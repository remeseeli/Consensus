import { config } from '../config.js';
import {
  getArticleByQid,
  getDiscrepanciesForArticle,
  getEditionsContentByQid,
  queryRankedArticlesByQidsOrFulltext,
  saveArticleDiscrepanciesTransaction,
  setTopicSearchCache,
  upsertArticleSummary,
  upsertEditionContent,
} from '../db/repository.js';
import type {
  ArticleAnalysisResponse,
  DiscrepancyRecord,
  EditionContentRecord,
  MismatchType,
  RankedArticleSummary,
  WikiLang,
} from '../types.js';
import {
  compareEditionsSemantically,
  runHeuristicDiscrepancyScan,
  type DetectedRawDiscrepancy,
} from './llmDiscrepancyService.js';
import {
  discoverLinkedCandidatesByTopic,
  fetchBatchEditionsForLanguage,
} from './mediawikiService.js';

// Fast in-memory caches so repeat searches and article clicks respond in < 5ms
const memorySearchCache = new Map<
  string,
  { expiresAt: number; articles: RankedArticleSummary[] }
>();
const memoryArticleCache = new Map<string, RankedArticleSummary>();
const memoryEditionsCache = new Map<string, Map<WikiLang, EditionContentRecord>>();
const memoryAnalysisCache = new Map<string, ArticleAnalysisResponse>();

export function computeWeightedPriorityScore(params: {
  sourceCount: number;
  maxRefCount: number;
  discrepancySeverity: number;
  discrepancyCount: number;
}): number {
  const lowSourceScore = (1 / (1 + Math.max(0, params.sourceCount) / 12)) * 100;
  const refGapBonus = Math.min(25, Math.max(0, params.maxRefCount - params.sourceCount) * 0.6);
  const severityScore = Math.max(0, Math.min(100, params.discrepancySeverity));
  const countBonus = Math.min(20, params.discrepancyCount * 7);

  return Number(
    Math.min(99.9, 0.42 * lowSourceScore + 0.43 * severityScore + 0.15 * (refGapBonus + countBonus)).toFixed(2)
  );
}

function toDiscrepancyRecords(
  qid: string,
  rawList: DetectedRawDiscrepancy[]
): DiscrepancyRecord[] {
  return rawList.map((raw, idx) => ({
    id: idx + 1,
    qid,
    mismatchType: raw.mismatchType,
    issueLabel: raw.issueLabel,
    targetLang: raw.targetLang,
    claimTopic: raw.claimTopic,
    summary: raw.summary,
    disputedSnippet: raw.disputedSnippet,
    sectionHeading: raw.sectionHeading,
    lineHint: raw.lineHint,
    suggestedCorrection: raw.suggestedCorrection,
    agreementMatrix: raw.agreementMatrix,
    citationGapFlag: raw.citationGapFlag,
    donorLang: raw.donorLang,
    brokenLinkDetected: false,
    brokenLinkUrl: null,
    severityScore: raw.severityScore,
    confidenceLevel: raw.severityScore >= 78 ? 'high' : 'medium',
    confidenceScore: Math.min(95, Math.round(raw.severityScore)),
    verifiedSources: [],
  }));
}

function inferIssueLabelFromRecord(disc: DiscrepancyRecord): string {
  if (disc.issueLabel) return disc.issueLabel;
  if (disc.mismatchType === 'hard_fact') return 'Different information';
  if (disc.mismatchType === 'outdated_data') return 'Outdated information';
  return 'Much fewer references';
}

export async function searchAndRankArticles(options: {
  query: string;
  filter?: MismatchType | 'all';
  forceRefresh?: boolean;
}): Promise<{
  query: string;
  filter: MismatchType | 'all';
  cached: boolean;
  totalReturned: number;
  articles: RankedArticleSummary[];
}> {
  const cleanedQuery = options.query.trim();
  const filter = options.filter || 'all';

  if (!cleanedQuery) {
    try {
      const initialArticles = await queryRankedArticlesByQidsOrFulltext({
        filter,
        limit: 25,
      });
      const enriched = initialArticles.map((art) => {
        const badges: string[] = [];
        if (art.mismatchFlags.hardFact) badges.push('Different information');
        const refs = [
          { code: 'FI', count: art.editions.fi.refCount, has: Boolean(art.editions.fi.title) },
          { code: 'SV', count: art.editions.sv.refCount, has: Boolean(art.editions.sv.title) },
          { code: 'RU', count: art.editions.ru.refCount, has: Boolean(art.editions.ru.title) },
        ].filter((r) => r.has);
        if (refs.length >= 2) {
          const sorted = [...refs].sort((a, b) => a.count - b.count);
          const minR = sorted[0];
          const maxR = sorted[sorted.length - 1];
          if (maxR.count >= 8 && maxR.count >= Math.max(minR.count * 2.5, minR.count + 6)) {
            badges.push(`Much fewer references (${minR.code}: ${minR.count} vs ${maxR.code}: ${maxR.count})`);
          } else if (art.mismatchFlags.missingCitation) {
            badges.push('Missing reference');
          }
        } else if (art.mismatchFlags.missingCitation) {
          badges.push('Missing reference');
        }
        if (art.mismatchFlags.outdatedData) badges.push('Outdated information');
        return { ...art, issueBadges: art.issueBadges?.length ? art.issueBadges : badges };
      });
      return {
        query: '',
        filter,
        cached: true,
        totalReturned: enriched.length,
        articles: enriched,
      };
    } catch {
      const memList = Array.from(memoryArticleCache.values()).slice(0, 25);
      return {
        query: '',
        filter,
        cached: true,
        totalReturned: memList.length,
        articles: memList,
      };
    }
  }

  const normalizedQuery = cleanedQuery.toLowerCase().replace(/\s+/g, ' ');

  if (!options.forceRefresh) {
    const memHit = memorySearchCache.get(normalizedQuery);
    if (memHit && memHit.expiresAt > Date.now()) {
      return {
        query: cleanedQuery,
        filter,
        cached: true,
        totalReturned: memHit.articles.length,
        articles: memHit.articles,
      };
    }
  }

  // Fast parallel candidate discovery (<= 15 candidates => 1 Wikidata call + 3 parallel MediaWiki calls)
  const candidates = await discoverLinkedCandidatesByTopic(cleanedQuery, 15);

  if (candidates.length === 0) {
    return {
      query: cleanedQuery,
      filter,
      cached: false,
      totalReturned: 0,
      articles: [],
    };
  }

  const fiBatchInput = candidates
    .filter((c) => Boolean(c.titles.fi))
    .map((c) => ({ qid: c.qid, title: c.titles.fi! }));
  const svBatchInput = candidates
    .filter((c) => Boolean(c.titles.sv))
    .map((c) => ({ qid: c.qid, title: c.titles.sv! }));
  const ruBatchInput = candidates
    .filter((c) => Boolean(c.titles.ru))
    .map((c) => ({ qid: c.qid, title: c.titles.ru! }));

  const [fiEditions, svEditions, ruEditions] = await Promise.all([
    fetchBatchEditionsForLanguage('fi', fiBatchInput),
    fetchBatchEditionsForLanguage('sv', svBatchInput),
    fetchBatchEditionsForLanguage('ru', ruBatchInput),
  ]);

  const rankedResults: RankedArticleSummary[] = [];
  const nowIso = new Date().toISOString();

  for (const cand of candidates) {
    const fiEd = fiEditions.get(cand.qid);
    const svEd = svEditions.get(cand.qid);
    const ruEd = ruEditions.get(cand.qid);

    const editionMap = new Map<WikiLang, EditionContentRecord>();
    if (fiEd) editionMap.set('fi', fiEd);
    if (svEd) editionMap.set('sv', svEd);
    if (ruEd) editionMap.set('ru', ruEd);

    if (editionMap.size < 2) continue;

    const availableRefs = Array.from(editionMap.values()).map((e) => e.refCount);
    const minSourceCount = Math.min(...availableRefs);
    const maxRefCount = Math.max(...availableRefs);
    const totalCnTags = Array.from(editionMap.values()).reduce(
      (sum, e) => sum + e.citationNeededTags,
      0
    );

    const quickScan = runHeuristicDiscrepancyScan(cand.canonicalLabel, editionMap);
    // Only surface articles that actually have at least 1 clear discrepancy / issue!
    if (quickScan.discrepancies.length === 0) {
      continue;
    }

    const maxSeverity = quickScan.discrepancies.reduce(
      (max, d) => (d.severityScore > max ? d.severityScore : max),
      50
    );

    const hasHardFact = quickScan.discrepancies.some((d) => d.mismatchType === 'hard_fact');
    const hasMissingCitation = quickScan.discrepancies.some(
      (d) => d.mismatchType === 'missing_citation'
    );
    const hasOutdatedData = quickScan.discrepancies.some(
      (d) => d.mismatchType === 'outdated_data'
    );

    const priorityScore = computeWeightedPriorityScore({
      sourceCount: minSourceCount,
      maxRefCount,
      discrepancySeverity: maxSeverity,
      discrepancyCount: quickScan.discrepancies.length,
    });

    const summaryObj: RankedArticleSummary = {
      qid: cand.qid,
      canonicalLabel: cand.canonicalLabel,
      topicKeywords: cleanedQuery,
      editions: {
        fi: {
          title: fiEd?.title || cand.titles.fi,
          url: fiEd?.articleUrl || cand.urls.fi,
          refCount: fiEd?.refCount ?? 0,
          pageviews30d: 0,
          lastRevAt: fiEd?.lastRevisionAt ?? null,
        },
        sv: {
          title: svEd?.title || cand.titles.sv,
          url: svEd?.articleUrl || cand.urls.sv,
          refCount: svEd?.refCount ?? 0,
          pageviews30d: 0,
          lastRevAt: svEd?.lastRevisionAt ?? null,
        },
        ru: {
          title: ruEd?.title || cand.titles.ru,
          url: ruEd?.articleUrl || cand.urls.ru,
          refCount: ruEd?.refCount ?? 0,
          pageviews30d: 0,
          lastRevAt: ruEd?.lastRevisionAt ?? null,
        },
      },
      editionCount: editionMap.size,
      sourceCount: minSourceCount,
      citationNeededCount: totalCnTags,
      pageviewCount: 0,
      discrepancyCount: quickScan.discrepancies.length,
      discrepancySeverity: maxSeverity,
      issueBadges: quickScan.issueBadges,
      mismatchFlags: {
        hardFact: hasHardFact,
        missingCitation: hasMissingCitation,
        outdatedData: hasOutdatedData,
      },
      priorityScore,
      lastSyncedAt: nowIso,
      deepAnalyzedAt: nowIso,
    };

    const discRecords = toDiscrepancyRecords(cand.qid, quickScan.discrepancies);

    memoryArticleCache.set(cand.qid, summaryObj);
    memoryEditionsCache.set(cand.qid, editionMap);
    memoryAnalysisCache.set(cand.qid, {
      article: summaryObj,
      overallSummary: quickScan.overallSummary,
      discrepancies: discRecords,
      analyzedWithLlm: false,
    });

    rankedResults.push(summaryObj);

    // Persist asynchronously to MariaDB without blocking HTTP response latency!
    void (async () => {
      try {
        await upsertArticleSummary({
          qid: cand.qid,
          canonicalLabel: cand.canonicalLabel,
          topicQuery: cleanedQuery,
          fiTitle: summaryObj.editions.fi.title,
          fiUrl: summaryObj.editions.fi.url,
          svTitle: summaryObj.editions.sv.title,
          svUrl: summaryObj.editions.sv.url,
          ruTitle: summaryObj.editions.ru.title,
          ruUrl: summaryObj.editions.ru.url,
          editionCount: summaryObj.editionCount,
          fiRefCount: summaryObj.editions.fi.refCount,
          svRefCount: summaryObj.editions.sv.refCount,
          ruRefCount: summaryObj.editions.ru.refCount,
          sourceCount: minSourceCount,
          citationNeededCount: totalCnTags,
          fiPageviews30d: 0,
          svPageviews30d: 0,
          ruPageviews30d: 0,
          pageviewCount: 0,
          fiLastRevAt: summaryObj.editions.fi.lastRevAt,
          svLastRevAt: summaryObj.editions.sv.lastRevAt,
          ruLastRevAt: summaryObj.editions.ru.lastRevAt,
          discrepancyCount: discRecords.length,
          discrepancySeverity: maxSeverity,
          hasHardFact,
          hasMissingCitation,
          hasOutdatedData,
          priorityScore,
        });
        for (const ed of editionMap.values()) {
          await upsertEditionContent(ed);
        }
        await saveArticleDiscrepanciesTransaction(cand.qid, discRecords, priorityScore);
      } catch {
        // Non-blocking background DB sync
      }
    })();
  }

  rankedResults.sort((a, b) => b.priorityScore - a.priorityScore);

  memorySearchCache.set(normalizedQuery, {
    expiresAt: Date.now() + config.searchCacheTtlSeconds * 1000,
    articles: rankedResults,
  });

  void setTopicSearchCache(
    normalizedQuery,
    cleanedQuery,
    rankedResults.map((r) => r.qid),
    config.searchCacheTtlSeconds
  ).catch(() => {});

  return {
    query: cleanedQuery,
    filter,
    cached: false,
    totalReturned: rankedResults.length,
    articles: rankedResults,
  };
}

export async function analyzeArticleByQid(
  qid: string,
  forceDeepLlm = false
): Promise<ArticleAnalysisResponse> {
  const normalizedQid = qid.trim().toUpperCase();

  // Instant (< 2ms) return from pre-computed in-memory scan unless deep LLM refresh requested
  if (!forceDeepLlm) {
    const memAnalysis = memoryAnalysisCache.get(normalizedQid);
    if (memAnalysis) {
      return memAnalysis;
    }
  }

  let article = memoryArticleCache.get(normalizedQid) || null;
  if (!article) {
    try {
      article = await getArticleByQid(normalizedQid);
    } catch {
      article = null;
    }
  }

  if (!article) {
    throw new Error(`Article "${normalizedQid}" was not found.`);
  }

  if (!forceDeepLlm) {
    try {
      const dbDiscrepancies = await getDiscrepanciesForArticle(normalizedQid);
      if (dbDiscrepancies.length > 0) {
        const withLabels = dbDiscrepancies.map((d) => ({
          ...d,
          issueLabel: inferIssueLabelFromRecord(d),
        }));
        const response: ArticleAnalysisResponse = {
          article,
          overallSummary: `Found ${withLabels.length} discrepancy issue(s) across FI, SV, and RU editions.`,
          discrepancies: withLabels,
          analyzedWithLlm: false,
        };
        memoryAnalysisCache.set(normalizedQid, response);
        return response;
      }
    } catch {
      // Fallback to live edition check
    }
  }

  let editionsMap = memoryEditionsCache.get(normalizedQid);
  if (!editionsMap || editionsMap.size < 2) {
    try {
      editionsMap = await getEditionsContentByQid(normalizedQid);
    } catch {
      editionsMap = new Map();
    }
  }

  if (editionsMap.size < 2) {
    const fetchTasks: Promise<Map<string, EditionContentRecord>>[] = [];
    if (article.editions.fi.title) {
      fetchTasks.push(
        fetchBatchEditionsForLanguage('fi', [
          { qid: normalizedQid, title: article.editions.fi.title },
        ])
      );
    }
    if (article.editions.sv.title) {
      fetchTasks.push(
        fetchBatchEditionsForLanguage('sv', [
          { qid: normalizedQid, title: article.editions.sv.title },
        ])
      );
    }
    if (article.editions.ru.title) {
      fetchTasks.push(
        fetchBatchEditionsForLanguage('ru', [
          { qid: normalizedQid, title: article.editions.ru.title },
        ])
      );
    }

    const fetchedMaps = await Promise.all(fetchTasks);
    editionsMap = new Map<WikiLang, EditionContentRecord>();
    for (const m of fetchedMaps) {
      const rec = m.get(normalizedQid);
      if (rec) editionsMap.set(rec.lang, rec);
    }
    memoryEditionsCache.set(normalizedQid, editionsMap);
  }

  const comparison = forceDeepLlm
    ? await compareEditionsSemantically(article.canonicalLabel, editionsMap)
    : runHeuristicDiscrepancyScan(article.canonicalLabel, editionsMap);

  const discRecords = toDiscrepancyRecords(normalizedQid, comparison.discrepancies);

  const result: ArticleAnalysisResponse = {
    article: {
      ...article,
      discrepancyCount: discRecords.length,
      issueBadges: comparison.issueBadges,
    },
    overallSummary: comparison.overallSummary,
    discrepancies: discRecords,
    analyzedWithLlm: comparison.analyzedWithLlm,
  };

  memoryAnalysisCache.set(normalizedQid, result);
  void saveArticleDiscrepanciesTransaction(normalizedQid, discRecords, article.priorityScore).catch(
    () => {}
  );

  return result;
}

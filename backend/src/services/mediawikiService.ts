import { config } from '../config.js';
import { getExternalCache, setExternalCache } from '../db/repository.js';
import type { EditionContentRecord, ParsedRefItem, WikiLang } from '../types.js';
import { fetchWithRetry, limiters } from '../utils/rateLimiter.js';

export interface LinkedTrilingualCandidate {
  qid: string;
  canonicalLabel: string;
  titles: Record<WikiLang, string | null>;
  urls: Record<WikiLang, string | null>;
  editionCount: number;
}

const CITATION_NEEDED_PATTERNS: Record<WikiLang, RegExp> = {
  fi: /\{\{\s*(?:lähde|lähde tarkemmin|kenen mukaan|lähde\?)\b[^}]*\}\}/gi,
  sv: /\{\{\s*(?:källa behövs|kb|vem|källa)\b[^}]*\}\}/gi,
  ru: /\{\{\s*(?:нет аи|источник|нет источника|проверить факты)\b[^}]*\}\}/gi,
};

function encodeWikiTitleForPath(title: string): string {
  return encodeURIComponent(title.replace(/ /g, '_'));
}

export function buildWikipediaUrl(lang: WikiLang, title: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeWikiTitleForPath(title)}`;
}

async function searchSingleWikiForQids(
  lang: WikiLang | 'en',
  query: string,
  limit = 15
): Promise<string[]> {
  const cacheDesc = `fast_qids:${lang}:${query.toLowerCase()}:${limit}`;
  const cached = await getExternalCache<string[]>('mediawiki', cacheDesc);
  if (cached) return cached;

  try {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '0',
      gsrlimit: String(limit),
      prop: 'pageprops',
      ppprop: 'wikibase_item',
      format: 'json',
      formatversion: '2',
    });

    const url = `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`;
    const res = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': config.wikimediaUserAgent } },
      { timeoutMs: 5500, limiter: limiters.mediawiki }
    );
    if (!res.ok) return [];

    interface GenSearchResponse {
      query?: {
        pages?: Array<{
          index?: number;
          pageprops?: { wikibase_item?: string };
        }>;
      };
    }

    const data = (await res.json()) as GenSearchResponse;
    const sortedPages = (data.query?.pages || []).sort(
      (a, b) => (a.index ?? 999) - (b.index ?? 999)
    );

    const qids = sortedPages
      .map((p) => p.pageprops?.wikibase_item)
      .filter((q): q is string => Boolean(q && /^Q\d+$/.test(q)));

    void setExternalCache('mediawiki', cacheDesc, qids, config.searchCacheTtlSeconds);
    return qids;
  } catch {
    return [];
  }
}

export async function discoverLinkedCandidatesByTopic(
  topicQuery: string,
  maxCandidates = 15
): Promise<LinkedTrilingualCandidate[]> {
  const [enQids, fiQids, svQids, ruQids] = await Promise.all([
    searchSingleWikiForQids('en', topicQuery, 15),
    searchSingleWikiForQids('fi', topicQuery, 15),
    searchSingleWikiForQids('sv', topicQuery, 12),
    searchSingleWikiForQids('ru', topicQuery, 12),
  ]);

  const uniqueQids: string[] = [];
  const seen = new Set<string>();

  for (const list of [enQids, fiQids, svQids, ruQids]) {
    for (const qid of list) {
      if (!seen.has(qid)) {
        seen.add(qid);
        uniqueQids.push(qid);
      }
      if (uniqueQids.length >= 35) break;
    }
    if (uniqueQids.length >= 35) break;
  }

  if (uniqueQids.length === 0) return [];

  // Single Wikidata call (<= 35 Q-IDs fits in 1 HTTP request)
  const batchKey = `wbgetentities_fast:${uniqueQids.join(',')}`;
  let entitiesMap = await getExternalCache<Record<string, unknown>>('wikidata', batchKey);

  if (!entitiesMap) {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: uniqueQids.join('|'),
      props: 'sitelinks|labels',
      sitefilter: 'fiwiki|svwiki|ruwiki|enwiki',
      languages: 'en|fi|sv|ru',
      format: 'json',
    });
    const wdUrl = `https://www.wikidata.org/w/api.php?${params.toString()}`;
    const res = await fetchWithRetry(
      wdUrl,
      { headers: { 'User-Agent': config.wikimediaUserAgent } },
      { timeoutMs: 6000, limiter: limiters.wikidata }
    );

    if (res.ok) {
      const json = (await res.json()) as { entities?: Record<string, unknown> };
      entitiesMap = json.entities || {};
      void setExternalCache('wikidata', batchKey, entitiesMap, config.apiCacheTtlSeconds);
    } else {
      entitiesMap = {};
    }
  }

  interface WikidataEntity {
    labels?: Record<string, { value?: string }>;
    sitelinks?: Record<string, { title?: string }>;
  }

  const candidates: LinkedTrilingualCandidate[] = [];
  for (const qid of uniqueQids) {
    const ent = (entitiesMap as Record<string, WikidataEntity>)[qid];
    if (!ent || !ent.sitelinks) continue;

    const fiTitle = ent.sitelinks.fiwiki?.title || null;
    const svTitle = ent.sitelinks.svwiki?.title || null;
    const ruTitle = ent.sitelinks.ruwiki?.title || null;

    const editionCount = [fiTitle, svTitle, ruTitle].filter(Boolean).length;
    if (editionCount < 2) continue;

    const label =
      ent.labels?.en?.value ||
      ent.sitelinks.enwiki?.title ||
      fiTitle ||
      svTitle ||
      ruTitle ||
      qid;

    candidates.push({
      qid,
      canonicalLabel: label,
      titles: { fi: fiTitle, sv: svTitle, ru: ruTitle },
      urls: {
        fi: fiTitle ? buildWikipediaUrl('fi', fiTitle) : null,
        sv: svTitle ? buildWikipediaUrl('sv', svTitle) : null,
        ru: ruTitle ? buildWikipediaUrl('ru', ruTitle) : null,
      },
      editionCount,
    });

    if (candidates.length >= maxCandidates) break;
  }

  return candidates;
}

function stripWikitextToPlainSnippet(raw: string): string {
  return raw
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/''+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseWikitextReferencesAndInfobox(
  lang: WikiLang,
  wikitext: string
): {
  refCount: number;
  citationNeededTags: number;
  citationNeededSnippets: string[];
  extractedRefs: ParsedRefItem[];
  infobox: Record<string, string>;
} {
  if (!wikitext) {
    return {
      refCount: 0,
      citationNeededTags: 0,
      citationNeededSnippets: [],
      extractedRefs: [],
      infobox: {},
    };
  }

  // Fast count of <ref> tags without heavy regex backtracking over huge strings
  const openRefMatches = wikitext.match(/<ref\b[^/>]*>/gi);
  const selfRefMatches = wikitext.match(/<ref\b[^>]*\/>/gi);
  const sfnMatches = wikitext.match(/\{\{\s*(?:sfn|harvnb|viite)\b/gi);

  const fullRefCount = openRefMatches ? openRefMatches.length : 0;
  const reuseCount = selfRefMatches ? Math.floor(selfRefMatches.length * 0.4) : 0;
  const effectiveRefCount = fullRefCount + reuseCount + (sfnMatches?.length || 0);

  // Extract sentences right before {{Lähde}} / {{Källa behövs}} / {{Нет АИ}} tags
  const cnRegex = new RegExp(CITATION_NEEDED_PATTERNS[lang].source, 'gi');
  const citationNeededSnippets: string[] = [];
  let citationNeededTags = 0;
  let cnMatch: RegExpExecArray | null;

  while ((cnMatch = cnRegex.exec(wikitext)) !== null) {
    citationNeededTags += 1;
    if (citationNeededSnippets.length < 3) {
      const startWindow = Math.max(0, cnMatch.index - 220);
      const preceding = wikitext.slice(startWindow, cnMatch.index);
      const lastBreak = Math.max(
        preceding.lastIndexOf('\n'),
        preceding.lastIndexOf('. ')
      );
      const rawSentence =
        lastBreak !== -1 ? preceding.slice(lastBreak + 1) : preceding;
      const cleanSnippet = stripWikitextToPlainSnippet(rawSentence);
      if (cleanSnippet.length >= 18) {
        citationNeededSnippets.push(cleanSnippet.slice(0, 140));
      }
    }
  }

  // Parse top infobox key-value lines from first 7,000 chars only (super fast)
  const infobox: Record<string, string> = {};
  const lines = wikitext.slice(0, 7000).split('\n');
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith('|')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(1, eqIdx).trim();
    const rawVal = trimmed.slice(eqIdx + 1).trim();
    if (!key || !rawVal || key.length > 40) continue;

    const val = stripWikitextToPlainSnippet(rawVal);
    if (val.length >= 1 && val.length <= 140 && !/\.(svg|jpg|png|webp)\b/i.test(val)) {
      infobox[key] = val;
      if (Object.keys(infobox).length >= 16) break;
    }
  }

  return {
    refCount: effectiveRefCount,
    citationNeededTags,
    citationNeededSnippets,
    extractedRefs: [],
    infobox,
  };
}

/**
 * Fetches ALL candidate articles (up to 15) in ONE single MediaWiki API call per language!
 * Uses exintro=1 + explaintext=1 + exlimit=max so MediaWiki returns lead extracts for
 * every page in the batch simultaneously alongside revision metadata.
 */
export async function fetchBatchEditionsForLanguage(
  lang: WikiLang,
  items: Array<{ qid: string; title: string }>
): Promise<Map<string, EditionContentRecord>> {
  const resultMap = new Map<string, EditionContentRecord>();
  if (items.length === 0) return resultMap;

  const chunkSize = 15;
  const batches: Array<Array<{ qid: string; title: string }>> = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    batches.push(items.slice(i, i + chunkSize));
  }

  await Promise.all(
    batches.map(async (slice) => {
      const titleToQid = new Map<string, string>();
      for (const it of slice) {
        titleToQid.set(it.title.toLowerCase(), it.qid);
      }

      const params = new URLSearchParams({
        action: 'query',
        titles: slice.map((s) => s.title).join('|'),
        prop: 'revisions|extracts|info',
        rvprop: 'timestamp|content',
        rvslots: 'main',
        exintro: '1',
        explaintext: '1',
        exlimit: 'max',
        inprop: 'url',
        redirects: '1',
        format: 'json',
        formatversion: '2',
      });

      try {
        const url = `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`;
        const res = await fetchWithRetry(
          url,
          { headers: { 'User-Agent': config.wikimediaUserAgent } },
          { timeoutMs: 8000, limiter: limiters.mediawiki }
        );
        if (!res.ok) return;

        interface BatchPageResponse {
          query?: {
            redirects?: Array<{ from: string; to: string }>;
            pages?: Array<{
              title: string;
              missing?: boolean;
              fullurl?: string;
              extract?: string;
              revisions?: Array<{
                timestamp?: string;
                slots?: { main?: { content?: string } };
                content?: string;
              }>;
            }>;
          };
        }

        const data = (await res.json()) as BatchPageResponse;
        for (const redir of data.query?.redirects || []) {
          const mappedQid = titleToQid.get(redir.from.toLowerCase());
          if (mappedQid) {
            titleToQid.set(redir.to.toLowerCase(), mappedQid);
          }
        }

        for (const page of data.query?.pages || []) {
          if (page.missing) continue;
          const qid =
            titleToQid.get(page.title.toLowerCase()) ||
            slice.find((s) => s.title.toLowerCase() === page.title.toLowerCase())?.qid;
          if (!qid) continue;

          const rev = page.revisions?.[0];
          const wikitext = rev?.slots?.main?.content || rev?.content || '';
          const parsed = parseWikitextReferencesAndInfobox(lang, wikitext);

          resultMap.set(qid, {
            qid,
            lang,
            title: page.title,
            articleUrl: page.fullurl || buildWikipediaUrl(lang, page.title),
            leadExtract: (page.extract || '').trim(),
            infobox: parsed.infobox,
            extractedRefs: parsed.extractedRefs,
            citationNeededSnippets: parsed.citationNeededSnippets,
            refCount: parsed.refCount,
            citationNeededTags: parsed.citationNeededTags,
            lastRevisionAt: rev?.timestamp || null,
          });
        }
      } catch {
        // Non-fatal
      }
    })
  );

  return resultMap;
}

export async function fetchArticlePageviews30d(
  _lang: WikiLang,
  _title: string | null
): Promise<number> {
  return 0;
}

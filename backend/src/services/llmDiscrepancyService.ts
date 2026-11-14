import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type, type Schema } from '@google/genai';
import { config } from '../config.js';
import type {
  DetectedIssueInput,
  EditionClaimStatus,
  EditionContentRecord,
  LanguageAgreementMatrix,
  MismatchType,
  MultiLangEditionInput,
  SemanticAnalysisResponse,
  SemanticDiscrepancyRecord,
  SemanticMismatchType,
  WikiLang,
} from '../types.js';

export interface DetectedRawDiscrepancy {
  mismatchType: MismatchType;
  issueLabel: string;
  targetLang: WikiLang;
  claimTopic: string;
  summary: string;
  disputedSnippet: string;
  sectionHeading: string | null;
  lineHint: number | null;
  suggestedCorrection: string;
  agreementMatrix: LanguageAgreementMatrix;
  citationGapFlag: boolean;
  donorLang: WikiLang | null;
  severityScore: number;
}

export interface CrossLingualComparisonResult {
  overallSummary: string;
  issueBadges: string[];
  discrepancies: DetectedRawDiscrepancy[];
  analyzedWithLlm: boolean;
}

const LANG_FULL_NAME: Record<WikiLang, string> = {
  fi: 'Finnish',
  sv: 'Swedish',
  ru: 'Russian',
};

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI | null {
  if (!config.llmEnabled || !config.geminiApiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return aiClient;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 16);
}

function firstCleanSentence(text: string): string {
  const sents = splitSentences(text);
  const first = sents[0] || text.replace(/\s+/g, ' ').trim();
  return first.length > 135 ? first.slice(0, 130).trim() : first;
}

interface ExtractedNumberFact {
  raw: string;
  normalized: string;
  numericValue: number;
  isYear: boolean;
  sentence: string;
}

function extractNumericFacts(text: string): ExtractedNumberFact[] {
  const sents = splitSentences(text);
  const facts: ExtractedNumberFact[] = [];
  const seen = new Set<string>();

  // Match multi-digit quantities (e.g., 25 904, 126,875, 480, 72.5%) and years (1500-2029)
  const numRegex = /\b\d{1,3}(?:[\s\u00a0.,]\d{3})+(?:[.,]\d+)?%?|\b(1[5-9]\d{2}|20[0-2]\d)\b|\b\d{2,4}(?:[.,]\d+)?\s*(?:%|km²|km|m)\b/gi;

  for (const sent of sents.slice(0, 8)) {
    let m: RegExpExecArray | null;
    while ((m = numRegex.exec(sent)) !== null) {
      const raw = m[0].trim();
      const digitsOnly = raw.replace(/[^\d]/g, '');
      if (digitsOnly.length < 3 || seen.has(digitsOnly)) continue;

      const val = Number(digitsOnly);
      if (!Number.isFinite(val) || val === 0) continue;

      const isYear = digitsOnly.length === 4 && val >= 1500 && val <= 2029;
      seen.add(digitsOnly);
      facts.push({
        raw,
        normalized: digitsOnly,
        numericValue: val,
        isYear,
        sentence: sent.length > 140 ? sent.slice(0, 136).trim() : sent,
      });
      if (facts.length >= 10) return facts;
    }
  }
  return facts;
}

/**
 * Fast, deterministic cross-lingual issue scanner (< 3ms per article) that clearly surfaces:
 * 1) "Different information" (conflicting numbers, dates, or statistics across FI/SV/RU)
 * 2) "Much fewer references" (major reference count gap across editions)
 * 3) "Missing reference" (explicit [citation needed] tags in one edition)
 * 4) "Outdated information" (stale edition or older latest year than sibling editions)
 */
export function runHeuristicDiscrepancyScan(
  canonicalLabel: string,
  editions: Map<WikiLang, EditionContentRecord>
): CrossLingualComparisonResult {
  const fi = editions.get('fi');
  const sv = editions.get('sv');
  const ru = editions.get('ru');
  const available = [fi, sv, ru].filter((e): e is EditionContentRecord => Boolean(e));

  if (available.length < 2) {
    return {
      overallSummary: 'Fewer than two language editions exist for this article.',
      issueBadges: [],
      discrepancies: [],
      analyzedWithLlm: false,
    };
  }

  const discrepancies: DetectedRawDiscrepancy[] = [];
  const issueBadges: string[] = [];

  const sortedByRefs = [...available].sort((a, b) => a.refCount - b.refCount);
  const minEd = sortedByRefs[0];
  const maxEd = sortedByRefs[sortedByRefs.length - 1];

  // --------------------------------------------------------------------------
  // CHECK 1: DIFFERENT INFORMATION (Conflicting numbers, dates, or statistics)
  // --------------------------------------------------------------------------
  const factsByLang: Record<WikiLang, ExtractedNumberFact[]> = {
    fi: fi ? extractNumericFacts(fi.leadExtract) : [],
    sv: sv ? extractNumericFacts(sv.leadExtract) : [],
    ru: ru ? extractNumericFacts(ru.leadExtract) : [],
  };

  for (const ed of available) {
    const ownFacts = factsByLang[ed.lang];
    const siblingEditions = available.filter((a) => a.lang !== ed.lang);

    // Look for a significant statistic (non-year >= 100 or year) in ed that differs from numbers in siblings
    const conflictingFact = ownFacts.find((fact) => {
      const siblingHaveNumbers = siblingEditions.some(
        (sib) => factsByLang[sib.lang].length > 0
      );
      if (!siblingHaveNumbers) return false;

      // Exact match in any sibling -> consistent, not a conflict
      const matchedInSibling = siblingEditions.some((sib) =>
        factsByLang[sib.lang].some((sf) => sf.normalized === fact.normalized)
      );
      if (matchedInSibling) return false;

      // Prefer non-year statistics (populations, casualties, measurements, counts) or conflicting dates
      return !fact.isYear || siblingEditions.every((sib) =>
        factsByLang[sib.lang].some((sf) => sf.isYear && Math.abs(sf.numericValue - fact.numericValue) <= 15)
      );
    });

    if (conflictingFact) {
      const formatLangClaim = (lang: WikiLang): string => {
        const langEd = editions.get(lang);
        if (!langEd) return 'Article missing';
        if (lang === ed.lang) return `${conflictingFact.raw} — "${conflictingFact.sentence}"`;
        const comparable = factsByLang[lang].find((f) => f.isYear === conflictingFact.isYear) || factsByLang[lang][0];
        if (comparable) {
          return `${comparable.raw} — "${comparable.sentence}"`;
        }
        return `States different details (${firstCleanSentence(langEd.leadExtract).slice(0, 85)}...)`;
      };

      const otherLangNames = siblingEditions.map((s) => LANG_FULL_NAME[s.lang]).join(' and ');

      discrepancies.push({
        mismatchType: 'hard_fact',
        issueLabel: 'Different information',
        targetLang: ed.lang,
        claimTopic: `Conflicting figure "${conflictingFact.raw}" in ${LANG_FULL_NAME[ed.lang]} Wikipedia`,
        summary: `${LANG_FULL_NAME[ed.lang]} Wikipedia states "${conflictingFact.raw}", which differs from the figures reported in ${otherLangNames} Wikipedia.`,
        disputedSnippet: conflictingFact.sentence,
        sectionHeading: null,
        lineHint: 1,
        suggestedCorrection: `Different information detected: ${LANG_FULL_NAME[ed.lang]} reports "${conflictingFact.raw}" while ${otherLangNames} editions state different figures.`,
        agreementMatrix: {
          consensusGroup: siblingEditions.map((s) => s.lang),
          outlierGroup: [ed.lang],
          matrixLabel: `Different information in ${ed.lang.toUpperCase()} ("${conflictingFact.raw}")`,
          claims: {
            fi: {
              value: formatLangClaim('fi'),
              hasCitation: Boolean(fi && fi.refCount > 5),
              citationStatus: !fi ? 'edition_missing' : fi.refCount > 5 ? 'valid' : 'missing',
            },
            sv: {
              value: formatLangClaim('sv'),
              hasCitation: Boolean(sv && sv.refCount > 5),
              citationStatus: !sv ? 'edition_missing' : sv.refCount > 5 ? 'valid' : 'missing',
            },
            ru: {
              value: formatLangClaim('ru'),
              hasCitation: Boolean(ru && ru.refCount > 5),
              citationStatus: !ru ? 'edition_missing' : ru.refCount > 5 ? 'valid' : 'missing',
            },
          },
        },
        citationGapFlag: ed.refCount < maxEd.refCount,
        donorLang: maxEd.lang !== ed.lang ? maxEd.lang : null,
        severityScore: 84,
      });

      issueBadges.push('Different information');
      break;
    }
  }

  // --------------------------------------------------------------------------
  // CHECK 2: MUCH FEWER REFERENCES (Under-sourced edition vs well-sourced edition)
  // --------------------------------------------------------------------------
  const hasLargeRefGap =
    (minEd.refCount <= 12 && maxEd.refCount >= minEd.refCount * 2 + 4) ||
    (minEd.refCount <= 3 && maxEd.refCount >= 5) ||
    (maxEd.refCount >= 30 && minEd.refCount <= Math.floor(maxEd.refCount * 0.25));

  if (hasLargeRefGap) {
    const snippet = firstCleanSentence(minEd.leadExtract);
    if (snippet) {
      discrepancies.push({
        mismatchType: 'missing_citation',
        issueLabel: 'Much fewer references',
        targetLang: minEd.lang,
        claimTopic: `Much fewer references in ${LANG_FULL_NAME[minEd.lang]} (${minEd.refCount} vs. ${maxEd.refCount} in ${LANG_FULL_NAME[maxEd.lang]})`,
        summary: `${LANG_FULL_NAME[minEd.lang]} Wikipedia has only ${minEd.refCount} references, while ${LANG_FULL_NAME[maxEd.lang]} Wikipedia has ${maxEd.refCount} references for "${canonicalLabel}". Many claims in ${LANG_FULL_NAME[minEd.lang]} lack verification.`,
        disputedSnippet: snippet,
        sectionHeading: null,
        lineHint: 1,
        suggestedCorrection: `Much fewer references: ${LANG_FULL_NAME[minEd.lang]} has only ${minEd.refCount} references compared with ${maxEd.refCount} in ${LANG_FULL_NAME[maxEd.lang]} Wikipedia.`,
        agreementMatrix: {
          consensusGroup: [maxEd.lang],
          outlierGroup: [minEd.lang],
          matrixLabel: `References: FI ${fi?.refCount ?? '—'} · SV ${sv?.refCount ?? '—'} · RU ${ru?.refCount ?? '—'}`,
          claims: {
            fi: {
              value: fi ? `${fi.refCount} references` : 'Article missing',
              hasCitation: Boolean(fi && fi.refCount > 8),
              citationStatus: !fi ? 'edition_missing' : fi.refCount > 8 ? 'valid' : 'missing',
            },
            sv: {
              value: sv ? `${sv.refCount} references` : 'Article missing',
              hasCitation: Boolean(sv && sv.refCount > 8),
              citationStatus: !sv ? 'edition_missing' : sv.refCount > 8 ? 'valid' : 'missing',
            },
            ru: {
              value: ru ? `${ru.refCount} references` : 'Article missing',
              hasCitation: Boolean(ru && ru.refCount > 8),
              citationStatus: !ru ? 'edition_missing' : ru.refCount > 8 ? 'valid' : 'missing',
            },
          },
        },
        citationGapFlag: true,
        donorLang: maxEd.lang,
        severityScore: Math.min(92, 62 + Math.min(28, maxEd.refCount - minEd.refCount)),
      });

      issueBadges.push(
        `Much fewer references (${minEd.lang.toUpperCase()}: ${minEd.refCount} vs ${maxEd.lang.toUpperCase()}: ${maxEd.refCount})`
      );
    }
  }

  // --------------------------------------------------------------------------
  // CHECK 3: EXPLICIT [CITATION NEEDED] TAGS ({{Lähde}} / {{Källa behövs}} / {{Нет АИ}})
  // --------------------------------------------------------------------------
  for (const ed of available) {
    if (ed.citationNeededTags > 0) {
      const exactTaggedSentence =
        ed.citationNeededSnippets?.[0] || firstCleanSentence(ed.leadExtract);
      if (exactTaggedSentence) {
        discrepancies.push({
          mismatchType: 'missing_citation',
          issueLabel: 'Missing reference',
          targetLang: ed.lang,
          claimTopic: `${ed.citationNeededTags} "[citation needed]" tag(s) in ${LANG_FULL_NAME[ed.lang]} Wikipedia`,
          summary: `${LANG_FULL_NAME[ed.lang]} Wikipedia explicitly marks ${ed.citationNeededTags} claim(s) as lacking a reliable source.`,
          disputedSnippet: exactTaggedSentence,
          sectionHeading: null,
          lineHint: 1,
          suggestedCorrection: `This claim is flagged as needing a reference in ${LANG_FULL_NAME[ed.lang]} Wikipedia.`,
          agreementMatrix: {
            consensusGroup: available.filter((a) => a.lang !== ed.lang && a.citationNeededTags === 0).map((a) => a.lang),
            outlierGroup: [ed.lang],
            matrixLabel: `${ed.citationNeededTags} unsourced claim tag(s) in ${ed.lang.toUpperCase()}`,
            claims: {
              fi: {
                value: fi ? `${fi.citationNeededTags} [citation needed] tags (${fi.refCount} refs)` : 'Missing',
                hasCitation: Boolean(fi && fi.citationNeededTags === 0),
                citationStatus: !fi ? 'edition_missing' : fi.citationNeededTags === 0 ? 'valid' : 'missing',
              },
              sv: {
                value: sv ? `${sv.citationNeededTags} [citation needed] tags (${sv.refCount} refs)` : 'Missing',
                hasCitation: Boolean(sv && sv.citationNeededTags === 0),
                citationStatus: !sv ? 'edition_missing' : sv.citationNeededTags === 0 ? 'valid' : 'missing',
              },
              ru: {
                value: ru ? `${ru.citationNeededTags} [citation needed] tags (${ru.refCount} refs)` : 'Missing',
                hasCitation: Boolean(ru && ru.citationNeededTags === 0),
                citationStatus: !ru ? 'edition_missing' : ru.citationNeededTags === 0 ? 'valid' : 'missing',
              },
            },
          },
          citationGapFlag: true,
          donorLang: maxEd.lang !== ed.lang ? maxEd.lang : null,
          severityScore: 78,
        });

        if (!issueBadges.some((b) => b.includes('Missing reference'))) {
          issueBadges.push(`Missing reference (${ed.lang.toUpperCase()})`);
        }
        break;
      }
    }
  }

  // --------------------------------------------------------------------------
  // CHECK 4: OUTDATED INFORMATION (Stale edition > 12 months behind sibling)
  // --------------------------------------------------------------------------
  const datedEditions = available
    .filter((e) => Boolean(e.lastRevisionAt))
    .map((e) => ({ ed: e, ts: new Date(e.lastRevisionAt!).getTime() }))
    .filter((x) => Number.isFinite(x.ts))
    .sort((a, b) => a.ts - b.ts);

  if (datedEditions.length >= 2) {
    const oldest = datedEditions[0];
    const newest = datedEditions[datedEditions.length - 1];
    const diffMonths = Math.round((newest.ts - oldest.ts) / (1000 * 60 * 60 * 24 * 30.4));

    if (diffMonths >= 12) {
      const snippet = firstCleanSentence(oldest.ed.leadExtract);
      if (snippet) {
        const oldDate = oldest.ed.lastRevisionAt!.slice(0, 10);
        const newDate = newest.ed.lastRevisionAt!.slice(0, 10);

        discrepancies.push({
          mismatchType: 'outdated_data',
          issueLabel: 'Outdated information',
          targetLang: oldest.ed.lang,
          claimTopic: `${LANG_FULL_NAME[oldest.ed.lang]} article not updated for ${diffMonths} months`,
          summary: `${LANG_FULL_NAME[oldest.ed.lang]} Wikipedia was last edited on ${oldDate}, while ${LANG_FULL_NAME[newest.ed.lang]} Wikipedia was updated on ${newDate}.`,
          disputedSnippet: snippet,
          sectionHeading: null,
          lineHint: 1,
          suggestedCorrection: `Outdated edition: ${LANG_FULL_NAME[oldest.ed.lang]} has not been updated since ${oldDate} (${diffMonths} months behind ${LANG_FULL_NAME[newest.ed.lang]}).`,
          agreementMatrix: {
            consensusGroup: [newest.ed.lang],
            outlierGroup: [oldest.ed.lang],
            matrixLabel: `Last updated: ${newest.ed.lang.toUpperCase()} (${newDate}) vs ${oldest.ed.lang.toUpperCase()} (${oldDate})`,
            claims: {
              fi: {
                value: fi?.lastRevisionAt ? `Updated ${fi.lastRevisionAt.slice(0, 10)}` : 'Missing',
                hasCitation: true,
                citationStatus: !fi ? 'edition_missing' : 'valid',
              },
              sv: {
                value: sv?.lastRevisionAt ? `Updated ${sv.lastRevisionAt.slice(0, 10)}` : 'Missing',
                hasCitation: true,
                citationStatus: !sv ? 'edition_missing' : 'valid',
              },
              ru: {
                value: ru?.lastRevisionAt ? `Updated ${ru.lastRevisionAt.slice(0, 10)}` : 'Missing',
                hasCitation: true,
                citationStatus: !ru ? 'edition_missing' : 'valid',
              },
            },
          },
          citationGapFlag: false,
          donorLang: newest.ed.lang,
          severityScore: Math.min(82, 52 + diffMonths),
        });

        issueBadges.push(`Outdated (${oldest.ed.lang.toUpperCase()})`);
      }
    }
  }

  return {
    overallSummary:
      discrepancies.length > 0
        ? `Found ${discrepancies.length} issue(s) across FI, SV, and RU Wikipedia.`
        : 'No major discrepancies detected across FI, SV, and RU.',
    issueBadges,
    discrepancies,
    analyzedWithLlm: false,
  };
}

const MULTI_LANG_SEMANTIC_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    overallSummary: {
      type: Type.STRING,
      description: '1 concise English sentence (max 25 words) summarizing how editions compare.',
    },
    discrepancies: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          mismatchType: {
            type: Type.STRING,
            enum: ['hard_fact', 'missing_citation', 'outdated_data', 'neutrality_bias'],
          },
          issueLabel: {
            type: Type.STRING,
            enum: [
              'Different information',
              'Much fewer references',
              'Missing reference',
              'Not neutral (emotional tone)',
              'Outdated information',
            ],
          },
          targetLang: {
            type: Type.STRING,
          },
          claimTopic: {
            type: Type.STRING,
            description: 'Short 3-7 word English heading.',
          },
          summary: {
            type: Type.STRING,
            description: '1 concise English sentence (max 22 words).',
          },
          disputedSnippet: {
            type: Type.STRING,
            description: 'Exact verbatim 5-12 word phrase from targetLang extract.',
          },
          highlightPhrase: {
            type: Type.STRING,
            description: 'Exact 2-6 word differing phrase inside disputedSnippet.',
          },
          snippetEnglishTranslation: {
            type: Type.STRING,
            description: 'Concise English translation of disputedSnippet.',
          },
          suggestedCorrection: {
            type: Type.STRING,
            description: '1 short English fix suggestion (max 18 words).',
          },
          severityScore: {
            type: Type.INTEGER,
          },
          claims: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                lang: { type: Type.STRING },
                claimValue: {
                  type: Type.STRING,
                  description: 'Ultra-brief 2-7 word English summary.',
                },
                hasCitation: { type: Type.BOOLEAN },
              },
              required: ['lang', 'claimValue', 'hasCitation'],
            },
          },
        },
        required: [
          'mismatchType',
          'issueLabel',
          'targetLang',
          'claimTopic',
          'summary',
          'disputedSnippet',
          'highlightPhrase',
          'snippetEnglishTranslation',
          'suggestedCorrection',
          'severityScore',
          'claims',
        ],
      },
    },
  },
  required: ['overallSummary', 'discrepancies'],
};

const SUMMARY_ONLY_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    overallSummary: {
      type: Type.STRING,
      description: '1-2 concise English sentences (max 40 words) summarizing only the editions and the provided issue boxes.',
    },
  },
  required: ['overallSummary'],
};

const semanticCache = new Map<string, { expiresAt: number; data: SemanticAnalysisResponse }>();

const intlLangDisplay =
  typeof Intl !== 'undefined' && Intl.DisplayNames
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;

function resolveLanguageDisplayName(code: string, provided?: string): string {
  if (provided && provided.trim()) return provided.trim();
  const lower = code.toLowerCase();
  if (lower in LANG_FULL_NAME) {
    return LANG_FULL_NAME[lower as WikiLang];
  }
  try {
    const resolved = intlLangDisplay?.of(lower);
    if (resolved && resolved.toLowerCase() !== lower) return resolved;
  } catch {
    // Ignore unsupported subtags
  }
  return code.toUpperCase();
}

function normalizeIssueLabelForSemantic(
  mismatchType: SemanticMismatchType,
  rawLabel: string
): string {
  const allowed = new Set([
    'Different information',
    'Much fewer references',
    'Missing reference',
    'Not neutral (emotional tone)',
    'Outdated information',
  ]);
  if (allowed.has(rawLabel)) return rawLabel;
  if (mismatchType === 'neutrality_bias') return 'Not neutral (emotional tone)';
  if (mismatchType === 'outdated_data') return 'Outdated information';
  if (mismatchType === 'missing_citation') return 'Missing reference';
  return 'Different information';
}

function resolveTargetLangCode(
  rawTarget: string,
  editions: MultiLangEditionInput[]
): string | null {
  const normalized = (rawTarget || '').trim().toLowerCase();
  const exact = editions.find((e) => e.lang.toLowerCase() === normalized);
  if (exact) return exact.lang.toLowerCase();

  const byName = editions.find(
    (e) => resolveLanguageDisplayName(e.lang, e.langName).toLowerCase() === normalized
  );
  return byName ? byName.lang.toLowerCase() : null;
}

function selectEditionsForSemanticPrompt(
  editions: MultiLangEditionInput[],
  maxEditions = 6
): MultiLangEditionInput[] {
  if (editions.length <= maxEditions) return editions;

  const picked = new Map<string, MultiLangEditionInput>();
  // Keep flagged/low-ref editions first so small under-sourced editions aren't dropped
  const withRefs = editions.filter((e) => typeof e.refCount === 'number');
  const lowestRef = withRefs.sort((a, b) => (a.refCount ?? 0) - (b.refCount ?? 0))[0];
  if (lowestRef) picked.set(lowestRef.lang, lowestRef);

  for (const ed of editions) {
    if (picked.size >= maxEditions) break;
    if (ed.hasNpovTemplate || (ed.citationNeededTags ?? 0) > 0) {
      picked.set(ed.lang, ed);
    }
  }

  const byExtractLen = [...editions].sort((a, b) => b.extract.length - a.extract.length);
  for (const ed of byExtractLen) {
    if (picked.size >= maxEditions) break;
    if (!picked.has(ed.lang)) picked.set(ed.lang, ed);
  }

  return Array.from(picked.values());
}

function buildFastThinkingConfig(modelName: string) {
  const lower = modelName.toLowerCase();
  if (lower.includes('gemini-3')) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  if (lower.includes('gemini-2.5')) {
    return { thinkingBudget: 0 };
  }
  return undefined;
}

/**
 * Runs Gemini semantic cross-lingual comparison across Wikipedia language
 * editions, detecting paraphrased factual conflicts, non-neutral framing,
 * citation imbalances, and outdated claims.
 */
export async function analyzeEditionsSemantically(params: {
  qid?: string;
  canonicalLabel: string;
  editions: MultiLangEditionInput[];
  detectedIssues?: DetectedIssueInput[];
  forceRefresh?: boolean;
}): Promise<SemanticAnalysisResponse> {
  const qid = (params.qid || '').trim().toUpperCase() || 'CUSTOM';
  const isSummaryOnly = Array.isArray(params.detectedIssues);
  const detectedIssues = isSummaryOnly ? params.detectedIssues! : [];
  const validEditions = params.editions
    .map((e) => ({
      ...e,
      lang: e.lang.trim().toLowerCase(),
      extract: (e.extract || '').trim(),
    }))
    .filter((e) => Boolean(e.lang && e.title));

  if (validEditions.length < 2) {
    return {
      qid,
      canonicalLabel: params.canonicalLabel,
      overallSummary: 'At least two Wikipedia language editions are required for semantic comparison.',
      issueBadges: [],
      discrepancies: [],
      analyzedWithLlm: false,
      model: config.geminiModel,
      error: 'Insufficient language editions',
    };
  }

  const ai = getAiClient();
  if (!ai) {
    return {
      qid,
      canonicalLabel: params.canonicalLabel,
      overallSummary: 'Gemini semantic analysis is disabled (GEMINI_API_KEY not configured).',
      issueBadges: [],
      discrepancies: [],
      analyzedWithLlm: false,
      model: config.geminiModel,
      error: 'GEMINI_API_KEY not configured',
    };
  }

  // Keep prompt compact (max 5 editions, 900-1200 chars/edition) for low-latency responses
  const editionsWithContext = selectEditionsForSemanticPrompt(validEditions, 5);
  const perEditionCharBudget = editionsWithContext.length <= 3 ? 1200 : 900;

  const issuesFingerprint = isSummaryOnly
    ? `|issues=${detectedIssues.map((i) => `${i.targetLang}:${i.issueLabel || ''}:${i.claimTopic}`).join(';')}`
    : '';
  const cacheFingerprint = crypto
    .createHash('sha256')
    .update(
      editionsWithContext
        .map((e) => `${e.lang}:${e.title}:${e.extract.slice(0, perEditionCharBudget)}:${e.refCount ?? ''}`)
        .sort()
        .join('|') + issuesFingerprint
    )
    .digest('hex')
    .slice(0, 16);
  const cacheKey = `${qid}:${config.geminiModel}:${isSummaryOnly ? 'sum' : 'full'}:${cacheFingerprint}`;

  if (!params.forceRefresh) {
    const cached = semanticCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const formattedEditions = editionsWithContext
    .map((ed) => {
      const name = resolveLanguageDisplayName(ed.lang, ed.langName);
      const refs = ed.refCount !== undefined ? `refs=${ed.refCount}` : 'refs=?';
      const cn = ed.citationNeededTags ? ` cn=${ed.citationNeededTags}` : '';
      const npov = ed.hasNpovTemplate ? ' NPOV_TAG' : '';
      const rev = ed.lastRevAt ? ` rev=${ed.lastRevAt.slice(0, 10)}` : '';
      const body = ed.extract
        ? ed.extract.slice(0, perEditionCharBudget)
        : '(No extract available)';
      return `[${ed.lang} | ${name} | "${ed.title}" | ${refs}${cn}${npov}${rev}]\n${body}`;
    })
    .join('\n\n');

  const langCodesList = editionsWithContext.map((e) => e.lang).join(', ');
  const formattedIssues =
    detectedIssues.length > 0
      ? detectedIssues
          .map(
            (d, idx) =>
              `${idx + 1}. [${d.targetLang.toUpperCase()} | ${d.issueLabel || 'Issue'}] ${d.claimTopic}: ${d.summary}`
          )
          .join('\n')
      : '(No issue boxes flagged)';

  const prompt = isSummaryOnly
    ? `Cross-lingual Wikipedia summary assistant for "${params.canonicalLabel}" (${qid}) across ${editionsWithContext.length} editions (${langCodesList}).

Issue boxes currently shown to the user:
${formattedIssues}

Strict rules:
- Write 1-2 concise English sentences (max 40 words total) explaining what these editions cover and summarizing ONLY the discrepancies present in the issue boxes above.
- Do NOT mention, invent, or speculate about any discrepancies, figures, or flaws that are NOT in the listed issue boxes.
- If no issue boxes are flagged, simply summarize in 1-2 sentences that the checked editions broadly align on the inspected signals without raising extra issues.

${formattedEditions}`
    : `Cross-lingual Wikipedia fact-checker for "${params.canonicalLabel}" (${qid}).
Compare these ${editionsWithContext.length} editions (${langCodesList}) semantically and return at most 3 highest-impact genuine discrepancies (or [] if aligned).

Categories:
- "hard_fact" / "Different information": contradictory dates, numbers, attributions, or factual claims.
- "neutrality_bias" / "Not neutral (emotional tone)": editorial POV bias or loaded framing (ignore neutral quotes).
- "missing_citation" / "Much fewer references" or "Missing reference": severe citation gap or [citation needed] tag.
- "outdated_data" / "Outdated information": stale stats or lagging revision.

Rules (keep all text ultra-concise):
- "targetLang" must be one of: ${langCodesList}.
- "disputedSnippet": exact verbatim 5-10 word substring from targetLang's text.
- "highlightPhrase": exact 2-5 word differing value/phrase inside disputedSnippet.
- "snippetEnglishTranslation": short English translation of disputedSnippet.
- "claims": 2-7 word English summary per compared lang.

${formattedEditions}`;

  try {
    const thinkingConfig = buildFastThinkingConfig(config.geminiModel);
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: isSummaryOnly ? SUMMARY_ONLY_SCHEMA : MULTI_LANG_SEMANTIC_SCHEMA,
        temperature: 0.1,
        maxOutputTokens: isSummaryOnly ? 350 : 1500,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });

    const rawText = response.text;
    if (!rawText) {
      return {
        qid,
        canonicalLabel: params.canonicalLabel,
        overallSummary: 'Gemini returned an empty response.',
        issueBadges: [],
        discrepancies: [],
        analyzedWithLlm: false,
        model: config.geminiModel,
        error: 'Empty model response',
      };
    }

    interface LlmSemanticPayload {
      overallSummary: string;
      discrepancies: Array<{
        mismatchType: SemanticMismatchType;
        issueLabel: string;
        targetLang: string;
        claimTopic: string;
        summary: string;
        disputedSnippet: string;
        highlightPhrase: string;
        snippetEnglishTranslation: string;
        suggestedCorrection: string;
        severityScore: number;
        claims: Array<{
          lang: string;
          claimValue: string;
          hasCitation: boolean;
        }>;
      }>;
    }

    const parsed = JSON.parse(rawText) as LlmSemanticPayload;
    const rawList = isSummaryOnly
      ? []
      : Array.isArray(parsed.discrepancies)
        ? parsed.discrepancies
        : [];

    const discrepancies: SemanticDiscrepancyRecord[] = [];
    for (const d of rawList) {
      const targetLang = resolveTargetLangCode(d.targetLang, editionsWithContext);
      if (!targetLang) continue;

      const mismatchType: SemanticMismatchType = (
        ['hard_fact', 'missing_citation', 'outdated_data', 'neutrality_bias'] as const
      ).includes(d.mismatchType)
        ? d.mismatchType
        : 'hard_fact';

      const issueLabel = normalizeIssueLabelForSemantic(mismatchType, d.issueLabel);

      const claimsMap: Record<string, EditionClaimStatus> = {};
      for (const c of Array.isArray(d.claims) ? d.claims : []) {
        const cLang = resolveTargetLangCode(c.lang, editionsWithContext);
        if (!cLang || !c.claimValue) continue;
        claimsMap[cLang] = {
          value: c.claimValue.trim(),
          hasCitation: Boolean(c.hasCitation),
          citationStatus: c.hasCitation ? 'valid' : 'missing',
        };
      }

      // Ensure targetLang is always represented in claimsMap if omitted
      if (!claimsMap[targetLang]) {
        claimsMap[targetLang] = {
          value: d.summary || issueLabel,
          hasCitation: mismatchType !== 'missing_citation',
          citationStatus: mismatchType === 'missing_citation' ? 'missing' : 'valid',
        };
      }

      const consensusGroup = editionsWithContext
        .map((e) => e.lang)
        .filter((l) => l !== targetLang && claimsMap[l]?.hasCitation);

      const cleanSnippet = (d.disputedSnippet || '').trim();
      const cleanHighlight = (d.highlightPhrase || '').trim();
      const cleanTranslation = (d.snippetEnglishTranslation || '').trim();

      discrepancies.push({
        id: discrepancies.length + 1,
        qid,
        mismatchType,
        issueLabel,
        targetLang,
        claimTopic: (d.claimTopic || issueLabel).trim(),
        summary: (d.summary || '').trim(),
        disputedSnippet: cleanSnippet,
        highlightPhrase: cleanHighlight || null,
        snippetEnglishTranslation:
          targetLang === 'en' ? null : cleanTranslation || null,
        sectionHeading: null,
        lineHint: 1,
        suggestedCorrection: (d.suggestedCorrection || '').trim(),
        agreementMatrix: {
          consensusGroup,
          outlierGroup: [targetLang],
          matrixLabel: issueLabel,
          claims: claimsMap,
        },
        citationGapFlag:
          issueLabel === 'Much fewer references' || issueLabel === 'Missing reference',
        donorLang: consensusGroup[0] || null,
        severityScore: Math.max(30, Math.min(99, Math.round(Number(d.severityScore) || 75))),
        confidenceLevel: Number(d.severityScore) >= 78 ? 'high' : 'medium',
        confidenceScore: Math.min(95, Math.max(45, Math.round(Number(d.severityScore) || 75))),
        verifiedSources: [],
      });
    }

    const issueBadges = Array.from(
      new Set(
        discrepancies.map((d) =>
          d.issueLabel === 'Not neutral (emotional tone)' ? 'Not neutral' : d.issueLabel
        )
      )
    );

    const fallbackSummary = isSummaryOnly
      ? detectedIssues.length > 0
        ? `Summary of ${detectedIssues.length} detected issue(s) across ${editionsWithContext.length} editions.`
        : `Checked ${editionsWithContext.length} editions with no flagged discrepancies.`
      : discrepancies.length > 0
        ? `Gemini detected ${discrepancies.length} semantic issue(s) across ${editionsWithContext.length} editions.`
        : `No major semantic discrepancies detected across ${editionsWithContext.length} editions.`;

    const result: SemanticAnalysisResponse = {
      qid,
      canonicalLabel: params.canonicalLabel,
      overallSummary: (parsed.overallSummary || '').trim() || fallbackSummary,
      issueBadges,
      discrepancies,
      analyzedWithLlm: true,
      model: config.geminiModel,
    };

    if (semanticCache.size >= 200) {
      const oldestKey = semanticCache.keys().next().value;
      if (oldestKey) semanticCache.delete(oldestKey);
    }
    semanticCache.set(cacheKey, {
      expiresAt: Date.now() + config.searchCacheTtlSeconds * 1000,
      data: result,
    });

    return result;
  } catch (err) {
    return {
      qid,
      canonicalLabel: params.canonicalLabel,
      overallSummary: 'Gemini semantic analysis failed.',
      issueBadges: [],
      discrepancies: [],
      analyzedWithLlm: false,
      model: config.geminiModel,
      error: err instanceof Error ? err.message : 'Gemini request failed',
    };
  }
}

export async function compareEditionsSemantically(
  canonicalLabel: string,
  editions: Map<WikiLang, EditionContentRecord>
): Promise<CrossLingualComparisonResult> {
  const heuristic = runHeuristicDiscrepancyScan(canonicalLabel, editions);
  if (!getAiClient()) {
    return heuristic;
  }

  const editionInputs: MultiLangEditionInput[] = (['fi', 'sv', 'ru'] as WikiLang[])
    .map((lang) => {
      const ed = editions.get(lang);
      if (!ed) return null;
      return {
        lang,
        langName: LANG_FULL_NAME[lang],
        title: ed.title,
        url: ed.articleUrl,
        extract: ed.leadExtract,
        refCount: ed.refCount,
        citationNeededTags: ed.citationNeededTags,
        lastRevAt: ed.lastRevisionAt,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const semantic = await analyzeEditionsSemantically({
    canonicalLabel,
    editions: editionInputs,
  });

  if (!semantic.analyzedWithLlm || semantic.discrepancies.length === 0) {
    return heuristic;
  }

  const trilingualLangs = new Set<WikiLang>(['fi', 'sv', 'ru']);
  const mapped: DetectedRawDiscrepancy[] = semantic.discrepancies
    .filter((d) => trilingualLangs.has(d.targetLang as WikiLang))
    .map((d) => {
      const targetLang = d.targetLang as WikiLang;
      const mismatchType: MismatchType =
        d.mismatchType === 'neutrality_bias' ? 'hard_fact' : d.mismatchType;
      const claims: Record<WikiLang, EditionClaimStatus> = {
        fi: d.agreementMatrix.claims.fi || { value: 'N/A', hasCitation: true, citationStatus: 'valid' },
        sv: d.agreementMatrix.claims.sv || { value: 'N/A', hasCitation: true, citationStatus: 'valid' },
        ru: d.agreementMatrix.claims.ru || { value: 'N/A', hasCitation: true, citationStatus: 'valid' },
      };

      const matrix: LanguageAgreementMatrix = {
        consensusGroup: d.agreementMatrix.consensusGroup.filter((l): l is WikiLang =>
          trilingualLangs.has(l as WikiLang)
        ),
        outlierGroup: [targetLang],
        matrixLabel: d.issueLabel,
        claims,
      };

      return {
        mismatchType,
        issueLabel: d.issueLabel === 'Not neutral (emotional tone)' ? 'Different information' : d.issueLabel,
        targetLang,
        claimTopic: d.claimTopic,
        summary: d.summary,
        disputedSnippet: d.disputedSnippet,
        sectionHeading: null,
        lineHint: null,
        suggestedCorrection: d.suggestedCorrection,
        agreementMatrix: matrix,
        citationGapFlag: d.citationGapFlag,
        donorLang: d.donorLang && trilingualLangs.has(d.donorLang as WikiLang) ? (d.donorLang as WikiLang) : null,
        severityScore: d.severityScore,
      };
    });

  if (mapped.length === 0) {
    return heuristic;
  }

  return {
    overallSummary: semantic.overallSummary,
    issueBadges: Array.from(new Set(mapped.map((m) => m.issueLabel))),
    discrepancies: mapped,
    analyzedWithLlm: true,
  };
}

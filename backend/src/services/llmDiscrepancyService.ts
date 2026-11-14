import { GoogleGenAI, Type, type Schema } from '@google/genai';
import { config } from '../config.js';
import type {
  EditionContentRecord,
  LanguageAgreementMatrix,
  MismatchType,
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

const LLM_DISCREPANCY_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    overallSummary: {
      type: Type.STRING,
    },
    discrepancies: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          mismatchType: {
            type: Type.STRING,
            enum: ['hard_fact', 'missing_citation', 'outdated_data'],
          },
          issueLabel: {
            type: Type.STRING,
            enum: [
              'Different information',
              'Much fewer references',
              'Missing reference',
              'Outdated information',
            ],
          },
          targetLang: {
            type: Type.STRING,
            enum: ['fi', 'sv', 'ru'],
          },
          claimTopic: {
            type: Type.STRING,
          },
          summary: {
            type: Type.STRING,
          },
          disputedSnippet: {
            type: Type.STRING,
            description:
              'Exact verbatim phrase (5 to 16 words) copied from targetLang extract so the browser can scroll to and highlight it.',
          },
          suggestedCorrection: {
            type: Type.STRING,
          },
          fiClaimValue: { type: Type.STRING },
          svClaimValue: { type: Type.STRING },
          ruClaimValue: { type: Type.STRING },
          severityScore: { type: Type.INTEGER },
        },
        required: [
          'mismatchType',
          'issueLabel',
          'targetLang',
          'claimTopic',
          'summary',
          'disputedSnippet',
          'suggestedCorrection',
          'fiClaimValue',
          'svClaimValue',
          'ruClaimValue',
          'severityScore',
        ],
      },
    },
  },
  required: ['overallSummary', 'discrepancies'],
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

export async function compareEditionsSemantically(
  canonicalLabel: string,
  editions: Map<WikiLang, EditionContentRecord>
): Promise<CrossLingualComparisonResult> {
  const heuristic = runHeuristicDiscrepancyScan(canonicalLabel, editions);
  const ai = getAiClient();
  if (!ai) {
    return heuristic;
  }

  const formatEd = (lang: WikiLang, name: string): string => {
    const ed = editions.get(lang);
    if (!ed) return `=== ${name} (${lang}) ===\nMISSING EDITION.`;
    return `=== ${name} (${lang}) | Title: "${ed.title}" | References: ${ed.refCount} | [citation needed]: ${ed.citationNeededTags} | Last updated: ${ed.lastRevisionAt?.slice(0, 10) || 'unknown'} ===\n${ed.leadExtract.slice(0, 2200)}`;
  };

  const prompt = `Compare Finnish (fi), Swedish (sv), and Russian (ru) Wikipedia articles for "${canonicalLabel}".
Find concrete mistakes and differences and label each with a clear "issueLabel":
- "Different information": conflicting facts, numbers, dates, casualty/population figures, or claims.
- "Much fewer references": one language has far fewer references than the others.
- "Missing reference": unsourced claims contradicted or sourced elsewhere.
- "Outdated information": one language has old figures while another was updated.

IMPORTANT: "disputedSnippet" MUST be an exact verbatim 5-to-15 word phrase in the original language of "targetLang" copied directly from that edition's text below!

${formatEd('fi', 'FINNISH')}

${formatEd('sv', 'SWEDISH')}

${formatEd('ru', 'RUSSIAN')}`;

  try {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: LLM_DISCREPANCY_SCHEMA,
        temperature: 0.1,
      },
    });

    const rawText = response.text;
    if (!rawText) return heuristic;

    interface LlmPayload {
      overallSummary: string;
      discrepancies: Array<{
        mismatchType: MismatchType;
        issueLabel: string;
        targetLang: WikiLang;
        claimTopic: string;
        summary: string;
        disputedSnippet: string;
        suggestedCorrection: string;
        fiClaimValue: string;
        svClaimValue: string;
        ruClaimValue: string;
        severityScore: number;
      }>;
    }

    const parsed = JSON.parse(rawText) as LlmPayload;
    if (!parsed.discrepancies || parsed.discrepancies.length === 0) {
      return heuristic;
    }

    const mapped: DetectedRawDiscrepancy[] = parsed.discrepancies.map((d) => ({
      mismatchType: d.mismatchType,
      issueLabel: d.issueLabel || 'Different information',
      targetLang: d.targetLang,
      claimTopic: d.claimTopic,
      summary: d.summary,
      disputedSnippet: d.disputedSnippet,
      sectionHeading: null,
      lineHint: null,
      suggestedCorrection: d.suggestedCorrection,
      agreementMatrix: {
        consensusGroup: [],
        outlierGroup: [d.targetLang],
        matrixLabel: d.issueLabel,
        claims: {
          fi: { value: d.fiClaimValue, hasCitation: true, citationStatus: 'valid' },
          sv: { value: d.svClaimValue, hasCitation: true, citationStatus: 'valid' },
          ru: { value: d.ruClaimValue, hasCitation: true, citationStatus: 'valid' },
        },
      },
      citationGapFlag: d.issueLabel === 'Much fewer references',
      donorLang: null,
      severityScore: Math.max(30, Math.min(99, Number(d.severityScore) || 75)),
    }));

    const badges = Array.from(new Set(mapped.map((m) => m.issueLabel)));
    return {
      overallSummary: parsed.overallSummary,
      issueBadges: badges,
      discrepancies: mapped,
      analyzedWithLlm: true,
    };
  } catch {
    return heuristic;
  }
}

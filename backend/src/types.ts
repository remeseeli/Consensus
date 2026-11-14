export type WikiLang = 'fi' | 'sv' | 'ru';

export type MismatchType = 'hard_fact' | 'missing_citation' | 'outdated_data';

export type SemanticMismatchType = MismatchType | 'neutrality_bias';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type ExternalCacheProvider =
  | 'mediawiki'
  | 'wikidata'
  | 'pageviews'
  | 'crossref'
  | 'openalex'
  | 'semantic_scholar'
  | 'google_books'
  | 'link_check';

export type SourceOrigin =
  | 'crossref'
  | 'openalex'
  | 'semantic_scholar'
  | 'google_books'
  | 'wikipedia_donor_ref';

export type SourceType =
  | 'journal'
  | 'book'
  | 'dissertation'
  | 'conference'
  | 'web'
  | 'archive';

export type DeadLinkStatus = 'alive' | 'dead' | 'archived_recovered' | 'unchecked';

export interface EditionClaimStatus {
  value: string;
  excerpt?: string;
  hasCitation: boolean;
  citationStatus: 'valid' | 'missing' | 'dead_link' | 'edition_missing';
  donorUrl?: string;
}

export interface LanguageAgreementMatrix {
  consensusGroup: WikiLang[];
  outlierGroup: WikiLang[];
  matrixLabel: string;
  claims: Record<WikiLang, EditionClaimStatus>;
}

export interface LocalizedCitations {
  fi: string;
  sv: string;
  ru: string;
  en: string;
}

export interface VerifiedSourceRecord {
  id?: number;
  discrepancyId?: number;
  sourceOrigin: SourceOrigin;
  sourceType: SourceType;
  title: string;
  authors: string[];
  publicationVenue: string | null;
  publicationYear: number | null;
  doi: string | null;
  isbn: string | null;
  sourceUrl: string | null;
  archiveUrl: string | null;
  deadLinkStatus: DeadLinkStatus;
  httpStatusCode: number | null;
  academicCitationCount: number;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  citations: LocalizedCitations;
}

export interface DiscrepancyRecord {
  id?: number;
  qid: string;
  mismatchType: MismatchType;
  issueLabel?: string;
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
  brokenLinkDetected: boolean;
  brokenLinkUrl: string | null;
  severityScore: number;
  confidenceLevel: ConfidenceLevel;
  confidenceScore: number;
  verifiedSources: VerifiedSourceRecord[];
}

export interface RankedArticleSummary {
  qid: string;
  canonicalLabel: string;
  topicKeywords: string;
  editions: {
    fi: { title: string | null; url: string | null; refCount: number; pageviews30d: number; lastRevAt: string | null };
    sv: { title: string | null; url: string | null; refCount: number; pageviews30d: number; lastRevAt: string | null };
    ru: { title: string | null; url: string | null; refCount: number; pageviews30d: number; lastRevAt: string | null };
  };
  editionCount: number;
  sourceCount: number;
  citationNeededCount: number;
  pageviewCount: number;
  discrepancyCount: number;
  discrepancySeverity: number;
  issueBadges?: string[];
  mismatchFlags: {
    hardFact: boolean;
    missingCitation: boolean;
    outdatedData: boolean;
  };
  priorityScore: number;
  lastSyncedAt: string;
  deepAnalyzedAt: string | null;
}

export interface ParsedRefItem {
  rawText: string;
  urls: string[];
  doi: string | null;
  isbn: string | null;
  titleHint: string | null;
}

export interface EditionContentRecord {
  qid: string;
  lang: WikiLang;
  title: string;
  articleUrl: string;
  leadExtract: string;
  infobox: Record<string, string>;
  extractedRefs: ParsedRefItem[];
  citationNeededSnippets?: string[];
  refCount: number;
  citationNeededTags: number;
  lastRevisionAt: string | null;
}

export interface ArticleAnalysisResponse {
  article: RankedArticleSummary;
  overallSummary: string;
  discrepancies: DiscrepancyRecord[];
  analyzedWithLlm: boolean;
}

export interface MultiLangEditionInput {
  lang: string;
  langName?: string;
  title: string;
  url?: string | null;
  extract: string;
  refCount?: number;
  citationNeededTags?: number;
  hasNpovTemplate?: boolean;
  lastRevAt?: string | null;
}

export interface DetectedIssueInput {
  targetLang: string;
  issueLabel?: string;
  claimTopic: string;
  summary: string;
  disputedSnippet?: string;
}

export interface SemanticDiscrepancyRecord {
  id: number;
  qid: string;
  mismatchType: SemanticMismatchType;
  issueLabel: string;
  targetLang: string;
  claimTopic: string;
  summary: string;
  disputedSnippet: string;
  highlightPhrase: string | null;
  snippetEnglishTranslation: string | null;
  sectionHeading: string | null;
  lineHint: number | null;
  suggestedCorrection: string;
  agreementMatrix: {
    consensusGroup: string[];
    outlierGroup: string[];
    matrixLabel: string;
    claims: Record<string, EditionClaimStatus>;
  };
  citationGapFlag: boolean;
  donorLang: string | null;
  severityScore: number;
  confidenceLevel: ConfidenceLevel;
  confidenceScore: number;
  verifiedSources: VerifiedSourceRecord[];
}

export interface SemanticAnalysisResponse {
  qid: string;
  canonicalLabel: string;
  overallSummary: string;
  issueBadges: string[];
  discrepancies: SemanticDiscrepancyRecord[];
  analyzedWithLlm: boolean;
  model: string;
  error?: string;
}

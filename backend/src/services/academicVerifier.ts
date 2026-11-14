import { config } from '../config.js';
import { getExternalCache, setExternalCache } from '../db/repository.js';
import type {
  ConfidenceLevel,
  ParsedRefItem,
  SourceOrigin,
  SourceType,
  VerifiedSourceRecord,
} from '../types.js';
import { fetchWithRetry, limiters } from '../utils/rateLimiter.js';
import { formatLocalizedWikipediaCitations } from './citationFormatter.js';
import { verifyExternalLinkHealth } from './linkCheckerService.js';

interface RawCandidateSource {
  sourceOrigin: SourceOrigin;
  sourceType: SourceType;
  title: string;
  authors: string[];
  publicationVenue: string | null;
  publicationYear: number | null;
  doi: string | null;
  isbn: string | null;
  sourceUrl: string | null;
  academicCitationCount: number;
}

export function scoreSourceConfidence(params: {
  sourceType: SourceType;
  doi: string | null;
  isbn: string | null;
  academicCitationCount: number;
  corroboratingCount: number;
  hasCrossLingualConsensus: boolean;
  isDeadUnrecovered: boolean;
}): { score: number; level: ConfidenceLevel } {
  let score = 35;

  if (params.sourceType === 'journal' && params.doi) {
    score += 34;
  } else if (params.sourceType === 'dissertation') {
    score += 26;
  } else if (params.sourceType === 'book' && params.isbn) {
    score += 28;
  } else if (params.doi || params.isbn) {
    score += 22;
  } else {
    score += 10;
  }

  if (params.academicCitationCount >= 50) {
    score += 12;
  } else if (params.academicCitationCount >= 10) {
    score += 7;
  } else if (params.academicCitationCount >= 1) {
    score += 3;
  }

  if (params.corroboratingCount >= 2) {
    score += 12;
  }
  if (params.hasCrossLingualConsensus) {
    score += 10;
  }
  if (params.isDeadUnrecovered) {
    score -= 25;
  }

  const clamped = Math.max(15, Math.min(99, Math.round(score)));
  const level: ConfidenceLevel =
    clamped >= 75 ? 'high' : clamped >= 48 ? 'medium' : 'low';

  return { score: clamped, level };
}

async function searchCrossref(query: string): Promise<RawCandidateSource[]> {
  const cached = await getExternalCache<RawCandidateSource[]>('crossref', query);
  if (cached) return cached;

  try {
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(
      query
    )}&rows=2&mailto=${encodeURIComponent(config.academicContactEmail)}`;

    const res = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': config.wikimediaUserAgent } },
      { timeoutMs: 8000, limiter: limiters.academic }
    );
    if (!res.ok) return [];

    interface CrossrefPayload {
      message?: {
        items?: Array<{
          DOI?: string;
          ISBN?: string[];
          URL?: string;
          type?: string;
          title?: string[];
          'container-title'?: string[];
          publisher?: string;
          'is-referenced-by-count'?: number;
          issued?: { 'date-parts'?: number[][] };
          author?: Array<{ given?: string; family?: string; name?: string }>;
        }>;
      };
    }

    const data = (await res.json()) as CrossrefPayload;
    const items = (data.message?.items || [])
      .filter((it) => Boolean(it.title?.[0]))
      .map((it): RawCandidateSource => {
        const authors = (it.author || [])
          .map((a) => (a.family ? (a.given ? `${a.given} ${a.family}` : a.family) : a.name || ''))
          .filter(Boolean)
          .slice(0, 5);

        const rawType = (it.type || '').toLowerCase();
        let sourceType: SourceType = 'journal';
        if (rawType.includes('book') || rawType.includes('monograph')) {
          sourceType = 'book';
        } else if (rawType.includes('dissertation') || rawType.includes('thesis')) {
          sourceType = 'dissertation';
        } else if (rawType.includes('proceedings')) {
          sourceType = 'conference';
        }

        const year = it.issued?.['date-parts']?.[0]?.[0] || null;
        const doi = it.DOI || null;

        return {
          sourceOrigin: 'crossref',
          sourceType,
          title: it.title?.[0] || 'Untitled work',
          authors,
          publicationVenue: it['container-title']?.[0] || it.publisher || null,
          publicationYear: year,
          doi,
          isbn: it.ISBN?.[0] || null,
          sourceUrl: doi ? `https://doi.org/${doi}` : it.URL || null,
          academicCitationCount: Number(it['is-referenced-by-count'] || 0),
        };
      });

    await setExternalCache('crossref', query, items, config.apiCacheTtlSeconds);
    return items;
  } catch {
    return [];
  }
}

async function searchOpenAlex(query: string): Promise<RawCandidateSource[]> {
  const cached = await getExternalCache<RawCandidateSource[]>('openalex', query);
  if (cached) return cached;

  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(
      query
    )}&per-page=2&mailto=${encodeURIComponent(config.academicContactEmail)}`;

    const res = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': config.wikimediaUserAgent } },
      { timeoutMs: 8000, limiter: limiters.academic }
    );
    if (!res.ok) return [];

    interface OpenAlexPayload {
      results?: Array<{
        display_name?: string;
        publication_year?: number;
        type?: string;
        doi?: string;
        cited_by_count?: number;
        primary_location?: {
          landing_page_url?: string;
          source?: { display_name?: string };
        };
        authorships?: Array<{ author?: { display_name?: string } }>;
      }>;
    }

    const data = (await res.json()) as OpenAlexPayload;
    const items = (data.results || [])
      .filter((w) => Boolean(w.display_name))
      .map((w): RawCandidateSource => {
        const cleanDoi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '') : null;
        const rawType = (w.type || '').toLowerCase();
        let sourceType: SourceType = 'journal';
        if (rawType.includes('dissertation')) sourceType = 'dissertation';
        else if (rawType.includes('book')) sourceType = 'book';

        const authors = (w.authorships || [])
          .map((a) => a.author?.display_name || '')
          .filter(Boolean)
          .slice(0, 5);

        return {
          sourceOrigin: 'openalex',
          sourceType,
          title: w.display_name || 'Academic work',
          authors,
          publicationVenue: w.primary_location?.source?.display_name || 'OpenAlex Indexed Venue',
          publicationYear: w.publication_year || null,
          doi: cleanDoi,
          isbn: null,
          sourceUrl: cleanDoi
            ? `https://doi.org/${cleanDoi}`
            : w.primary_location?.landing_page_url || null,
          academicCitationCount: Number(w.cited_by_count || 0),
        };
      });

    await setExternalCache('openalex', query, items, config.apiCacheTtlSeconds);
    return items;
  } catch {
    return [];
  }
}

async function searchSemanticScholar(query: string): Promise<RawCandidateSource[]> {
  const cached = await getExternalCache<RawCandidateSource[]>('semantic_scholar', query);
  if (cached) return cached;

  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
      query
    )}&limit=2&fields=title,authors,year,venue,externalIds,url,citationCount`;

    const headers: Record<string, string> = {
      'User-Agent': config.wikimediaUserAgent,
    };
    if (config.semanticScholarApiKey) {
      headers['x-api-key'] = config.semanticScholarApiKey;
    }

    const res = await fetchWithRetry(url, { headers }, { timeoutMs: 7500, limiter: limiters.academic });
    if (!res.ok) return [];

    interface S2Payload {
      data?: Array<{
        title?: string;
        year?: number;
        venue?: string;
        url?: string;
        citationCount?: number;
        authors?: Array<{ name?: string }>;
        externalIds?: { DOI?: string };
      }>;
    }

    const payload = (await res.json()) as S2Payload;
    const items = (payload.data || [])
      .filter((p) => Boolean(p.title))
      .map((p): RawCandidateSource => {
        const doi = p.externalIds?.DOI || null;
        return {
          sourceOrigin: 'semantic_scholar',
          sourceType: 'journal',
          title: p.title || 'Scholarly article',
          authors: (p.authors || []).map((a) => a.name || '').filter(Boolean).slice(0, 5),
          publicationVenue: p.venue || 'Semantic Scholar',
          publicationYear: p.year || null,
          doi,
          isbn: null,
          sourceUrl: doi ? `https://doi.org/${doi}` : p.url || null,
          academicCitationCount: Number(p.citationCount || 0),
        };
      });

    await setExternalCache('semantic_scholar', query, items, config.apiCacheTtlSeconds);
    return items;
  } catch {
    return [];
  }
}

async function searchGoogleBooks(query: string): Promise<RawCandidateSource[]> {
  const cached = await getExternalCache<RawCandidateSource[]>('google_books', query);
  if (cached) return cached;

  try {
    const keyParam = config.googleBooksApiKey
      ? `&key=${encodeURIComponent(config.googleBooksApiKey)}`
      : '';
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
      query
    )}&maxResults=2&printType=books${keyParam}`;

    const res = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': config.wikimediaUserAgent } },
      { timeoutMs: 7500, limiter: limiters.academic }
    );
    if (!res.ok) return [];

    interface BooksPayload {
      items?: Array<{
        volumeInfo?: {
          title?: string;
          authors?: string[];
          publisher?: string;
          publishedDate?: string;
          infoLink?: string;
          industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
        };
      }>;
    }

    const payload = (await res.json()) as BooksPayload;
    const items = (payload.items || [])
      .filter((b) => Boolean(b.volumeInfo?.title))
      .map((b): RawCandidateSource => {
        const vi = b.volumeInfo!;
        const isbn13 = vi.industryIdentifiers?.find((id) => id.type === 'ISBN_13')?.identifier;
        const isbn10 = vi.industryIdentifiers?.find((id) => id.type === 'ISBN_10')?.identifier;
        const yearMatch = vi.publishedDate?.match(/\b(18|19|20)\d{2}\b/);

        return {
          sourceOrigin: 'google_books',
          sourceType: 'book',
          title: vi.title || 'Book reference',
          authors: (vi.authors || []).slice(0, 5),
          publicationVenue: vi.publisher || null,
          publicationYear: yearMatch ? Number(yearMatch[0]) : null,
          doi: null,
          isbn: isbn13 || isbn10 || null,
          sourceUrl: vi.infoLink || null,
          academicCitationCount: 5,
        };
      });

    await setExternalCache('google_books', query, items, config.apiCacheTtlSeconds);
    return items;
  } catch {
    return [];
  }
}

export async function verifyClaimAgainstAcademicSources(params: {
  articleLabel: string;
  claimTopic: string;
  donorRefs?: ParsedRefItem[];
  hasCrossLingualConsensus: boolean;
}): Promise<VerifiedSourceRecord[]> {
  const searchQuery = `${params.articleLabel} ${params.claimTopic}`.trim();

  const [crossrefHits, openAlexHits, s2Hits, booksHits] = await Promise.all([
    searchCrossref(searchQuery),
    searchOpenAlex(searchQuery),
    searchSemanticScholar(searchQuery),
    searchGoogleBooks(searchQuery),
  ]);

  const rawPool: RawCandidateSource[] = [];

  // Include portable donor references from sibling Wikipedia editions first if they carry DOI/ISBN/URL
  for (const donor of (params.donorRefs || []).slice(0, 2)) {
    if (donor.doi || donor.isbn || donor.urls[0]) {
      rawPool.push({
        sourceOrigin: 'wikipedia_donor_ref',
        sourceType: donor.doi ? 'journal' : donor.isbn ? 'book' : 'web',
        title: donor.titleHint || `${params.articleLabel} — Verified Cross-Edition Reference`,
        authors: [],
        publicationVenue: 'Cross-Edition Wikipedia Citation',
        publicationYear: null,
        doi: donor.doi,
        isbn: donor.isbn,
        sourceUrl: donor.doi ? `https://doi.org/${donor.doi}` : donor.urls[0] || null,
        academicCitationCount: 10,
      });
    }
  }

  rawPool.push(...crossrefHits, ...openAlexHits, ...s2Hits, ...booksHits);

  // Deduplicate by DOI, ISBN, or normalized title
  const deduped: RawCandidateSource[] = [];
  const seenKeys = new Set<string>();

  for (const cand of rawPool) {
    const key = (
      cand.doi?.toLowerCase() ||
      cand.isbn?.replace(/[^0-9X]/gi, '') ||
      cand.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    ).slice(0, 120);

    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(cand);
    if (deduped.length >= 3) break;
  }

  const corroboratingCount = deduped.length;

  const verifiedRecords = await Promise.all(
    deduped.map(async (cand): Promise<VerifiedSourceRecord> => {
      const linkCheck = cand.sourceUrl
        ? await verifyExternalLinkHealth(cand.sourceUrl)
        : {
            url: '',
            status: 'unchecked' as const,
            httpStatusCode: null,
            archiveUrl: null,
          };

      const isDeadUnrecovered = linkCheck.status === 'dead';
      const { score, level } = scoreSourceConfidence({
        sourceType: cand.sourceType,
        doi: cand.doi,
        isbn: cand.isbn,
        academicCitationCount: cand.academicCitationCount,
        corroboratingCount,
        hasCrossLingualConsensus: params.hasCrossLingualConsensus,
        isDeadUnrecovered,
      });

      const citations = formatLocalizedWikipediaCitations({
        title: cand.title,
        authors: cand.authors,
        publicationVenue: cand.publicationVenue,
        publicationYear: cand.publicationYear,
        doi: cand.doi,
        isbn: cand.isbn,
        sourceUrl: cand.sourceUrl,
        archiveUrl: linkCheck.archiveUrl,
        sourceType: cand.sourceType,
      });

      return {
        sourceOrigin: cand.sourceOrigin,
        sourceType: cand.sourceType,
        title: cand.title,
        authors: cand.authors,
        publicationVenue: cand.publicationVenue,
        publicationYear: cand.publicationYear,
        doi: cand.doi,
        isbn: cand.isbn,
        sourceUrl: cand.sourceUrl,
        archiveUrl: linkCheck.archiveUrl,
        deadLinkStatus: linkCheck.status,
        httpStatusCode: linkCheck.httpStatusCode,
        academicCitationCount: cand.academicCitationCount,
        confidenceScore: score,
        confidenceLevel: level,
        citations,
      };
    })
  );

  verifiedRecords.sort((a, b) => b.confidenceScore - a.confidenceScore);
  return verifiedRecords;
}

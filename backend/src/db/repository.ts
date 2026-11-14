import crypto from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  DiscrepancyRecord,
  EditionContentRecord,
  ExternalCacheProvider,
  LanguageAgreementMatrix,
  MismatchType,
  ParsedRefItem,
  RankedArticleSummary,
  VerifiedSourceRecord,
  WikiLang,
} from '../types.js';
import { getDbPool } from './pool.js';

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

function toMysqlDateTime(isoOrDate: string | Date | null | undefined): string | null {
  if (!isoOrDate) return null;
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function computeCacheHash(provider: ExternalCacheProvider, key: string): string {
  return crypto.createHash('sha256').update(`${provider}::${key}`).digest('hex');
}

let dbDownUntil = 0;

export async function getExternalCache<T>(
  provider: ExternalCacheProvider,
  descriptor: string
): Promise<T | null> {
  if (Date.now() < dbDownUntil) return null;
  try {
    const db = getDbPool();
    const cacheKey = computeCacheHash(provider, descriptor);
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT response_json
       FROM external_api_cache
       WHERE cache_key = ? AND expires_at > UTC_TIMESTAMP()
       LIMIT 1`,
      [cacheKey]
    );
    const row = rows[0];
    if (!row) return null;
    return parseJsonSafe<T | null>(row.response_json, null);
  } catch {
    dbDownUntil = Date.now() + 20_000;
    return null;
  }
}

export async function setExternalCache(
  provider: ExternalCacheProvider,
  descriptor: string,
  payload: unknown,
  ttlSeconds: number
): Promise<void> {
  if (Date.now() < dbDownUntil) return;
  try {
    const db = getDbPool();
    const cacheKey = computeCacheHash(provider, descriptor);
    await db.execute(
      `INSERT INTO external_api_cache (cache_key, provider, request_descriptor, response_json, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))
       ON DUPLICATE KEY UPDATE
         response_json = VALUES(response_json),
         expires_at = VALUES(expires_at),
         created_at = CURRENT_TIMESTAMP`,
      [cacheKey, provider, descriptor.slice(0, 512), JSON.stringify(payload), ttlSeconds]
    );
  } catch {
    dbDownUntil = Date.now() + 20_000;
  }
}

export async function getTopicSearchCache(normalizedQuery: string): Promise<string[] | null> {
  try {
    const db = getDbPool();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT qids_json
       FROM topic_search_cache
       WHERE normalized_query = ? AND expires_at > UTC_TIMESTAMP()
       LIMIT 1`,
      [normalizedQuery.slice(0, 255)]
    );
    if (!rows[0]) return null;
    return parseJsonSafe<string[] | null>(rows[0].qids_json, null);
  } catch {
    return null;
  }
}

export async function setTopicSearchCache(
  normalizedQuery: string,
  rawQuery: string,
  qids: string[],
  ttlSeconds: number
): Promise<void> {
  try {
    const db = getDbPool();
    await db.execute(
      `INSERT INTO topic_search_cache (normalized_query, raw_query, qids_json, result_count, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))
       ON DUPLICATE KEY UPDATE
         qids_json = VALUES(qids_json),
         result_count = VALUES(result_count),
         expires_at = VALUES(expires_at),
         created_at = CURRENT_TIMESTAMP`,
      [
        normalizedQuery.slice(0, 255),
        rawQuery.slice(0, 255),
        JSON.stringify(qids),
        qids.length,
        ttlSeconds,
      ]
    );
  } catch {
    // Non-fatal
  }
}

function mapRowToArticleSummary(row: RowDataPacket): RankedArticleSummary {
  return {
    qid: String(row.qid),
    canonicalLabel: String(row.canonical_label),
    topicKeywords: String(row.topic_keywords || ''),
    editions: {
      fi: {
        title: row.fi_title ? String(row.fi_title) : null,
        url: row.fi_url ? String(row.fi_url) : null,
        refCount: Number(row.fi_ref_count || 0),
        pageviews30d: Number(row.fi_pageviews_30d || 0),
        lastRevAt: row.fi_last_rev_at ? new Date(row.fi_last_rev_at).toISOString() : null,
      },
      sv: {
        title: row.sv_title ? String(row.sv_title) : null,
        url: row.sv_url ? String(row.sv_url) : null,
        refCount: Number(row.sv_ref_count || 0),
        pageviews30d: Number(row.sv_pageviews_30d || 0),
        lastRevAt: row.sv_last_rev_at ? new Date(row.sv_last_rev_at).toISOString() : null,
      },
      ru: {
        title: row.ru_title ? String(row.ru_title) : null,
        url: row.ru_url ? String(row.ru_url) : null,
        refCount: Number(row.ru_ref_count || 0),
        pageviews30d: Number(row.ru_pageviews_30d || 0),
        lastRevAt: row.ru_last_rev_at ? new Date(row.ru_last_rev_at).toISOString() : null,
      },
    },
    editionCount: Number(row.edition_count || 0),
    sourceCount: Number(row.source_count || 0),
    citationNeededCount: Number(row.citation_needed_count || 0),
    pageviewCount: Number(row.pageview_count || 0),
    discrepancyCount: Number(row.discrepancy_count || 0),
    discrepancySeverity: Number(row.discrepancy_severity || 0),
    mismatchFlags: {
      hardFact: Boolean(row.has_hard_fact),
      missingCitation: Boolean(row.has_missing_citation),
      outdatedData: Boolean(row.has_outdated_data),
    },
    priorityScore: Number(row.priority_score || 0),
    lastSyncedAt: row.last_synced_at
      ? new Date(row.last_synced_at).toISOString()
      : new Date().toISOString(),
    deepAnalyzedAt: row.deep_analyzed_at ? new Date(row.deep_analyzed_at).toISOString() : null,
  };
}

export interface UpsertArticlePayload {
  qid: string;
  canonicalLabel: string;
  topicQuery: string;
  fiTitle: string | null;
  fiUrl: string | null;
  svTitle: string | null;
  svUrl: string | null;
  ruTitle: string | null;
  ruUrl: string | null;
  editionCount: number;
  fiRefCount: number;
  svRefCount: number;
  ruRefCount: number;
  sourceCount: number;
  citationNeededCount: number;
  fiPageviews30d: number;
  svPageviews30d: number;
  ruPageviews30d: number;
  pageviewCount: number;
  fiLastRevAt: string | null;
  svLastRevAt: string | null;
  ruLastRevAt: string | null;
  discrepancyCount: number;
  discrepancySeverity: number;
  hasHardFact: boolean;
  hasMissingCitation: boolean;
  hasOutdatedData: boolean;
  priorityScore: number;
}

export async function upsertArticleSummary(item: UpsertArticlePayload): Promise<void> {
  const db = getDbPool();
  const keywordTokens = [
    item.topicQuery,
    item.canonicalLabel,
    item.fiTitle || '',
    item.svTitle || '',
    item.ruTitle || '',
  ]
    .join(' ')
    .toLowerCase()
    .trim();

  await db.execute(
    `INSERT INTO articles (
       qid, canonical_label, topic_keywords,
       fi_title, fi_url, sv_title, sv_url, ru_title, ru_url,
       edition_count, fi_ref_count, sv_ref_count, ru_ref_count, source_count, citation_needed_count,
       fi_pageviews_30d, sv_pageviews_30d, ru_pageviews_30d, pageview_count,
       fi_last_rev_at, sv_last_rev_at, ru_last_rev_at,
       discrepancy_count, discrepancy_severity,
       has_hard_fact, has_missing_citation, has_outdated_data,
       priority_score
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       canonical_label = VALUES(canonical_label),
       topic_keywords = CONCAT_WS(' ', topic_keywords, ?),
       fi_title = COALESCE(VALUES(fi_title), fi_title),
       fi_url = COALESCE(VALUES(fi_url), fi_url),
       sv_title = COALESCE(VALUES(sv_title), sv_title),
       sv_url = COALESCE(VALUES(sv_url), sv_url),
       ru_title = COALESCE(VALUES(ru_title), ru_title),
       ru_url = COALESCE(VALUES(ru_url), ru_url),
       edition_count = VALUES(edition_count),
       fi_ref_count = VALUES(fi_ref_count),
       sv_ref_count = VALUES(sv_ref_count),
       ru_ref_count = VALUES(ru_ref_count),
       source_count = VALUES(source_count),
       citation_needed_count = VALUES(citation_needed_count),
       fi_pageviews_30d = VALUES(fi_pageviews_30d),
       sv_pageviews_30d = VALUES(sv_pageviews_30d),
       ru_pageviews_30d = VALUES(ru_pageviews_30d),
       pageview_count = VALUES(pageview_count),
       fi_last_rev_at = COALESCE(VALUES(fi_last_rev_at), fi_last_rev_at),
       sv_last_rev_at = COALESCE(VALUES(sv_last_rev_at), sv_last_rev_at),
       ru_last_rev_at = COALESCE(VALUES(ru_last_rev_at), ru_last_rev_at),
       discrepancy_count = IF(deep_analyzed_at IS NOT NULL, discrepancy_count, VALUES(discrepancy_count)),
       discrepancy_severity = IF(deep_analyzed_at IS NOT NULL, discrepancy_severity, VALUES(discrepancy_severity)),
       has_hard_fact = IF(deep_analyzed_at IS NOT NULL, has_hard_fact, VALUES(has_hard_fact)),
       has_missing_citation = IF(deep_analyzed_at IS NOT NULL, has_missing_citation, VALUES(has_missing_citation)),
       has_outdated_data = IF(deep_analyzed_at IS NOT NULL, has_outdated_data, VALUES(has_outdated_data)),
       priority_score = IF(deep_analyzed_at IS NOT NULL, priority_score, VALUES(priority_score)),
       last_synced_at = CURRENT_TIMESTAMP`,
    [
      item.qid,
      item.canonicalLabel,
      keywordTokens,
      item.fiTitle,
      item.fiUrl,
      item.svTitle,
      item.svUrl,
      item.ruTitle,
      item.ruUrl,
      item.editionCount,
      item.fiRefCount,
      item.svRefCount,
      item.ruRefCount,
      item.sourceCount,
      item.citationNeededCount,
      item.fiPageviews30d,
      item.svPageviews30d,
      item.ruPageviews30d,
      item.pageviewCount,
      toMysqlDateTime(item.fiLastRevAt),
      toMysqlDateTime(item.svLastRevAt),
      toMysqlDateTime(item.ruLastRevAt),
      item.discrepancyCount,
      item.discrepancySeverity,
      item.hasHardFact ? 1 : 0,
      item.hasMissingCitation ? 1 : 0,
      item.hasOutdatedData ? 1 : 0,
      item.priorityScore,
      item.topicQuery.toLowerCase(),
    ]
  );
}

export async function upsertEditionContent(ed: EditionContentRecord): Promise<void> {
  const db = getDbPool();
  await db.execute(
    `INSERT INTO article_editions_content (
       qid, lang, title, article_url, lead_extract, infobox_json,
       extracted_refs_json, ref_count, citation_needed_tags, last_revision_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       article_url = VALUES(article_url),
       lead_extract = VALUES(lead_extract),
       infobox_json = VALUES(infobox_json),
       extracted_refs_json = VALUES(extracted_refs_json),
       ref_count = VALUES(ref_count),
       citation_needed_tags = VALUES(citation_needed_tags),
       last_revision_at = VALUES(last_revision_at),
       synced_at = CURRENT_TIMESTAMP`,
    [
      ed.qid,
      ed.lang,
      ed.title,
      ed.articleUrl,
      ed.leadExtract,
      JSON.stringify(ed.infobox),
      JSON.stringify(ed.extractedRefs),
      ed.refCount,
      ed.citationNeededTags,
      toMysqlDateTime(ed.lastRevisionAt),
    ]
  );
}

export async function queryRankedArticlesByQidsOrFulltext(options: {
  qids?: string[];
  topicQuery?: string;
  filter?: MismatchType | 'all';
  limit?: number;
}): Promise<RankedArticleSummary[]> {
  const db = getDbPool();
  const limit = Math.max(1, Math.min(50, options.limit ?? 50));
  const whereClauses: string[] = ['edition_count >= 2'];
  const params: Array<string | number> = [];

  if (options.qids && options.qids.length > 0) {
    const placeholders = options.qids.map(() => '?').join(',');
    whereClauses.push(`qid IN (${placeholders})`);
    params.push(...options.qids);
  } else if (options.topicQuery && options.topicQuery.trim()) {
    const cleaned = options.topicQuery.trim();
    const booleanTokens = cleaned
      .replace(/[+\-><()~*"@]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2)
      .map((w) => `+${w}*`)
      .join(' ');

    if (booleanTokens) {
      whereClauses.push(
        `(MATCH(canonical_label, topic_keywords, fi_title, sv_title, ru_title) AGAINST (? IN BOOLEAN MODE)
          OR canonical_label LIKE ? OR topic_keywords LIKE ?)`
      );
      params.push(booleanTokens, `%${cleaned}%`, `%${cleaned}%`);
    } else {
      whereClauses.push(`(canonical_label LIKE ? OR topic_keywords LIKE ?)`);
      params.push(`%${cleaned}%`, `%${cleaned}%`);
    }
  }

  if (options.filter === 'hard_fact') {
    whereClauses.push('has_hard_fact = 1');
  } else if (options.filter === 'missing_citation') {
    whereClauses.push('has_missing_citation = 1');
  } else if (options.filter === 'outdated_data') {
    whereClauses.push('has_outdated_data = 1');
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT *
     FROM articles
     ${whereSql}
     ORDER BY priority_score DESC, source_count ASC, discrepancy_severity DESC, pageview_count DESC
     LIMIT ?`,
    [...params, limit]
  );

  return rows.map(mapRowToArticleSummary);
}

export async function getArticleByQid(qid: string): Promise<RankedArticleSummary | null> {
  const db = getDbPool();
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT * FROM articles WHERE qid = ? LIMIT 1',
    [qid]
  );
  if (!rows[0]) return null;
  return mapRowToArticleSummary(rows[0]);
}

export async function getEditionsContentByQid(
  qid: string
): Promise<Map<WikiLang, EditionContentRecord>> {
  const db = getDbPool();
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT * FROM article_editions_content WHERE qid = ?',
    [qid]
  );
  const map = new Map<WikiLang, EditionContentRecord>();

  for (const row of rows) {
    const lang = String(row.lang) as WikiLang;
    map.set(lang, {
      qid: String(row.qid),
      lang,
      title: String(row.title),
      articleUrl: String(row.article_url),
      leadExtract: String(row.lead_extract),
      infobox: parseJsonSafe<Record<string, string>>(row.infobox_json, {}),
      extractedRefs: parseJsonSafe<ParsedRefItem[]>(row.extracted_refs_json, []),
      refCount: Number(row.ref_count || 0),
      citationNeededTags: Number(row.citation_needed_tags || 0),
      lastRevisionAt: row.last_revision_at
        ? new Date(row.last_revision_at).toISOString()
        : null,
    });
  }
  return map;
}

export async function getDiscrepanciesForArticle(qid: string): Promise<DiscrepancyRecord[]> {
  const db = getDbPool();
  const [discRows] = await db.query<RowDataPacket[]>(
    `SELECT *
     FROM discrepancies
     WHERE qid = ?
     ORDER BY severity_score DESC, id ASC`,
    [qid]
  );

  if (discRows.length === 0) return [];

  const discIds = discRows.map((r) => Number(r.id));
  const placeholders = discIds.map(() => '?').join(',');
  const [sourceRows] = await db.query<RowDataPacket[]>(
    `SELECT *
     FROM verified_sources
     WHERE discrepancy_id IN (${placeholders})
     ORDER BY confidence_score DESC, id ASC`,
    discIds
  );

  const sourcesByDisc = new Map<number, VerifiedSourceRecord[]>();
  for (const sr of sourceRows) {
    const dId = Number(sr.discrepancy_id);
    const list = sourcesByDisc.get(dId) || [];
    list.push({
      id: Number(sr.id),
      discrepancyId: dId,
      sourceOrigin: sr.source_origin,
      sourceType: sr.source_type,
      title: String(sr.title),
      authors: parseJsonSafe<string[]>(sr.authors_json, []),
      publicationVenue: sr.publication_venue ? String(sr.publication_venue) : null,
      publicationYear: sr.publication_year ? Number(sr.publication_year) : null,
      doi: sr.doi ? String(sr.doi) : null,
      isbn: sr.isbn ? String(sr.isbn) : null,
      sourceUrl: sr.source_url ? String(sr.source_url) : null,
      archiveUrl: sr.archive_url ? String(sr.archive_url) : null,
      deadLinkStatus: sr.dead_link_status,
      httpStatusCode: sr.http_status_code ? Number(sr.http_status_code) : null,
      academicCitationCount: Number(sr.academic_citation_count || 0),
      confidenceScore: Number(sr.confidence_score || 70),
      confidenceLevel: sr.confidence_level,
      citations: {
        fi: String(sr.cite_template_fi),
        sv: String(sr.cite_template_sv),
        ru: String(sr.cite_template_ru),
        en: String(sr.cite_template_en),
      },
    });
    sourcesByDisc.set(dId, list);
  }

  return discRows.map((row) => {
    const id = Number(row.id);
    const defaultMatrix: LanguageAgreementMatrix = {
      consensusGroup: [],
      outlierGroup: [],
      matrixLabel: '',
      claims: {
        fi: { value: '', hasCitation: false, citationStatus: 'missing' },
        sv: { value: '', hasCitation: false, citationStatus: 'missing' },
        ru: { value: '', hasCitation: false, citationStatus: 'missing' },
      },
    };

    return {
      id,
      qid: String(row.qid),
      mismatchType: row.mismatch_type,
      targetLang: row.target_lang,
      claimTopic: String(row.claim_topic),
      summary: String(row.summary),
      disputedSnippet: String(row.disputed_snippet),
      sectionHeading: row.section_heading ? String(row.section_heading) : null,
      lineHint: row.line_hint !== null ? Number(row.line_hint) : null,
      suggestedCorrection: String(row.suggested_correction),
      agreementMatrix: parseJsonSafe<LanguageAgreementMatrix>(
        row.agreement_matrix_json,
        defaultMatrix
      ),
      citationGapFlag: Boolean(row.citation_gap_flag),
      donorLang: row.donor_lang ? (String(row.donor_lang) as WikiLang) : null,
      brokenLinkDetected: Boolean(row.broken_link_detected),
      brokenLinkUrl: row.broken_link_url ? String(row.broken_link_url) : null,
      severityScore: Number(row.severity_score || 50),
      confidenceLevel: row.confidence_level,
      confidenceScore: Number(row.confidence_score || 65),
      verifiedSources: sourcesByDisc.get(id) || [],
    };
  });
}

export async function saveArticleDiscrepanciesTransaction(
  qid: string,
  discrepancies: DiscrepancyRecord[],
  updatedPriorityScore: number
): Promise<DiscrepancyRecord[]> {
  const db = getDbPool();
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM discrepancies WHERE qid = ?', [qid]);

    let maxSeverity = 0;
    let hasHardFact = false;
    let hasMissingCitation = false;
    let hasOutdatedData = false;

    for (const disc of discrepancies) {
      if (disc.severityScore > maxSeverity) {
        maxSeverity = disc.severityScore;
      }
      if (disc.mismatchType === 'hard_fact') hasHardFact = true;
      if (disc.mismatchType === 'missing_citation') hasMissingCitation = true;
      if (disc.mismatchType === 'outdated_data') hasOutdatedData = true;

      const [ins] = await conn.execute<ResultSetHeader>(
        `INSERT INTO discrepancies (
           qid, mismatch_type, target_lang, claim_topic, summary,
           disputed_snippet, section_heading, line_hint, suggested_correction,
           agreement_matrix_json, citation_gap_flag, donor_lang,
           broken_link_detected, broken_link_url,
           severity_score, confidence_level, confidence_score
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          qid,
          disc.mismatchType,
          disc.targetLang,
          disc.claimTopic.slice(0, 512),
          disc.summary,
          disc.disputedSnippet,
          disc.sectionHeading ? disc.sectionHeading.slice(0, 512) : null,
          disc.lineHint,
          disc.suggestedCorrection,
          JSON.stringify(disc.agreementMatrix),
          disc.citationGapFlag ? 1 : 0,
          disc.donorLang,
          disc.brokenLinkDetected ? 1 : 0,
          disc.brokenLinkUrl ? disc.brokenLinkUrl.slice(0, 1024) : null,
          disc.severityScore,
          disc.confidenceLevel,
          disc.confidenceScore,
        ]
      );

      const discrepancyId = Number(ins.insertId);
      for (const src of disc.verifiedSources) {
        await conn.execute(
          `INSERT INTO verified_sources (
             discrepancy_id, source_origin, source_type,
             title, authors_json, publication_venue, publication_year,
             doi, isbn, source_url, archive_url,
             dead_link_status, http_status_code, academic_citation_count,
             confidence_score, confidence_level,
             cite_template_fi, cite_template_sv, cite_template_ru, cite_template_en
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            discrepancyId,
            src.sourceOrigin,
            src.sourceType,
            src.title.slice(0, 1024),
            JSON.stringify(src.authors),
            src.publicationVenue ? src.publicationVenue.slice(0, 512) : null,
            src.publicationYear,
            src.doi ? src.doi.slice(0, 255) : null,
            src.isbn ? src.isbn.slice(0, 64) : null,
            src.sourceUrl ? src.sourceUrl.slice(0, 1024) : null,
            src.archiveUrl ? src.archiveUrl.slice(0, 1024) : null,
            src.deadLinkStatus,
            src.httpStatusCode,
            src.academicCitationCount,
            src.confidenceScore,
            src.confidenceLevel,
            src.citations.fi,
            src.citations.sv,
            src.citations.ru,
            src.citations.en,
          ]
        );
      }
    }

    await conn.execute(
      `UPDATE articles
       SET discrepancy_count = ?,
           discrepancy_severity = ?,
           has_hard_fact = ?,
           has_missing_citation = ?,
           has_outdated_data = ?,
           priority_score = ?,
           deep_analyzed_at = CURRENT_TIMESTAMP
       WHERE qid = ?`,
      [
        discrepancies.length,
        maxSeverity,
        hasHardFact ? 1 : 0,
        hasMissingCitation ? 1 : 0,
        hasOutdatedData ? 1 : 0,
        updatedPriorityScore,
        qid,
      ]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return getDiscrepanciesForArticle(qid);
}

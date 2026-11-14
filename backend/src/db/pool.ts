import mysql, { type Pool } from 'mysql2/promise';
import { config } from '../config.js';

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: config.mariadb.host,
      port: config.mariadb.port,
      user: config.mariadb.user,
      password: config.mariadb.password,
      database: config.mariadb.database,
      waitForConnections: true,
      connectionLimit: 12,
      connectTimeout: config.mariadb.connectTimeoutMs,
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: 'Z',
      ...(config.mariadb.ssl
        ? {
            ssl: {
              rejectUnauthorized: config.mariadb.sslRejectUnauthorized,
            },
          }
        : {}),
    });
  }
  return pool;
}

export async function initializeMariaDbSchema(): Promise<void> {
  const db = getDbPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS articles (
      qid VARCHAR(32) NOT NULL,
      canonical_label VARCHAR(512) NOT NULL,
      topic_keywords TEXT NOT NULL,
      fi_title VARCHAR(512) NULL,
      fi_url VARCHAR(1024) NULL,
      sv_title VARCHAR(512) NULL,
      sv_url VARCHAR(1024) NULL,
      ru_title VARCHAR(512) NULL,
      ru_url VARCHAR(1024) NULL,
      edition_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
      fi_ref_count INT UNSIGNED NOT NULL DEFAULT 0,
      sv_ref_count INT UNSIGNED NOT NULL DEFAULT 0,
      ru_ref_count INT UNSIGNED NOT NULL DEFAULT 0,
      source_count INT UNSIGNED NOT NULL DEFAULT 0,
      citation_needed_count INT UNSIGNED NOT NULL DEFAULT 0,
      fi_pageviews_30d BIGINT UNSIGNED NOT NULL DEFAULT 0,
      sv_pageviews_30d BIGINT UNSIGNED NOT NULL DEFAULT 0,
      ru_pageviews_30d BIGINT UNSIGNED NOT NULL DEFAULT 0,
      pageview_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
      fi_last_rev_at DATETIME NULL,
      sv_last_rev_at DATETIME NULL,
      ru_last_rev_at DATETIME NULL,
      discrepancy_count INT UNSIGNED NOT NULL DEFAULT 0,
      discrepancy_severity DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      has_hard_fact BOOLEAN NOT NULL DEFAULT FALSE,
      has_missing_citation BOOLEAN NOT NULL DEFAULT FALSE,
      has_outdated_data BOOLEAN NOT NULL DEFAULT FALSE,
      priority_score DECIMAL(6,2) NOT NULL DEFAULT 0.00,
      last_synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deep_analyzed_at TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (qid),
      INDEX idx_ranking_metrics (source_count ASC, discrepancy_severity DESC, pageview_count DESC),
      INDEX idx_priority_ranking (priority_score DESC, pageview_count DESC),
      INDEX idx_filter_hard_fact (has_hard_fact, priority_score DESC),
      INDEX idx_filter_missing_citation (has_missing_citation, priority_score DESC),
      INDEX idx_filter_outdated_data (has_outdated_data, priority_score DESC),
      FULLTEXT INDEX ft_article_search (canonical_label, topic_keywords, fi_title, sv_title, ru_title)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS article_editions_content (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      qid VARCHAR(32) NOT NULL,
      lang ENUM('fi', 'sv', 'ru') NOT NULL,
      title VARCHAR(512) NOT NULL,
      article_url VARCHAR(1024) NOT NULL,
      lead_extract MEDIUMTEXT NOT NULL,
      infobox_json JSON NULL,
      extracted_refs_json JSON NULL,
      ref_count INT UNSIGNED NOT NULL DEFAULT 0,
      citation_needed_tags INT UNSIGNED NOT NULL DEFAULT 0,
      last_revision_at DATETIME NULL,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_edition_qid_lang (qid, lang),
      CONSTRAINT fk_edition_article
        FOREIGN KEY (qid) REFERENCES articles (qid)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS discrepancies (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      qid VARCHAR(32) NOT NULL,
      mismatch_type ENUM('hard_fact', 'missing_citation', 'outdated_data') NOT NULL,
      target_lang ENUM('fi', 'sv', 'ru') NOT NULL,
      claim_topic VARCHAR(512) NOT NULL,
      summary TEXT NOT NULL,
      disputed_snippet TEXT NOT NULL,
      section_heading VARCHAR(512) NULL,
      line_hint INT UNSIGNED NULL,
      suggested_correction TEXT NOT NULL,
      agreement_matrix_json JSON NOT NULL,
      citation_gap_flag BOOLEAN NOT NULL DEFAULT FALSE,
      donor_lang ENUM('fi', 'sv', 'ru') NULL,
      broken_link_detected BOOLEAN NOT NULL DEFAULT FALSE,
      broken_link_url VARCHAR(1024) NULL,
      severity_score DECIMAL(5,2) NOT NULL DEFAULT 50.00,
      confidence_level ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'medium',
      confidence_score TINYINT UNSIGNED NOT NULL DEFAULT 65,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_discrepancies_qid_severity (qid, severity_score DESC),
      INDEX idx_discrepancies_type_severity (mismatch_type, severity_score DESC),
      INDEX idx_discrepancies_target_lang (target_lang, qid),
      CONSTRAINT fk_discrepancy_article
        FOREIGN KEY (qid) REFERENCES articles (qid)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS verified_sources (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      discrepancy_id BIGINT UNSIGNED NOT NULL,
      source_origin ENUM('crossref', 'openalex', 'semantic_scholar', 'google_books', 'wikipedia_donor_ref') NOT NULL,
      source_type ENUM('journal', 'book', 'dissertation', 'conference', 'web', 'archive') NOT NULL DEFAULT 'journal',
      title VARCHAR(1024) NOT NULL,
      authors_json JSON NOT NULL,
      publication_venue VARCHAR(512) NULL,
      publication_year SMALLINT UNSIGNED NULL,
      doi VARCHAR(255) NULL,
      isbn VARCHAR(64) NULL,
      source_url VARCHAR(1024) NULL,
      archive_url VARCHAR(1024) NULL,
      dead_link_status ENUM('alive', 'dead', 'archived_recovered', 'unchecked') NOT NULL DEFAULT 'unchecked',
      http_status_code SMALLINT UNSIGNED NULL,
      academic_citation_count INT UNSIGNED NOT NULL DEFAULT 0,
      confidence_score TINYINT UNSIGNED NOT NULL DEFAULT 75,
      confidence_level ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'high',
      cite_template_fi TEXT NOT NULL,
      cite_template_sv TEXT NOT NULL,
      cite_template_ru TEXT NOT NULL,
      cite_template_en TEXT NOT NULL,
      verified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_sources_discrepancy_conf (discrepancy_id, confidence_score DESC),
      INDEX idx_sources_doi (doi),
      INDEX idx_sources_isbn (isbn),
      CONSTRAINT fk_source_discrepancy
        FOREIGN KEY (discrepancy_id) REFERENCES discrepancies (id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS topic_search_cache (
      normalized_query VARCHAR(255) NOT NULL,
      raw_query VARCHAR(255) NOT NULL,
      qids_json JSON NOT NULL,
      result_count INT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      PRIMARY KEY (normalized_query),
      INDEX idx_topic_cache_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS external_api_cache (
      cache_key CHAR(64) NOT NULL,
      provider ENUM('mediawiki', 'wikidata', 'pageviews', 'crossref', 'openalex', 'semantic_scholar', 'google_books', 'link_check') NOT NULL,
      request_descriptor VARCHAR(512) NOT NULL,
      response_json LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      PRIMARY KEY (cache_key),
      INDEX idx_external_cache_provider_exp (provider, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

-- ============================================================================
-- WikiBridge — MariaDB Schema for Cross-Lingual Wikipedia Fact-Checking (FI/SV/RU)
-- Engine: InnoDB | Charset: utf8mb4 | Collation: utf8mb4_unicode_ci
-- Supports full Finnish (ä, ö), Swedish (å, ä, ö), and Russian Cyrillic scripts.
-- ============================================================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

CREATE DATABASE IF NOT EXISTS wikibridge
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE wikibridge;

-- ----------------------------------------------------------------------------
-- 1. articles: Wikidata Q-ID cross-lingual hub & weighted ranking metrics
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS articles (
  qid VARCHAR(32) NOT NULL COMMENT 'Wikidata item identifier (e.g., Q104318)',
  canonical_label VARCHAR(512) NOT NULL COMMENT 'Primary human-readable title/label',
  topic_keywords TEXT NOT NULL COMMENT 'Space-separated search topics & localized aliases for FULLTEXT lookup',

  fi_title VARCHAR(512) NULL,
  fi_url VARCHAR(1024) NULL,
  sv_title VARCHAR(512) NULL,
  sv_url VARCHAR(1024) NULL,
  ru_title VARCHAR(512) NULL,
  ru_url VARCHAR(1024) NULL,

  edition_count TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Number of available editions among fi, sv, ru (1..3)',

  -- Parsed <ref> citation counts per language edition
  fi_ref_count INT UNSIGNED NOT NULL DEFAULT 0,
  sv_ref_count INT UNSIGNED NOT NULL DEFAULT 0,
  ru_ref_count INT UNSIGNED NOT NULL DEFAULT 0,
  source_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Effective minimum/composite <ref> count driving low-source-density ranking',
  citation_needed_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total [citation needed] / {{Lähde}} / {{Källa behövs}} / {{Нет АИ}} tags',

  -- 30-day Wikimedia Pageviews per edition & aggregate
  fi_pageviews_30d BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sv_pageviews_30d BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ru_pageviews_30d BIGINT UNSIGNED NOT NULL DEFAULT 0,
  pageview_count BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Combined 30-day pageviews across fi + sv + ru',

  -- Latest revision timestamps for staleness / outdated-data detection
  fi_last_rev_at DATETIME NULL,
  sv_last_rev_at DATETIME NULL,
  ru_last_rev_at DATETIME NULL,

  -- Aggregated discrepancy metrics & filter flags
  discrepancy_count INT UNSIGNED NOT NULL DEFAULT 0,
  discrepancy_severity DECIMAL(5,2) NOT NULL DEFAULT 0.00 COMMENT 'Normalized 0..100 discrepancy severity score',
  has_hard_fact BOOLEAN NOT NULL DEFAULT FALSE,
  has_missing_citation BOOLEAN NOT NULL DEFAULT FALSE,
  has_outdated_data BOOLEAN NOT NULL DEFAULT FALSE,

  -- Precomputed weighted priority score (Low Source Density + Discrepancy Severity + Traffic)
  priority_score DECIMAL(6,2) NOT NULL DEFAULT 0.00,

  last_synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deep_analyzed_at TIMESTAMP NULL DEFAULT NULL,

  PRIMARY KEY (qid),

  -- Composite index directly supporting ranking queries by source_count, discrepancy_severity, and pageview_count
  INDEX idx_ranking_metrics (source_count ASC, discrepancy_severity DESC, pageview_count DESC),

  -- Composite indexes for fast top-50 sorted retrieval with Mismatch Type filters
  INDEX idx_priority_ranking (priority_score DESC, pageview_count DESC),
  INDEX idx_filter_hard_fact (has_hard_fact, priority_score DESC),
  INDEX idx_filter_missing_citation (has_missing_citation, priority_score DESC),
  INDEX idx_filter_outdated_data (has_outdated_data, priority_score DESC),

  -- FULLTEXT index for multilingual topic & title searching across fi, sv, ru, and keywords
  FULLTEXT INDEX ft_article_search (canonical_label, topic_keywords, fi_title, sv_title, ru_title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. article_editions_content: Cached extracts, infobox facts & <ref> inventory
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS article_editions_content (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  qid VARCHAR(32) NOT NULL,
  lang ENUM('fi', 'sv', 'ru') NOT NULL,
  title VARCHAR(512) NOT NULL,
  article_url VARCHAR(1024) NOT NULL,
  lead_extract MEDIUMTEXT NOT NULL,
  infobox_json JSON NULL COMMENT 'Structured key-value facts parsed from edition infobox',
  extracted_refs_json JSON NULL COMMENT 'Parsed <ref> URLs, DOIs, ISBNs, and citation text',
  ref_count INT UNSIGNED NOT NULL DEFAULT 0,
  citation_needed_tags INT UNSIGNED NOT NULL DEFAULT 0,
  last_revision_at DATETIME NULL,
  synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_edition_qid_lang (qid, lang),
  CONSTRAINT fk_edition_article
    FOREIGN KEY (qid) REFERENCES articles (qid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. discrepancies: Cross-lingual mismatches, Language Agreement Matrix & snippets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discrepancies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  qid VARCHAR(32) NOT NULL,
  mismatch_type ENUM('hard_fact', 'missing_citation', 'outdated_data') NOT NULL,
  target_lang ENUM('fi', 'sv', 'ru') NOT NULL COMMENT 'Edition containing the error, missing citation, or outdated figure',
  claim_topic VARCHAR(512) NOT NULL COMMENT 'Short heading for the disputed claim (e.g., Casualty figures)',
  summary TEXT NOT NULL COMMENT 'Concise editorial summary of how fi, sv, and ru differ',
  disputed_snippet TEXT NOT NULL COMMENT 'Exact localized passage in target_lang to scroll to and highlight in red',
  section_heading VARCHAR(512) NULL COMMENT 'Optional section heading anchor on target Wikipedia page',
  line_hint INT UNSIGNED NULL COMMENT 'Approximate paragraph/line index inside article body',
  suggested_correction TEXT NOT NULL COMMENT 'Recommended factual correction or update for the editor',

  -- Language Agreement Matrix JSON:
  -- { consensusGroup: ["fi","sv"], outlierGroup: ["ru"], matrixLabel: "FI & SV agree: X | RU states: Y", claims: { fi: {...}, sv: {...}, ru: {...} } }
  agreement_matrix_json JSON NOT NULL,

  -- Citation Gap & Broken Link flags
  citation_gap_flag BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'True when another edition backs this claim with a valid source while target_lang lacks one',
  donor_lang ENUM('fi', 'sv', 'ru') NULL COMMENT 'Language edition from which a verified citation can be ported',
  broken_link_detected BOOLEAN NOT NULL DEFAULT FALSE,
  broken_link_url VARCHAR(1024) NULL,

  severity_score DECIMAL(5,2) NOT NULL DEFAULT 50.00 COMMENT '0..100 severity rating',
  confidence_level ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'medium',
  confidence_score TINYINT UNSIGNED NOT NULL DEFAULT 65 COMMENT '0..100 confidence rating based on academic source tier & corroboration',

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_discrepancies_qid_severity (qid, severity_score DESC),
  INDEX idx_discrepancies_type_severity (mismatch_type, severity_score DESC),
  INDEX idx_discrepancies_target_lang (target_lang, qid),
  CONSTRAINT fk_discrepancy_article
    FOREIGN KEY (qid) REFERENCES articles (qid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. verified_sources: Academic verification metadata, dead-link checks & localized citations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verified_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  discrepancy_id BIGINT UNSIGNED NOT NULL,
  source_origin ENUM('crossref', 'openalex', 'semantic_scholar', 'google_books', 'wikipedia_donor_ref') NOT NULL,
  source_type ENUM('journal', 'book', 'dissertation', 'conference', 'web', 'archive') NOT NULL DEFAULT 'journal',

  title VARCHAR(1024) NOT NULL,
  authors_json JSON NOT NULL COMMENT 'JSON array of author names',
  publication_venue VARCHAR(512) NULL,
  publication_year SMALLINT UNSIGNED NULL,
  doi VARCHAR(255) NULL,
  isbn VARCHAR(64) NULL,
  source_url VARCHAR(1024) NULL,
  archive_url VARCHAR(1024) NULL COMMENT 'Wayback Machine snapshot URL if original link is dead',

  dead_link_status ENUM('alive', 'dead', 'archived_recovered', 'unchecked') NOT NULL DEFAULT 'unchecked',
  http_status_code SMALLINT UNSIGNED NULL,
  academic_citation_count INT UNSIGNED NOT NULL DEFAULT 0,

  confidence_score TINYINT UNSIGNED NOT NULL DEFAULT 75,
  confidence_level ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'high',

  -- Pre-formatted Wikipedia <ref> citation templates localized per language edition
  cite_template_fi TEXT NOT NULL COMMENT 'Finnish {{Kirjaviite}} / {{Lehtiviite}} / {{Verkkoviite}} wrapped in <ref>',
  cite_template_sv TEXT NOT NULL COMMENT 'Swedish {{Bokref}} / {{Tidskriftsref}} / {{Webbref}} wrapped in <ref>',
  cite_template_ru TEXT NOT NULL COMMENT 'Russian {{Статья}} / {{Книга}} wrapped in <ref>',
  cite_template_en TEXT NOT NULL COMMENT 'Standard {{Cite journal}} / {{Cite book}} wrapped in <ref>',

  verified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_sources_discrepancy_conf (discrepancy_id, confidence_score DESC),
  INDEX idx_sources_doi (doi),
  INDEX idx_sources_isbn (isbn),
  CONSTRAINT fk_source_discrepancy
    FOREIGN KEY (discrepancy_id) REFERENCES discrepancies (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5. topic_search_cache: Caches ranked Q-ID lists per topic query with TTL
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS topic_search_cache (
  normalized_query VARCHAR(255) NOT NULL,
  raw_query VARCHAR(255) NOT NULL,
  qids_json JSON NOT NULL COMMENT 'Ordered JSON array of matched Wikidata Q-IDs',
  result_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,

  PRIMARY KEY (normalized_query),
  INDEX idx_topic_cache_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. external_api_cache: Caches MediaWiki, Pageviews & Academic API responses
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_api_cache (
  cache_key CHAR(64) NOT NULL COMMENT 'SHA-256 hex digest of provider + normalized request key',
  provider ENUM('mediawiki', 'wikidata', 'pageviews', 'crossref', 'openalex', 'semantic_scholar', 'google_books', 'link_check') NOT NULL,
  request_descriptor VARCHAR(512) NOT NULL,
  response_json LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,

  PRIMARY KEY (cache_key),
  INDEX idx_external_cache_provider_exp (provider, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

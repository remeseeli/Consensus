CREATE DATABASE IF NOT EXISTS wiki_rag CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE wiki_rag;

-- Single-table store for Wikipedia chunks, metadata, and native VECTOR embeddings
CREATE TABLE IF NOT EXISTS wiki_chunks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_title VARCHAR(255) NOT NULL,
    article_url VARCHAR(1024) NOT NULL,
    section_title VARCHAR(512) NOT NULL DEFAULT 'Introduction',
    chunk_index INT NOT NULL DEFAULT 0,
    chunk_text TEXT NOT NULL,
    embedding VECTOR(384) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_article_chunk (article_title, chunk_index),
    INDEX idx_article_title (article_title),
    VECTOR INDEX idx_wiki_chunks_embedding (embedding) M=16 DISTANCE=cosine
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cache for topic expansion mind maps to reduce MediaWiki API calls
CREATE TABLE IF NOT EXISTS topic_cache (
    topic_key VARCHAR(255) PRIMARY KEY,
    canonical_title VARCHAR(255) NOT NULL,
    tree_json LONGTEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    INDEX idx_topic_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
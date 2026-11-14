import dotenv from 'dotenv';

dotenv.config();

const rawGeminiKey = (process.env.GEMINI_API_KEY || '').trim();
const hasGeminiKey =
  rawGeminiKey.length > 0 &&
  rawGeminiKey !== 'your_gemini_api_key_here' &&
  rawGeminiKey !== 'REPLACE_ME';

export const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  mariadb: {
    host: process.env.MARIADB_HOST || 'localhost',
    port: Number(process.env.MARIADB_PORT || 3306),
    user: process.env.MARIADB_USER || 'wikibridge',
    password: process.env.MARIADB_PASSWORD || 'wikibridge_pw',
    database: process.env.MARIADB_DATABASE || 'wikibridge',
    ssl: process.env.MARIADB_SSL === 'true',
    sslRejectUnauthorized: process.env.MARIADB_SSL_REJECT_UNAUTHORIZED !== 'false',
    connectTimeoutMs: Math.max(1000, Number(process.env.MARIADB_CONNECT_TIMEOUT_MS || 10000)),
  },
  geminiApiKey: hasGeminiKey ? rawGeminiKey : '',
  llmEnabled: hasGeminiKey,
  geminiModel: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
  academicContactEmail:
    (process.env.ACADEMIC_CONTACT_EMAIL || 'editor-tools@wikibridge.local').trim(),
  semanticScholarApiKey: (process.env.SEMANTIC_SCHOLAR_API_KEY || '').trim(),
  googleBooksApiKey: (process.env.GOOGLE_BOOKS_API_KEY || '').trim(),
  wikimediaUserAgent:
    (process.env.WIKIMEDIA_USER_AGENT || '').trim() ||
    'WikiBridgeExtension/1.0 (https://localhost:4000; editor-tools@wikibridge.local)',
  searchCacheTtlSeconds: Math.max(60, Number(process.env.SEARCH_CACHE_TTL_SECONDS || 21600)),
  apiCacheTtlSeconds: Math.max(300, Number(process.env.API_CACHE_TTL_SECONDS || 86400)),
} as const;

# WikiBridge — Cross-Lingual Wikipedia Fact-Checking & Citation Workbench (`FI` · `SV` · `RU`)

**WikiBridge** is a Manifest V3 browser extension and Node.js/TypeScript + **MariaDB** backend designed for Wikipedia editors auditing factual consistency, citation gaps, and outdated statistics across **Finnish (`fi.wikipedia.org`)**, **Swedish (`sv.wikipedia.org`)**, and **Russian (`ru.wikipedia.org`)** Wikipedia.

---

## 1. System Architecture

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│                   MANIFEST V3 BROWSER EXTENSION (extension/)                  │
│                                                                               │
│  ┌──────────────────────────────┐      ┌───────────────────────────────────┐  │
│  │ Side Panel / Docked Sidebar  │◄────►│ Background Service Worker (MV3)   │  │
│  │ - Topic Search & Chips       │      │ - Cross-tab URL Navigation        │  │
│  │ - Top 50 Priority Queue      │      │ - Tab Load Synchronization        │  │
│  │ - Language Agreement Matrix  │      └─────────────────┬─────────────────┘  │
│  │ - Localized <ref> Formatter  │                        │                    │
│  └──────────────┬───────────────┘                        ▼                    │
│                 │                      ┌───────────────────────────────────┐  │
│                 │ REST JSON            │ Wikipedia Content Script          │  │
│                 │                      │ - 3-Tier DOM Text Matcher         │  │
│                 │                      │ - Red (#fee7e6 / #d33) Highlight  │  │
│                 │                      │ - Inline Verification Card        │  │
│                 │                      │ - Source & VisualEditor Injector  │  │
│                 │                      └───────────────────────────────────┘  │
└─────────────────┼─────────────────────────────────────────────────────────────┘
                  ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                 EXPRESS + TYPESCRIPT BACKEND API (backend/)                   │
│                                                                               │
│  - Token-Bucket Rate Limiters & Retry/Backoff per External Host               │
│  - MediaWiki Action API (fi/sv/ru) + Wikidata Q-ID Batch Linker (50 IDs/req)  │
│  - Wikitext <ref> Density, Infobox & Citation-Needed Tag Parser               │
│  - Wikimedia 30-Day Pageviews REST Client                                     │
│  - LLM Semantic Comparator (Gemini @google/genai JSON Schema + Heuristic)     │
│  - External Verifier: Crossref · OpenAlex · Semantic Scholar · Google Books   │
│  - SSRF-Safe Link Health Checker + Internet Archive Wayback Machine Recovery  │
└─────────────────┬─────────────────────────────────────────────────────────────┘
                  ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│             MARIADB 11.4+ (InnoDB · utf8mb4_unicode_ci) (db/)                 │
│                                                                               │
│  - articles (Composite Ranking Indexes + FULLTEXT Multilingual Index)         │
│  - article_editions_content (Cached Extracts, Infobox JSON, <ref> Inventory)  │
│  - discrepancies (Mismatch Types, Snippets, Language Agreement Matrix JSON)   │
│  - verified_sources (DOI/ISBN, Confidence Score, Localized FI/SV/RU <ref>s)   │
│  - topic_search_cache & external_api_cache (SHA-256 Keyed TTL Response Cache) │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Quick Start

### Step A — Start MariaDB & Backend API (Docker Compose)

1. Optional: set `GEMINI_API_KEY` in your shell or a root `.env` file to enable live Gemini semantic comparison (if omitted, the backend automatically falls back to its deterministic cross-lingual numeric/date/citation-gap analyzer + live academic verification):
   ```bash
   docker compose up --build
   ```
   - **MariaDB** initializes `db/schema.sql` (`InnoDB`, `utf8mb4_unicode_ci`) and pre-loads `db/seed.sql` on port `3306`.
   - **Backend API** starts on `http://localhost:4000` (`/api/health`, `/api/search`, `/api/articles/:qid/analyze`, `/api/verify-claim`, `/api/citations/format`).

### Step B — Run Backend Locally Without Docker (Alternative)

```bash
cd backend
cp .env.example .env
# Edit .env with your MariaDB credentials and GEMINI_API_KEY
npm install
npm run dev
```

### Step C — Load the Manifest V3 Browser Extension

No frontend build step is required — `extension/` uses native ES modules ready for unpacked loading:

1. Open Chrome, Edge, or Brave and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `extension/` folder in this repository.
4. Click the **WikiBridge** extension icon in the browser toolbar to open the persistent **Side Panel** (or click the **WikiBridge FI·SV·RU** button at the bottom-right of any `fi`, `sv`, or `ru` Wikipedia article to toggle the layout-preserving docked sidebar).

---

## 3. Ranking Algorithm & Filtering Engine

When an editor searches a topic (`GET /api/search?q=<topic>&filter=all|hard_fact|missing_citation|outdated_data`), the backend links articles across `fi.wikipedia.org`, `sv.wikipedia.org`, and `ru.wikipedia.org` via **Wikidata Q-IDs** (`wbgetentities`) and ranks the **Top 50** articles by a composite priority score $S \in [0, 100]$:

$$
S = 0.40 \cdot S_{\text{low\_sources}} + 0.35 \cdot S_{\text{discrepancy}} + 0.25 \cdot S_{\text{traffic}}
$$

1. **Low Source Density ($40\%$):**
   $$S_{\text{low\_sources}} = \frac{100}{1 + \frac{\min(\text{refs}_{\text{fi}}, \text{refs}_{\text{sv}}, \text{refs}_{\text{ru}})}{14}}$$
   Strongly prioritizes under-sourced articles (e.g., 0–10 `<ref>` tags) or severe cross-edition citation imbalances.
2. **Discrepancy Severity ($35\%$):** Normalized `0..100` severity of detected cross-lingual conflicts (`hard_fact` numeric/chronological divergences, `missing_citation` / `{{Lähde}}` / `{{Källa behövs}}` / `{{Нет АИ}}` tags, and `outdated_data` staleness).
3. **Article Traffic ($25\%$):** Log-scaled 30-day combined pageviews from the Wikimedia Pageviews REST API so high-readership articles surface ahead of zero-traffic pages.

---

## 4. MariaDB Schema & Indexing Highlights (`db/schema.sql`)

All tables use `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` to handle Finnish (`ä`, `ö`), Swedish (`å`, `ä`, `ö`), and Russian Cyrillic (`А–Я`, `а–я`) accurately:

- **`articles`**: Stores Wikidata `qid`, localized `fi`/`sv`/`ru` titles and URLs, parsed `<ref>` counts, 30-day pageviews, revision timestamps, mismatch filter booleans, and `priority_score`.
  - `INDEX idx_ranking_metrics (source_count ASC, discrepancy_severity DESC, pageview_count DESC)`
  - `INDEX idx_priority_ranking (priority_score DESC, pageview_count DESC)`
  - Filter-specific composite indexes (`idx_filter_hard_fact`, `idx_filter_missing_citation`, `idx_filter_outdated_data`)
  - `FULLTEXT INDEX ft_article_search (canonical_label, topic_keywords, fi_title, sv_title, ru_title)`
- **`article_editions_content`**: Caches lead extracts, parsed infobox JSON, and extracted `<ref>` metadata per `(qid, lang)`.
- **`discrepancies`**: Stores `mismatch_type`, `target_lang`, verbatim `disputed_snippet` for DOM matching, `agreement_matrix_json` (`LanguageAgreementMatrix`), `citation_gap_flag`, `donor_lang`, and `broken_link_detected`.
- **`verified_sources`**: Stores academic metadata (`DOI`, `ISBN`, authors, venue, year, `dead_link_status`, Wayback `archive_url`), `confidence_score` (`high`/`medium`/`low`), and pre-rendered localized `<ref>` templates (`cite_template_fi`, `cite_template_sv`, `cite_template_ru`, `cite_template_en`).
- **`topic_search_cache` & `external_api_cache`**: TTL-enforced (`expires_at`) caches keyed by normalized query or SHA-256 request digest to minimize external API calls.

---

## 5. Navigation, Highlighting & Localized Citation Templates

- **DOM Highlighting (`extension/src/content/contentScript.js`)**:
  - Navigates the active tab to the target Wikipedia edition, locates the disputed passage via a 3-tier matcher (exact normalized text-walker across inline `<a>` tags, numeric/token overlap fallback, and section heading anchor), scrolls smoothly into view, highlights the claim in Vector-2022 red (`#fee7e6` background, `#d33` border), and mounts an inline verification card.
- **Localized One-Click `<ref>` Templates (`backend/src/services/citationFormatter.ts`)**:
  - **Finnish (`fi`)**: `{{Kirjaviite}}`, `{{Lehtiviite}}`, `{{Verkkoviite}}`
  - **Swedish (`sv`)**: `{{Bokref}}`, `{{Tidskriftsref}}`, `{{Webbref}}`
  - **Russian (`ru`)**: `{{Статья}}`, `{{Книга}}`, `{{Cite web}}`
  - **Standard (`en`)**: `{{Cite journal}}`, `{{Cite book}}`, `{{Cite web}}`
- **Editor Injection**:
  - **Source Editor (`#wpTextbox1`)**: Locates the disputed sentence in wikitext (or current cursor), replaces any adjacent citation-needed template (`{{Lähde}}`, `{{Källa behövs}}`, `{{Нет АИ}}`) or appends `<ref name="...">...</ref>`, populates `#wpSummary`, and highlights the inserted wikitext for human review. If clicked from Read Mode, automatically transitions to `?action=edit` and injects on load.
  - **VisualEditor (`.ve-ce-surface`)**: Inserts at the active VisualEditor cursor surface and copies to clipboard.

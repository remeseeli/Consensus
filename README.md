# Consensus — Cross-Lingual Wikipedia Fact-Checking & Discrepancy Workbench

**Consensus** is a Manifest V3 browser extension and optional Node.js/TypeScript + MariaDB backend that helps Wikipedia editors and researchers detect factual discrepancies, citation imbalances, outdated claims, and non-neutral (emotional) framing across multiple language editions of Wikipedia—and jump straight to the exact passage to inspect or edit it.

---

## 1. The Challenge & What Consensus Does

### The Problem
Wikipedia articles on the same topic are written independently by different language communities. As a result, critical articles frequently drift out of sync:
- **Conflicting facts & statistics:** Different language editions report different dates, casualty figures, populations, or historical attributions.
- **Citation gaps & uneven sourcing:** One edition may cite dozens of peer-reviewed sources while another relies on a handful of references or carries unresolved `[citation needed]` tags.
- **Stale or outdated data:** Updates made in one language often fail to propagate to others.
- **Non-neutral (POV) framing:** Certain editions introduce emotionally loaded phrasing or carry neutrality dispute templates (`{{POV}}`, `{{НТЗ}}`, etc.).
- **High-traffic misinformation risk:** When these issues appear on heavily visited pages, inaccurate or unsourced claims reach far more readers.

### How Consensus Solves It
Consensus connects matching articles across Wikipedia editions via **Wikidata Q-IDs** and surfaces cross-lingual issues in a persistent browser Side Panel:
1. **Top Risk Dashboard:** Fetches high-traffic Wikipedia articles from the Wikimedia Pageviews REST API, scans them across selected languages, and ranks them by **misinformation spread risk** (daily traffic × issue count × severity).
2. **Multi-Language Topic Search:** Searches Wikidata and selected Wikipedias in parallel, compares claims side-by-side, and highlights per-language reference counts.
3. **5-Category Discrepancy Detection:**
   - **Different information** — Diverging dates, numbers, and factual claims across editions.
   - **Much fewer references** — Severe `<ref>` count imbalance compared to other language editions.
   - **Missing reference** — Localized `[citation needed]` tags (`{{Lähde}}`, `{{Källa behövs}}`, `{{Нет АИ}}`, `{{Citation needed}}`, etc.).
   - **Not neutral (emotional tone)** — NPOV dispute templates and loaded/subjective wording.
   - **Outdated information** — Stale edition timestamps or lagging year references.
4. **In-Page DOM Highlighting & Click-to-Edit:** Clicking any flagged language or **Find in Wikipedia** opens the article tab, scrolls to the disputed passage, highlights it in red (`#fee7e6` / `#d33`) with an inline note, and lets editors click the highlighted passage to jump directly to the Wikipedia section editor (`?action=edit`).
5. **Inline Phrase Translation & Saved Queue:** Translates flagged non-English snippets into English inside the Side Panel and lets editors bookmark articles to a persistent **Saved** queue to fix later.
6. **Optional AI Quick Summary (Side Feature):** When connected to the backend, an optional Gemini summary runs in the background to give a 1–2 sentence overview grounded strictly in the already-detected issue boxes without altering issue cards or collapsing expanded items. It can be hidden or shown anytime (inline or via Settings) while still running in the background, and displays a note reminding readers that quick AI summaries may contain mistakes.

---

## 2. Multi-Language Support

Consensus supports cross-lingual scanning across **17 selectable Wikipedia editions** in the extension's **Settings** menu, plus dynamic discovery of additional major editions:

| Code | Language | Code | Language | Code | Language |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `de` | German | `hu` | Hungarian | `pt` | Portuguese |
| `en` | English | `it` | Italian | `ru` | Russian |
| `es` | Spanish | `ja` | Japanese | `sv` | Swedish |
| `et` | Estonian | `no` | Norwegian | `tr` | Turkish |
| `fi` | Finnish | `pl` | Polish | `uk` | Ukrainian |
| `fr` | French | `zh` | Chinese | — | — |

- **Dynamic Top-5 Longest Editions:** When enabled in Settings (*"Also include 5 longest Wikipedia editions per article"*), Consensus automatically probes article lengths across additional Wikipedia editions per Wikidata Q-ID and includes the 5 longest editions alongside your selected languages.
- **Offline Fallback Dataset:** Includes a built-in fallback dataset covering 9 editions (`FI`, `SV`, `RU`, `EN`, `ET`, `ES`, `ZH`, `PL`, `HU`) so the UI and page highlighting continue to work even without internet or backend connectivity.
- **Companion Backend (`backend/`):** Supports optional multi-language quick summaries (`POST /api/analyze/semantic`, up to 5 editions per request), alongside server-side discrepancy analysis, academic citation verification, and localized `<ref>` formatting centered on the trilingual core (`FI`, `SV`, `RU`, plus `EN` citation templates).

---

## 3. Tech Stack

- **Browser Extension (`extension/`):**
  - **Manifest V3** (Chrome, Edge, Brave, and Chromium-based browsers)
  - **Vanilla JavaScript (ES Modules)** — zero frontend build step required
  - **Chrome APIs:** `sidePanel`, `activeTab`, `tabs`, `scripting`
  - **Wikimedia & Wikidata CORS APIs:** MediaWiki Action API, Wikidata `wbgetentities` / `wbsearchentities`, Wikimedia Pageviews REST API
  - **Client UI:** Wikipedia Vector-2022–inspired CSS, `localStorage` persistence for language preferences, dashboard cache, and saved bookmarks
- **Backend API (`backend/` — optional):**
  - **Node.js 22+ & TypeScript** (`tsx` for dev watch mode, `tsc` for builds)
  - **Express** REST API with CORS support for `chrome-extension://`, `moz-extension://`, and `*.wikipedia.org`
  - **Gemini AI (`@google/genai`, optional side feature):** Generates quick cross-lingual summaries (`gemini-3.8-flash` default in code, configurable via `GEMINI_MODEL`) grounded in detected issue boxes, while all core issue boxes run deterministically in the browser/heuristic scanner
  - **Academic & Archival Verification:** Crossref, OpenAlex, Semantic Scholar, Google Books, SSRF-safe link health checker, and Internet Archive Wayback Machine recovery
  - **Rate Limiting:** Custom token-bucket rate limiters and retry/backoff per external host
- **Database (`db/` — optional):**
  - **MariaDB 11.4+** (`InnoDB`, `utf8mb4_unicode_ci`) via `mysql2`
  - Composite ranking indexes, `FULLTEXT` multilingual search, and SHA-256 keyed TTL response caches
- **Cloud Deployment & Containerization:** Docker & Docker Compose (`docker-compose.yml`), plus GitHub Actions CI/CD (`.github/workflows/backend-pipeline.yml`) pushing container images to GHCR and deploying to Azure App Service (`DEFAULT_API_BASE_URL` in `extension/src/shared/constants.js` defaults to the hosted Azure backend)

---

## 4. System Architecture

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│                   MANIFEST V3 BROWSER EXTENSION (extension/)                  │
│                                                                               │
│  ┌──────────────────────────────┐      ┌───────────────────────────────────┐  │
│  │ Side Panel (sidepanel.html)  │◄────►│ Background Service Worker (MV3)   │  │
│  │ - Top Risk Dashboard         │      │ - Opens Side Panel on icon click  │  │
│  │ - 17-Lang Settings + Top 5   │      │ - Tab navigation & load wait      │  │
│  │ - Claim Matrix & EN Glosses  │      └─────────────────┬─────────────────┘  │
│  │ - Saved Bookmarks Queue      │                        │                    │
│  │ - Direct Browser CORS Scanner│                        ▼                    │
│  └──────────────┬───────────────┘      ┌───────────────────────────────────┐  │
│                 │                      │ Wikipedia Content Script          │  │
│                 │ Direct Wikimedia /   │ - 3-Tier DOM Text Matcher         │  │
│                 │ Wikidata APIs OR     │ - Red (#fee7e6 / #d33) Highlight  │  │
│                 │ Optional REST JSON   │ - Inline Note & Click-to-Edit     │  │
└─────────────────┼──────────────────────┴───────────────────────────────────┘  ┘
                  │  (Optional: Cloud Azure Backend or http://localhost:4000/api)
                  ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                 EXPRESS + TYPESCRIPT BACKEND API (backend/)                   │
│                                                                               │
│  - Token-Bucket Rate Limiters & Retry/Backoff per External Host               │
│  - MediaWiki Action API + Wikidata Q-ID Batch Linker                          │
│  - Wikitext <ref> Density, Infobox & Citation-Needed Tag Parser               │
│  - Optional AI Quick Summary (@google/genai) + Heuristic Comparator           │
│  - Academic Verifier (Crossref · OpenAlex · Semantic Scholar · Google Books)  │
│  - SSRF-Safe Link Health Checker + Wayback Machine Recovery                   │
└─────────────────┬─────────────────────────────────────────────────────────────┘
                  ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│             MARIADB 11.4+ (InnoDB · utf8mb4_unicode_ci) (db/)                 │
│                                                                               │
│  - articles (Composite Ranking Indexes + FULLTEXT Multilingual Index)         │
│  - article_editions_content (Extracts, Infobox JSON, <ref> Inventory)         │
│  - discrepancies (Mismatch Types, Snippets, Language Agreement Matrix JSON)   │
│  - verified_sources (DOI/ISBN, Confidence Score, Localized <ref> Templates)   │
│  - topic_search_cache & external_api_cache (SHA-256 Keyed TTL Cache)          │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. How to Run Consensus

You can run **Consensus** in seconds as a standalone browser extension, or run the full stack with the backend API and MariaDB.

### Option A — Extension Only (Fastest, No Local Server or Docker Required)

The extension includes a direct browser scanner (`extension/src/shared/liveBrowserScanner.js`) that queries Wikipedia, Wikidata, and Wikimedia Pageviews directly over HTTPS—so search, dashboard ranking, and all issue boxes work even if the backend is offline (with `demoFallback.js` as a final offline backup). By default, `DEFAULT_API_BASE_URL` in [`extension/src/shared/constants.js`](extension/src/shared/constants.js) points to the hosted Azure backend for the optional AI quick summary.

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd junction
   ```
2. Open **Chrome**, **Edge**, or **Brave** and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `extension/` directory in this repository.
5. Click the **Consensus** icon in the browser toolbar to open the **Side Panel**.
6. Click the gear icon inside the search bar to select any combination of the **17 supported languages**, toggle **Also include 5 longest Wikipedia editions per article**, or toggle **Show AI semantic summary** (when hidden, summaries still run silently in the background).

---

### Option B — Full Stack with Docker Compose (macOS / Linux / Windows)

Run MariaDB 11.4 and the Express/TypeScript backend in containers alongside the browser extension.

**Prerequisites:**
- [Docker](https://docs.docker.com/get-docker/) with Docker Compose (`docker compose`)
- A Chromium-based browser (Chrome, Edge, or Brave)

**Steps:**
1. *(Optional)* Set `GEMINI_API_KEY` (and optional `GOOGLE_BOOKS_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY`) in your shell or a `.env` file at the repo root to enable live Gemini semantic comparison. If omitted, the backend automatically uses its deterministic heuristic analyzer.
2. Start MariaDB and the backend API from the repository root:
   ```bash
   docker compose up --build
   ```
   - **MariaDB** initializes [`db/schema.sql`](db/schema.sql) and seeds reference data from [`db/seed.sql`](db/seed.sql) on port `3306`.
   - **Backend API** listens on `http://localhost:4000` (verify with `http://localhost:4000/api/health`).
3. If you want the extension to talk to your local backend instead of the hosted Azure backend, set `DEFAULT_API_BASE_URL` in [`extension/src/shared/constants.js`](extension/src/shared/constants.js) to `'http://localhost:4000/api'`, then load/reload the `extension/` folder via `chrome://extensions` as described in **Option A**.

---

### Option C — Local Backend Development Without Docker (macOS / Linux / Windows)

Recommended for open-source contributors developing on the backend or database schema.

**Prerequisites:**
- **Node.js 22+** and `npm`
- **MariaDB 11.4+** running locally (with `utf8mb4` / `utf8mb4_unicode_ci`)

**1. Initialize MariaDB:**
Run [`db/schema.sql`](db/schema.sql) and [`db/seed.sql`](db/seed.sql) against your local MariaDB instance, and ensure a database user matching your `.env` credentials exists (e.g., user `wikibridge` / database `wikibridge` with privileges granted).

**2. Configure environment variables:**

- **macOS / Linux:**
  ```bash
  cd backend
  cp .env.example .env
  ```
- **Windows (PowerShell):**
  ```powershell
  cd backend
  Copy-Item .env.example .env
  ```

Edit `backend/.env` with your MariaDB credentials and optional `GEMINI_API_KEY` / `GEMINI_MODEL` (plus optional `ACADEMIC_CONTACT_EMAIL`, `GOOGLE_BOOKS_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY`, and `WIKIMEDIA_USER_AGENT`).

**3. Install dependencies and start the dev server:**
```bash
npm install
npm run dev
```

Useful developer scripts in `backend/`:
- `npm run dev` — Starts the backend in watch mode (`tsx watch src/index.ts`) on `http://localhost:4000`
- `npm run typecheck` — Runs TypeScript type checking (`tsc --noEmit`)
- `npm run build` — Compiles TypeScript to `backend/dist/`
- `npm start` — Runs the compiled production server (`node dist/index.js`)

**4. Load the extension:**
Follow **Option A** to load `extension/` into your browser. When you edit files inside `extension/`, click the **Reload** icon for Consensus on `chrome://extensions` to apply changes.

---

## 6. Project Structure

```text
.
├── extension/                  # Manifest V3 browser extension (no build step)
│   ├── manifest.json           # MV3 config, permissions, side panel & content script registration
│   ├── sidepanel.html          # Side Panel UI markup
│   ├── icons/                  # Extension icons (16, 48, 128 px)
│   └── src/
│       ├── background/         # serviceWorker.js (tab navigation & highlight messaging)
│       ├── content/            # contentScript.js & contentStyles.css (DOM matching & highlight)
│       ├── shared/             # constants.js (17 langs), liveBrowserScanner.js, translator.js, demoFallback.js
│       └── sidepanel/          # app.js & styles.css (dashboard, search, bookmarks, settings)
├── backend/                    # Optional Node.js + Express + TypeScript API
│   ├── Dockerfile
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── routes/api.ts       # /api/health, /api/search, /api/articles/:qid/analyze, /api/analyze/semantic, /api/verify-claim, /api/citations/format
│       ├── services/           # MediaWiki, Gemini/heuristic comparator, academic verifier, link checker, citation formatter
│       ├── db/                 # mysql2 connection pool & repository queries
│       └── utils/              # Token-bucket rate limiters & retry helpers
├── db/
│   ├── schema.sql              # MariaDB 11.4 schema (InnoDB, utf8mb4_unicode_ci)
│   └── seed.sql                # Reference cross-lingual seed data
└── docker-compose.yml          # MariaDB + Backend API container orchestration
```

---

## 7. Backend API & Scoring Reference

### REST Endpoints (`http://localhost:4000/api` or hosted Azure URL)
- `GET /api/health` — Database connection status and active LLM/model configuration
- `GET /api/search?q=<topic>&filter=all|hard_fact|missing_citation|outdated_data` — Cross-lingual topic search and ranked article summary
- `GET /api/articles/:qid/analyze` — Detailed discrepancy report for a Wikidata Q-ID (e.g. `Q104318`)
- `POST /api/analyze/semantic` — Optional quick AI summary across selected Wikipedia editions, grounded in supplied `detectedIssues`
- `POST /api/verify-claim` — Crossref, OpenAlex, Semantic Scholar, and Google Books verification for a claim
- `POST /api/citations/format` — Generates localized Wikipedia `<ref>` templates (`fi`, `sv`, `ru`, `en`)

### Dashboard Spread Risk Scoring
In the extension's **Top Risk Dashboard**, high-traffic articles are scored by combining log-scaled daily pageviews with detected issue count and maximum discrepancy severity:

$$\text{SpreadRisk} = \operatorname{round}\!\left(\log_{10}(\max(10, \text{dailyViews})) \cdot \left(1.15 \cdot \text{issueCount} + 1.35 \cdot \frac{\text{severity}}{100}\right) \cdot 10\right)$$

import {
  DEFAULT_API_BASE_URL,
  getLangDisplayName,
  LANG_FLAG_SVGS,
  SUPPORTED_LANGS,
} from '../shared/constants.js';
import { OFFLINE_ANALYSES, OFFLINE_ARTICLES } from '../shared/demoFallback.js';
import {
  computeSpreadRiskScore,
  fetchHighTrafficRiskDashboard,
  getCachedBrowserAnalysis,
  getCachedEditionPayloads,
  searchLiveFromBrowser,
} from '../shared/liveBrowserScanner.js';
import {
  lookupOfflineTermTranslation,
  translateToEnglish,
} from '../shared/translator.js';

const STORAGE_LANGS_KEY = 'wikibridge_selected_langs';
const STORAGE_TOP5_KEY = 'wikibridge_include_top5';
const STORAGE_SHOW_AI_SUMMARY_KEY = 'consensus_show_ai_summary_v1';
const STORAGE_SAVED_QUEUE_KEY = 'consensus_saved_queue_v1';
const STORAGE_DASHBOARD_CACHE_KEY = 'consensus_dashboard_cache_v1';
const DASHBOARD_CACHE_TTL_MS = 30 * 60 * 1000;

function loadBooleanPref(key, fallback = true) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
  } catch {
    // Ignore storage errors
  }
  return fallback;
}

function loadSelectedLangs() {
  try {
    const raw = localStorage.getItem(STORAGE_LANGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((l) => SUPPORTED_LANGS.includes(l));
      }
    }
  } catch {
    // Ignore storage errors
  }
  return [...SUPPORTED_LANGS];
}

function loadSavedQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_SAVED_QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    // Ignore storage errors
  }
  return {};
}

function persistSavedQueue(queue) {
  try {
    localStorage.setItem(STORAGE_SAVED_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Ignore storage quota errors
  }
}

function createBookmarkIconSvg(filled, size = 16) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z');
  svg.appendChild(path);
  return svg;
}

function loadDashboardCache() {
  try {
    const raw = localStorage.getItem(STORAGE_DASHBOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.articles) && Date.now() - parsed.ts < DASHBOARD_CACHE_TTL_MS) {
      return parsed;
    }
  } catch {
    // Ignore
  }
  return null;
}

function persistDashboardCache(articles, analysesMap) {
  try {
    localStorage.setItem(
      STORAGE_DASHBOARD_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), articles, analyses: analysesMap })
    );
  } catch {
    // Ignore
  }
}

// Instant client-side caches so repeat queries and clicking articles take 0ms
const clientSearchCache = new Map();
const clientAnalysisCache = new Map();
const semanticAnalysisCache = new Map();

let backendDownUntil = 0;
let activeSearchToken = 0;

const state = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  currentQuery: '',
  activeTab: 'dashboard', // 'dashboard' | 'saved' | 'search'
  selectedLangs: loadSelectedLangs(),
  includeTopLongest: loadBooleanPref(STORAGE_TOP5_KEY, true),
  showAiSummary: loadBooleanPref(STORAGE_SHOW_AI_SUMMARY_KEY, true),
  savedQueue: loadSavedQueue(),
  articles: [],
  selectedArticle: null,
  selectedAnalysis: null,
  llmEnabled: false,
  geminiModel: '',
  semanticLoadingQid: null,
  semanticError: null,
};

const els = {
  searchForm: document.getElementById('search-form'),
  inputTopicQuery: document.getElementById('input-topic-query'),
  tabSaved: document.getElementById('tab-saved'),
  savedCount: document.getElementById('saved-count'),
  btnRefreshDashboard: document.getElementById('btn-refresh-dashboard'),
  btnSettings: document.getElementById('btn-settings'),
  settingsDropdown: document.getElementById('settings-dropdown'),
  settingsLangGrid: document.getElementById('settings-lang-grid'),
  btnLangAll: document.getElementById('btn-lang-all'),
  btnLangNone: document.getElementById('btn-lang-none'),
  chkDynamicTop5: document.getElementById('chk-dynamic-top5'),
  chkShowAiSummary: document.getElementById('chk-show-ai-summary'),
  feedbackBanner: document.getElementById('feedback-banner'),
  viewList: document.getElementById('view-article-list'),
  viewDetail: document.getElementById('view-article-detail'),
  listHeading: document.getElementById('list-heading'),
  loadingList: document.getElementById('loading-list'),
  articlesContainer: document.getElementById('articles-container'),
  btnBackToList: document.getElementById('btn-back-to-list'),
  loadingDetail: document.getElementById('loading-detail'),
  detailContainer: document.getElementById('detail-container'),
};

function saveAndApplyLanguageSelection() {
  try {
    localStorage.setItem(STORAGE_LANGS_KEY, JSON.stringify(state.selectedLangs));
  } catch {
    // Ignore
  }
  clientSearchCache.clear();
  clientAnalysisCache.clear();
  if (state.currentQuery) runSearch();
}

function renderSettingsControls() {
  els.settingsLangGrid.innerHTML = '';
  for (const lang of SUPPORTED_LANGS) {
    const label = document.createElement('label');
    label.className = 'wb-lang-option';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selectedLangs.includes(lang);
    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (!state.selectedLangs.includes(lang)) {
          state.selectedLangs = SUPPORTED_LANGS.filter(
            (l) => l === lang || state.selectedLangs.includes(l)
          );
        }
      } else {
        state.selectedLangs = state.selectedLangs.filter((l) => l !== lang);
      }
      saveAndApplyLanguageSelection();
    });

    const text = document.createElement('span');
    text.textContent = lang.toUpperCase();
    label.title = getLangDisplayName(lang);

    label.appendChild(cb);
    label.appendChild(text);

    const flagSvg = LANG_FLAG_SVGS[lang];
    if (flagSvg) {
      const flagWrap = document.createElement('span');
      flagWrap.className = 'wb-flag-wrap';
      flagWrap.innerHTML = flagSvg;
      label.appendChild(flagWrap);
    }
    els.settingsLangGrid.appendChild(label);
  }

  els.chkDynamicTop5.checked = state.includeTopLongest;
  if (els.chkShowAiSummary) {
    els.chkShowAiSummary.checked = state.showAiSummary;
  }
}

function setShowAiSummary(visible) {
  state.showAiSummary = Boolean(visible);
  try {
    localStorage.setItem(STORAGE_SHOW_AI_SUMMARY_KEY, String(state.showAiSummary));
  } catch {
    // Ignore storage errors
  }
  if (els.chkShowAiSummary) {
    els.chkShowAiSummary.checked = state.showAiSummary;
  }
  if (!els.viewDetail.classList.contains('hidden') && state.selectedAnalysis) {
    refreshDetailSemanticUi(
      state.selectedAnalysis.article || state.selectedArticle,
      state.selectedAnalysis
    );
  }
}

els.btnLangAll.addEventListener('click', () => {
  state.selectedLangs = [...SUPPORTED_LANGS];
  renderSettingsControls();
  saveAndApplyLanguageSelection();
});

els.btnLangNone.addEventListener('click', () => {
  state.selectedLangs = [];
  renderSettingsControls();
  saveAndApplyLanguageSelection();
});

els.chkDynamicTop5.addEventListener('change', () => {
  state.includeTopLongest = els.chkDynamicTop5.checked;
  try {
    localStorage.setItem(STORAGE_TOP5_KEY, String(state.includeTopLongest));
  } catch {
    // Ignore
  }
  clientSearchCache.clear();
  clientAnalysisCache.clear();
  if (state.currentQuery) runSearch();
});

if (els.chkShowAiSummary) {
  els.chkShowAiSummary.addEventListener('change', () => {
    setShowAiSummary(els.chkShowAiSummary.checked);
  });
}

els.btnSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  const isHidden = els.settingsDropdown.classList.contains('hidden');
  els.settingsDropdown.classList.toggle('hidden', !isHidden);
  els.btnSettings.setAttribute('aria-expanded', String(isHidden));
});

document.addEventListener('click', (e) => {
  if (
    !els.settingsDropdown.classList.contains('hidden') &&
    !els.settingsDropdown.contains(e.target) &&
    !els.btnSettings.contains(e.target)
  ) {
    els.settingsDropdown.classList.add('hidden');
    els.btnSettings.setAttribute('aria-expanded', 'false');
  }
});

renderSettingsControls();

// Non-blocking startup probe so we know if the backend + Gemini are online
async function probeBackendHealth(timeoutMs = 900) {
  try {
    const res = await fetch(`${state.apiBaseUrl}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok || res.status === 503) {
      const data = await res.json().catch(() => ({}));
      state.llmEnabled = Boolean(data?.llmEnabled);
      state.geminiModel = typeof data?.geminiModel === 'string' ? data.geminiModel : '';
      backendDownUntil = 0;
      return true;
    }
  } catch {
    backendDownUntil = Date.now() + 25000;
  }
  state.llmEnabled = false;
  return false;
}

void probeBackendHealth(900);

function showError(message) {
  els.feedbackBanner.textContent = message;
  els.feedbackBanner.classList.remove('hidden');
  setTimeout(() => {
    els.feedbackBanner.classList.add('hidden');
  }, 3500);
}

function getOfflineArticles(query) {
  const q = query.trim().toLowerCase();
  if (!q) return OFFLINE_ARTICLES;
  return OFFLINE_ARTICLES.filter(
    (a) =>
      a.canonicalLabel.toLowerCase().includes(q) ||
      (a.topicKeywords && a.topicKeywords.toLowerCase().includes(q))
  );
}

function normalizeIssueBadge(badge) {
  return String(badge || '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

function deriveIssueBadges(art) {
  if (Array.isArray(art.issueBadges) && art.issueBadges.length > 0) {
    const normalized = art.issueBadges.map(normalizeIssueBadge).filter(Boolean);
    if (normalized.length > 0) return [...new Set(normalized)];
  }

  const badges = [];
  if (art.mismatchFlags?.hardFact) {
    badges.push('Different information');
  }
  if (art.mismatchFlags?.neutralityBias) {
    badges.push('Not neutral');
  }

  const available = SUPPORTED_LANGS
    .filter((l) => Boolean(art.editions?.[l]?.title))
    .map((l) => ({ code: l.toUpperCase(), refs: Number(art.editions?.[l]?.refCount ?? 0) }));

  if (available.length >= 2) {
    const sorted = [...available].sort((a, b) => a.refs - b.refs);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    if (high.refs >= 6 && (high.refs >= low.refs * 2.5 || high.refs - low.refs >= 12)) {
      badges.push('Much fewer references');
    } else if (art.mismatchFlags?.missingCitation) {
      badges.push('Missing reference');
    }
  } else if (art.mismatchFlags?.missingCitation) {
    badges.push('Missing reference');
  }

  if (art.mismatchFlags?.outdatedData) {
    badges.push('Outdated information');
  }

  return badges.length > 0 ? [...new Set(badges)] : ['Different information'];
}

function classifyBadgeStyle(label) {
  const lower = (label || '').toLowerCase();
  if (lower.includes('neutral') || lower.includes('emotional') || lower.includes('pov')) {
    return 'pov';
  }
  if (lower.includes('fewer reference') || lower.includes('missing reference') || lower.includes('citation')) {
    return 'refs';
  }
  if (lower.includes('outdated')) {
    return 'outdated';
  }
  return 'conflict';
}

function resolveIssueLabel(disc) {
  if (disc.issueLabel) return disc.issueLabel;
  if (disc.mismatchType === 'neutrality_bias') return 'Not neutral (emotional tone)';
  if (disc.mismatchType === 'outdated_data') return 'Outdated information';
  if (disc.mismatchType === 'missing_citation') {
    const text = `${disc.claimTopic || ''} ${disc.summary || ''}`.toLowerCase();
    return text.includes('fewer') || text.includes('only ')
      ? 'Much fewer references'
      : 'Missing reference';
  }
  return 'Different information';
}

function isArticleSaved(qid) {
  return Boolean(qid && state.savedQueue[qid]);
}

function updateSavedUiCounts() {
  const count = Object.keys(state.savedQueue).length;
  if (els.savedCount) els.savedCount.textContent = String(count);
}

function updateNavTabsUI() {
  const isSaved = state.activeTab === 'saved';
  if (els.tabSaved) {
    els.tabSaved.classList.toggle('is-active', isSaved);
    els.tabSaved.title = isSaved ? 'Back to dashboard' : 'Saved articles';
    els.tabSaved.setAttribute('aria-label', isSaved ? 'Back to dashboard' : 'Saved articles');
  }
  if (els.btnRefreshDashboard) {
    els.btnRefreshDashboard.classList.toggle('hidden', state.activeTab !== 'dashboard');
    els.btnRefreshDashboard.title = 'Refresh live pageview risk ranking';
  }
}

function toggleSaveArticle(article, analysis = null) {
  if (!article?.qid) return false;
  if (state.savedQueue[article.qid]) {
    delete state.savedQueue[article.qid];
    persistSavedQueue(state.savedQueue);
    updateSavedUiCounts();
    return false;
  }

  const resolvedAnalysis =
    analysis ||
    clientAnalysisCache.get(article.qid) ||
    getCachedBrowserAnalysis(article.qid) ||
    (OFFLINE_ANALYSES[article.qid]
      ? {
          article,
          overallSummary: OFFLINE_ANALYSES[article.qid].overallSummary,
          discrepancies: OFFLINE_ANALYSES[article.qid].discrepancies,
        }
      : null);

  state.savedQueue[article.qid] = {
    article,
    analysis: resolvedAnalysis,
    resolvedKeys: [],
    savedAt: Date.now(),
  };
  persistSavedQueue(state.savedQueue);
  updateSavedUiCounts();
  return true;
}

function formatViewsCount(views) {
  const n = Number(views || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M/day`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K/day`;
  if (n > 0) return `${n}/day`;
  return '';
}

function getOfflineDashboardArticles() {
  return OFFLINE_ARTICLES.map((art) => {
    const spreadRiskScore = computeSpreadRiskScore(
      art.dailyViews || 5000,
      art.discrepancyCount || 1,
      art.discrepancySeverity || 75
    );
    return { ...art, spreadRiskScore };
  }).sort((a, b) => (b.spreadRiskScore || 0) - (a.spreadRiskScore || 0));
}

async function loadDashboard(forceRefresh = false) {
  const token = ++activeSearchToken;
  state.activeTab = 'dashboard';
  state.currentQuery = '';
  updateNavTabsUI();

  els.viewDetail.classList.add('hidden');
  els.viewList.classList.remove('hidden');

  const cached = !forceRefresh ? loadDashboardCache() : null;
  if (cached && cached.articles.length > 0) {
    if (cached.analyses) {
      for (const [qid, analysis] of Object.entries(cached.analyses)) {
        clientAnalysisCache.set(qid, analysis);
      }
    }
    state.articles = cached.articles;
    els.loadingList.classList.add('hidden');
    renderArticleList();
    return;
  }

  // Show immediate baseline high-traffic articles while live pageviews + issues scan
  if (!forceRefresh) {
    state.articles = getOfflineDashboardArticles();
    renderArticleList();
  } else {
    els.articlesContainer.innerHTML = '';
  }

  els.loadingList.classList.remove('hidden');

  try {
    const liveDashboard = await fetchHighTrafficRiskDashboard({
      selectedLangs: state.selectedLangs,
    });
    if (token !== activeSearchToken || state.activeTab !== 'dashboard') return;

    if (Array.isArray(liveDashboard) && liveDashboard.length > 0) {
      state.articles = liveDashboard;
      const analysesObj = {};
      for (const art of liveDashboard) {
        const a = getCachedBrowserAnalysis(art.qid);
        if (a) analysesObj[art.qid] = a;
      }
      persistDashboardCache(liveDashboard, analysesObj);
      renderArticleList();
    }
  } catch {
    // Keep offline/baseline dashboard if offline
  } finally {
    if (token === activeSearchToken) {
      els.loadingList.classList.add('hidden');
    }
  }
}

function showSavedView() {
  activeSearchToken++;
  state.activeTab = 'saved';
  updateNavTabsUI();
  els.viewDetail.classList.add('hidden');
  els.viewList.classList.remove('hidden');
  els.loadingList.classList.add('hidden');

  const entries = Object.values(state.savedQueue).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  state.articles = entries.map((e) => e.article);
  for (const e of entries) {
    if (e.analysis) clientAnalysisCache.set(e.article.qid, e.analysis);
  }
  renderArticleList();
}

async function runSearch() {
  const token = ++activeSearchToken;
  const q = state.currentQuery.trim();

  if (!q) {
    loadDashboard(false);
    return;
  }

  state.activeTab = 'search';
  updateNavTabsUI();

  const cacheKey = q.toLowerCase();
  els.viewDetail.classList.add('hidden');
  els.viewList.classList.remove('hidden');

  if (clientSearchCache.has(cacheKey)) {
    state.articles = clientSearchCache.get(cacheKey);
    els.loadingList.classList.add('hidden');
    renderArticleList();
    return;
  }

  if (state.selectedLangs.length === 0 && !state.includeTopLongest) {
    state.articles = [];
    els.loadingList.classList.add('hidden');
    showError('Select at least one language or enable the 5 longest editions in Settings.');
    renderArticleList();
    return;
  }

  els.loadingList.classList.remove('hidden');
  els.articlesContainer.innerHTML = '';

  let resolvedArticles = null;

  try {
    const liveArticles = await searchLiveFromBrowser(q, {
      selectedLangs: state.selectedLangs,
      includeTopLongest: state.includeTopLongest,
    });
    if (Array.isArray(liveArticles) && liveArticles.length > 0) {
      resolvedArticles = liveArticles;
    }
  } catch {
    // Fallback below if offline
  }

  if (!resolvedArticles) {
    resolvedArticles = getOfflineArticles(q);
  }

  if (token !== activeSearchToken) return;

  state.articles = resolvedArticles;
  clientSearchCache.set(cacheKey, resolvedArticles);

  els.loadingList.classList.add('hidden');
  renderArticleList();
}

function renderArticleList() {
  els.articlesContainer.innerHTML = '';

  if (state.activeTab === 'saved') {
    els.listHeading.textContent = `Saved to fix later (${state.articles.length})`;
  } else if (state.activeTab === 'search' && state.currentQuery) {
    els.listHeading.textContent = `Issues found for "${state.currentQuery}" (${state.articles.length})`;
  } else {
    els.listHeading.textContent = 'Top Risk Dashboard';
  }

  if (state.articles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'wb-empty';
    empty.textContent =
      state.activeTab === 'saved'
        ? 'No saved articles yet. Click "Save" on any article to keep track of errors to fix later.'
        : 'No articles with cross-lingual discrepancies found for this query.';
    els.articlesContainer.appendChild(empty);
    return;
  }

  for (const art of state.articles) {
    const cardWrap = document.createElement('div');
    cardWrap.className = 'wb-article-item';
    cardWrap.tabIndex = 0;
    cardWrap.setAttribute('role', 'button');

    const top = document.createElement('div');
    top.className = 'wb-article-top';

    const title = document.createElement('h2');
    title.className = 'wb-article-name';
    title.textContent = art.canonicalLabel;

    const pillsGroup = document.createElement('div');
    pillsGroup.className = 'wb-article-pills';

    const viewsText = formatViewsCount(art.dailyViews);
    if (viewsText) {
      const viewsPill = document.createElement('span');
      viewsPill.className = 'wb-views-pill';
      viewsPill.textContent = viewsText;
      viewsPill.title = 'Recent daily Wikipedia pageviews';
      pillsGroup.appendChild(viewsPill);
    }

    const totalCount = Number(art.discrepancyCount ?? 0);

    const pill = document.createElement('span');
    pill.className = `wb-mistake-pill${totalCount === 0 ? ' wb-mistake-pill--ok' : ''}`;
    pill.textContent =
      totalCount === 0
        ? 'No issues'
        : `${totalCount} ${totalCount === 1 ? 'issue' : 'issues'}`;
    pillsGroup.appendChild(pill);

    const saved = isArticleSaved(art.qid);
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = `wb-save-mini-btn${saved ? ' is-saved' : ''}`;
    saveBtn.replaceChildren(createBookmarkIconSvg(saved, 13));
    saveBtn.title = saved ? 'Remove from Saved' : 'Bookmark to Saved';
    saveBtn.setAttribute('aria-label', saved ? 'Remove from Saved' : 'Bookmark to Saved');
    saveBtn.setAttribute('aria-pressed', saved ? 'true' : 'false');
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSaveArticle(art);
      if (state.activeTab === 'saved') {
        showSavedView();
      } else {
        renderArticleList();
      }
    });
    pillsGroup.appendChild(saveBtn);

    top.appendChild(title);
    top.appendChild(pillsGroup);
    cardWrap.appendChild(top);

    const badges = deriveIssueBadges(art);
    if (badges.length > 0) {
      const tagsRow = document.createElement('div');
      tagsRow.className = 'wb-issue-tags';

      for (const badgeText of badges) {
        const kind = classifyBadgeStyle(badgeText);
        const tag = document.createElement('span');
        tag.className = `wb-issue-tag wb-issue-tag--${kind}`;
        tag.textContent = badgeText;
        tagsRow.appendChild(tag);
      }
      cardWrap.appendChild(tagsRow);
    }

    cardWrap.addEventListener('click', () => openArticleMistakes(art));
    cardWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openArticleMistakes(art);
      }
    });
    els.articlesContainer.appendChild(cardWrap);
  }
}

function buildEditionInputsForArticle(article) {
  const cachedPayloads = getCachedEditionPayloads(article.qid);
  if (Array.isArray(cachedPayloads) && cachedPayloads.length >= 2) {
    return cachedPayloads;
  }

  const out = [];
  for (const [lang, ed] of Object.entries(article.editions || {})) {
    if (!ed || !ed.title) continue;
    out.push({
      lang,
      langName: getLangDisplayName(lang),
      title: ed.title,
      url: ed.url || null,
      extract: '',
      refCount: ed.refCount ?? 0,
      lastRevAt: ed.lastRevAt || null,
    });
  }
  return out;
}

function applySemanticSummaryToAnalysis(baseAnalysis, article, semanticSummary) {
  const base = baseAnalysis || {
    article,
    discrepancies: [],
  };
  return {
    ...base,
    article: base.article || article,
    discrepancies: Array.isArray(base.discrepancies) ? base.discrepancies : [],
    overallSummary: semanticSummary?.overallSummary || base.overallSummary || '',
    analyzedWithLlm: true,
    model: semanticSummary?.model || state.geminiModel,
  };
}

async function runSemanticAnalysisForArticle(article, options = {}) {
  const { forceRefresh = false, manual = false } = options;
  if (!article?.qid) return;

  if (!forceRefresh && semanticAnalysisCache.has(article.qid)) {
    const cachedSummary = semanticAnalysisCache.get(article.qid);
    if (state.selectedArticle?.qid === article.qid) {
      const baseAnalysis =
        state.selectedAnalysis ||
        clientAnalysisCache.get(article.qid) ||
        getCachedBrowserAnalysis(article.qid) ||
        state.savedQueue[article.qid]?.analysis ||
        null;
      state.selectedAnalysis = applySemanticSummaryToAnalysis(
        baseAnalysis,
        article,
        cachedSummary
      );
      refreshDetailSemanticUi(
        state.selectedAnalysis.article || article,
        state.selectedAnalysis
      );
    }
    return;
  }

  if (state.semanticLoadingQid === article.qid) return;

  if (manual || !state.llmEnabled) {
    const reachable = await probeBackendHealth(1200);
    if (!reachable || !state.llmEnabled) {
      if (manual) {
        state.semanticError = reachable
          ? 'GEMINI_API_KEY is not configured on backend.'
          : 'Backend is offline.';
        if (state.selectedArticle?.qid === article.qid && state.selectedAnalysis) {
          refreshDetailSemanticUi(
            state.selectedAnalysis.article || article,
            state.selectedAnalysis
          );
        }
      }
      return;
    }
  }

  const editions = buildEditionInputsForArticle(article);
  if (editions.length < 2) {
    if (manual) {
      state.semanticError = 'Need at least 2 language editions for semantic comparison.';
      if (state.selectedArticle?.qid === article.qid && state.selectedAnalysis) {
        refreshDetailSemanticUi(
          state.selectedAnalysis.article || article,
          state.selectedAnalysis
        );
      }
    }
    return;
  }

  const baseForPrompt =
    (state.selectedArticle?.qid === article.qid && state.selectedAnalysis) ||
    clientAnalysisCache.get(article.qid) ||
    getCachedBrowserAnalysis(article.qid) ||
    state.savedQueue[article.qid]?.analysis ||
    null;

  const detectedIssues = (baseForPrompt?.discrepancies || []).slice(0, 10).map((d) => ({
    targetLang: d.targetLang || '',
    issueLabel: resolveIssueLabel(d),
    claimTopic: d.claimTopic || '',
    summary: d.summary || '',
    disputedSnippet: d.disputedSnippet || '',
  }));

  state.semanticLoadingQid = article.qid;
  state.semanticError = null;
  if (state.selectedArticle?.qid === article.qid && state.selectedAnalysis) {
    refreshDetailSemanticUi(
      state.selectedAnalysis.article || article,
      state.selectedAnalysis
    );
  }

  try {
    const res = await fetch(`${state.apiBaseUrl}/analyze/semantic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qid: article.qid,
        canonicalLabel: article.canonicalLabel,
        editions,
        detectedIssues,
        forceRefresh,
      }),
      signal: AbortSignal.timeout(22000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.analyzedWithLlm) {
      if (manual) {
        state.semanticError =
          res.status === 404
            ? 'Semantic endpoint not found on backend (HTTP 404) — redeploy latest backend.'
            : data?.error || `Semantic analysis failed (HTTP ${res.status}).`;
      }
      return;
    }

    const semanticSummary = {
      overallSummary: data.overallSummary || '',
      analyzedWithLlm: true,
      model: data.model || state.geminiModel,
    };

    semanticAnalysisCache.set(article.qid, semanticSummary);

    const existingCached =
      clientAnalysisCache.get(article.qid) ||
      getCachedBrowserAnalysis(article.qid) ||
      state.savedQueue[article.qid]?.analysis ||
      null;

    if (existingCached) {
      clientAnalysisCache.set(
        article.qid,
        applySemanticSummaryToAnalysis(existingCached, article, semanticSummary)
      );
    }

    if (state.selectedArticle?.qid === article.qid) {
      const baseAnalysis = state.selectedAnalysis || existingCached;
      state.selectedAnalysis = applySemanticSummaryToAnalysis(
        baseAnalysis,
        article,
        semanticSummary
      );
    }
  } catch (err) {
    if (manual) {
      state.semanticError =
        err instanceof Error ? err.message : 'Could not reach semantic backend.';
    }
  } finally {
    if (state.semanticLoadingQid === article.qid) {
      state.semanticLoadingQid = null;
    }
    if (state.selectedArticle?.qid === article.qid && state.selectedAnalysis) {
      refreshDetailSemanticUi(
        state.selectedAnalysis.article || article,
        state.selectedAnalysis
      );
    }
  }
}

async function openArticleMistakes(article, options = {}) {
  state.selectedArticle = article;
  state.semanticError = null;
  els.viewList.classList.add('hidden');
  els.viewDetail.classList.remove('hidden');

  const savedEntry = state.savedQueue[article.qid];
  const baseCached =
    clientAnalysisCache.get(article.qid) ||
    getCachedBrowserAnalysis(article.qid) ||
    savedEntry?.analysis ||
    options.fallbackAnalysis ||
    null;
  const cachedSummary = semanticAnalysisCache.get(article.qid);
  const cached = baseCached
    ? cachedSummary
      ? applySemanticSummaryToAnalysis(baseCached, article, cachedSummary)
      : baseCached
    : null;

  if (cached) {
    state.selectedAnalysis = cached;
    els.loadingDetail.classList.add('hidden');
    renderArticleMistakes(options);
    if (!cached.analyzedWithLlm && state.llmEnabled) {
      void runSemanticAnalysisForArticle(article, { forceRefresh: false, manual: false });
    }
    return;
  }

  if (Date.now() < backendDownUntil && OFFLINE_ANALYSES[article.qid]) {
    const offline = {
      article,
      overallSummary: OFFLINE_ANALYSES[article.qid].overallSummary,
      discrepancies: OFFLINE_ANALYSES[article.qid].discrepancies,
    };
    clientAnalysisCache.set(article.qid, offline);
    state.selectedAnalysis = offline;
    els.loadingDetail.classList.add('hidden');
    renderArticleMistakes(options);
    return;
  }

  els.loadingDetail.classList.remove('hidden');
  els.detailContainer.innerHTML = '';

  try {
    const res = await fetch(
      `${state.apiBaseUrl}/articles/${encodeURIComponent(article.qid)}/analyze`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const analysis = await res.json();
    clientAnalysisCache.set(article.qid, analysis);
    state.selectedAnalysis = analysis;
  } catch {
    backendDownUntil = Date.now() + 25000;
    const fallback = OFFLINE_ANALYSES[article.qid] || { discrepancies: [] };
    state.selectedAnalysis = {
      article,
      discrepancies: fallback.discrepancies,
    };
  } finally {
    els.loadingDetail.classList.add('hidden');
    renderArticleMistakes(options);
    if (!state.selectedAnalysis?.analyzedWithLlm && state.llmEnabled) {
      void runSemanticAnalysisForArticle(article, { forceRefresh: false, manual: false });
    }
  }
}

async function findInWikipediaPage(targetUrl, discrepancy) {
  if (!targetUrl) {
    showError('No Wikipedia article URL available for this language.');
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'NAVIGATE_AND_HIGHLIGHT',
      targetUrl,
      discrepancy: {
        ...discrepancy,
        issueLabel: resolveIssueLabel(discrepancy),
      },
    });
    if (!response || !response.ok) {
      window.open(targetUrl, '_blank', 'noopener');
    }
  } catch {
    window.open(targetUrl, '_blank', 'noopener');
  }
}

function setIssueCardExpanded(card, expanded) {
  if (!card) return;
  card.classList.toggle('is-expanded', expanded);
  const toggleBtn = card.querySelector('.wb-mistake-toggle');
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggleBtn.title = expanded ? 'Click to minimize issue' : 'Click to expand issue';
  }
}

function jumpToIssueCard(card) {
  if (!card) return;
  setIssueCardExpanded(card, true);
  document
    .querySelectorAll('.wb-mistake-card--focused')
    .forEach((el) => el.classList.remove('wb-mistake-card--focused'));
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  requestAnimationFrame(() => {
    card.classList.add('wb-mistake-card--focused');
  });
  setTimeout(() => {
    card.classList.remove('wb-mistake-card--focused');
  }, 2200);
}

function handleLanguageClick(art, lang, discrepancies, cardByLang, preferredDisc = null) {
  const matchingDisc =
    (preferredDisc && preferredDisc.targetLang === lang ? preferredDisc : null) ||
    discrepancies.find((d) => d.targetLang === lang) ||
    null;

  if (matchingDisc) {
    const targetCard = cardByLang.get(lang);
    if (targetCard) jumpToIssueCard(targetCard);
  }

  const langUrl = art.editions?.[lang]?.url || '';
  if (langUrl) {
    findInWikipediaPage(langUrl, matchingDisc);
  } else {
    showError(`No Wikipedia article URL available for ${getLangDisplayName(lang)}.`);
  }
}

function getArticleLangKeys(art) {
  const keys = Object.keys(art.editions || {}).filter((l) => Boolean(art.editions?.[l]?.title));
  return keys.length > 0 ? keys : SUPPORTED_LANGS.filter((l) => Boolean(art.editions?.[l]?.title));
}

function renderReferenceStrip(art, discrepancies, cardByLang) {
  const wrapper = document.createElement('div');
  wrapper.className = 'wb-ref-card';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'wb-ref-toggle';
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.title = 'Click to expand references';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'wb-ref-title';
  titleSpan.textContent = 'References';

  const chevron = document.createElement('span');
  chevron.className = 'wb-ref-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '\u25b8';

  toggleBtn.appendChild(titleSpan);
  toggleBtn.appendChild(chevron);
  toggleBtn.addEventListener('click', () => {
    const expanded = !wrapper.classList.contains('is-expanded');
    wrapper.classList.toggle('is-expanded', expanded);
    toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggleBtn.title = expanded ? 'Click to minimize references' : 'Click to expand references';
  });
  wrapper.appendChild(toggleBtn);

  const body = document.createElement('div');
  body.className = 'wb-ref-body';

  const strip = document.createElement('div');
  strip.className = 'wb-ref-strip';

  const langs = getArticleLangKeys(art);
  const presentCounts = langs.map((l) => Number(art.editions?.[l]?.refCount ?? 0));
  const maxRefs = Math.max(0, ...presentCounts);

  for (const lang of langs) {
    const ed = art.editions?.[lang];
    const refs = Number(ed?.refCount ?? 0);
    const isLow =
      maxRefs >= 6 && (maxRefs >= refs * 2.5 || maxRefs - refs >= 12);
    const hasIssue = discrepancies.some((d) => d.targetLang === lang);
    const langDisplay = getLangDisplayName(lang);

    const box = document.createElement('button');
    box.type = 'button';
    box.className = `wb-ref-box wb-ref-box--clickable${isLow ? ' wb-ref-box--low' : ''}${
      hasIssue ? ' wb-ref-box--has-issue' : ''
    }`;
    box.title = hasIssue
      ? `Open ${langDisplay} Wikipedia & jump to issue`
      : `Open ${langDisplay} Wikipedia`;
    box.addEventListener('click', () =>
      handleLanguageClick(art, lang, discrepancies, cardByLang)
    );

    const langSpan = document.createElement('span');
    langSpan.className = 'wb-ref-box-lang';
    langSpan.textContent = `${langDisplay} (${lang.toUpperCase()})${ed?.isDynamicLongest ? ' · Top 5' : ''}`;

    const valSpan = document.createElement('span');
    valSpan.className = 'wb-ref-box-val';
    valSpan.textContent = isLow ? `${refs} refs (Low)` : `${refs} refs`;

    box.appendChild(langSpan);
    box.appendChild(valSpan);
    strip.appendChild(box);
  }

  body.appendChild(strip);
  wrapper.appendChild(body);
  return wrapper;
}

function createBookmarkDetailButton(art, analysis) {
  const saveDetailBtn = document.createElement('button');
  saveDetailBtn.type = 'button';
  const updateSaveBtnUI = () => {
    const saved = isArticleSaved(art.qid);
    saveDetailBtn.className = `wb-btn-bookmark${saved ? ' is-saved' : ''}`;
    saveDetailBtn.replaceChildren(createBookmarkIconSvg(saved));
    saveDetailBtn.title = saved ? 'Remove from Saved' : 'Bookmark to Saved';
    saveDetailBtn.setAttribute('aria-label', saved ? 'Remove from Saved' : 'Bookmark to Saved');
    saveDetailBtn.setAttribute('aria-pressed', saved ? 'true' : 'false');
  };
  updateSaveBtnUI();
  saveDetailBtn.addEventListener('click', () => {
    toggleSaveArticle(art, analysis);
    updateSaveBtnUI();
  });
  return saveDetailBtn;
}

function buildDetailActions(art, analysis) {
  const detailActions = document.createElement('div');
  detailActions.className = 'wb-detail-actions';

  if (!state.showAiSummary) {
    const showAiBtn = document.createElement('button');
    showAiBtn.type = 'button';
    showAiBtn.className = 'wb-link-btn';
    showAiBtn.textContent = 'Show AI summary';
    showAiBtn.setAttribute('aria-expanded', 'false');
    showAiBtn.addEventListener('click', () => {
      setShowAiSummary(true);
    });
    detailActions.appendChild(showAiBtn);
  }

  detailActions.appendChild(createBookmarkDetailButton(art, analysis));
  return detailActions;
}

function buildSemanticBar(art, analysis) {
  if (!state.showAiSummary) return null;

  const semanticBar = document.createElement('div');
  semanticBar.className = 'wb-semantic-bar';

  const isSemanticLoading = state.semanticLoadingQid === art.qid;
  const isLlmActive = Boolean(analysis.analyzedWithLlm);

  const semanticTop = document.createElement('div');
  semanticTop.className = 'wb-semantic-top';

  const semanticBadge = document.createElement('span');
  semanticBadge.className = `wb-semantic-badge${isLlmActive ? ' is-llm' : ''}`;
  if (isSemanticLoading) {
    semanticBadge.textContent = 'Analyzing semantically…';
  } else if (isLlmActive) {
    semanticBadge.textContent = `Gemini Semantic${analysis.model ? ` · ${analysis.model}` : ''}`;
  } else {
    semanticBadge.textContent = 'Heuristic scan';
  }
  semanticTop.appendChild(semanticBadge);

  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'wb-semantic-actions';

  const hideSummaryBtn = document.createElement('button');
  hideSummaryBtn.type = 'button';
  hideSummaryBtn.className = 'wb-link-btn';
  hideSummaryBtn.textContent = 'Hide summary';
  hideSummaryBtn.setAttribute('aria-expanded', 'true');
  hideSummaryBtn.addEventListener('click', () => {
    setShowAiSummary(false);
  });
  actionsWrap.appendChild(hideSummaryBtn);

  if (!isSemanticLoading) {
    const semanticBtn = document.createElement('button');
    semanticBtn.type = 'button';
    semanticBtn.className = 'wb-semantic-btn';
    semanticBtn.textContent = isLlmActive ? 'Re-run AI' : 'Run Semantic AI';
    semanticBtn.title = isLlmActive
      ? 'Re-run Gemini semantic cross-lingual analysis'
      : 'Compare editions semantically using Gemini backend';
    semanticBtn.addEventListener('click', () => {
      void runSemanticAnalysisForArticle(art, { forceRefresh: isLlmActive, manual: true });
    });
    actionsWrap.appendChild(semanticBtn);
  }

  semanticTop.appendChild(actionsWrap);
  semanticBar.appendChild(semanticTop);

  if (isLlmActive && analysis.overallSummary) {
    const summaryP = document.createElement('p');
    summaryP.className = 'wb-semantic-summary';
    summaryP.textContent = analysis.overallSummary;
    semanticBar.appendChild(summaryP);
  } else if (state.semanticError) {
    const errP = document.createElement('p');
    errP.className = 'wb-semantic-error';
    errP.textContent = state.semanticError;
    semanticBar.appendChild(errP);
  }

  return semanticBar;
}

function refreshDetailSemanticUi(art, analysis) {
  if (!art?.qid) return;
  const header = els.detailContainer.querySelector('.wb-detail-header');
  const slot = els.detailContainer.querySelector('.wb-semantic-slot');
  if (els.detailContainer.dataset.qid !== art.qid || !header || !slot) {
    renderArticleMistakes();
    return;
  }

  const oldActions = header.querySelector('.wb-detail-actions');
  const nextActions = buildDetailActions(art, analysis);
  if (oldActions) {
    oldActions.replaceWith(nextActions);
  } else {
    header.appendChild(nextActions);
  }

  const bar = buildSemanticBar(art, analysis);
  slot.replaceChildren(...(bar ? [bar] : []));
}

function renderArticleMistakes(options = {}) {
  const analysis = state.selectedAnalysis;
  if (!analysis) return;

  const art = analysis.article || state.selectedArticle;
  const discrepancies = analysis.discrepancies || [];

  const isSameArticle = els.detailContainer.dataset.qid === art.qid;
  const expandedIssueKeys = new Set();
  let refCardWasExpanded = false;
  if (isSameArticle) {
    for (const el of els.detailContainer.querySelectorAll('.wb-mistake-card.is-expanded')) {
      if (el.dataset.issueKey) expandedIssueKeys.add(el.dataset.issueKey);
    }
    refCardWasExpanded = Boolean(els.detailContainer.querySelector('.wb-ref-card.is-expanded'));
  }

  els.detailContainer.dataset.qid = art.qid;
  els.detailContainer.innerHTML = '';

  const cardByLang = new Map();

  const detailHeader = document.createElement('div');
  detailHeader.className = 'wb-detail-header';

  const heading = document.createElement('h2');
  heading.className = 'wb-detail-title';
  heading.textContent = art.canonicalLabel;

  detailHeader.appendChild(heading);
  detailHeader.appendChild(buildDetailActions(art, analysis));
  els.detailContainer.appendChild(detailHeader);

  const semanticSlot = document.createElement('div');
  semanticSlot.className = 'wb-semantic-slot';
  const initialBar = buildSemanticBar(art, analysis);
  if (initialBar) semanticSlot.appendChild(initialBar);
  els.detailContainer.appendChild(semanticSlot);

  const refCard = renderReferenceStrip(art, discrepancies, cardByLang);
  if (refCardWasExpanded) {
    refCard.classList.add('is-expanded');
    const refToggle = refCard.querySelector('.wb-ref-toggle');
    if (refToggle) refToggle.setAttribute('aria-expanded', 'true');
  }
  els.detailContainer.appendChild(refCard);

  if (discrepancies.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'wb-empty';
    empty.textContent = 'No specific issues detected across editions for this article.';
    els.detailContainer.appendChild(empty);
    return;
  }

  discrepancies.forEach((disc, idx) => {
    const issueLabel = resolveIssueLabel(disc);
    const styleKind = classifyBadgeStyle(issueLabel);
    const cardModifier =
      styleKind === 'refs'
        ? ' wb-mistake-card--refs'
        : styleKind === 'pov'
          ? ' wb-mistake-card--pov'
          : '';
    const badgeModifier =
      styleKind === 'refs'
        ? ' wb-issue-type-badge--refs'
        : styleKind === 'pov'
          ? ' wb-issue-type-badge--pov'
          : '';

    const card = document.createElement('div');
    card.className = `wb-mistake-card${cardModifier}`;
    card.dataset.targetLang = disc.targetLang;
    const issueKey = `${disc.targetLang || ''}:${disc.claimTopic || ''}:${idx}`;
    card.dataset.issueKey = issueKey;
    if (!cardByLang.has(disc.targetLang)) {
      cardByLang.set(disc.targetLang, card);
    }

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'wb-mistake-toggle';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.title = 'Click to expand issue';

    const claimTitle = document.createElement('span');
    claimTitle.className = 'wb-mistake-heading';
    claimTitle.textContent = disc.claimTopic;

    const chevron = document.createElement('span');
    chevron.className = 'wb-mistake-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '\u25b8';

    toggleBtn.appendChild(claimTitle);
    toggleBtn.appendChild(chevron);
    toggleBtn.addEventListener('click', () => {
      const nextExpanded = !card.classList.contains('is-expanded');
      setIssueCardExpanded(card, nextExpanded);
    });
    card.appendChild(toggleBtn);

    const body = document.createElement('div');
    body.className = 'wb-mistake-body';

    const header = document.createElement('div');
    header.className = 'wb-mistake-header';

    const typeBadge = document.createElement('span');
    typeBadge.className = `wb-issue-type-badge${badgeModifier}`;
    typeBadge.textContent = issueLabel;

    const langFull = getLangDisplayName(disc.targetLang);
    const langTarget = document.createElement('button');
    langTarget.type = 'button';
    langTarget.className = 'wb-issue-target-lang wb-issue-target-lang--link';
    langTarget.textContent = `in ${langFull} (${disc.targetLang.toUpperCase()}) Wikipedia`;
    langTarget.title = `Open ${langFull} Wikipedia`;
    langTarget.addEventListener('click', () =>
      handleLanguageClick(art, disc.targetLang, discrepancies, cardByLang, disc)
    );

    header.appendChild(typeBadge);
    header.appendChild(langTarget);
    body.appendChild(header);

    const desc = document.createElement('p');
    desc.className = 'wb-mistake-desc';
    desc.textContent = disc.summary;
    body.appendChild(desc);

    const claimsObj = disc.agreementMatrix?.claims;
    if (claimsObj) {
      const compareBox = document.createElement('div');
      compareBox.className = 'wb-claims-compare';

      for (const lang of Object.keys(claimsObj)) {
        const val = claimsObj[lang]?.value;
        if (!val || val === 'Edition missing' || val === 'Article missing') continue;

        const isFlagged = lang === disc.targetLang;
        const langHasIssue = discrepancies.some((d) => d.targetLang === lang);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `wb-claim-line wb-claim-line--clickable${
          isFlagged ? ' wb-claim-line--flagged' : ''
        }`;
        row.title = langHasIssue
          ? `Open ${getLangDisplayName(lang)} Wikipedia & jump to its issue`
          : `Open ${getLangDisplayName(lang)} Wikipedia`;
        row.addEventListener('click', () =>
          handleLanguageClick(art, lang, discrepancies, cardByLang, disc)
        );

        const code = document.createElement('span');
        code.className = `wb-claim-code${isFlagged ? ' target' : ''}`;
        code.textContent = lang.toUpperCase();

        const text = document.createElement('span');
        text.className = 'wb-claim-text';
        text.textContent = val;

        row.appendChild(code);
        row.appendChild(text);
        compareBox.appendChild(row);
      }
      body.appendChild(compareBox);
    }

    const highlightOrSnippet = disc.highlightPhrase || disc.disputedSnippet;
    if (highlightOrSnippet) {
      const quote = document.createElement('div');
      quote.className = 'wb-snippet-preview';

      const quoteLine = document.createElement('div');
      quoteLine.textContent = `Highlighted on page: "${highlightOrSnippet}"`;
      quote.appendChild(quoteLine);

      if (disc.targetLang && disc.targetLang !== 'en') {
        const transLine = document.createElement('div');
        transLine.className = 'wb-snippet-translation';
        if (disc.snippetEnglishTranslation) {
          transLine.textContent = `English translation: "${disc.snippetEnglishTranslation}"`;
          quote.appendChild(transLine);
        } else {
          const instant = lookupOfflineTermTranslation(highlightOrSnippet);
          transLine.textContent = instant
            ? `English translation: "${instant}"`
            : 'English translation: translating...';
          quote.appendChild(transLine);

          translateToEnglish(highlightOrSnippet, disc.targetLang).then((translated) => {
            if (!transLine.isConnected) return;
            if (translated) {
              transLine.textContent = `English translation: "${translated}"`;
            } else if (!instant) {
              transLine.remove();
            }
          });
        }
      }

      body.appendChild(quote);
    }

    const targetUrl = art.editions?.[disc.targetLang]?.url || '';
    const findBtn = document.createElement('button');
    findBtn.type = 'button';
    findBtn.className = 'wb-btn-find';
    findBtn.textContent = `Find in ${langFull} Wikipedia \u2192`;
    findBtn.addEventListener('click', () => findInWikipediaPage(targetUrl, disc));

    body.appendChild(findBtn);
    card.appendChild(body);
    els.detailContainer.appendChild(card);

    if (options.expandedIssueIdx === idx) {
      jumpToIssueCard(card);
    } else if (expandedIssueKeys.has(issueKey)) {
      setIssueCardExpanded(card, true);
    }
  });
}

els.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  state.currentQuery = els.inputTopicQuery.value.trim();
  runSearch();
});

els.tabSaved.addEventListener('click', () => {
  if (state.activeTab === 'saved') {
    els.inputTopicQuery.value = '';
    state.currentQuery = '';
    loadDashboard(false);
  } else {
    showSavedView();
  }
});

els.btnRefreshDashboard.addEventListener('click', () => {
  loadDashboard(true);
});

els.btnBackToList.addEventListener('click', () => {
  els.viewDetail.classList.add('hidden');
  els.viewList.classList.remove('hidden');
  if (state.activeTab === 'saved') {
    showSavedView();
  } else {
    renderArticleList();
  }
});

updateSavedUiCounts();
loadDashboard(false);

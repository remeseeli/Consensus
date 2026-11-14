import {
  DEFAULT_API_BASE_URL,
  getLangDisplayName,
  LANG_FLAG_SVGS,
  SUPPORTED_LANGS,
} from '../shared/constants.js';
import { OFFLINE_ANALYSES, OFFLINE_ARTICLES } from '../shared/demoFallback.js';
import {
  getCachedBrowserAnalysis,
  searchLiveFromBrowser,
} from '../shared/liveBrowserScanner.js';
import {
  lookupOfflineTermTranslation,
  translateToEnglish,
} from '../shared/translator.js';

const STORAGE_LANGS_KEY = 'wikibridge_selected_langs';
const STORAGE_TOP5_KEY = 'wikibridge_include_top5';

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

function loadIncludeTop5() {
  try {
    const raw = localStorage.getItem(STORAGE_TOP5_KEY);
    if (raw === 'false') return false;
  } catch {
    // Ignore
  }
  return true;
}

// Instant client-side caches so repeat queries and clicking articles take 0ms
const clientSearchCache = new Map();
const clientAnalysisCache = new Map();

let backendDownUntil = 0;
let activeSearchToken = 0;

const state = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  currentQuery: '',
  selectedLangs: loadSelectedLangs(),
  includeTopLongest: loadIncludeTop5(),
  articles: [],
  selectedArticle: null,
  selectedAnalysis: null,
};

const els = {
  searchForm: document.getElementById('search-form'),
  inputTopicQuery: document.getElementById('input-topic-query'),
  btnSettings: document.getElementById('btn-settings'),
  settingsDropdown: document.getElementById('settings-dropdown'),
  settingsLangGrid: document.getElementById('settings-lang-grid'),
  btnLangAll: document.getElementById('btn-lang-all'),
  btnLangNone: document.getElementById('btn-lang-none'),
  chkDynamicTop5: document.getElementById('chk-dynamic-top5'),
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

// Non-blocking startup probe so we never stall on dead localhost TCP timeouts
(async function probeBackendOnce() {
  try {
    await fetch(`${state.apiBaseUrl}/health`, {
      signal: AbortSignal.timeout(700),
    });
    backendDownUntil = 0;
  } catch {
    backendDownUntil = Date.now() + 25000;
  }
})();

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

function deriveIssueBadges(art) {
  if (Array.isArray(art.issueBadges) && art.issueBadges.length > 0) {
    return art.issueBadges;
  }

  const badges = [];
  if (art.mismatchFlags?.hardFact) {
    badges.push('Different information');
  }
  if (art.mismatchFlags?.neutralityBias) {
    badges.push('Not neutral (emotional tone)');
  }

  const available = SUPPORTED_LANGS
    .filter((l) => Boolean(art.editions?.[l]?.title))
    .map((l) => ({ code: l.toUpperCase(), refs: Number(art.editions?.[l]?.refCount ?? 0) }));

  if (available.length >= 2) {
    const sorted = [...available].sort((a, b) => a.refs - b.refs);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    if (high.refs >= 6 && (high.refs >= low.refs * 2.5 || high.refs - low.refs >= 12)) {
      badges.push(`Much fewer references (${low.code}: ${low.refs} vs ${high.code}: ${high.refs})`);
    } else if (art.mismatchFlags?.missingCitation) {
      badges.push('Missing reference');
    }
  } else if (art.mismatchFlags?.missingCitation) {
    badges.push('Missing reference');
  }

  if (art.mismatchFlags?.outdatedData) {
    badges.push('Outdated information');
  }

  return badges.length > 0 ? badges : ['Different information'];
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

async function runSearch() {
  const token = ++activeSearchToken;
  const q = state.currentQuery.trim();
  const cacheKey = q.toLowerCase();

  els.viewDetail.classList.add('hidden');
  els.viewList.classList.remove('hidden');

  if (clientSearchCache.has(cacheKey)) {
    state.articles = clientSearchCache.get(cacheKey);
    els.loadingList.classList.add('hidden');
    renderArticleList();
    return;
  }

  if (!q && Date.now() < backendDownUntil) {
    state.articles = OFFLINE_ARTICLES;
    els.loadingList.classList.add('hidden');
    renderArticleList();
    return;
  }

  if (q && state.selectedLangs.length === 0 && !state.includeTopLongest) {
    state.articles = [];
    els.loadingList.classList.add('hidden');
    showError('Select at least one language or enable the 5 longest editions in Settings.');
    renderArticleList();
    return;
  }

  els.loadingList.classList.remove('hidden');
  els.articlesContainer.innerHTML = '';

  let resolvedArticles = null;

  // For topic searches, run the fast live scanner with user-selected languages + dynamic top-5 longest editions.
  if (q) {
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
  } else if (Date.now() >= backendDownUntil) {
    try {
      const res = await fetch(`${state.apiBaseUrl}/search?q=`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      if (Array.isArray(payload.articles) && payload.articles.length > 0) {
        resolvedArticles = payload.articles;
      }
    } catch {
      backendDownUntil = Date.now() + 25000;
    }
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
  els.listHeading.textContent = state.currentQuery
    ? `Issues found for "${state.currentQuery}" (${state.articles.length})`
    : 'Articles with cross-lingual issues';

  if (state.articles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'wb-empty';
    empty.textContent = 'No articles with cross-lingual discrepancies found for this query.';
    els.articlesContainer.appendChild(empty);
    return;
  }

  for (const art of state.articles) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-article-item';

    const top = document.createElement('div');
    top.className = 'wb-article-top';

    const title = document.createElement('h2');
    title.className = 'wb-article-name';
    title.textContent = art.canonicalLabel;

    const count = Number(art.discrepancyCount ?? 0);
    const pill = document.createElement('span');
    pill.className = `wb-mistake-pill${count === 0 ? ' wb-mistake-pill--ok' : ''}`;
    pill.textContent =
      count === 0 ? 'No issues' : `${count} ${count === 1 ? 'issue' : 'issues'}`;

    top.appendChild(title);
    top.appendChild(pill);
    btn.appendChild(top);

    const badges = Array.isArray(art.issueBadges) ? art.issueBadges : deriveIssueBadges(art);
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
      btn.appendChild(tagsRow);
    }

    btn.addEventListener('click', () => openArticleMistakes(art));
    els.articlesContainer.appendChild(btn);
  }
}

async function openArticleMistakes(article) {
  state.selectedArticle = article;
  els.viewList.classList.add('hidden');
  els.viewDetail.classList.remove('hidden');

  const cached =
    clientAnalysisCache.get(article.qid) || getCachedBrowserAnalysis(article.qid);
  if (cached) {
    state.selectedAnalysis = cached;
    els.loadingDetail.classList.add('hidden');
    renderArticleMistakes();
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
    renderArticleMistakes();
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
    renderArticleMistakes();
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

function renderArticleMistakes() {
  const analysis = state.selectedAnalysis;
  if (!analysis) return;

  const art = analysis.article || state.selectedArticle;
  const discrepancies = analysis.discrepancies || [];
  els.detailContainer.innerHTML = '';

  const cardByLang = new Map();

  const heading = document.createElement('h2');
  heading.className = 'wb-detail-title';
  heading.textContent = art.canonicalLabel;
  els.detailContainer.appendChild(heading);

  els.detailContainer.appendChild(renderReferenceStrip(art, discrepancies, cardByLang));

  if (discrepancies.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'wb-empty';
    empty.textContent = 'No specific issues detected across editions for this article.';
    els.detailContainer.appendChild(empty);
    return;
  }

  for (const disc of discrepancies) {
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
      setIssueCardExpanded(card, !card.classList.contains('is-expanded'));
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
  }
}

els.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  state.currentQuery = els.inputTopicQuery.value.trim();
  runSearch();
});

els.btnBackToList.addEventListener('click', () => {
  els.viewDetail.classList.add('hidden');
  els.viewList.classList.remove('hidden');
});

runSearch();

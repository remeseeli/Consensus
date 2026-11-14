import {
  DEFAULT_API_BASE_URL,
  LANG_NAMES,
  SUPPORTED_LANGS,
} from '../shared/constants.js';
import { OFFLINE_ANALYSES, OFFLINE_ARTICLES } from '../shared/demoFallback.js';
import {
  getCachedBrowserAnalysis,
  searchLiveFromBrowser,
} from '../shared/liveBrowserScanner.js';

// Instant client-side caches so repeat queries and clicking articles take 0ms
const clientSearchCache = new Map();
const clientAnalysisCache = new Map();

let backendDownUntil = 0;
let activeSearchToken = 0;

const state = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  currentQuery: '',
  articles: [],
  selectedArticle: null,
  selectedAnalysis: null,
};

const els = {
  searchForm: document.getElementById('search-form'),
  inputTopicQuery: document.getElementById('input-topic-query'),
  searchTiming: document.getElementById('search-timing'),
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
    els.searchTiming.textContent = 'Instant (cached)';
    renderArticleList();
    return;
  }

  if (!q && Date.now() < backendDownUntil) {
    state.articles = OFFLINE_ARTICLES;
    els.loadingList.classList.add('hidden');
    els.searchTiming.textContent = 'FI · SV · RU · EN · ET · ES · ZH · PL · HU';
    renderArticleList();
    return;
  }

  els.loadingList.classList.remove('hidden');
  els.articlesContainer.innerHTML = '';
  els.searchTiming.textContent = 'Searching 9 languages...';

  const startedAt = performance.now();
  let resolvedArticles = null;

  // For topic searches, run the fast 9-language live scanner (with exact-match #1 ranking,
  // relevance filtering, and emotional/NPOV detection). For empty query, check backend/offline list.
  if (q) {
    try {
      const liveArticles = await searchLiveFromBrowser(q);
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

  const elapsedSec = ((performance.now() - startedAt) / 1000).toFixed(2);
  els.searchTiming.textContent = q ? `${elapsedSec}s` : 'FI · SV · RU · EN · ET · ES · ZH · PL · HU';
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

function renderReferenceStrip(art) {
  const strip = document.createElement('div');
  strip.className = 'wb-ref-strip';

  const presentCounts = SUPPORTED_LANGS
    .filter((l) => Boolean(art.editions?.[l]?.title))
    .map((l) => Number(art.editions?.[l]?.refCount ?? 0));
  const maxRefs = Math.max(0, ...presentCounts);

  for (const lang of SUPPORTED_LANGS) {
    const ed = art.editions?.[lang];
    const hasEd = Boolean(ed?.title);
    if (!hasEd) continue;

    const refs = Number(ed?.refCount ?? 0);
    const isLow =
      maxRefs >= 6 && (maxRefs >= refs * 2.5 || maxRefs - refs >= 12);

    const box = document.createElement('div');
    box.className = `wb-ref-box${isLow ? ' wb-ref-box--low' : ''}`;

    const langSpan = document.createElement('span');
    langSpan.className = 'wb-ref-box-lang';
    langSpan.textContent = `${LANG_NAMES[lang]} (${lang.toUpperCase()})`;

    const valSpan = document.createElement('span');
    valSpan.className = 'wb-ref-box-val';
    valSpan.textContent = isLow ? `${refs} refs (Low)` : `${refs} refs`;

    box.appendChild(langSpan);
    box.appendChild(valSpan);
    strip.appendChild(box);
  }

  return strip;
}

function renderArticleMistakes() {
  const analysis = state.selectedAnalysis;
  if (!analysis) return;

  const art = analysis.article || state.selectedArticle;
  const discrepancies = analysis.discrepancies || [];
  els.detailContainer.innerHTML = '';

  const heading = document.createElement('h2');
  heading.className = 'wb-detail-title';
  heading.textContent = art.canonicalLabel;
  els.detailContainer.appendChild(heading);

  els.detailContainer.appendChild(renderReferenceStrip(art));

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

    const header = document.createElement('div');
    header.className = 'wb-mistake-header';

    const typeBadge = document.createElement('span');
    typeBadge.className = `wb-issue-type-badge${badgeModifier}`;
    typeBadge.textContent = issueLabel;

    const langFull = LANG_NAMES[disc.targetLang] || disc.targetLang.toUpperCase();
    const langTarget = document.createElement('span');
    langTarget.className = 'wb-issue-target-lang';
    langTarget.textContent = `in ${langFull} (${disc.targetLang.toUpperCase()}) Wikipedia`;

    header.appendChild(typeBadge);
    header.appendChild(langTarget);
    card.appendChild(header);

    const claimTitle = document.createElement('h3');
    claimTitle.className = 'wb-mistake-heading';
    claimTitle.textContent = disc.claimTopic;
    card.appendChild(claimTitle);

    const desc = document.createElement('p');
    desc.className = 'wb-mistake-desc';
    desc.textContent = disc.summary;
    card.appendChild(desc);

    const claimsObj = disc.agreementMatrix?.claims;
    if (claimsObj) {
      const compareBox = document.createElement('div');
      compareBox.className = 'wb-claims-compare';

      for (const lang of SUPPORTED_LANGS) {
        const val = claimsObj[lang]?.value;
        if (!val || val === 'Edition missing' || val === 'Article missing') continue;

        const isFlagged = lang === disc.targetLang;
        const row = document.createElement('div');
        row.className = `wb-claim-line${isFlagged ? ' wb-claim-line--flagged' : ''}`;

        const code = document.createElement('span');
        code.className = `wb-claim-code${isFlagged ? ' target' : ''}`;
        code.textContent = lang.toUpperCase();

        const text = document.createElement('span');
        text.textContent = val;

        row.appendChild(code);
        row.appendChild(text);
        compareBox.appendChild(row);
      }
      card.appendChild(compareBox);
    }

    if (disc.disputedSnippet) {
      const quote = document.createElement('div');
      quote.className = 'wb-snippet-preview';
      quote.textContent = `Highlighted on page: "${disc.highlightPhrase || disc.disputedSnippet}"`;
      card.appendChild(quote);
    }

    const targetUrl = art.editions?.[disc.targetLang]?.url || '';
    const findBtn = document.createElement('button');
    findBtn.type = 'button';
    findBtn.className = 'wb-btn-find';
    findBtn.textContent = `Find in ${langFull} Wikipedia \u2192`;
    findBtn.addEventListener('click', () => findInWikipediaPage(targetUrl, disc));

    card.appendChild(findBtn);
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

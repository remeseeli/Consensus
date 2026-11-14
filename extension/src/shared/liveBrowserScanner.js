import { LANG_NAMES, SUPPORTED_LANGS } from './constants.js';

/**
 * Fast Direct Browser Scanner (also serves as instant fallback when localhost:4000 is down).
 * Searches FI, SV, RU, EN, ET, ES Wikipedia in parallel via MediaWiki + Wikidata CORS APIs (&origin=*)
 * and detects:
 *  1) Different information (conflicting dates/figures + exact highlightPhrase)
 *  2) Much fewer references
 *  3) Missing reference ([citation needed] tags)
 *  4) Not neutral (emotional tone / NPOV templates & loaded subjective language)
 *  5) Outdated information
 */

const CITATION_NEEDED_RE = {
  fi: /\{\{\s*(?:lähde|lähde\?|kenen mukaan|missä|milloin)\b[^}]*\}\}/gi,
  sv: /\{\{\s*(?:källa behövs|kb|vem|när|var)\b[^}]*\}\}/gi,
  ru: /\{\{\s*(?:нет аи|источник\?|кто|когда|откуда|проверить факты)\b[^}]*\}\}/gi,
  en: /\{\{\s*(?:citation needed|cn|fact|unreferenced|who|when|where)\b[^}]*\}\}/gi,
  et: /\{\{\s*(?:lisa viide|viide\?|allikas\?|viidet pole|täpsusta)\b[^}]*\}\}/gi,
  es: /\{\{\s*(?:cita requerida|cr|referencias|quién|cuándo|dónde)\b[^}]*\}\}/gi,
  zh: /\{\{\s*(?:citation needed|cn|fact|来源请求|需要来源|无来源|who|when)\b[^}]*\}\}/gi,
  pl: /\{\{\s*(?:fakt|potrzebne źródło|citation needed|cn|kto|kiedy|gdzie)\b[^}]*\}\}/gi,
  hu: /\{\{\s*(?:forrás\?|nincs forrás|citation needed|cn|ki|mikor|hol)\b[^}]*\}\}/gi,
};

const NPOV_TEMPLATE_RE = {
  fi: /\{\{\s*(?:neutraalius|pov|puolueellisuus|yksipuolinen|kansanvalta|näkökulma)\b[^}]*\}\}/i,
  sv: /\{\{\s*(?:pov|neutralitet|synvinkel|partisk|värdeord|icke-neutral)\b[^}]*\}\}/i,
  ru: /\{\{\s*(?:нтз|нейтральность|ненейтральность|проверить нейтральность|реклама|взвешенность|неавторитетные источники)\b[^}]*\}\}/i,
  en: /\{\{\s*(?:pov|neutrality|pov-section|pov statement|peacock|weasel|tone|advert|unbalanced)\b[^}]*\}\}/i,
  et: /\{\{\s*(?:neutraalsus|pov|vaidlustatud|erapoolik)\b[^}]*\}\}/i,
  es: /\{\{\s*(?:no neutral|pvn|discutido|publicidad|tono|desacuerdo de neutralidad)\b[^}]*\}\}/i,
  zh: /\{\{\s*(?:pov|neutrality|中立性|不中立|非中立|advert|tone)\b[^}]*\}\}/i,
  pl: /\{\{\s*(?:pov|neutralność|niejasne|kontrowersyjny|reklama|styl)\b[^}]*\}\}/i,
  hu: /\{\{\s*(?:pov|semlegesség|vitatott|reklám|elfogult)\b[^}]*\}\}/i,
};

const EMOTIONAL_WORDS_RE = {
  en: /\b(catastrophic|disastrous|atrocious|atrocities|barbaric|brutal|heroic|glorious|glorification|legendary|triumphant|devastating|horrific|evil|corrupt|infamous|notorious|shameful|scandalous|unforgivable|genius|masterpiece|undoubtedly|obviously|miraculous|treacherous|tyrannical|bloody|propaganda|pathetic|ridiculous|ruthless|heinous|terrorist\w*|war criminal\w*|extremist\w*|fanatic\w*|traitor\w*|murderer\w*|massacre\w*|puppet regime)\b/gi,
  fi: /\b(katastrofaali\w*|julma\w*|barbaari\w*|sankarilli\w*|loistava\w*|neroka\w*|hirvittävä\w*|häpeälli\w*|skandaali\w*|korruptoitun\w*|järkyttävä\w*|tuhoisa\w*|pahamainei\w*|epäilemättä|luonnollisesti|ihmeelli\w*|hirmuhallinto\w*|petokselli\w*|verinen|propaganda\w*|terroristi\w*|sotarikolli\w*|ääri\w*|fanaatik\w*|petturi\w*|murhaaja\w*|joukkomurha\w*|julmuuks\w*)\b/gi,
  sv: /\b(katastrofal\w*|barbarisk\w*|brutal\w*|hjältemodig\w*|ärorik\w*|fruktansvärd\w*|skandalös\w*|korrupt\w*|ökänd\w*|skamlig\w*|mästerverk|geni\w*|otvivelaktigt|självklart|tyrannisk\w*|förrädisk\w*|blodig\w*|propaganda\w*|terrorist\w*|krigsförbryt\w*|extremist\w*|fanatiker\w*|förrädare\w*|mördare\w*|massaker\w*|grymhet\w*)\b/gi,
  ru: /(?:^|[^\p{L}])(катастрофическ\p{L}*|варварск\p{L}*|жесток\p{L}*|героическ\p{L}*|героизаци\p{L}*|славн\p{L}*|чудовищн\p{L}*|бесчеловечн\p{L}*|позорн\p{L}*|скандальн\p{L}*|коррумпирован\p{L}*|злодейск\p{L}*|злодеяни\p{L}*|зверств\p{L}*|гениальн\p{L}*|шедевр\p{L}*|бесспорно|очевидно|тираническ\p{L}*|кровав\p{L}*|вероломн\p{L}*|пропаганд\p{L}*|террорист\p{L}*|террор\p{L}*|каратель\p{L}*|карательн\p{L}*|пособник\p{L}*|преступн\p{L}*|преступник\p{L}*|предател\p{L}*|палач\p{L}*|убийц\p{L}*|резн\p{L}*|расправ\p{L}*|марионеточн\p{L}*|экстремист\p{L}*|фанатик\p{L}*|фашистск\p{L}*|нацистск\p{L}*|неонацист\p{L}*|русофоб\p{L}*|ультранационалист\p{L}*|оккупант\p{L}*|агрессор\p{L}*)/giu,
  et: /\b(katastroofili\w*|barbaar\w*|julm\w*|kangelaslik\w*|hiilgav\w*|kohutav\w*|häbiväär\w*|skandaal\w*|korrumpeerun\w*|kuritegelik\w*|geniaal\w*|meistriteos\w*|kahtlemata|türannia\w*|verine\w*|reeturlik\w*|propaganda\w*|terrorist\w*|sõjakurjategi\w*|äärmus\w*|fanaatik\w*|reetur\w*|mõrvar\w*|veresaun\w*)\b/gi,
  es: /\b(catastrófic\w*|bárbar\w*|brutal\w*|heroic\w*|glorios\w*|horrible\w*|vergonzos\w*|escandalos\w*|corrupt\w*|infame\w*|notori\w*|genial\w*|obra maestra|indudablemente|obviamente|tiránic\w*|sangrient\w*|traicioner\w*|propaganda\w*|terrorista\w*|criminal\w* de guerra|extremista\w*|fanátic\w*|masacre\w*|atrocidad\w*)\b/gi,
  zh: /(?:灾难性|残暴|野蛮|英雄般|辉煌|可耻|丑闻|腐败|臭名昭著|毫无疑问|显而易见|暴政|血腥|宣传|天才|杰作|令人震惊|极度|恐怖分子|战犯|极端主义|狂热|大屠杀|暴行|傀儡政权|叛徒)/g,
  pl: /(?:^|[^\p{L}])(katastrofaln\p{L}*|barbarzyń\p{L}*|brutaln\p{L}*|bohatersk\p{L}*|haniebn\p{L}*|skandaliczn\p{L}*|skorumpowan\p{L}*|zbrodnicz\p{L}*|zbrodni\p{L}*|okrutn\p{L}*|okrucieństw\p{L}*|ludobójstw\p{L}*|rzeź\p{L}*|rzezi\p{L}*|terroryst\p{L}*|kolaborant\p{L}*|zdrajc\p{L}*|morderc\p{L}*|propagand\p{L}*|ekstremist\p{L}*|fanatyk\p{L}*|krwaw\p{L}*|tyran\p{L}*|nazistowsk\p{L}*|faszystowsk\p{L}*|arcydzieł\p{L}*|genialn\p{L}*|niewątpliwie|oczywiście)/giu,
  hu: /(?:^|[^\p{L}])(katasztrofális\p{L}*|barbár\p{L}*|brutális\p{L}*|hősies\p{L}*|szégyenteljes\p{L}*|botrányos\p{L}*|korrupt\p{L}*|bűnös\p{L}*|kegyetlen\p{L}*|kegyetlenség\p{L}*|népirtás\p{L}*|mészárlás\p{L}*|terrorist\p{L}*|kollaboráns\p{L}*|áruló\p{L}*|gyilkos\p{L}*|propagand\p{L}*|szélsőséges\p{L}*|fanatikus\p{L}*|véres\p{L}*|zsarnok\p{L}*|náci\p{L}*|fasiszta\p{L}*|remekmű\p{L}*|zseniális\p{L}*|kétségtelenül|nyilvánvalóan)/giu,
};

const browserAnalysisCache = new Map();

function buildWikiUrl(lang, title) {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

async function fetchJsonFast(url, timeoutMs = 4800) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function searchQidsOnWiki(wikiHost, query) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '0',
    gsrlimit: '10',
    prop: 'pageprops',
    ppprop: 'wikibase_item',
    format: 'json',
    origin: '*',
  });
  try {
    const data = await fetchJsonFast(`https://${wikiHost}.wikipedia.org/w/api.php?${params}`);
    const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
    pages.sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
    return pages.map((p) => p?.pageprops?.wikibase_item).filter(Boolean);
  } catch {
    return [];
  }
}

async function searchWikidataEntities(query) {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: query,
    language: 'en',
    uselang: 'en',
    type: 'item',
    limit: '10',
    format: 'json',
    origin: '*',
  });
  try {
    const data = await fetchJsonFast(`https://www.wikidata.org/w/api.php?${params}`, 4000);
    return (data?.search || [])
      .map((item) => item?.id)
      .filter((id) => Boolean(id && /^Q\d+$/.test(id)));
  } catch {
    return [];
  }
}

const DISAMBIG_RE = /\((?:disambiguation|täsmennyssivu|olika betydelser|значения|täpsustus|desambiguación|消歧义|ujednoznacznienie|egyértelműsítő lap)\)/i;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWordBoundaryMatch(text, token) {
  if (!text || !token) return false;
  if (/[\u4e00-\u9fff]/.test(token)) {
    return text.toLowerCase().includes(token.toLowerCase());
  }
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(token)}([^\\p{L}\\p{N}]|$)`, 'iu');
  return re.test(text);
}

function computeQueryTitleMatchScore(query, canonicalLabel, titlesObj) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const qTokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const candidates = [canonicalLabel, ...Object.values(titlesObj || {})]
    .filter(Boolean)
    .map((s) => s.toLowerCase().trim());

  let best = 0;
  for (const text of candidates) {
    if (text === q) {
      best = Math.max(best, 120);
    } else if (text.startsWith(q) && hasWordBoundaryMatch(text, q)) {
      best = Math.max(best, 85);
    } else if (hasWordBoundaryMatch(text, q)) {
      best = Math.max(best, 70);
    } else if (qTokens.length > 0) {
      const matched = qTokens.filter((tok) => hasWordBoundaryMatch(text, tok)).length;
      if (matched === qTokens.length) {
        best = Math.max(best, 55);
      } else if (matched > 0) {
        best = Math.max(best, Math.round((matched / qTokens.length) * 20));
      }
    }
  }
  return best;
}

function isTopicRelevantToQuery(query, canonicalLabel, edMap) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const qTokens = q.split(/\s+/).filter((t) => t.length >= 2);

  const titlesText = [
    canonicalLabel,
    ...Array.from(edMap.values()).map((e) => e.title),
  ]
    .filter(Boolean)
    .join(' ');

  // 1. Exact phrase or all query words (with word boundaries) in title/label -> definitely relevant
  if (hasWordBoundaryMatch(titlesText, q)) return true;
  if (qTokens.length > 0 && qTokens.every((tok) => hasWordBoundaryMatch(titlesText, tok))) {
    return true;
  }

  // 2. For multi-word queries (e.g. "winter war"), require the exact phrase in an edition's lead extract
  //    (eliminates "Warhammer", "Captain America: The Winter Soldier", etc.)
  const leadTexts = Array.from(edMap.values())
    .map((e) => (e.extract || '').slice(0, 700))
    .join(' ');

  if (qTokens.length >= 2) {
    return hasWordBoundaryMatch(leadTexts, q);
  }

  // 3. Single-word query: require word-boundary match in lead extract
  return hasWordBoundaryMatch(leadTexts, q);
}

function countInlineRefs(wikitext) {
  if (!wikitext) return 0;
  const fullTags = wikitext.match(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi) || [];
  const selfClosing = wikitext.match(/<ref\b[^>]*\/\s*>/gi) || [];
  const sfn = wikitext.match(/\{\{\s*(sfn|harvnb|källhänvisning|viite)\b/gi) || [];
  return fullTags.length + Math.ceil(selfClosing.length * 0.5) + sfn.length;
}

function extractCitationNeededSnippet(wikitext, lang) {
  if (!wikitext || !CITATION_NEEDED_RE[lang]) return null;
  const re = new RegExp(CITATION_NEEDED_RE[lang].source, 'gi');
  const m = re.exec(wikitext);
  if (!m || m.index === undefined) return null;
  const before = wikitext.slice(Math.max(0, m.index - 240), m.index);
  const cleaned = before
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref\b[^>]*\/\s*>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = cleaned.split(/(?<=[.!?])\s+/);
  const last = (parts[parts.length - 1] || cleaned).trim();
  return last.length >= 15 ? last : null;
}

function stripWikitextToPlain(wikitext) {
  return (wikitext || '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, ' ')
    .replace(/<ref\b[^>]*\/\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\[\[(?:File|Image|Файл|Tiedosto|Fil|Fail|Archivo|文件):[^\]]+\]\]/gi, ' ')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/^=+\s*.*?\s*=+$/gm, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchBatchEditions(lang, items) {
  const out = new Map();
  if (!items.length) return out;

  const titleToQid = new Map();
  for (const it of items) {
    titleToQid.set(it.title.toLowerCase(), it.qid);
  }

  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts|revisions',
    exintro: '1',
    explaintext: '1',
    exlimit: 'max',
    rvprop: 'timestamp|content',
    rvslots: 'main',
    redirects: '1',
    titles: items.map((i) => i.title).join('|'),
    format: 'json',
    origin: '*',
  });

  try {
    const data = await fetchJsonFast(`https://${lang}.wikipedia.org/w/api.php?${params}`, 5500);
    const normMap = new Map();
    for (const n of data?.query?.normalized || []) {
      normMap.set(n.to.toLowerCase(), n.from.toLowerCase());
    }
    for (const r of data?.query?.redirects || []) {
      const orig = normMap.get(r.from.toLowerCase()) || r.from.toLowerCase();
      normMap.set(r.to.toLowerCase(), orig);
    }

    for (const page of Object.values(data?.query?.pages || {})) {
      if (!page || page.missing !== undefined || !page.title) continue;
      const pLower = page.title.toLowerCase();
      const origLower = normMap.get(pLower) || pLower;
      const qid = titleToQid.get(origLower) || titleToQid.get(pLower);
      if (!qid) continue;

      const rev = page.revisions?.[0];
      const wikitext = rev?.slots?.main?.['*'] || rev?.['*'] || '';
      const cnRe = CITATION_NEEDED_RE[lang];
      const cnMatches = cnRe ? wikitext.match(cnRe) || [] : [];
      const hasNpovTemplate = NPOV_TEMPLATE_RE[lang]
        ? NPOV_TEMPLATE_RE[lang].test(wikitext)
        : false;
      const bodyPlain = stripWikitextToPlain(wikitext.slice(0, 18000));

      out.set(qid, {
        qid,
        lang,
        title: page.title,
        url: buildWikiUrl(lang, page.title),
        extract: (page.extract || '').trim(),
        bodyPlain,
        refCount: countInlineRefs(wikitext),
        citationNeededTags: cnMatches.length,
        cnSnippet: extractCitationNeededSnippet(wikitext, lang),
        hasNpovTemplate,
        lastRevAt: rev?.timestamp || null,
      });
    }
  } catch {
    // Ignore failed language batch
  }
  return out;
}

function splitSentences(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。！？])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10);
}

function firstSentence(text, fallbackTitle) {
  const list = splitSentences(text);
  return list[0] || fallbackTitle;
}

function classifyFigureCategory(raw, sentence) {
  const s = (sentence || '').toLowerCase();
  if (/%/.test(raw)) return 'percent';
  if (/(?:km²|km2|mi²|ha\b|hektar|square\s+k|neliökilometr|квадратн)/i.test(s)) return 'area';
  if (/(?:population|inhabitants|asukas|invånare|населен|elanik|habitant|人口|ludnoś|lakos|residents)/i.test(s)) return 'population';
  if (/(?:dead|killed|died|casualties|missing|wounded|kuoll|kaatun|stupade|погиб|убит|пропавш|langen|muert|死亡|zginę|zabitych|halott)/i.test(s)) return 'casualties';
  if (/(?:\bkm\b|\bmeters\b|\bmetres\b|metriä|meter\b|метр|kilometr)/i.test(s)) return 'distance';
  return 'general';
}

function extractYearsAndFigures(text) {
  const lead = (text || '').slice(0, 1500);
  const years = new Set();
  const yearMatches = lead.match(/\b(1[5-9]\d{2}|20[0-2]\d)\b/g) || [];
  for (const y of yearMatches) years.add(y);

  const figures = new Map();
  const sents = splitSentences(lead);
  const numRe = /\b\d{1,3}(?:[\s\u00a0.,]\d{3})+(?:[.,]\d+)?%?|\b\d{2,7}(?:[.,]\d+)?%|\b\d{3,7}\b/g;
  for (const s of sents) {
    const matches = s.match(numRe) || [];
    for (const raw of matches) {
      const digits = raw.replace(/[^\d]/g, '');
      const val = Number(digits);
      if (!Number.isFinite(val) || val === 0) continue;
      if (val >= 1500 && val <= 2035 && raw.length === 4 && !/%/.test(raw)) continue;
      if (digits.length >= 2 && !figures.has(digits)) {
        figures.set(digits, {
          raw: raw.trim(),
          numericValue: val,
          category: classifyFigureCategory(raw, s),
          sentence: s,
        });
      }
    }
  }
  return { years, figures, sents };
}

function scoreEmotionalNeutrality(ed) {
  const leadSents = splitSentences(ed.extract);
  const bodySents = splitSentences(ed.bodyPlain || ed.extract);
  const allSents = leadSents.length > 0 ? [...leadSents, ...bodySents.slice(0, 45)] : bodySents.slice(0, 45);

  const wordRe = EMOTIONAL_WORDS_RE[ed.lang];
  let bestSentence = null;
  let bestWords = [];
  let bestScore = 0;
  let totalHits = 0;
  const allTerms = new Set();

  for (const s of allSents) {
    if (!wordRe) continue;
    const re = new RegExp(wordRe.source, wordRe.flags);
    const rawMatches = [...s.matchAll(re)].map((m) => (m[1] || m[0] || '').trim()).filter(Boolean);
    const hasExclamation = /!(?:\s|$)/.test(s);
    const score = rawMatches.length + (hasExclamation ? 1 : 0);
    totalHits += rawMatches.length;
    for (const w of rawMatches) allTerms.add(w.toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      bestWords = [...new Set(rawMatches)];
      bestSentence = s;
    }
  }

  return {
    hasNpovTemplate: ed.hasNpovTemplate,
    totalHits,
    uniqueTermsCount: allTerms.size,
    emotionalTerms: bestWords.length ? bestWords : [...allTerms].slice(0, 4),
    sentence: bestSentence || firstSentence(ed.extract, ed.title),
    highlightPhrase: bestWords[0] || [...allTerms][0] || null,
  };
}

function detectEmotionalNeutralityIssue(ed, allEditionScores = []) {
  const own = scoreEmotionalNeutrality(ed);
  const otherScores = allEditionScores
    .filter((x) => x.lang !== ed.lang)
    .map((x) => x.totalHits);
  const avgOtherHits =
    otherScores.length > 0
      ? otherScores.reduce((a, b) => a + b, 0) / otherScores.length
      : 0;

  const isSignificantlyMoreEmotional =
    own.totalHits >= 4 && own.totalHits >= Math.max(avgOtherHits * 2, avgOtherHits + 3);

  if (
    own.hasNpovTemplate ||
    own.uniqueTermsCount >= 3 ||
    own.emotionalTerms.length >= 2 ||
    isSignificantlyMoreEmotional
  ) {
    return {
      hasIssue: true,
      ...own,
      isSignificantlyMoreEmotional,
    };
  }
  return { hasIssue: false, ...own };
}

function buildClaimsMatrix(editionsMap, mapper) {
  const claims = {};
  for (const code of SUPPORTED_LANGS) {
    const ed = editionsMap.get(code);
    if (!ed) {
      claims[code] = { value: 'Edition missing', hasCitation: false, citationStatus: 'edition_missing' };
    } else {
      claims[code] = mapper(code, ed);
    }
  }
  return claims;
}

function scanEditionsForIssues(qid, canonicalLabel, editionsMap) {
  const langs = SUPPORTED_LANGS.filter((l) => editionsMap.has(l));
  if (langs.length < 2) return { discrepancies: [], issueBadges: [], overallSummary: '' };

  const discrepancies = [];
  const issueBadges = [];

  const parsed = {};
  for (const l of langs) {
    parsed[l] = extractYearsAndFigures(editionsMap.get(l).extract);
  }

  // 1. DIFFERENT INFORMATION: Conflicting years or numerical figures across leads
  let foundFactDiff = false;
  const allYears = new Map();
  for (const l of langs) {
    for (const y of parsed[l].years) {
      if (!allYears.has(y)) allYears.set(y, []);
      allYears.get(y).push(l);
    }
  }

  for (const [sharedYear, presentIn] of allYears.entries()) {
    if (presentIn.length >= 2) {
      const outlier = langs.find(
        (l) => !presentIn.includes(l) && parsed[l].years.size > 0
      );
      if (!outlier) continue;

      const outlierOtherYears = [...parsed[outlier].years].filter((y) => {
        const yNum = Number(y);
        return (
          !presentIn.some((p) => parsed[p].years.has(y)) &&
          Math.abs(yNum - Number(sharedYear)) <= 15
        );
      });
      if (outlierOtherYears.length > 0) {
        const altYear = outlierOtherYears[0];
        const outlierSent =
          parsed[outlier].sents.find((s) => s.includes(altYear)) ||
          firstSentence(editionsMap.get(outlier).extract, editionsMap.get(outlier).title);

        const claims = buildClaimsMatrix(editionsMap, (code, ed) => {
          if (code === outlier) {
            return {
              value: `States year ${altYear} (${ed.refCount} refs)`,
              hasCitation: ed.refCount > 0,
              citationStatus: ed.refCount > 0 ? 'valid' : 'missing',
            };
          }
          if (presentIn.includes(code)) {
            return {
              value: `States year ${sharedYear} (${ed.refCount} refs)`,
              hasCitation: ed.refCount > 0,
              citationStatus: ed.refCount > 0 ? 'valid' : 'missing',
            };
          }
          return {
            value: `Lead mentions ${[...parsed[code].years].slice(0, 2).join(', ') || 'other dates'} (${ed.refCount} refs)`,
            hasCitation: ed.refCount > 0,
            citationStatus: ed.refCount > 0 ? 'valid' : 'missing',
          };
        });

        discrepancies.push({
          id: discrepancies.length + 1,
          qid,
          mismatchType: 'hard_fact',
          issueLabel: 'Different information',
          targetLang: outlier,
          claimTopic: `Different dates in intro (${altYear} vs. ${sharedYear})`,
          summary: `${presentIn.map((l) => l.toUpperCase()).join(' & ')} Wikipedia state ${sharedYear}, while ${LANG_NAMES[outlier]} Wikipedia states ${altYear}.`,
          disputedSnippet: outlierSent,
          highlightPhrase: altYear,
          sectionHeading: null,
          lineHint: 1,
          suggestedCorrection: `Different information: ${presentIn.map((l) => l.toUpperCase()).join(' & ')} state ${sharedYear}, whereas ${outlier.toUpperCase()} states ${altYear}.`,
          agreementMatrix: {
            consensusGroup: presentIn,
            outlierGroup: [outlier],
            matrixLabel: `${presentIn.map((l) => l.toUpperCase()).join(' & ')}: ${sharedYear} | ${outlier.toUpperCase()}: ${altYear}`,
            claims,
          },
          citationGapFlag: false,
          donorLang: presentIn[0],
          severityScore: 86,
          confidenceLevel: 'high',
          confidenceScore: 85,
          verifiedSources: [],
        });
        issueBadges.push('Different information');
        foundFactDiff = true;
        break;
      }
    }
  }

  // Conflicting same-category statistics/figures (never compare unrelated numbers from different topics)
  if (!foundFactDiff) {
    const langsWithFigs = langs.filter((l) => parsed[l].figures.size > 0);
    if (langsWithFigs.length >= 2) {
      const sortedFigs = langsWithFigs
        .map((l) => editionsMap.get(l))
        .sort((a, b) => a.refCount - b.refCount);
      const targetEd = sortedFigs[0];
      const donorEd = sortedFigs[sortedFigs.length - 1];

      let matchedPair = null;
      for (const [tKey, tEntry] of parsed[targetEd.lang].figures.entries()) {
        if (parsed[donorEd.lang].figures.has(tKey)) continue;
        // Find a figure in donorEd with the SAME semantic category (e.g. both population, both casualties, both area, both percent)
        for (const [dKey, dEntry] of parsed[donorEd.lang].figures.entries()) {
          if (tKey === dKey) continue;
          if (tEntry.category !== dEntry.category) continue;
          // If category is 'general' (no explicit unit/topic keyword), require compatible magnitude (within 4x)
          if (tEntry.category === 'general') {
            const ratio = Math.max(tEntry.numericValue, dEntry.numericValue) / Math.max(1, Math.min(tEntry.numericValue, dEntry.numericValue));
            if (ratio > 4) continue;
          }
          // Ignore trivial < 2% rounding differences
          const diffPct = Math.abs(tEntry.numericValue - dEntry.numericValue) / Math.max(1, dEntry.numericValue);
          if (diffPct < 0.02) continue;

          matchedPair = { targetEntry: tEntry, donorEntry: dEntry };
          break;
        }
        if (matchedPair) break;
      }

      if (matchedPair) {
        const { targetEntry, donorEntry } = matchedPair;

        const claims = buildClaimsMatrix(editionsMap, (code, ed) => {
          const sameCat = [...parsed[code].figures.values()].find(
            (f) => f.category === targetEntry.category
          );
          return {
            value: sameCat
              ? `${sameCat.raw} — "${sameCat.sentence.slice(0, 80)}"`
              : `No matching ${targetEntry.category} figure in lead (${ed.refCount} refs)`,
            hasCitation: ed.refCount > 0,
            citationStatus: ed.refCount > 0 ? 'valid' : 'missing',
          };
        });

        discrepancies.push({
          id: discrepancies.length + 1,
          qid,
          mismatchType: 'hard_fact',
          issueLabel: 'Different information',
          targetLang: targetEd.lang,
          claimTopic: `Different figures in intro (${targetEntry.raw} vs. ${donorEntry.raw})`,
          summary: `${LANG_NAMES[targetEd.lang]} Wikipedia states "${targetEntry.raw}", whereas ${LANG_NAMES[donorEd.lang]} Wikipedia states "${donorEntry.raw}".`,
          disputedSnippet: targetEntry.sentence,
          highlightPhrase: targetEntry.raw,
          sectionHeading: null,
          lineHint: 1,
          suggestedCorrection: `Different information: Compare ${targetEd.lang.toUpperCase()} (${targetEntry.raw}) against ${donorEd.lang.toUpperCase()} (${donorEntry.raw}).`,
          agreementMatrix: {
            consensusGroup: [donorEd.lang],
            outlierGroup: [targetEd.lang],
            matrixLabel: `${donorEd.lang.toUpperCase()}: ${donorEntry.raw} | ${targetEd.lang.toUpperCase()}: ${targetEntry.raw}`,
            claims,
          },
          citationGapFlag: targetEd.refCount < donorEd.refCount,
          donorLang: donorEd.lang,
          severityScore: 83,
          confidenceLevel: 'medium',
          confidenceScore: 79,
          verifiedSources: [],
        });
        issueBadges.push('Different information');
      }
    }
  }

  // 2. NOT NEUTRAL (EMOTIONAL TONE / NPOV)
  const povScores = langs.map((l) => ({
    lang: l,
    ...scoreEmotionalNeutrality(editionsMap.get(l)),
  }));

  for (const l of langs) {
    const ed = editionsMap.get(l);
    const pov = detectEmotionalNeutralityIssue(ed, povScores);
    if (pov.hasIssue) {
      const reasonText = pov.hasNpovTemplate
        ? `Wikipedia editors flagged this ${LANG_NAMES[l]} article with a Neutrality / POV warning template${pov.emotionalTerms.length ? ` and loaded wording (${pov.emotionalTerms.slice(0, 4).join(', ')})` : ''}.`
        : `${LANG_NAMES[l]} Wikipedia uses emotionally loaded or non-neutral wording (${pov.totalHits} loaded occurrences, e.g. "${pov.emotionalTerms.slice(0, 4).join('", "')}").`;

      const claims = buildClaimsMatrix(editionsMap, (code, otherEd) => {
        const otherPov = detectEmotionalNeutralityIssue(otherEd, povScores);
        return {
          value: otherPov.hasIssue
            ? `Loaded / emotional tone (${otherPov.totalHits} hits${otherPov.emotionalTerms?.length ? `: "${otherPov.emotionalTerms.slice(0, 3).join(', ')}"` : ''})`
            : `Neutral tone (${otherPov.totalHits} loaded terms, ${otherEd.refCount} refs)`,
          hasCitation: !otherPov.hasIssue,
          citationStatus: otherPov.hasIssue ? 'missing' : 'valid',
        };
      });

      discrepancies.push({
        id: discrepancies.length + 1,
        qid,
        mismatchType: 'neutrality_bias',
        issueLabel: 'Not neutral (emotional tone)',
        targetLang: l,
        claimTopic: `Emotional or non-neutral point of view in ${LANG_NAMES[l]} Wikipedia`,
        summary: reasonText,
        disputedSnippet: pov.sentence,
        highlightPhrase: pov.highlightPhrase,
        sectionHeading: null,
        lineHint: 1,
        suggestedCorrection: `Rewrite passage in neutral encyclopedic tone without subjective adjectives${pov.emotionalTerms.length ? ` ("${pov.emotionalTerms.join('", "')}")` : ''}.`,
        agreementMatrix: {
          consensusGroup: langs.filter((x) => x !== l),
          outlierGroup: [l],
          matrixLabel: `${l.toUpperCase()} uses emotional / non-neutral wording`,
          claims,
        },
        citationGapFlag: false,
        donorLang: null,
        severityScore: 81,
        confidenceLevel: pov.hasNpovTemplate ? 'high' : 'medium',
        confidenceScore: pov.hasNpovTemplate ? 90 : 77,
        verifiedSources: [],
      });
      issueBadges.push(`Not neutral (${l.toUpperCase()})`);
    }
  }

  // 3. MUCH FEWER REFERENCES
  const sortedByRefs = langs
    .map((l) => editionsMap.get(l))
    .sort((a, b) => a.refCount - b.refCount);
  const lowestEd = sortedByRefs[0];
  const highestEd = sortedByRefs[sortedByRefs.length - 1];

  if (
    highestEd.refCount >= 6 &&
    (highestEd.refCount >= lowestEd.refCount * 2.5 || highestEd.refCount - lowestEd.refCount >= 12)
  ) {
    const pctLess = Math.round(((highestEd.refCount - lowestEd.refCount) / highestEd.refCount) * 100);
    const claims = buildClaimsMatrix(editionsMap, (code, ed) => ({
      value:
        code === lowestEd.lang
          ? `Only ${ed.refCount} references (${pctLess}% fewer than ${highestEd.lang.toUpperCase()})`
          : `${ed.refCount} references`,
      hasCitation: ed.refCount > 4,
      citationStatus: code === lowestEd.lang ? 'missing' : 'valid',
    }));

    discrepancies.push({
      id: discrepancies.length + 1,
      qid,
      mismatchType: 'missing_citation',
      issueLabel: 'Much fewer references',
      targetLang: lowestEd.lang,
      claimTopic: `${LANG_NAMES[lowestEd.lang]} Wikipedia has only ${lowestEd.refCount} references (vs. ${highestEd.refCount} in ${LANG_NAMES[highestEd.lang]})`,
      summary: `${LANG_NAMES[lowestEd.lang]} edition has ${pctLess}% fewer references (${lowestEd.refCount} vs. ${highestEd.refCount} in ${LANG_NAMES[highestEd.lang]}), leaving claims weakly sourced.`,
      disputedSnippet: lowestEd.cnSnippet || firstSentence(lowestEd.extract, lowestEd.title),
      highlightPhrase: null,
      sectionHeading: null,
      lineHint: 1,
      suggestedCorrection: `Much fewer references: ${lowestEd.lang.toUpperCase()} has only ${lowestEd.refCount} refs compared with ${highestEd.refCount} refs in ${highestEd.lang.toUpperCase()}.`,
      agreementMatrix: {
        consensusGroup: [highestEd.lang],
        outlierGroup: [lowestEd.lang],
        matrixLabel: `${highestEd.lang.toUpperCase()}: ${highestEd.refCount} refs | ${lowestEd.lang.toUpperCase()}: only ${lowestEd.refCount} refs`,
        claims,
      },
      citationGapFlag: true,
      donorLang: highestEd.lang,
      severityScore: Math.min(92, 68 + Math.round(pctLess / 4)),
      confidenceLevel: 'high',
      confidenceScore: 90,
      verifiedSources: [],
    });
    issueBadges.push(
      `Much fewer references (${lowestEd.lang.toUpperCase()}: ${lowestEd.refCount} vs ${highestEd.lang.toUpperCase()}: ${highestEd.refCount})`
    );
  }

  // 4. MISSING REFERENCE: Explicit [citation needed] tag
  for (const l of langs) {
    const ed = editionsMap.get(l);
    if (ed.citationNeededTags > 0) {
      const claims = buildClaimsMatrix(editionsMap, (_code, e) => ({
        value:
          e.citationNeededTags > 0
            ? `${e.citationNeededTags} [citation needed] tag(s) (${e.refCount} refs)`
            : `No [citation needed] tags (${e.refCount} refs)`,
        hasCitation: e.citationNeededTags === 0 && e.refCount > 0,
        citationStatus: e.citationNeededTags > 0 ? 'missing' : 'valid',
      }));

      discrepancies.push({
        id: discrepancies.length + 1,
        qid,
        mismatchType: 'missing_citation',
        issueLabel: 'Missing reference',
        targetLang: l,
        claimTopic: `${ed.citationNeededTags} [citation needed] tag(s) in ${LANG_NAMES[l]} Wikipedia`,
        summary: `${LANG_NAMES[l]} edition explicitly marks ${ed.citationNeededTags} claim(s) as lacking a reliable source.`,
        disputedSnippet: ed.cnSnippet || firstSentence(ed.extract, ed.title),
        highlightPhrase: ed.cnSnippet || null,
        sectionHeading: null,
        lineHint: 1,
        suggestedCorrection: `Missing reference: Verify and cite the flagged passage using ${highestEd.lang.toUpperCase()} Wikipedia (${highestEd.refCount} refs).`,
        agreementMatrix: {
          consensusGroup: [highestEd.lang],
          outlierGroup: [l],
          matrixLabel: `${l.toUpperCase()} has ${ed.citationNeededTags} [citation needed] tag(s)`,
          claims,
        },
        citationGapFlag: true,
        donorLang: highestEd.lang,
        severityScore: 76,
        confidenceLevel: 'high',
        confidenceScore: 88,
        verifiedSources: [],
      });
      if (!issueBadges.some((b) => b.startsWith('Missing reference'))) {
        issueBadges.push(`Missing reference (${l.toUpperCase()})`);
      }
      break;
    }
  }

  // 5. OUTDATED INFORMATION: Revision age gap > 400 days
  const withDates = langs
    .map((l) => ({ ed: editionsMap.get(l), ts: Date.parse(editionsMap.get(l).lastRevAt || '') }))
    .filter((x) => Number.isFinite(x.ts))
    .sort((a, b) => a.ts - b.ts);

  if (withDates.length >= 2) {
    const oldest = withDates[0];
    const newest = withDates[withDates.length - 1];
    const daysGap = Math.round((newest.ts - oldest.ts) / (1000 * 60 * 60 * 24));
    if (daysGap >= 400 && oldest.ed.refCount < newest.ed.refCount) {
      const oldYear = new Date(oldest.ts).getUTCFullYear();
      const newYear = new Date(newest.ts).getUTCFullYear();
      const claims = buildClaimsMatrix(editionsMap, (code, e) => ({
        value: `Last edited ${e.lastRevAt ? e.lastRevAt.slice(0, 10) : 'unknown'} (${e.refCount} refs)`,
        hasCitation: e.refCount > 0,
        citationStatus: code === oldest.ed.lang ? 'missing' : 'valid',
      }));

      discrepancies.push({
        id: discrepancies.length + 1,
        qid,
        mismatchType: 'outdated_data',
        issueLabel: 'Outdated information',
        targetLang: oldest.ed.lang,
        claimTopic: `${LANG_NAMES[oldest.ed.lang]} edition not updated since ${oldYear}`,
        summary: `${LANG_NAMES[oldest.ed.lang]} Wikipedia has not been updated since ${oldYear}, while ${LANG_NAMES[newest.ed.lang]} Wikipedia was updated in ${newYear}.`,
        disputedSnippet: firstSentence(oldest.ed.extract, oldest.ed.title),
        highlightPhrase: null,
        sectionHeading: null,
        lineHint: 1,
        suggestedCorrection: `Outdated information: Review ${oldest.ed.lang.toUpperCase()} article against ${newest.ed.lang.toUpperCase()} (${newYear} revision).`,
        agreementMatrix: {
          consensusGroup: [newest.ed.lang],
          outlierGroup: [oldest.ed.lang],
          matrixLabel: `${newest.ed.lang.toUpperCase()} updated ${newYear} | ${oldest.ed.lang.toUpperCase()} last edited ${oldYear}`,
          claims,
        },
        citationGapFlag: false,
        donorLang: newest.ed.lang,
        severityScore: 72,
        confidenceLevel: 'medium',
        confidenceScore: 78,
        verifiedSources: [],
      });
      issueBadges.push(`Outdated information (${oldest.ed.lang.toUpperCase()})`);
    }
  }

  return {
    discrepancies,
    issueBadges,
    overallSummary:
      discrepancies[0]?.summary ||
      `Detected ${discrepancies.length} issue(s) across editions of ${canonicalLabel}.`,
  };
}

export async function searchLiveFromBrowser(query) {
  const q = query.trim();
  if (!q) return null;

  const [wdQids, ...wikiQidLists] = await Promise.all([
    searchWikidataEntities(q),
    ...SUPPORTED_LANGS.map((lang) => searchQidsOnWiki(lang, q)),
  ]);

  // Score Q-IDs by search rank & cross-wiki consensus so exact/top matches never get pushed out
  const qidScoreMap = new Map();
  const addScore = (qid, pts) => {
    if (!qid) return;
    qidScoreMap.set(qid, (qidScoreMap.get(qid) || 0) + pts);
  };

  wdQids.forEach((qid, idx) => addScore(qid, Math.max(4, 24 - idx * 2)));
  wikiQidLists.forEach((list, langIdx) => {
    const langCode = SUPPORTED_LANGS[langIdx];
    const langBoost = langCode === 'en' || langCode === 'fi' ? 1.3 : 1.0;
    list.forEach((qid, idx) => {
      addScore(qid, Math.round(Math.max(2, 16 - idx * 1.5) * langBoost));
    });
  });

  const uniqueQids = [...qidScoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([qid]) => qid);

  if (!uniqueQids.length) return [];

  const wdParams = new URLSearchParams({
    action: 'wbgetentities',
    ids: uniqueQids.join('|'),
    props: 'sitelinks|labels',
    sitefilter: 'fiwiki|svwiki|ruwiki|enwiki|etwiki|eswiki|zhwiki|plwiki|huwiki',
    languages: 'en|fi|sv|ru|et|es|zh|pl|hu',
    format: 'json',
    origin: '*',
  });

  const wdData = await fetchJsonFast(`https://www.wikidata.org/w/api.php?${wdParams}`, 4800);
  const entities = wdData?.entities || {};

  const candidates = [];
  for (const qid of uniqueQids) {
    const ent = entities[qid];
    if (!ent?.sitelinks) continue;

    const titles = {};
    let count = 0;
    let isDisambig = false;
    for (const lang of SUPPORTED_LANGS) {
      const t = ent.sitelinks[`${lang}wiki`]?.title || null;
      titles[lang] = t;
      if (t) {
        count++;
        if (DISAMBIG_RE.test(t)) isDisambig = true;
      }
    }
    if (count < 2 || isDisambig) continue;

    const label =
      ent.labels?.en?.value ||
      titles.en ||
      ent.labels?.fi?.value ||
      ent.labels?.sv?.value ||
      ent.labels?.et?.value ||
      ent.labels?.es?.value ||
      ent.labels?.zh?.value ||
      ent.labels?.pl?.value ||
      ent.labels?.hu?.value ||
      ent.labels?.ru?.value ||
      titles.fi ||
      titles.sv ||
      titles.et ||
      titles.es ||
      titles.zh ||
      titles.pl ||
      titles.hu ||
      titles.ru ||
      qid;

    if (DISAMBIG_RE.test(label)) continue;

    const titleMatchScore = computeQueryTitleMatchScore(q, label, titles);
    const isExactMatch =
      label.toLowerCase().trim() === q.toLowerCase() ||
      Object.values(titles).some((t) => t && t.toLowerCase().trim() === q.toLowerCase());
    const searchRankScore = qidScoreMap.get(qid) || 0;
    const relevanceScore = (isExactMatch ? 500 : 0) + titleMatchScore * 10 + searchRankScore;

    candidates.push({ qid, canonicalLabel: label, titles, relevanceScore, isExactMatch });
  }

  candidates.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const topCandidates = candidates.slice(0, 15);

  if (!topCandidates.length) return [];

  const batchMaps = await Promise.all(
    SUPPORTED_LANGS.map((lang) =>
      fetchBatchEditions(
        lang,
        topCandidates
          .filter((c) => c.titles[lang])
          .map((c) => ({ qid: c.qid, title: c.titles[lang] }))
      )
    )
  );

  const articles = [];
  for (const cand of topCandidates) {
    const edMap = new Map();
    SUPPORTED_LANGS.forEach((lang, idx) => {
      if (batchMaps[idx].has(cand.qid)) {
        edMap.set(lang, batchMaps[idx].get(cand.qid));
      }
    });
    if (edMap.size < 2) continue;

    if (!isTopicRelevantToQuery(q, cand.canonicalLabel, edMap)) continue;

    const scan = scanEditionsForIssues(cand.qid, cand.canonicalLabel, edMap);
    // Always keep exact title match as #1 even if no issues were detected;
    // for other related articles, only show those with detected issues.
    if (scan.discrepancies.length === 0 && !cand.isExactMatch) continue;

    const maxSev =
      scan.discrepancies.length > 0
        ? Math.max(...scan.discrepancies.map((d) => d.severityScore))
        : 0;
    const refs = [...edMap.values()].map((e) => e.refCount);
    const minRef = Math.min(...refs);

    const editionsSummary = {};
    for (const lang of SUPPORTED_LANGS) {
      const ed = edMap.get(lang);
      editionsSummary[lang] = {
        title: ed?.title || null,
        url: ed?.url || null,
        refCount: ed?.refCount ?? 0,
        lastRevAt: ed?.lastRevAt || null,
      };
    }

    const issueBonus = Math.min(20, Math.round((maxSev + Math.max(0, 20 - minRef)) * 0.18));
    const articleSummary = {
      qid: cand.qid,
      canonicalLabel: cand.canonicalLabel,
      editions: editionsSummary,
      editionCount: edMap.size,
      sourceCount: minRef,
      discrepancyCount: scan.discrepancies.length,
      discrepancySeverity: maxSev,
      issueBadges: scan.issueBadges,
      isExactMatch: cand.isExactMatch,
      priorityScore: (cand.isExactMatch ? 1000000 : 0) + cand.relevanceScore * 100 + issueBonus,
    };

    browserAnalysisCache.set(cand.qid, {
      article: articleSummary,
      overallSummary: scan.overallSummary,
      discrepancies: scan.discrepancies,
    });

    articles.push(articleSummary);
  }

  articles.sort((a, b) => b.priorityScore - a.priorityScore);
  return articles;
}

export function getCachedBrowserAnalysis(qid) {
  return browserAnalysisCache.get(qid) || null;
}

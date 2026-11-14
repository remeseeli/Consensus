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
};

const NPOV_TEMPLATE_RE = {
  fi: /\{\{\s*(?:neutraalius|pov|puolueellisuus|yksipuolinen|kansanvalta)\b[^}]*\}\}/i,
  sv: /\{\{\s*(?:pov|neutralitet|synvinkel|partisk|värdeord)\b[^}]*\}\}/i,
  ru: /\{\{\s*(?:нтз|нейтральность|ненейтральность|проверить нейтральность|реклама)\b[^}]*\}\}/i,
  en: /\{\{\s*(?:pov|neutrality|pov-section|pov statement|peacock|weasel|tone|advert)\b[^}]*\}\}/i,
  et: /\{\{\s*(?:neutraalsus|pov|vaidlustatud|erapoolik)\b[^}]*\}\}/i,
  es: /\{\{\s*(?:no neutral|pvn|discutido|publicidad|tono)\b[^}]*\}\}/i,
};

const EMOTIONAL_WORDS_RE = {
  en: /\b(catastrophic|disastrous|atrocious|barbaric|brutal|heroic|glorious|legendary|triumphant|devastating|horrific|evil|corrupt|infamous|notorious|shameful|scandalous|unforgivable|genius|masterpiece|undoubtedly|obviously|everyone knows|miraculous|treacherous|tyrannical|bloody|propaganda|pathetic|ridiculous)\b/gi,
  fi: /\b(katastrofaali\w*|julma\w*|barbaari\w*|sankarilli\w*|loistava\w*|neroka\w*|hirvittävä\w*|häpeälli\w*|skandaali\w*|korruptoitun\w*|järkyttävä\w*|tuhoisa\w*|pahamainei\w*|epäilemättä|luonnollisesti|ihmeelli\w*|hirmuhallinto\w*|petokselli\w*|verinen|propaganda\w*)\b/gi,
  sv: /\b(katastrofal\w*|barbarisk\w*|brutal\w*|hjältemodig\w*|ärorik\w*|fruktansvärd\w*|skandalös\w*|korrupt\w*|ökänd\w*|skamlig\w*|mästerverk|geni\w*|otvivelaktigt|självklart|tyrannisk\w*|förrädisk\w*|blodig\w*|propaganda\w*)\b/gi,
  ru: /\b(катастрофическ\w*|варварск\w*|жесток\w*|героическ\w*|славн\w*|чудовищн\w*|позорн\w*|скандальн\w*|коррумпирован\w*|злодейск\w*|гениальн\w*|шедевр\w*|бесспорно|очевидно|тираническ\w*|кровав\w*|вероломн\w*|пропаганд\w*)\b/gi,
  et: /\b(katastroofili\w*|barbaar\w*|julm\w*|kangelaslik\w*|hiilgav\w*|kohutav\w*|häbiväär\w*|skandaal\w*|korrumpeerun\w*|kuritegelik\w*|geniaal\w*|meistriteos\w*|kahtlemata|türannia\w*|verine\w*|reeturlik\w*|propaganda\w*)\b/gi,
  es: /\b(catastrófic\w*|bárbar\w*|brutal\w*|heroic\w*|glorios\w*|horrible\w*|vergonzos\w*|escandalos\w*|corrupt\w*|infame\w*|notori\w*|genial\w*|obra maestra|indudablemente|obviamente|tiránic\w*|sangrient\w*|traicioner\w*|propaganda)\b/gi,
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
    gsrlimit: '8',
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
        ? NPOV_TEMPLATE_RE[lang].test(wikitext.slice(0, 4000))
        : false;

      out.set(qid, {
        qid,
        lang,
        title: page.title,
        url: buildWikiUrl(lang, page.title),
        extract: (page.extract || '').trim(),
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
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 16);
}

function firstSentence(text, fallbackTitle) {
  const list = splitSentences(text);
  return list[0] || fallbackTitle;
}

function extractYearsAndFigures(text) {
  const lead = (text || '').slice(0, 1500);
  const years = new Set();
  const yearMatches = lead.match(/\b(1[5-9]\d{2}|20[0-2]\d)\b/g) || [];
  for (const y of yearMatches) years.add(y);

  const figures = new Map();
  const sents = splitSentences(lead);
  const numRe = /\b\d{1,3}(?:[\s\u00a0.,]\d{3})+\b|\b\d{3,7}\b/g;
  for (const s of sents) {
    const matches = s.match(numRe) || [];
    for (const raw of matches) {
      const digits = raw.replace(/[^\d]/g, '');
      const val = Number(digits);
      if (val >= 1500 && val <= 2035 && raw.length === 4) continue;
      if (digits.length >= 3 && !figures.has(digits)) {
        figures.set(digits, { raw: raw.trim(), sentence: s });
      }
    }
  }
  return { years, figures, sents };
}

function detectEmotionalNeutralityIssue(ed) {
  const sents = splitSentences(ed.extract);
  const wordRe = EMOTIONAL_WORDS_RE[ed.lang];
  let bestSentence = null;
  let bestWords = [];
  let totalHits = 0;

  for (const s of sents.slice(0, 10)) {
    const matches = wordRe ? s.match(new RegExp(wordRe.source, 'gi')) || [] : [];
    const hasExclamation = /!(?:\s|$)/.test(s);
    const score = matches.length + (hasExclamation ? 1 : 0);
    totalHits += matches.length;
    if (score > bestWords.length) {
      bestWords = [...new Set(matches.map((m) => m.trim()))];
      bestSentence = s;
    }
  }

  if (ed.hasNpovTemplate || totalHits >= 2 || bestWords.length >= 2) {
    return {
      hasIssue: true,
      hasNpovTemplate: ed.hasNpovTemplate,
      emotionalTerms: bestWords,
      sentence: bestSentence || firstSentence(ed.extract, ed.title),
      highlightPhrase: bestWords[0] || null,
    };
  }
  return { hasIssue: false };
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

      const outlierOtherYears = [...parsed[outlier].years].filter(
        (y) => !presentIn.some((p) => parsed[p].years.has(y))
      );
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

  // Conflicting multi-digit statistics/figures if no year conflict was emitted
  if (!foundFactDiff) {
    const langsWithFigs = langs.filter((l) => parsed[l].figures.size > 0);
    if (langsWithFigs.length >= 2) {
      const sortedFigs = langsWithFigs
        .map((l) => editionsMap.get(l))
        .sort((a, b) => a.refCount - b.refCount);
      const targetEd = sortedFigs[0];
      const donorEd = sortedFigs[sortedFigs.length - 1];
      const targetKeys = [...parsed[targetEd.lang].figures.keys()];
      const shared = targetKeys.some((k) => parsed[donorEd.lang].figures.has(k));

      if (!shared) {
        const targetEntry = [...parsed[targetEd.lang].figures.values()][0];
        const donorEntry = [...parsed[donorEd.lang].figures.values()][0];

        const claims = buildClaimsMatrix(editionsMap, (code, ed) => {
          const firstFig = [...parsed[code].figures.values()][0];
          return {
            value: firstFig
              ? `${firstFig.raw} — "${firstFig.sentence.slice(0, 80)}"`
              : `No matching figure in lead (${ed.refCount} refs)`,
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
  for (const l of langs) {
    const ed = editionsMap.get(l);
    const pov = detectEmotionalNeutralityIssue(ed);
    if (pov.hasIssue) {
      const reasonText = pov.hasNpovTemplate
        ? `Wikipedia editors flagged this ${LANG_NAMES[l]} article with a Neutrality / POV warning template${pov.emotionalTerms.length ? ` and emotional wording (${pov.emotionalTerms.join(', ')})` : ''}.`
        : `${LANG_NAMES[l]} Wikipedia uses highly emotional or non-neutral wording (${pov.emotionalTerms.join(', ')}).`;

      const claims = buildClaimsMatrix(editionsMap, (code, otherEd) => {
        const otherPov = detectEmotionalNeutralityIssue(otherEd);
        return {
          value: otherPov.hasIssue
            ? `Non-neutral / emotional wording${otherPov.emotionalTerms?.length ? `: "${otherPov.emotionalTerms.join(', ')}"` : ' (POV tag)'}`
            : `Neutral encyclopedic tone (${otherEd.refCount} refs)`,
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
      break;
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

  const qidLists = await Promise.all(
    SUPPORTED_LANGS.map((lang) => searchQidsOnWiki(lang, q))
  );

  const uniqueQids = [];
  const seen = new Set();
  const maxLen = Math.max(...qidLists.map((l) => l.length));
  for (let i = 0; i < maxLen && uniqueQids.length < 15; i++) {
    for (const arr of qidLists) {
      const id = arr[i];
      if (id && !seen.has(id)) {
        seen.add(id);
        uniqueQids.push(id);
        if (uniqueQids.length >= 15) break;
      }
    }
  }

  if (!uniqueQids.length) return [];

  const wdParams = new URLSearchParams({
    action: 'wbgetentities',
    ids: uniqueQids.join('|'),
    props: 'sitelinks|labels',
    sitefilter: 'fiwiki|svwiki|ruwiki|enwiki|etwiki|eswiki',
    languages: 'en|fi|sv|ru|et|es',
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
    for (const lang of SUPPORTED_LANGS) {
      const t = ent.sitelinks[`${lang}wiki`]?.title || null;
      titles[lang] = t;
      if (t) count++;
    }
    if (count < 2) continue;

    const label =
      ent.labels?.en?.value ||
      titles.en ||
      ent.labels?.fi?.value ||
      ent.labels?.sv?.value ||
      ent.labels?.et?.value ||
      ent.labels?.es?.value ||
      ent.labels?.ru?.value ||
      titles.fi ||
      titles.sv ||
      titles.et ||
      titles.es ||
      titles.ru ||
      qid;

    candidates.push({ qid, canonicalLabel: label, titles });
  }

  if (!candidates.length) return [];

  const batchMaps = await Promise.all(
    SUPPORTED_LANGS.map((lang) =>
      fetchBatchEditions(
        lang,
        candidates.filter((c) => c.titles[lang]).map((c) => ({ qid: c.qid, title: c.titles[lang] }))
      )
    )
  );

  const articles = [];
  for (const cand of candidates) {
    const edMap = new Map();
    SUPPORTED_LANGS.forEach((lang, idx) => {
      if (batchMaps[idx].has(cand.qid)) {
        edMap.set(lang, batchMaps[idx].get(cand.qid));
      }
    });
    if (edMap.size < 2) continue;

    const scan = scanEditionsForIssues(cand.qid, cand.canonicalLabel, edMap);
    if (scan.discrepancies.length === 0) continue;

    const maxSev = Math.max(...scan.discrepancies.map((d) => d.severityScore));
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

    const articleSummary = {
      qid: cand.qid,
      canonicalLabel: cand.canonicalLabel,
      editions: editionsSummary,
      editionCount: edMap.size,
      sourceCount: minRef,
      discrepancyCount: scan.discrepancies.length,
      discrepancySeverity: maxSev,
      issueBadges: scan.issueBadges,
      priorityScore: maxSev + Math.max(0, 20 - minRef),
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

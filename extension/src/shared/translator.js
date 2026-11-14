/**
 * Lightweight client-side English translator for highlighted non-English Wikipedia phrases.
 * Uses an instant offline dictionary for common loaded terms + live Google Translate / MyMemory fallback.
 */

const translationCache = new Map();

const OFFLINE_TERM_GLOSSARY = [
  // Finnish
  ['katastrofaali', 'catastrophic'],
  ['julma', 'cruel / brutal'],
  ['julmuuks', 'atrocities'],
  ['barbaari', 'barbaric'],
  ['sankarilli', 'heroic'],
  ['hirvittävä', 'horrific'],
  ['häpeälli', 'shameful'],
  ['skandaali', 'scandalous'],
  ['korruptoitun', 'corrupt'],
  ['järkyttävä', 'shocking'],
  ['tuhoisa', 'devastating'],
  ['pahamainei', 'infamous / notorious'],
  ['hirmuhallinto', 'reign of terror / tyranny'],
  ['petokselli', 'treacherous'],
  ['verinen', 'bloody'],
  ['propaganda', 'propaganda'],
  ['terroristi', 'terrorist'],
  ['sotarikolli', 'war criminal'],
  ['petturi', 'traitor'],
  ['murhaaja', 'murderer'],
  ['joukkomurha', 'massacre / mass murder'],

  // Swedish
  ['katastrofal', 'catastrophic'],
  ['barbarisk', 'barbaric'],
  ['brutal', 'brutal'],
  ['hjältemodig', 'heroic'],
  ['fruktansvärd', 'horrific'],
  ['skandalös', 'scandalous'],
  ['korrupt', 'corrupt'],
  ['ökänd', 'notorious'],
  ['skamlig', 'shameful'],
  ['tyrannisk', 'tyrannical'],
  ['förrädisk', 'treacherous'],
  ['blodig', 'bloody'],
  ['krigsförbryt', 'war criminal'],
  ['förrädare', 'traitor'],
  ['mördare', 'murderer'],
  ['massaker', 'massacre'],
  ['grymhet', 'atrocity / cruelty'],

  // Russian
  ['катастрофическ', 'catastrophic'],
  ['варварск', 'barbaric'],
  ['жесток', 'cruel / brutal'],
  ['героическ', 'heroic'],
  ['героизаци', 'glorification'],
  ['чудовищн', 'monstrous'],
  ['бесчеловечн', 'inhumane'],
  ['позорн', 'shameful'],
  ['скандальн', 'scandalous'],
  ['коррумпирован', 'corrupt'],
  ['злодейск', 'villainous'],
  ['злодеяни', 'atrocities / misdeeds'],
  ['зверств', 'atrocities'],
  ['тираническ', 'tyrannical'],
  ['кровав', 'bloody'],
  ['вероломн', 'treacherous'],
  ['пропаганд', 'propaganda'],
  ['террорист', 'terrorist'],
  ['террор', 'terror'],
  ['каратель', 'punitive / executioner'],
  ['пособник', 'collaborator'],
  ['преступн', 'criminal'],
  ['предател', 'traitor'],
  ['палач', 'executioner'],
  ['убийц', 'murderer'],
  ['резн', 'massacre / slaughter'],
  ['расправ', 'reprisal / massacre'],
  ['марионеточн', 'puppet (regime)'],
  ['экстремист', 'extremist'],
  ['фанатик', 'fanatic'],
  ['фашистск', 'fascist'],
  ['нацистск', 'Nazi'],
  ['ультранационалист', 'ultranationalist'],
  ['оккупант', 'occupier'],
  ['агрессор', 'aggressor'],

  // Estonian
  ['katastroofili', 'catastrophic'],
  ['barbaar', 'barbaric'],
  ['julm', 'cruel'],
  ['kangelaslik', 'heroic'],
  ['kohutav', 'horrific'],
  ['häbiväär', 'shameful'],
  ['kuritegelik', 'criminal'],
  ['türannia', 'tyranny'],
  ['verine', 'bloody'],
  ['reeturlik', 'treacherous'],
  ['sõjakurjategi', 'war criminal'],
  ['reetur', 'traitor'],
  ['mõrvar', 'murderer'],
  ['veresaun', 'massacre / bloodbath'],

  // Spanish
  ['catastrófic', 'catastrophic'],
  ['bárbar', 'barbaric'],
  ['heroic', 'heroic'],
  ['glorios', 'glorious'],
  ['vergonzos', 'shameful'],
  ['escandalos', 'scandalous'],
  ['corrupt', 'corrupt'],
  ['infame', 'infamous'],
  ['notori', 'notorious'],
  ['tiránic', 'tyrannical'],
  ['sangrient', 'bloody'],
  ['traicioner', 'treacherous'],
  ['criminal de guerra', 'war criminal'],
  ['masacre', 'massacre'],
  ['atrocidad', 'atrocity'],

  // Chinese
  ['灾难性', 'catastrophic'],
  ['残暴', 'brutal'],
  ['野蛮', 'barbaric'],
  ['英雄般', 'heroic'],
  ['辉煌', 'glorious'],
  ['可耻', 'shameful'],
  ['丑闻', 'scandal'],
  ['腐败', 'corrupt'],
  ['臭名昭著', 'notorious'],
  ['暴政', 'tyranny'],
  ['血腥', 'bloody'],
  ['宣传', 'propaganda'],
  ['恐怖分子', 'terrorist'],
  ['战犯', 'war criminal'],
  ['极端主义', 'extremism'],
  ['大屠杀', 'massacre'],
  ['暴行', 'atrocities'],
  ['傀儡政权', 'puppet regime'],
  ['叛徒', 'traitor'],

  // Polish
  ['katastrofaln', 'catastrophic'],
  ['barbarzyń', 'barbaric'],
  ['brutaln', 'brutal'],
  ['bohatersk', 'heroic'],
  ['haniebn', 'shameful'],
  ['skandaliczn', 'scandalous'],
  ['skorumpowan', 'corrupt'],
  ['zbrodnicz', 'criminal'],
  ['zbrodni', 'crime / atrocity'],
  ['okrutn', 'cruel'],
  ['okrucieństw', 'cruelty / atrocity'],
  ['ludobójstw', 'genocide'],
  ['rzeź', 'massacre / slaughter'],
  ['rzezi', 'massacre / slaughter'],
  ['terroryst', 'terrorist'],
  ['kolaborant', 'collaborator'],
  ['zdrajc', 'traitor'],
  ['morderc', 'murderer'],
  ['propagand', 'propaganda'],
  ['ekstremist', 'extremist'],
  ['krwaw', 'bloody'],
  ['tyran', 'tyrant'],
  ['nazistowsk', 'Nazi'],
  ['faszystowsk', 'fascist'],
];

export function lookupOfflineTermTranslation(text) {
  const lower = (text || '').trim().toLowerCase();
  if (!lower) return null;

  for (const [stem, gloss] of OFFLINE_TERM_GLOSSARY) {
    if (lower === stem || lower.startsWith(stem)) {
      return gloss;
    }
  }
  return null;
}

function mapLangCode(lang) {
  if (!lang) return 'auto';
  if (lang === 'zh') return 'zh-CN';
  return lang;
}

export async function translateToEnglish(text, sourceLang) {
  const raw = (text || '').trim();
  if (!raw || sourceLang === 'en') return null;

  const cacheKey = `${sourceLang || 'auto'}:${raw}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const sl = mapLangCode(sourceLang);
  const clipped = raw.slice(0, 400);

  // 1. Google Translate public GTX endpoint
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
      sl
    )}&tl=en&dt=t&q=${encodeURIComponent(clipped)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.[0])) {
        const translated = data[0]
          .map((seg) => (Array.isArray(seg) ? seg[0] : ''))
          .join('')
          .trim();
        if (translated && translated.toLowerCase() !== clipped.toLowerCase()) {
          translationCache.set(cacheKey, translated);
          return translated;
        }
      }
    }
  } catch {
    // Fall through to secondary translator / offline glossary
  }

  // 2. MyMemory fallback
  try {
    const pairLang = sourceLang === 'zh' ? 'zh-CN' : sourceLang || 'auto';
    if (pairLang !== 'auto') {
      const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        clipped
      )}&langpair=${encodeURIComponent(`${pairLang}|en`)}`;
      const res = await fetch(mmUrl, { signal: AbortSignal.timeout(3500) });
      if (res.ok) {
        const data = await res.json();
        const translated = data?.responseData?.translatedText?.trim();
        if (translated && translated.toLowerCase() !== clipped.toLowerCase()) {
          translationCache.set(cacheKey, translated);
          return translated;
        }
      }
    }
  } catch {
    // Fall through to offline glossary
  }

  const glossary = lookupOfflineTermTranslation(raw);
  if (glossary) {
    translationCache.set(cacheKey, glossary);
    return glossary;
  }

  return null;
}

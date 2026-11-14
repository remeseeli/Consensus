export const DEFAULT_API_BASE_URL = 'http://localhost:4000/api';

export const SUPPORTED_LANGS = [
  'de',
  'en',
  'es',
  'et',
  'fi',
  'fr',
  'hu',
  'it',
  'ja',
  'no',
  'pl',
  'pt',
  'ru',
  'sv',
  'tr',
  'uk',
  'zh',
];

export const LANG_FLAG_SVGS = {
  de: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="4" fill="#000"/><rect y="4" width="18" height="4" fill="#dd0000"/><rect y="8" width="18" height="4" fill="#ffce00"/></svg>',
  en: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="12" fill="#012169"/><path d="M0,0 L18,12 M18,0 L0,12" stroke="#fff" stroke-width="2.2"/><path d="M0,0 L18,12 M18,0 L0,12" stroke="#c8102e" stroke-width="1"/><path d="M9,0 V12 M0,6 H18" stroke="#fff" stroke-width="3.6"/><path d="M9,0 V12 M0,6 H18" stroke="#c8102e" stroke-width="2"/></svg>',
  es: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="3" fill="#aa151b"/><rect y="3" width="18" height="6" fill="#f1bf00"/><rect y="9" width="18" height="3" fill="#aa151b"/><rect x="4.2" y="4.4" width="2.2" height="3.2" fill="#aa151b"/></svg>',
  et: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="4" fill="#0072ce"/><rect y="4" width="18" height="4" fill="#000"/><rect y="8" width="18" height="4" fill="#fff"/></svg>',
  fi: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="12" fill="#fff"/><rect x="5" width="3" height="12" fill="#003580"/><rect y="4.5" width="18" height="3" fill="#003580"/></svg>',
  fr: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="6" height="12" fill="#0055a4"/><rect x="6" width="6" height="12" fill="#fff"/><rect x="12" width="6" height="12" fill="#ef4135"/></svg>',
  hu: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="4" fill="#cd2a3e"/><rect y="4" width="18" height="4" fill="#fff"/><rect y="8" width="18" height="4" fill="#436f4d"/></svg>',
  it: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="6" height="12" fill="#009246"/><rect x="6" width="6" height="12" fill="#fff"/><rect x="12" width="6" height="12" fill="#ce2b37"/></svg>',
  ja: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="12" fill="#fff"/><circle cx="9" cy="6" r="3.4" fill="#bc002d"/></svg>',
  no: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="12" fill="#ba0c2f"/><rect x="5" width="3.2" height="12" fill="#fff"/><rect y="4.4" width="18" height="3.2" fill="#fff"/><rect x="5.8" width="1.6" height="12" fill="#00205b"/><rect y="5.2" width="18" height="1.6" fill="#00205b"/></svg>',
  pl: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="6" fill="#fff"/><rect y="6" width="18" height="6" fill="#dc143c"/></svg>',
  pt: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="7" height="12" fill="#006600"/><rect x="7" width="11" height="12" fill="#ff0000"/><circle cx="7" cy="6" r="2.2" fill="#ffcc00"/></svg>',
  ru: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="4" fill="#fff"/><rect y="4" width="18" height="4" fill="#0039a6"/><rect y="8" width="18" height="4" fill="#d52b1e"/></svg>',
  sv: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="12" fill="#006aa7"/><rect x="5" width="2.5" height="12" fill="#fecc00"/><rect y="4.75" width="18" height="2.5" fill="#fecc00"/></svg>',
  tr: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="12" fill="#e30a17"/><circle cx="7.4" cy="6" r="2.9" fill="#fff"/><circle cx="8.3" cy="6" r="2.3" fill="#e30a17"/><polygon points="11.2,4.5 11.7,5.7 13,5.7 12,6.4 12.3,7.6 11.2,6.9 10.2,7.6 10.5,6.4 9.5,5.7 10.8,5.7" fill="#fff"/></svg>',
  uk: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="6" fill="#0057b7"/><rect y="6" width="18" height="6" fill="#ffd700"/></svg>',
  zh: '<svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true"><rect width="18" height="12" fill="#de2910"/><polygon points="3.5,1.8 4.1,3.5 5.9,3.5 4.4,4.5 5,6.2 3.5,5.1 2,6.2 2.6,4.5 1.1,3.5 2.9,3.5" fill="#ffde00"/></svg>',
};

export const LANG_NAMES = {
  de: 'German',
  en: 'English',
  es: 'Spanish',
  et: 'Estonian',
  fi: 'Finnish',
  fr: 'French',
  hu: 'Hungarian',
  it: 'Italian',
  ja: 'Japanese',
  no: 'Norwegian',
  pl: 'Polish',
  pt: 'Portuguese',
  ru: 'Russian',
  sv: 'Swedish',
  tr: 'Turkish',
  uk: 'Ukrainian',
  zh: 'Chinese',
};

const intlLangNames =
  typeof Intl !== 'undefined' && Intl.DisplayNames
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;

export function getLangDisplayName(code) {
  if (!code) return '';
  const lower = code.toLowerCase();
  if (LANG_NAMES[lower]) return LANG_NAMES[lower];
  try {
    const resolved = intlLangNames ? intlLangNames.of(lower) : null;
    if (resolved && resolved.toLowerCase() !== lower) return resolved;
  } catch {
    // Ignore unsupported subtags
  }
  return code.toUpperCase();
}

export const LANG_LABELS = {
  fi: 'Finnish (FI)',
  sv: 'Swedish (SV)',
  ru: 'Russian (RU)',
  en: 'English (EN)',
  et: 'Estonian (ET)',
  es: 'Spanish (ES)',
  zh: 'Chinese (ZH)',
  pl: 'Polish (PL)',
  hu: 'Hungarian (HU)',
};

export const TEMPLATE_TYPE_HINTS = {
  fi: '{{Kirjaviite}} / {{Lehtiviite}} / {{Verkkoviite}}',
  sv: '{{Bokref}} / {{Tidskriftsref}} / {{Webbref}}',
  ru: '{{Статья}} / {{Книга}} / {{Cite web}}',
  en: '{{Cite journal}} / {{Cite book}} / {{Cite web}}',
  et: '{{Netiviide}} / {{Raamatuviide}} / {{Cite journal}}',
  es: '{{Cita web}} / {{Cita libro}} / {{Cita publicación}}',
  zh: '{{Cite journal}} / {{Cite book}} / {{Cite web}}',
  pl: '{{Cytuj stronę}} / {{Cytuj książkę}} / {{Cytuj pismo}}',
  hu: '{{CitWeb}} / {{CitLib}} / {{CitPer}}',
};

export const MISMATCH_LABELS = {
  hard_fact: 'Different information',
  missing_citation: 'Much fewer references',
  outdated_data: 'Outdated information',
  neutrality_bias: 'Not neutral (emotional tone)',
};

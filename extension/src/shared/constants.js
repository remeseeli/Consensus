export const DEFAULT_API_BASE_URL = 'http://localhost:4000/api';

export const SUPPORTED_LANGS = ['fi', 'sv', 'ru', 'en', 'et', 'es', 'zh', 'pl', 'hu'];

export const LANG_NAMES = {
  fi: 'Finnish',
  sv: 'Swedish',
  ru: 'Russian',
  en: 'English',
  et: 'Estonian',
  es: 'Spanish',
  zh: 'Chinese',
  pl: 'Polish',
  hu: 'Hungarian',
};

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

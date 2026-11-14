export const DEFAULT_API_BASE_URL = 'http://localhost:4000/api';

export const LANG_LABELS = {
  fi: 'Finnish (FI)',
  sv: 'Swedish (SV)',
  ru: 'Russian (RU)',
  en: 'Standard English Template',
};

export const TEMPLATE_TYPE_HINTS = {
  fi: '{{Kirjaviite}} / {{Lehtiviite}} / {{Verkkoviite}}',
  sv: '{{Bokref}} / {{Tidskriftsref}} / {{Webbref}}',
  ru: '{{Статья}} / {{Книга}} / {{Cite web}}',
  en: '{{Cite journal}} / {{Cite book}}',
};

export const MISMATCH_LABELS = {
  hard_fact: 'Hard Fact Conflict',
  missing_citation: 'Missing Citation',
  outdated_data: 'Outdated Data',
};

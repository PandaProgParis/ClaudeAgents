/**
 * Chaînes runtime fr/en. Module pur (importable par la webview) ; les chaînes du
 * manifeste passent, elles, par package.nls*.json (mécanique VSCode standard).
 */

export type Locale = 'fr' | 'en';

/** Locale d'affichage à partir de vscode.env.language ; anglais en repli. */
export function resolveLocale(language: string): Locale {
  return language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export interface LocaleStrings {
  /** Message d'état vide de la vue. */
  empty: string;
  /** Repli quand une question en attente n'a pas de texte extractible. */
  waiting: string;
  /** Habillage d'une durée en temps relatif (« il y a 3 min » / « 3 min ago »). */
  relative: (duration: string) => string;
  /** Verbes d'activité (picto inclus), par famille d'outil. */
  verbs: {
    edit: string;
    run: string;
    read: string;
    search: string;
    web: string;
    delegate: string;
    question: string;
  };
}

export const STRINGS: Record<Locale, LocaleStrings> = {
  fr: {
    empty: 'Aucune session Claude en cours.',
    waiting: 'attend une réponse',
    relative: (duration) => `il y a ${duration}`,
    verbs: {
      edit: '✎ édite',
      run: '⏵ commande',
      read: '📖 lit',
      search: '🔍 cherche',
      web: '🌐 web',
      delegate: '🤖 délègue',
      question: '⏳ question',
    },
  },
  en: {
    empty: 'No Claude session running.',
    waiting: 'waiting for an answer',
    relative: (duration) => `${duration} ago`,
    verbs: {
      edit: '✎ editing',
      run: '⏵ running',
      read: '📖 reading',
      search: '🔍 searching',
      web: '🌐 web',
      delegate: '🤖 delegating',
      question: '⏳ question',
    },
  },
};

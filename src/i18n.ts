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
  /** Infobulle du badge de l'icône de la barre d'activité : nombre de sessions bloquées sur une question. */
  waitingBadge: (count: number) => string;
  /** Verbe de l'agent principal quand le modèle génère (aucun outil en cours). */
  thinking: string;
  /** Infobulle de l'icône d'une commande de fond. */
  backgroundTask: string;
  /** Détail déplié d'un workflow : « 2 agents », « Phases prévues ». */
  agentCount: (count: number) => string;
  phases: string;
  /** État d'un agent en échec (infobulle d'un carré). */
  failed: string;
  /** Compteurs de la ligne d'un workflow : « 3 en cours », « 1 en échec ». */
  running: (count: number) => string;
  failedCount: (count: number) => string;
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
    waitingBadge: (count) => (count === 1 ? '1 session attend une réponse' : `${count} sessions attendent une réponse`),
    thinking: '💭 réfléchit',
    backgroundTask: 'tâche en arrière-plan',
    agentCount: (count) => (count === 1 ? '1 agent' : `${count} agents`),
    phases: 'Phases prévues',
    failed: 'en échec',
    running: (count) => `${count} en cours`,
    failedCount: (count) => `${count} en échec`,
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
    waitingBadge: (count) =>
      count === 1 ? '1 session is waiting for your answer' : `${count} sessions are waiting for your answer`,
    thinking: '💭 thinking',
    backgroundTask: 'background task',
    agentCount: (count) => (count === 1 ? '1 agent' : `${count} agents`),
    phases: 'Planned phases',
    failed: 'failed',
    running: (count) => `${count} running`,
    failedCount: (count) => `${count} failed`,
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

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
  /** Encart de notation ancré en haut de la vue : messages tirés au hasard, salutation selon l'heure, infobulle des étoiles. */
  ratePhrases: string[];
  rateGreeting: (hour: number) => string;
  rateStars: (count: number) => string;
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
    ratePhrases: [
      'Sois sympa, mets une étoile ⭐',
      'Un câlin ? 🤗',
      'Fais une pause ☕',
      'Toi + 5 étoiles = ❤️',
      'Codé avec amour — rends-le-moi',
      'Nourris le panda, une étoile 🐼',
      'Un clic, un sourire 🙂',
      'Toujours là ? Coucou 👋',
      'Ça vaut une étoile ? ⭐',
      'Ça te plaît ? Prouve-le 😉',
      'Les pandas adorent les étoiles 🐼',
      'Un café ? Une étoile suffit ☕',
    ],
    rateGreeting: (hour) => (hour < 6 ? 'Encore debout ? 🌙' : hour < 12 ? 'Bonjour ☀️' : hour < 18 ? 'Bon après-midi 👋' : 'Bonsoir 🌙'),
    rateStars: (count) => (count === 1 ? 'Mettre 1 étoile sur le Marketplace' : `Mettre ${count} étoiles sur le Marketplace`),
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
    ratePhrases: [
      'Be nice, like me ⭐',
      'Send me a hug 🤗',
      'Take a break ☕',
      'You + 5 stars = ❤️',
      'Made with love — rate it back',
      'Feed the panda, drop a star 🐼',
      'One click, one smile 🙂',
      'Still watching? Say hi 👋',
      'Worth a star? ⭐',
      'Like it? Prove it 😉',
      'Pandas love stars 🐼',
      "Coffee's on you? A star will do ☕",
    ],
    rateGreeting: (hour) => (hour < 6 ? 'Still up? 🌙' : hour < 12 ? 'Good morning ☀️' : hour < 18 ? 'Good afternoon 👋' : 'Good evening 🌙'),
    rateStars: (count) => (count === 1 ? 'Rate 1 star on the Marketplace' : `Rate ${count} stars on the Marketplace`),
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

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
  agentType: (type: string) => string;
  phases: string;
  /** État d'un agent en échec (infobulle d'un carré). */
  failed: string;
  /** Compteurs de la ligne d'un workflow : « 3 en cours », « 1 en échec ». */
  running: (count: number) => string;
  failedCount: (count: number) => string;
  /** Bloc des tâches d'un plan exécuté en subagent-driven development. */
  sddTask: (number: number, title?: string) => string;
  sddStates: Record<'done' | 'doing' | 'review' | 'pending', string>;
  /** Bandeau « 1 en revue » : implémentation rendue, achèvement non attesté. */
  sddInReview: (count: number) => string;
  sddArtifacts: Record<'brief' | 'report' | 'review', string>;
  sddFix: (round: number) => string;
  sddCount: (done: number, total?: number) => string;
  /** Infobulle du ✓ d'un plan fini. */
  sddFinished: string;
  /** Intitulé du bloc, et son infobulle : nom du plan et origine des tâches. */
  sddLabel: string;
  sddPlanTitle: (plan: string) => string;
  /** Historique des plans du dossier : flèches, ligne d'accès quand aucun plan n'est affiché, date d'un ancien plan. */
  sddPrevious: string;
  sddNext: string;
  sddNoPrevious: string;
  sddNoNext: string;
  sddTokensTotal: (tokens: string) => string;
  sddHistory: (count: number) => string;
  sddUpdated: (at: number) => string;
  sddUpdatedTitle: string;
  /** Carte des agents : « 5 terminés », « 98 outils » (infobulle), croix de repli. */
  finishedCount: (count: number) => string;
  toolUses: (count: number) => string;
  mapClose: string;
  /** Cache d'invite, règle et libellés de Claude Code : chaud avec minutes restantes, probablement expiré, compacté. */
  cacheWarm: (minutes: number) => string;
  cacheCold: (idle: string) => string;
  cacheCompacted: string;
  /** Card des limites du forfait, ancrée en bas de la vue. */
  usageTitle: string;
  usageSession: string;
  usageWeeklyAll: string;
  usageWeeklyScoped: (model: string) => string;
  /** Libellés courts des jauges de la card réduite, où 5h et hebdo tiennent sur une ligne. */
  usageSessionShort: string;
  usageWeeklyAllShort: string;
  usageResets: (duration: string) => string;
  /** Fraîcheur du fichier : discrète quand il est récent, alertée quand il a vieilli. */
  usageUpdated: (duration: string) => string;
  usageStale: (duration: string) => string;
  /** Card pointillée affichée quand le fichier manque : dit quoi faire. */
  usageHelp: string;
  usageHelpPath: string;
  /** Infobulle de la croix qui masque l'invitation (et décoche le réglage). */
  usageDismiss: string;
  usageCollapse: string;
  usageExpand: string;
  usageSettings: string;
  /** Lien vers l'outil qui écrit le fichier d'usage (dépôt ClaudeUsage). */
  usageRepo: string;
  /** Usage dans la barre d'état : libellés, hebdo en jours + heures, infobulle et menu d'affichage. */
  statusSession: string;
  statusWeekly: string;
  statusDays: (days: number, hours: string) => string;
  statusTitle: string;
  statusOpenView: string;
  statusMenu: string;
  statusText: string;
  statusRings: string;
  statusHide: string;
  statusMoveLeft: string;
  statusMoveRight: string;
  statusOnRight: string;
  statusOnLeft: string;
  statusCard: string;
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

function pad2(value: number): string {
  return String(value).padStart(2, '0');
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
    agentType: (type) => `type : ${type}`,
    phases: 'Phases prévues',
    failed: 'en échec',
    running: (count) => `${count} en cours`,
    failedCount: (count) => `${count} en échec`,
    finishedCount: (count) => (count === 1 ? '1 terminé' : `${count} terminés`),
    toolUses: (count) => (count === 1 ? '1 outil' : `${count} outils`),
    sddTask: (number, title) => (title === undefined ? `Tâche ${number}` : `Tâche ${number} : ${title}`),
    sddStates: { done: 'terminée', doing: 'en cours', review: 'en revue', pending: 'à faire' },
    sddInReview: (count) => `${count} en revue`,
    sddArtifacts: { brief: 'brief', report: 'rapport', review: 'revue' },
    sddFix: (round) => `correction ${round}`,
    sddCount: (done, total) => (total === undefined ? `${done} faite${done > 1 ? 's' : ''}` : `${done}/${total}`),
    sddFinished: 'Plan terminé — revue finale présente',
    sddLabel: 'Plan',
    sddPlanTitle: (plan) => `${plan} — plan exécuté par sous-agents (superpowers)`,
    sddPrevious: 'Plan précédent',
    sddNext: 'Plan suivant',
    sddNoPrevious: 'Aucun plan précédent',
    sddNoNext: 'Aucun plan plus récent',
    sddTokensTotal: (tokens) => `${tokens} jetons cumulés`,
    sddHistory: (count) => (count === 1 ? '1 plan' : `${count} plans`),
    sddUpdated: (at) => {
      const date = new Date(at);
      return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    },
    sddUpdatedTitle: 'Dernière écriture du plan',
    mapClose: 'Replier la carte des agents',
    cacheWarm: (minutes) => `Cache d’invite chaud, encore ${minutes} min`,
    cacheCold: (idle) => `Cache d’invite probablement expiré · inactif depuis ${idle}`,
    cacheCompacted: 'Cache d’invite sans effet : conversation compactée',
    usageTitle: 'USAGE',
    usageSession: 'Session (5h)',
    usageWeeklyAll: 'Hebdo — tous modèles',
    usageWeeklyScoped: (model) => `Hebdo — ${model}`,
    usageSessionShort: '5h',
    usageWeeklyAllShort: 'Hebdo',
    usageResets: (duration) => `réinit. ${duration}`,
    usageUpdated: (duration) => `maj il y a ${duration}`,
    usageStale: (duration) => `⚠ chiffres vieux de ${duration}`,
    usageHelp: 'Écrivez régulièrement le contenu de claude.ai/usage dans ce fichier :',
    usageHelpPath: 'Chemin à renseigner dans le réglage claudeAgents.usageFile',
    usageDismiss: 'Masquer cet encart',
    usageCollapse: 'Réduire',
    usageExpand: 'Déplier',
    usageSettings: 'Réglages de l’usage',
    usageRepo: 'L’outil qui l’écrit pour vous : ClaudeUsage ↗',
    statusSession: 'Session',
    statusWeekly: 'Hebdo',
    statusDays: (days, hours) => `${days}j ${hours}h`,
    statusTitle: 'Usage Claude',
    statusOpenView: 'Cliquer pour ouvrir Claude Agents',
    statusMenu: 'Affichage de l’usage',
    statusText: 'Texte',
    statusRings: 'Anneaux',
    statusHide: 'Masquer de la barre d’état',
    statusMoveLeft: 'Placer à gauche',
    statusMoveRight: 'Placer à droite',
    statusOnRight: 'actuellement à droite',
    statusOnLeft: 'actuellement à gauche',
    statusCard: 'Card d’usage dans la vue',
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
      'Une étoile et je ronronne 😺',
      'Cinq étoiles, ça brille 🌟',
      'Le panda te fait un clin d’œil 🐼',
      'Merci d’être là 💛',
      'Tu codes, je veille 👀',
      'Petit clic, grand bonheur ✨',
      'Une étoile pour la route ? 🚀',
      'Tes agents t’adorent 🤖',
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
    agentType: (type) => `type: ${type}`,
    phases: 'Planned phases',
    failed: 'failed',
    running: (count) => `${count} running`,
    failedCount: (count) => `${count} failed`,
    finishedCount: (count) => `${count} finished`,
    toolUses: (count) => (count === 1 ? '1 tool call' : `${count} tool calls`),
    sddTask: (number, title) => (title === undefined ? `Task ${number}` : `Task ${number}: ${title}`),
    sddStates: { done: 'done', doing: 'in progress', review: 'in review', pending: 'to do' },
    sddInReview: (count) => `${count} in review`,
    sddArtifacts: { brief: 'brief', report: 'report', review: 'review' },
    sddFix: (round) => `fix round ${round}`,
    sddCount: (done, total) => (total === undefined ? `${done} done` : `${done}/${total}`),
    sddFinished: 'Plan finished — final review present',
    sddLabel: 'Plan',
    sddPlanTitle: (plan) => `${plan} — plan run by subagents (superpowers)`,
    sddPrevious: 'Previous plan',
    sddNext: 'Next plan',
    sddNoPrevious: 'No previous plan',
    sddNoNext: 'No newer plan',
    sddTokensTotal: (tokens) => `${tokens} tokens in total`,
    sddHistory: (count) => (count === 1 ? '1 plan' : `${count} plans`),
    sddUpdated: (at) => {
      const date = new Date(at);
      return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    },
    sddUpdatedTitle: 'Last write to the plan',
    mapClose: 'Collapse the agent map',
    cacheWarm: (minutes) => `Prompt cache warm, about ${minutes} min left`,
    cacheCold: (idle) => `Prompt cache likely expired · idle ${idle}`,
    cacheCompacted: 'Prompt cache does not cover the compacted conversation',
    usageTitle: 'USAGE',
    usageSession: 'Session (5h)',
    usageWeeklyAll: 'Weekly — All models',
    usageWeeklyScoped: (model) => `Weekly — ${model}`,
    usageSessionShort: '5h',
    usageWeeklyAllShort: 'Weekly',
    usageResets: (duration) => `resets ${duration}`,
    usageUpdated: (duration) => `updated ${duration} ago`,
    usageStale: (duration) => `⚠ figures ${duration} old`,
    usageHelp: 'Write the content of claude.ai/usage periodically into this file:',
    usageHelpPath: 'Set the path in the claudeAgents.usageFile setting',
    usageDismiss: 'Hide this panel',
    usageCollapse: 'Collapse',
    usageExpand: 'Expand',
    usageSettings: 'Usage settings',
    usageRepo: 'The tool that writes it for you: ClaudeUsage ↗',
    statusSession: 'Session',
    statusWeekly: 'Weekly',
    statusDays: (days, hours) => `${days}d ${hours}h`,
    statusTitle: 'Claude usage',
    statusOpenView: 'Click to open Claude Agents',
    statusMenu: 'Usage display',
    statusText: 'Text',
    statusRings: 'Rings',
    statusHide: 'Hide from the status bar',
    statusMoveLeft: 'Move to the left',
    statusMoveRight: 'Move to the right',
    statusOnRight: 'currently on the right',
    statusOnLeft: 'currently on the left',
    statusCard: 'Usage card in the view',
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
      'One star and I purr 😺',
      'Five stars, so shiny 🌟',
      'The panda winks at you 🐼',
      'Thanks for being here 💛',
      'You code, I keep watch 👀',
      'Small click, big joy ✨',
      'A star for the road? 🚀',
      'Your agents adore you 🤖',
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

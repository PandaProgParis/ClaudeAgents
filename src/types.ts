import type { Locale } from './i18n';

export interface SessionRegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  name?: string;
  /** « derived » quand Claude Code a tiré le nom du dossier (« l2lt-master-4e »), autre valeur si l'utilisateur l'a choisi. */
  nameSource?: string;
  kind?: string;
  entrypoint?: string;
  version?: string;
}

/** failed : signalé par le journal du run d'un workflow (l'agent n'a pas rendu de résultat). */
export type AgentStatus = 'active' | 'finished' | 'failed';

/** Phase de l'agent principal, déduite de la dernière ligne datée du transcript et de ses sous-agents. */
export type SessionPhase = 'thinking' | 'tool' | 'delegating' | 'idle' | 'waiting';

export interface SessionActivity {
  /**
   * thinking : le modèle génère (dernière ligne = prompt, tool_result, ou bloc sans stop_reason) ;
   * tool : un tool_use attend son résultat ; waiting : une question est posée à l'utilisateur ;
   * delegating : le tour est terminé mais des sous-agents lancés en arrière-plan tournent encore ;
   * idle : le tour est terminé.
   */
  phase: SessionPhase;
  /** Horodatage de la ligne qui a ouvert la phase. */
  since: number;
  /** Outil en cours (phase tool). */
  tool?: string;
}

/** Commande Bash lancée en arrière-plan par l'agent principal (run_in_background) et pas encore terminée. */
export interface BackgroundTask {
  /** Identifiant attribué par Claude Code (nom du fichier tasks/<id>.output). */
  id: string;
  command: string;
  description?: string;
  startedAt: number;
  /** Première adresse locale (http://localhost:…) écrite dans la sortie de la commande ; rien n'est deviné. */
  url?: string;
  /** Vivacité mesurée du port (portProbe) : `undefined` tant qu'il n'a pas été sondé. */
  urlAlive?: boolean;
}

/**
 * Chiffres de fin d'un sous-agent tels que Claude Code les écrit dans le transcript parent
 * (bloc `<usage>` de la notification de fin, ou queue du tool_result) : ce sont ceux de sa carte des agents.
 */
export interface AgentReport {
  tokens: number;
  toolUses: number;
  durationMs: number;
}

/**
 * Cache d'invite de la session : TTL lue dans la ventilation `cache_creation` du dernier bloc usage
 * (5 min ou 1 h) et horodatage de ce message. `compactedAt` : une compaction postérieure a rendu le cache inutile.
 */
export interface PromptCacheInfo {
  anchorAt: number;
  ttlMs: number;
  compactedAt?: number;
}

/** Phase déclarée par le script d'un workflow (meta.phases) : le plan, pas la progression. */
export interface WorkflowPhase {
  title: string;
  detail?: string;
}

/** Une limite du forfait telle qu'écrite dans `limits[]` du fichier d'usage. */
export interface UsageLimit {
  /** `session`, `weekly_all`, `weekly_scoped`… tel quel : la vue traduit ce qu'elle connaît. */
  kind: string;
  /** Modèle ou surface concernée (`weekly_scoped`), ex. « Fable ». */
  scopeLabel?: string;
  /** Pourcentage consommé, borné 0-100. */
  percent: number;
  /** Fin de la fenêtre, en horodatage. */
  resetsAt?: number;
  severity: 'normal' | 'warning' | 'critical';
}

/** Limites du forfait lues dans le fichier d'usage tenu par un outil tiers. */
export interface UsageSnapshot {
  limits: UsageLimit[];
  /** Dernière écriture du fichier : sert à signaler des chiffres vieillis. */
  updatedAt: number;
}

/** Message d'état poussé à la webview par l'extension (ou rejoué par le serveur d'aperçu local). */
export interface StateMessage {
  projects: ProjectNode[];
  effortLevel?: string;
  settings: FinishedAgentSettings;
  inactiveSessionRetentionMinutes?: number;
  locale?: Locale;
  now: number;
  /** Limites du forfait, présentes seulement si la fonction est activée. */
  usage?: UsageSnapshot;
  /** Chemin attendu du fichier d'usage : affiché dans la card d'aide quand il manque. */
  usageFile?: string;
  /** Dossiers du workspace : leurs sessions restent affichées au-delà de la rétention d'inactivité. */
  pinnedFolders?: string[];
}

export type SddTaskState = 'done' | 'doing' | 'review' | 'pending';

/** Tâche d'un plan exécuté en subagent-driven development, telle que son workspace la donne à voir. */
export interface SddTask {
  number: number;
  state: SddTaskState;
  /** Titre lu dans le plan, absent quand le plan n'a pas pu être lu. */
  title?: string;
  /** Artefacts présents dans le workspace : des faits, pas une interprétation. */
  brief: boolean;
  report: boolean;
  review: boolean;
  /** Dernière ronde de correction présente, absente quand il n'y en a aucune. */
  fixRound?: number;
}

export interface SddRun {
  /** Dossier du workspace : `<…>/.superpowers/sdd/<plan>`. */
  dir: string;
  /** Nom du plan, qui est celui du dossier du workspace. */
  plan: string;
  tasks: SddTask[];
  doneCount: number;
  /** Un fichier de revue finale est présent : le plan est fini, toutes ses tâches sont terminées. */
  finalReview: boolean;
  /** Dernière écriture du workspace : un prompt humain postérieur retire un plan fini de la card. */
  updatedAt: number;
  /** Nombre de tâches du plan, absent quand le plan n'a pas pu être lu : jamais un total supposé. */
  totalCount?: number;
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export interface AgentNode {
  id: string;
  filePath: string;
  status: AgentStatus;
  lastActivity: number;
  createdAt: number;
  description?: string;
  /**
   * Extrait du prompt pour l'infobulle : la part propre à l'agent après le préambule commun de son run (workflow),
   * ou le début du prompt quand le libellé vient de la description du meta.json (sous-agent direct).
   */
  detail?: string;
  model?: string;
  contextTokens?: number;
  /** Chiffres écrits par Claude Code à la fin de l'agent (absents tant qu'il tourne, ou pour un agent de workflow). */
  report?: AgentReport;
  /**
   * Raison de l'échec telle que Claude Code l'a écrite : champ error de l'entrée workflow_agent du json de fin de run,
   * sinon texte de la ligne assistant synthétique (isApiErrorMessage) qui clôt le transcript de l'agent.
   */
  failure?: string;
  /** Type déclaré dans agent-<id>.meta.json (ex. « superpowers:code-reviewer »). */
  agentType?: string;
  /** Nom du dernier outil utilisé (dernier bloc tool_use de la fenêtre de queue). */
  lastTool?: string;
  /** Id du bloc tool_use qui a lancé cet agent (agent-<id>.meta.json) — sert à la filiation. */
  toolUseId?: string;
  /** Agent qui a lancé celui-ci, écrit par Claude Code ≥ 2.1.270 dans le meta.json : filiation exacte, sans fenêtre de lecture. */
  parentAgentId?: string;
  /** Profondeur de filiation : 0 = lancé par la session, 1 = petit-fils, etc. */
  depth?: number;
  /** Tâche d'un plan SDD dont le prompt de l'agent nomme les fichiers (`.superpowers/sdd/<plan>/task-<N>-….md`). */
  sddTask?: SddTaskLink;
}

export interface SddTaskLink {
  /** Nom du dossier du workspace, comme SddRun.plan. */
  plan: string;
  number: number;
}

export interface WorkflowNode {
  id: string;
  /** Nom du script (workflows/scripts/<nom>-<runId>.js de la session), absent si le fichier manque. */
  name?: string;
  /** meta.description et meta.phases du script, quand il a été trouvé. */
  description?: string;
  phases?: WorkflowPhase[];
  agents: AgentNode[];
  finishedCount: number;
  totalCount: number;
  /** Agents en échec d'après le journal du run (absent hors workflow). */
  failedCount?: number;
}

export interface SessionNode {
  sessionId: string;
  pid: number;
  cwd: string;
  name: string;
  startedAt: number;
  active: boolean;
  lastActivity?: number;
  model?: string;
  contextTokens?: number;
  /** Effort de la session, champ racine des lignes assistant (Claude Code ≥ 2.1.270) ; absent avant. */
  effort?: string;
  /** Cache d'invite : absent quand le transcript ne permet pas de le connaître. */
  cache?: PromptCacheInfo;
  gitBranch?: string;
  /** Nom du dernier outil utilisé (dernier bloc tool_use de la fenêtre de queue). */
  lastTool?: string;
  /** Une AskUserQuestion est restée sans tool_result : la session attend l'utilisateur. */
  pendingQuestion?: boolean;
  /** Texte de la première question en attente, si visible dans la fenêtre de queue. */
  pendingQuestionText?: string;
  /** Phase de l'agent principal déduite du transcript (absente si la queue ne porte aucune ligne datée). */
  activity?: SessionActivity;
  /** Commandes lancées en arrière-plan par l'agent principal et pas encore terminées. */
  backgroundTasks?: BackgroundTask[];
  /** Dernière liste de tâches (TodoWrite) de la session : « où en est » le travail. */
  todos?: TodoItem[];
  /** Run subagent-driven development trouvé sous le dossier de la session : ses tâches vivent en fichiers, pas en TodoWrite. */
  sdd?: SddRun;
  /** Tous les plans du dossier, du plus récent au plus ancien, y compris un plan fini retiré : l'historique parcouru par les flèches. */
  sddPlans?: SddRun[];
  agents: AgentNode[];
  workflows: WorkflowNode[];
}

export interface ProjectNode {
  cwd: string;
  name: string;
  hasActiveSession: boolean;
  sessions: SessionNode[];
}

export interface FinishedAgentSettings {
  mode: 'always' | 'temporarily' | 'never';
  retentionSeconds: number;
}

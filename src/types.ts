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
}

/** Phase déclarée par le script d'un workflow (meta.phases) : le plan, pas la progression. */
export interface WorkflowPhase {
  title: string;
  detail?: string;
}

/** Message d'état poussé à la webview par l'extension (ou rejoué par le serveur d'aperçu local). */
export interface StateMessage {
  projects: ProjectNode[];
  effortLevel?: string;
  settings: FinishedAgentSettings;
  inactiveSessionRetentionMinutes?: number;
  locale?: Locale;
  now: number;
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
  /** Type déclaré dans agent-<id>.meta.json (ex. « superpowers:code-reviewer »). */
  agentType?: string;
  /** Nom du dernier outil utilisé (dernier bloc tool_use de la fenêtre de queue). */
  lastTool?: string;
  /** Id du bloc tool_use qui a lancé cet agent (agent-<id>.meta.json) — sert à la filiation. */
  toolUseId?: string;
  /** Profondeur de filiation : 0 = lancé par la session, 1 = petit-fils, etc. */
  depth?: number;
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

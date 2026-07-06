export interface SessionRegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  name?: string;
  kind?: string;
  entrypoint?: string;
  version?: string;
}

export type AgentStatus = 'active' | 'finished';

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
  agents: AgentNode[];
  finishedCount: number;
  totalCount: number;
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

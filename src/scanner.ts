import * as fs from 'fs';
import * as path from 'path';
import type {
  AgentNode,
  ProjectNode,
  SessionNode,
  SessionRegistryEntry,
  TodoItem,
  TodoStatus,
  WorkflowNode,
} from './types';

export { filterVisibleAgents } from './visibility';

export interface ScanOptions {
  claudeDir: string;
  now?: number;
  isPidAlive?: (pid: number) => boolean;
  activeThresholdMs?: number;
  log?: (message: string) => void;
}

type Log = (message: string) => void;

const DEFAULT_ACTIVE_THRESHOLD_MS = 30_000;

export function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = le process existe mais ne nous appartient pas
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function scan(options: ScanOptions): ProjectNode[] {
  const now = options.now ?? Date.now();
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  const activeThresholdMs = options.activeThresholdMs ?? DEFAULT_ACTIVE_THRESHOLD_MS;
  const log = options.log ?? (() => {});

  const aliveEntries = readRegistry(path.join(options.claudeDir, 'sessions'), log).filter((entry) =>
    isPidAlive(entry.pid),
  );
  const projectsRoot = path.join(options.claudeDir, 'projects');
  // Un seul readdir de projects/ par scan, partagé entre toutes les sessions.
  let projectDirNames: string[];
  try {
    projectDirNames = fs.readdirSync(projectsRoot);
  } catch {
    projectDirNames = [];
  }
  const seenTranscripts = new Set<string>();

  const projectsByCwd = new Map<string, ProjectNode>();
  for (const entry of aliveEntries) {
    const session = buildSessionNode(entry, projectsRoot, projectDirNames, seenTranscripts, now, activeThresholdMs, log);
    const key = entry.cwd.toLowerCase();
    let project = projectsByCwd.get(key);
    if (!project) {
      project = { cwd: entry.cwd, name: path.basename(entry.cwd), hasActiveSession: false, sessions: [] };
      projectsByCwd.set(key, project);
    }
    project.sessions.push(session);
    if (session.active) {
      project.hasActiveSession = true;
    }
  }

  const projects = [...projectsByCwd.values()];
  // Tri STABLE entre deux scans (pas de réordonnancement au fil des bascules d'activité) :
  // l'activité se lit sur les icônes, pas sur la position.
  for (const project of projects) {
    project.sessions.sort((a, b) => b.startedAt - a.startedAt);
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));

  // Élague les caches aux entrées vues lors de ce scan (évite une croissance monotone).
  const seenFilePaths = new Set<string>();
  const liveSessionIds = new Set<string>();
  for (const project of projects) {
    for (const session of project.sessions) {
      liveSessionIds.add(session.sessionId);
      for (const agent of session.agents) {
        seenFilePaths.add(agent.filePath);
      }
      for (const workflow of session.workflows) {
        for (const agent of workflow.agents) {
          seenFilePaths.add(agent.filePath);
        }
      }
    }
  }
  for (const key of transcriptMetaCache.keys()) {
    if (!seenFilePaths.has(key)) {
      transcriptMetaCache.delete(key);
    }
  }
  for (const key of customTitleCache.keys()) {
    if (!liveSessionIds.has(key)) {
      customTitleCache.delete(key);
    }
  }
  for (const key of aiTitleCache.keys()) {
    if (!liveSessionIds.has(key)) {
      aiTitleCache.delete(key);
    }
  }
  for (const key of todosCache.keys()) {
    if (!liveSessionIds.has(key)) {
      todosCache.delete(key);
    }
  }
  for (const key of sessionTailCache.keys()) {
    if (!seenTranscripts.has(key)) {
      sessionTailCache.delete(key);
    }
  }

  return projects;
}

function readRegistry(sessionsDir: string, log: Log): SessionRegistryEntry[] {
  let files: string[];
  try {
    files = fs.readdirSync(sessionsDir).filter((file) => file.endsWith('.json'));
  } catch {
    return [];
  }
  const entries: SessionRegistryEntry[] = [];
  for (const file of files) {
    const filePath = path.join(sessionsDir, file);
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const entry = parsed as Partial<SessionRegistryEntry>;
      if (
        typeof entry.pid === 'number' &&
        typeof entry.sessionId === 'string' &&
        typeof entry.cwd === 'string' &&
        typeof entry.startedAt === 'number'
      ) {
        entries.push(entry as SessionRegistryEntry);
      } else {
        log(`Registre ignoré (champs manquants) : ${filePath}`);
      }
    } catch (error) {
      log(`Registre illisible : ${filePath} — ${String(error)}`);
    }
  }
  return entries;
}

export function encodeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function findProjectDir(projectsRoot: string, dirNames: string[], cwd: string): string | undefined {
  const wanted = encodeProjectDirName(cwd).toLowerCase();
  const match = dirNames.find((name) => name.toLowerCase() === wanted);
  return match ? path.join(projectsRoot, match) : undefined;
}

/** Lit au plus maxBytes en tête ou en queue de fichier, sans jamais le charger entier. */
function readChunk(filePath: string, where: 'head' | 'tail', maxBytes: number): string | undefined {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return undefined;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    if (length === 0) {
      return '';
    }
    const position = where === 'head' ? 0 : size - length;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, position);
    return buffer.toString('utf8');
  } catch {
    return undefined;
  } finally {
    fs.closeSync(fd);
  }
}

const TAIL_READ_BYTES = 64 * 1024;

export interface TailMeta {
  model?: string;
  customTitle?: string;
  aiTitle?: string;
  contextTokens?: number;
  gitBranch?: string;
  lastTool?: string;
  pendingQuestion?: boolean;
  pendingQuestionText?: string;
  todos?: TodoItem[];
  /** Ids de tous les blocs tool_use vus dans la fenêtre de queue (filiation des sous-agents). */
  toolUseIds?: string[];
}

const TODO_STATUSES = new Set<TodoStatus>(['pending', 'in_progress', 'completed']);

/** Dernière liste TodoWrite de la queue : on parse la ligne JSONL complète qui la contient. */
function extractTodos(tail: string): TodoItem[] | undefined {
  const idx = tail.lastIndexOf('"name":"TodoWrite"');
  if (idx === -1) {
    return undefined;
  }
  const start = tail.lastIndexOf('\n', idx) + 1; // 0 si la ligne commence avant la fenêtre
  const nl = tail.indexOf('\n', idx);
  const line = nl === -1 ? tail.slice(start) : tail.slice(start, nl);
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined; // ligne coupée par la lecture bornée → le cache collant prend le relais
  }
  const content = (parsed as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const block = content.find(
    (b): b is { input?: { todos?: unknown } } =>
      typeof b === 'object' && b !== null && (b as { name?: unknown }).name === 'TodoWrite',
  );
  const todos = block?.input?.todos;
  if (!Array.isArray(todos)) {
    return undefined;
  }
  const items: TodoItem[] = [];
  for (const t of todos) {
    const c = (t as { content?: unknown }).content;
    const s = (t as { status?: unknown }).status;
    if (typeof c === 'string' && c && typeof s === 'string' && TODO_STATUSES.has(s as TodoStatus)) {
      items.push({ content: c, status: s as TodoStatus });
    }
  }
  return items.length > 0 ? items : undefined;
}

/** Déséchappe une valeur de chaîne JSON capturée brute (\" \n ’…). */
function unescapeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

const TOOL_USE_PATTERN = /"type"\s*:\s*"tool_use"\s*,\s*"id"\s*:\s*"([^"]+)"\s*,\s*"name"\s*:\s*"([^"]+)"/g;

/** Une AskUserQuestion sans tool_result postérieur = la session attend une réponse de l'utilisateur. */
function extractPendingQuestion(tail: string): { pending: boolean; text?: string } {
  const questions = [...tail.matchAll(TOOL_USE_PATTERN)].filter((match) => match[2] === 'AskUserQuestion');
  if (questions.length === 0) {
    return { pending: false };
  }
  const last = questions[questions.length - 1];
  const after = tail.slice((last.index ?? 0) + last[0].length);
  const answerPattern = new RegExp(`"tool_use_id"\\s*:\\s*"${last[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
  if (answerPattern.test(after)) {
    return { pending: false };
  }
  // L'input du tool_use suit immédiatement le name : la première "question" rencontrée est la bonne.
  const question = /"question"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/.exec(after);
  return { pending: true, text: question ? unescapeJsonString(question[1]) : undefined };
}

function lastMatch(
  text: string,
  pattern: RegExp,
  accept: (value: string) => boolean = () => true,
): string | undefined {
  const values = [...text.matchAll(pattern)].map((match) => match[1]).filter(accept);
  return values.length > 0 ? values[values.length - 1] : undefined;
}

/** Contexte courant ≈ somme des champs d'entrée du DERNIER bloc usage de la fenêtre. */
function extractContextTokens(tail: string): number | undefined {
  const usageIndex = tail.lastIndexOf('"usage"');
  if (usageIndex === -1) {
    return undefined;
  }
  const usageWindow = tail.slice(usageIndex, usageIndex + 600);
  const input = /"input_tokens"\s*:\s*(\d+)/.exec(usageWindow);
  if (!input) {
    return undefined;
  }
  const cacheRead = /"cache_read_input_tokens"\s*:\s*(\d+)/.exec(usageWindow);
  const cacheCreation = /"cache_creation_input_tokens"\s*:\s*(\d+)/.exec(usageWindow);
  return Number(input[1]) + Number(cacheRead?.[1] ?? 0) + Number(cacheCreation?.[1] ?? 0);
}

/** Une seule lecture de queue par fichier et par scan : modèle + titre custom + contexte. */
export function extractTailMeta(filePath: string): TailMeta {
  const tail = readChunk(filePath, 'tail', TAIL_READ_BYTES);
  if (tail === undefined) {
    return {};
  }
  const rawCustomTitle = lastMatch(tail, /"customTitle"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g);
  const rawAiTitle = lastMatch(tail, /"aiTitle"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g);
  const toolUses = [...tail.matchAll(TOOL_USE_PATTERN)];
  const pendingQuestion = extractPendingQuestion(tail);
  return {
    model: lastMatch(tail, /"model"\s*:\s*"([^"]+)"/g, (value) => value !== '<synthetic>'),
    customTitle: rawCustomTitle !== undefined ? unescapeJsonString(rawCustomTitle) : undefined,
    aiTitle: rawAiTitle !== undefined ? unescapeJsonString(rawAiTitle) : undefined,
    contextTokens: extractContextTokens(tail),
    gitBranch: lastMatch(tail, /"gitBranch"\s*:\s*"([^"]+)"/g),
    lastTool: toolUses.length > 0 ? toolUses[toolUses.length - 1][2] : undefined,
    pendingQuestion: pendingQuestion.pending,
    pendingQuestionText: pendingQuestion.text,
    todos: extractTodos(tail),
    toolUseIds: toolUses.map((match) => match[1]),
  };
}

const effortLevelCache = new Map<string, { mtimeMs: number; value: string | undefined }>();

/** Effort global de ~/.claude/settings.json (l'effort par session n'est pas persisté), caché par mtime. */
export function readEffortLevel(claudeDir: string): string | undefined {
  const filePath = path.join(claudeDir, 'settings.json');
  try {
    const mtimeMs = fs.statSync(filePath).mtimeMs;
    const cached = effortLevelCache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.value;
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const effort = (parsed as { effortLevel?: unknown }).effortLevel;
    const value = typeof effort === 'string' ? effort : undefined;
    effortLevelCache.set(filePath, { mtimeMs, value });
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Titre custom d'une session, mémorisé par sessionId : les lignes {"type":"custom-title"}
 * sont écrites près de la fin du transcript au moment du renommage, puis peuvent sortir
 * de la fenêtre de lecture bornée quand le fichier grossit — le cache retient la dernière vue.
 */
const customTitleCache = new Map<string, string>();

/** Titre généré par l'IA ({"type":"ai-title"}), même mécanique de rétention que le titre custom. */
const aiTitleCache = new Map<string, string>();

/** Dernière todo-list vue par session : survit à sa sortie de la fenêtre de lecture bornée. */
const todosCache = new Map<string, TodoItem[]>();

const DESCRIPTION_READ_BYTES = 8 * 1024;
/** Assez long pour un tooltip lisible ; l'ellipse d'affichage est faite en CSS. */
const DESCRIPTION_MAX_LENGTH = 500;
const AGENT_FILE_PATTERN = /^agent-[^.]+\.jsonl$/;

/** Tri chronologique de création, départage par id (le birthtime peut être identique ou absent selon les FS). */
export function compareAgents(a: AgentNode, b: AgentNode): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

export function extractDescription(filePath: string): string | undefined {
  const head = readChunk(filePath, 'head', DESCRIPTION_READ_BYTES);
  if (head === undefined) {
    return undefined;
  }
  for (const line of head.split('\n')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // ligne tronquée par la lecture bornée ou bruit
    }
    const entry = parsed as { type?: string; message?: { content?: unknown } };
    if (entry.type !== 'user') {
      continue;
    }
    const content = entry.message?.content;
    let text: string | undefined;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      const block = content.find(
        (part): part is { type: string; text: string } =>
          typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text',
      );
      text = block?.text;
    }
    if (text) {
      const firstLine = text.split('\n')[0].trim();
      return firstLine.length > DESCRIPTION_MAX_LENGTH
        ? firstLine.slice(0, DESCRIPTION_MAX_LENGTH - 1) + '…'
        : firstLine;
    }
  }
  return undefined;
}

interface TranscriptMeta {
  mtimeMs: number;
  description: string | undefined;
  model: string | undefined;
  contextTokens: number | undefined;
  agentType: string | undefined;
  lastTool: string | undefined;
  toolUseId: string | undefined;
  toolUseIds: string[];
}

/** Métadonnées du fichier frère agent-<id>.meta.json (immuable). */
function readAgentMetaFile(transcriptPath: string): { agentType?: string; toolUseId?: string } {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(transcriptPath.replace(/\.jsonl$/, '.meta.json'), 'utf8'),
    );
    const { agentType, toolUseId } = parsed as { agentType?: unknown; toolUseId?: unknown };
    return {
      agentType: typeof agentType === 'string' ? agentType : undefined,
      toolUseId: typeof toolUseId === 'string' ? toolUseId : undefined,
    };
  } catch {
    return {};
  }
}

/** Cache des lectures bornées : un fichier agent inchangé (même mtime) n'est jamais relu. */
const transcriptMetaCache = new Map<string, TranscriptMeta>();

function readTranscriptMeta(filePath: string, mtimeMs: number): TranscriptMeta {
  const cached = transcriptMetaCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached;
  }
  const tailMeta = extractTailMeta(filePath);
  // Le premier message user (append-only) et le meta.json ne changent jamais : une seule lecture.
  const metaFile =
    cached && (cached.agentType !== undefined || cached.toolUseId !== undefined)
      ? { agentType: cached.agentType, toolUseId: cached.toolUseId }
      : readAgentMetaFile(filePath);
  const meta: TranscriptMeta = {
    mtimeMs,
    description: cached?.description ?? extractDescription(filePath),
    agentType: metaFile.agentType,
    toolUseId: metaFile.toolUseId,
    model: tailMeta.model,
    contextTokens: tailMeta.contextTokens,
    lastTool: tailMeta.lastTool,
    toolUseIds: tailMeta.toolUseIds ?? [],
  };
  transcriptMetaCache.set(filePath, meta);
  return meta;
}

function scanAgentsDir(
  dir: string,
  now: number,
  activeThresholdMs: number,
  log: Log,
  spawnedOut?: Map<string, Set<string>>,
): AgentNode[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const agents: AgentNode[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !AGENT_FILE_PATTERN.test(entry.name)) {
      continue;
    }
    const filePath = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(filePath);
      const meta = readTranscriptMeta(filePath, stat.mtimeMs);
      const id = entry.name.replace(/\.jsonl$/, '');
      agents.push({
        id,
        filePath,
        status: now - stat.mtimeMs < activeThresholdMs ? 'active' : 'finished',
        lastActivity: stat.mtimeMs,
        createdAt: stat.birthtimeMs || stat.mtimeMs,
        description: meta.description,
        model: meta.model,
        contextTokens: meta.contextTokens,
        agentType: meta.agentType,
        lastTool: meta.lastTool,
        toolUseId: meta.toolUseId,
      });
      spawnedOut?.set(id, new Set(meta.toolUseIds));
    } catch (error) {
      log(`Agent illisible : ${filePath} — ${String(error)}`);
    }
  }
  agents.sort(compareAgents);
  return agents;
}

/**
 * Réordonne les agents en profondeur d'abord : chaque agent dont le toolUseId figure
 * dans le transcript d'un autre (son parent) est placé derrière lui avec depth + 1.
 * Les fichiers sont posés à plat sur disque — la hiérarchie n'existe que par ce lien.
 */
function orderByFiliation(agents: AgentNode[], spawned: Map<string, Set<string>>): AgentNode[] {
  const childrenOf = new Map<string, AgentNode[]>();
  const roots: AgentNode[] = [];
  for (const agent of agents) {
    const parent = agent.toolUseId
      ? agents.find((candidate) => candidate !== agent && spawned.get(candidate.id)?.has(agent.toolUseId as string))
      : undefined;
    if (parent) {
      const siblings = childrenOf.get(parent.id) ?? [];
      siblings.push(agent);
      childrenOf.set(parent.id, siblings);
    } else {
      roots.push(agent);
    }
  }
  const ordered: AgentNode[] = [];
  const visited = new Set<string>();
  const visit = (agent: AgentNode, depth: number): void => {
    if (visited.has(agent.id)) {
      return;
    }
    visited.add(agent.id);
    agent.depth = depth;
    ordered.push(agent);
    for (const child of childrenOf.get(agent.id) ?? []) {
      visit(child, depth + 1);
    }
  };
  for (const root of roots) {
    visit(root, 0);
  }
  // Filet anti-cycle : tout agent non visité (filiation circulaire) revient à la racine.
  for (const agent of agents) {
    if (!visited.has(agent.id)) {
      agent.depth = 0;
      ordered.push(agent);
    }
  }
  return ordered;
}

function scanWorkflows(workflowsDir: string, now: number, activeThresholdMs: number, log: Log): WorkflowNode[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workflowsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const agents = scanAgentsDir(path.join(workflowsDir, entry.name), now, activeThresholdMs, log);
      return {
        id: entry.name,
        agents,
        totalCount: agents.length,
        finishedCount: agents.filter((agent) => agent.status === 'finished').length,
      };
    })
    .filter((workflow) => workflow.totalCount > 0)
    .sort((a, b) => a.agents[0].createdAt - b.agents[0].createdAt || a.id.localeCompare(b.id));
}

/** Cache de la queue du transcript de session : une session oisive n'est jamais relue. */
const sessionTailCache = new Map<string, { mtimeMs: number; meta: TailMeta }>();

function readSessionTailMeta(filePath: string, mtimeMs: number): TailMeta {
  const cached = sessionTailCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.meta;
  }
  const meta = extractTailMeta(filePath);
  sessionTailCache.set(filePath, { mtimeMs, meta });
  return meta;
}

function buildSessionNode(
  entry: SessionRegistryEntry,
  projectsRoot: string,
  projectDirNames: string[],
  seenTranscripts: Set<string>,
  now: number,
  activeThresholdMs: number,
  log: Log,
): SessionNode {
  const session: SessionNode = {
    sessionId: entry.sessionId,
    pid: entry.pid,
    cwd: entry.cwd,
    name: entry.name ?? entry.sessionId.slice(0, 8),
    startedAt: entry.startedAt,
    active: false,
    agents: [],
    workflows: [],
  };

  const projectDir = findProjectDir(projectsRoot, projectDirNames, entry.cwd);
  if (!projectDir) {
    return session;
  }

  const transcriptPath = path.join(projectDir, `${entry.sessionId}.jsonl`);
  try {
    const stat = fs.statSync(transcriptPath);
    seenTranscripts.add(transcriptPath);
    session.lastActivity = stat.mtimeMs;
    session.active = now - stat.mtimeMs < activeThresholdMs;
    const meta = readSessionTailMeta(transcriptPath, stat.mtimeMs);
    session.model = meta.model;
    session.contextTokens = meta.contextTokens;
    session.gitBranch = meta.gitBranch;
    session.lastTool = meta.lastTool;
    session.pendingQuestion = meta.pendingQuestion;
    session.pendingQuestionText = meta.pendingQuestionText;
    if (meta.customTitle) {
      customTitleCache.set(entry.sessionId, meta.customTitle);
    }
    if (meta.aiTitle) {
      aiTitleCache.set(entry.sessionId, meta.aiTitle);
    }
    if (meta.todos) {
      todosCache.set(entry.sessionId, meta.todos);
    }
  } catch {
    // Transcript introuvable : la session reste affichée avec les infos du registre.
  }
  session.todos = todosCache.get(entry.sessionId);
  // Priorité : renommage manuel > titre généré par l'IA > nom du registre (« marketing-94 »).
  const bestTitle = customTitleCache.get(entry.sessionId) ?? aiTitleCache.get(entry.sessionId);
  if (bestTitle) {
    session.name = bestTitle;
  }

  const subagentsDir = path.join(projectDir, entry.sessionId, 'subagents');
  const spawned = new Map<string, Set<string>>();
  session.agents = orderByFiliation(scanAgentsDir(subagentsDir, now, activeThresholdMs, log, spawned), spawned);
  session.workflows = scanWorkflows(path.join(subagentsDir, 'workflows'), now, activeThresholdMs, log);

  // Une session qui délègue n'écrit plus dans son propre transcript : son activité
  // réelle est celle de ses agents. On agrège statut et dernière activité.
  for (const agent of [...session.agents, ...session.workflows.flatMap((workflow) => workflow.agents)]) {
    if (session.lastActivity === undefined || agent.lastActivity > session.lastActivity) {
      session.lastActivity = agent.lastActivity;
    }
    if (agent.status === 'active') {
      session.active = true;
    }
  }

  return session;
}

/** Réservé aux tests : vide les caches module-level. */
export function clearScannerCaches(): void {
  transcriptMetaCache.clear();
  customTitleCache.clear();
  aiTitleCache.clear();
  todosCache.clear();
  sessionTailCache.clear();
  effortLevelCache.clear();
}

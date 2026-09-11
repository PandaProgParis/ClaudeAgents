import * as fs from 'fs';
import * as path from 'path';
import { extractLocalUrl } from './localUrl';
import { parseWorkflowMeta } from './workflowMeta';
import type {
  AgentNode,
  ProjectNode,
  SessionNode,
  SessionRegistryEntry,
  TodoItem,
  TodoStatus,
  WorkflowNode,
  BackgroundTask,
  SessionActivity,
  WorkflowPhase,
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
  const seenJournals = new Set<string>();
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
          seenJournals.add(path.join(path.dirname(agent.filePath), 'journal.jsonl'));
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
  for (const key of backgroundCache.keys()) {
    if (!liveSessionIds.has(key)) {
      backgroundCache.delete(key);
    }
  }
  for (const key of sessionTailCache.keys()) {
    if (!seenTranscripts.has(key)) {
      sessionTailCache.delete(key);
    }
  }
  for (const key of deepPromptIdCache.keys()) {
    if (!seenTranscripts.has(key)) {
      deepPromptIdCache.delete(key);
    }
  }
  for (const key of journalFailedCache.keys()) {
    if (!seenJournals.has(key)) {
      journalFailedCache.delete(key);
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

/** Suffixe aléatoire (deux caractères hexadécimaux) que Claude Code ajoute au nom dérivé du dossier. */
const DERIVED_NAME_SUFFIX = /-[0-9a-f]{2}$/;

/** Nom affiché à défaut de titre : le nom dérivé du dossier sans son suffixe (« l2lt-master-4e » → « l2lt-master »), tout autre nom tel quel. */
function registryName(entry: SessionRegistryEntry): string {
  if (entry.name === undefined) {
    return entry.sessionId.slice(0, 8);
  }
  return entry.nameSource === 'derived' ? entry.name.replace(DERIVED_NAME_SUFFIX, '') : entry.name;
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

/** Lit [start, start + length) du fichier — rattrapage des notifications sorties de la fenêtre de queue. */
function readRange(filePath: string, start: number, length: number): string | undefined {
  if (length <= 0) {
    return '';
  }
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return undefined;
  }
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString('utf8', 0, read);
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
  /** promptId du tour (dernière ligne user précédente) qui a écrit la dernière TodoWrite. */
  todosPromptId?: string;
  /** promptId de la dernière ligne user de la queue : change à chaque nouveau prompt humain. */
  lastPromptId?: string;
  /** Ids de tous les blocs tool_use vus dans la fenêtre de queue (filiation des sous-agents). */
  toolUseIds?: string[];
  /** Phase de l'agent principal déduite des lignes datées de la fenêtre (absente si aucune). */
  activity?: SessionActivity;
  /** Bash lancés en arrière-plan vus dans la fenêtre, avec l'id de tâche quand leur tool_result est visible. */
  backgroundStarts?: BackgroundStart[];
  /** Ids des tâches de fond dont la notification de fin est dans la fenêtre. */
  notifiedTaskIds?: string[];
}

interface BackgroundStart {
  toolUseId: string;
  taskId?: string;
  outputFile?: string;
  command: string;
  description?: string;
  startedAt: number;
}

interface TailAnalysis {
  activity?: SessionActivity;
  backgroundStarts: BackgroundStart[];
  notifiedTaskIds: string[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

/** Ce que Claude Code renvoie en tool_result d'un Bash lancé en arrière-plan. */
const BACKGROUND_RESULT_PATTERN = /Command running in background with ID: (\S+?)\. Output is being written to: (.+?\.output)/;
/** Contenu (déjà désérialisé) d'une notification de fin de tâche, enfilée ou livrée à l'agent. */
const TASK_NOTIFICATION_PATTERN = /^<task-notification>/;
/** Une même notification en groupe parfois plusieurs (rattrapage des tâches orphelines d'une session passée). */
const TASK_ID_PATTERN = /<task-id>([^<\s]+)<\/task-id>/g;

/** Texte d'un bloc tool_result : chaîne, ou tableau de blocs text. */
function resultText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : '')).join('\n');
  }
  return '';
}

function taskIdsInNotification(content: unknown): string[] {
  if (typeof content !== 'string' || !TASK_NOTIFICATION_PATTERN.test(content)) {
    return [];
  }
  return [...content.matchAll(TASK_ID_PATTERN)].map((match) => match[1]);
}

interface PendingTool {
  name: string;
  since: number;
}

interface LastMessage {
  kind: 'user' | 'assistant';
  since: number;
  stopReason?: unknown;
}

/**
 * Phase de l'agent principal. Une question posée prime ; sinon un tool_use sans tool_result = outil en cours ;
 * sinon une dernière ligne user (ou un bloc assistant sans stop_reason) = le modèle génère ; sinon tour terminé.
 */
function inferActivity(last: LastMessage | undefined, pendingTools: Map<string, PendingTool>): SessionActivity | undefined {
  if (!last) {
    return undefined;
  }
  const pending = [...pendingTools.values()];
  const question = pending.find((tool) => tool.name === 'AskUserQuestion');
  const activity: SessionActivity = question
    ? { phase: 'waiting', since: question.since }
    : pending.length > 0
      ? { phase: 'tool', tool: pending[0].name, since: pending[0].since }
      : last.kind === 'user' || last.stopReason === undefined || last.stopReason === null
        ? { phase: 'thinking', since: last.since }
        : { phase: 'idle', since: last.since };
  return Number.isNaN(activity.since) ? undefined : activity;
}

/**
 * Relit la fenêtre ligne par ligne (JSON) : phase de l'agent principal et commandes de fond. Les lignes
 * assistant sont écrites bloc par bloc à la fin de chaque réponse, avec le stop_reason du message entier ;
 * la première ligne (tronquée par la fenêtre) et une dernière ligne en cours d'écriture sont ignorées.
 */
function analyzeTail(tail: string): TailAnalysis {
  const pendingTools = new Map<string, PendingTool>();
  const starts = new Map<string, BackgroundStart>();
  const notifiedTaskIds: string[] = [];
  let last: LastMessage | undefined;
  for (const line of tail.split('\n')) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record)) {
      continue;
    }
    const since = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
    if (record.type === 'queue-operation') {
      notifiedTaskIds.push(...taskIdsInNotification(record.content));
      continue;
    }
    const message = isRecord(record.message) ? record.message : undefined;
    const content = message?.content;
    if (record.type === 'assistant') {
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block) || block.type !== 'tool_use' || typeof block.id !== 'string') {
            continue;
          }
          const name = typeof block.name === 'string' ? block.name : '?';
          pendingTools.set(block.id, { name, since });
          const input = isRecord(block.input) ? block.input : undefined;
          if (name === 'Bash' && input?.run_in_background === true && typeof input.command === 'string') {
            starts.set(block.id, {
              toolUseId: block.id,
              command: input.command,
              description: typeof input.description === 'string' ? input.description : undefined,
              startedAt: since,
            });
          }
        }
      }
      last = { kind: 'assistant', since, stopReason: message?.stop_reason };
    } else if (record.type === 'user') {
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block) || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
            continue;
          }
          pendingTools.delete(block.tool_use_id);
          const match = BACKGROUND_RESULT_PATTERN.exec(resultText(block.content));
          const start = match ? starts.get(block.tool_use_id) : undefined;
          if (match && start) {
            start.taskId = match[1];
            start.outputFile = match[2];
          }
        }
      }
      notifiedTaskIds.push(...taskIdsInNotification(content));
      last = { kind: 'user', since };
    }
  }
  return { activity: inferActivity(last, pendingTools), backgroundStarts: [...starts.values()], notifiedTaskIds };
}

const TODO_STATUSES = new Set<TodoStatus>(['pending', 'in_progress', 'completed']);
const TODO_WRITE_MARKER = '"name":"TodoWrite"';
/** Seules les lignes user (prompt humain et tool_result) portent un promptId ; il change à chaque prompt humain. */
const PROMPT_ID_PATTERN = /"promptId"\s*:\s*"([^"]+)"/g;

/**
 * promptId du tour qui a écrit la TodoWrite : la ligne user qui la précède, sinon (début de fenêtre)
 * son propre tool_result, première ligne user qui la suit et qui porte le même promptId.
 */
function todoPromptId(promptIds: RegExpMatchArray[], todoIdx: number): string | undefined {
  if (todoIdx === -1) {
    return undefined;
  }
  const before = promptIds.filter((match) => (match.index ?? 0) < todoIdx);
  if (before.length > 0) {
    return before[before.length - 1]?.[1];
  }
  return promptIds.find((match) => (match.index ?? 0) > todoIdx)?.[1];
}

/** Dernière liste TodoWrite de la queue (idx = position du marqueur, -1 si absent) : on parse la ligne JSONL complète. */
function extractTodos(tail: string, idx: number): TodoItem[] | undefined {
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

/** Alias nus acceptés par le paramètre model des appels Agent : jamais l'id de modèle d'une session. */
const AGENT_MODEL_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'fable', 'mythos', 'inherit']);

/** Vrai id de modèle, quel qu'il soit (« claude-opus-5 », « glm-4.6 »…) : écarte « <synthetic> » et les alias nus des appels Agent. */
function isModelId(value: string): boolean {
  return value !== '<synthetic>' && !AGENT_MODEL_ALIASES.has(value);
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
  const todoIdx = tail.lastIndexOf(TODO_WRITE_MARKER);
  const promptIds = [...tail.matchAll(PROMPT_ID_PATTERN)];
  return {
    model: lastMatch(tail, /"model"\s*:\s*"([^"]+)"/g, isModelId),
    customTitle: rawCustomTitle !== undefined ? unescapeJsonString(rawCustomTitle) : undefined,
    aiTitle: rawAiTitle !== undefined ? unescapeJsonString(rawAiTitle) : undefined,
    contextTokens: extractContextTokens(tail),
    gitBranch: lastMatch(tail, /"gitBranch"\s*:\s*"([^"]+)"/g),
    lastTool: toolUses.length > 0 ? toolUses[toolUses.length - 1][2] : undefined,
    pendingQuestion: pendingQuestion.pending,
    pendingQuestionText: pendingQuestion.text,
    todos: extractTodos(tail, todoIdx),
    todosPromptId: todoPromptId(promptIds, todoIdx),
    lastPromptId: promptIds[promptIds.length - 1]?.[1],
    toolUseIds: toolUses.map((match) => match[1]),
    ...analyzeTail(tail),
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

interface CachedTodos {
  items: TodoItem[];
  /** promptId du tour qui a produit la liste (renseigné dès qu'une fenêtre de lecture le montre). */
  promptId?: string;
  /** Liste terminée dépassée par un nouveau prompt : masquée tant que la même liste est relue. */
  superseded: boolean;
}

/** Dernière todo-list vue par session : survit à sa sortie de la fenêtre de lecture bornée. */
const todosCache = new Map<string, CachedTodos>();

function sameTodos(a: TodoItem[], b: TodoItem[]): boolean {
  return a.length === b.length && a.every((todo, i) => todo.content === b[i]?.content && todo.status === b[i]?.status);
}

/** Mémorise la liste lue ; une relecture de la même liste garde son entrée (promptId connu, masquage collant). */
function rememberTodos(sessionId: string, items: TodoItem[], promptId: string | undefined): void {
  const cached = todosCache.get(sessionId);
  if (cached && sameTodos(cached.items, items)) {
    if (cached.promptId === undefined) {
      cached.promptId = promptId;
    }
    return;
  }
  todosCache.set(sessionId, { items, promptId, superseded: false });
}

/** Une liste entièrement terminée, datée, attend le verdict « un nouveau prompt l'a-t-il suivie ? ». */
function awaitsSupersession(cached: CachedTodos): boolean {
  return !cached.superseded && cached.promptId !== undefined && cached.items.every((todo) => todo.status === 'completed');
}

/** Lecture profonde du dernier promptId quand la queue de 64 Ko n'en montre aucun (ligne user géante) ; une fois par version du fichier. */
const PROMPT_ID_DEEP_READ_BYTES = 2 * 1024 * 1024;
const deepPromptIdCache = new Map<string, { mtimeMs: number; promptId?: string }>();

function readLastPromptIdDeep(filePath: string, mtimeMs: number): string | undefined {
  const cached = deepPromptIdCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.promptId;
  }
  const chunk = readChunk(filePath, 'tail', PROMPT_ID_DEEP_READ_BYTES);
  const promptId = chunk === undefined ? undefined : lastMatch(chunk, PROMPT_ID_PATTERN);
  deepPromptIdCache.set(filePath, { mtimeMs, promptId });
  return promptId;
}

const DESCRIPTION_READ_BYTES = 8 * 1024;
/** Assez long pour un tooltip lisible ; l'ellipse d'affichage est faite en CSS. */
const DESCRIPTION_MAX_LENGTH = 500;
const AGENT_FILE_PATTERN = /^agent-[^.]+\.jsonl$/;

/** Tri chronologique de création, départage par id (le birthtime peut être identique ou absent selon les FS). */
export function compareAgents(a: AgentNode, b: AgentNode): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

function truncate(text: string): string {
  return text.length > DESCRIPTION_MAX_LENGTH ? text.slice(0, DESCRIPTION_MAX_LENGTH - 1) + '…' : text;
}

/** Première ligne non vide d'un texte, bornée pour l'affichage. */
function firstLine(text: string | undefined): string | undefined {
  const line = text
    ?.split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line === undefined ? undefined : truncate(line);
}

/** Texte du premier message user portant du texte (le prompt de l'agent), dans la limite de la lecture bornée en tête. */
export function extractPrompt(filePath: string): string | undefined {
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
    if (text !== undefined && text.trim().length > 0) {
      return text;
    }
  }
  return undefined;
}

export function extractDescription(filePath: string): string | undefined {
  return firstLine(extractPrompt(filePath));
}

interface TranscriptMeta {
  mtimeMs: number;
  /** Prompt de l'agent (premier message user), borné par la lecture en tête. */
  prompt: string | undefined;
  /** Description donnée à l'outil Agent, lue dans le meta.json (absente pour un agent de workflow). */
  metaDescription: string | undefined;
  description: string | undefined;
  detail: string | undefined;
  model: string | undefined;
  contextTokens: number | undefined;
  agentType: string | undefined;
  lastTool: string | undefined;
  toolUseId: string | undefined;
  toolUseIds: string[];
}

interface AgentMetaFile {
  agentType?: string;
  toolUseId?: string;
  /** Description passée à l'outil Agent par le parent (« Corrige les largeurs du tableau »). */
  description?: string;
}

/** Métadonnées du fichier frère agent-<id>.meta.json (immuable). */
function readAgentMetaFile(transcriptPath: string): AgentMetaFile {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(transcriptPath.replace(/\.jsonl$/, '.meta.json'), 'utf8'),
    );
    const { agentType, toolUseId, description } = parsed as {
      agentType?: unknown;
      toolUseId?: unknown;
      description?: unknown;
    };
    return {
      agentType: typeof agentType === 'string' ? agentType : undefined,
      toolUseId: typeof toolUseId === 'string' ? toolUseId : undefined,
      description: typeof description === 'string' && description.trim().length > 0 ? description.trim() : undefined,
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
  const metaFile: AgentMetaFile =
    cached && (cached.agentType !== undefined || cached.toolUseId !== undefined)
      ? { agentType: cached.agentType, toolUseId: cached.toolUseId, description: cached.metaDescription }
      : readAgentMetaFile(filePath);
  const prompt = cached?.prompt ?? extractPrompt(filePath);
  // Libellé : la description donnée par le parent si elle existe, sinon la première ligne du prompt ;
  // dans le premier cas le début du prompt reste consultable en infobulle.
  const meta: TranscriptMeta = {
    mtimeMs,
    prompt,
    metaDescription: metaFile.description,
    description: metaFile.description ?? firstLine(prompt),
    detail: metaFile.description !== undefined && prompt !== undefined ? truncate(prompt.trim()) : undefined,
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
  promptsOut?: Map<string, string>,
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
        detail: meta.detail,
        model: meta.model,
        contextTokens: meta.contextTokens,
        agentType: meta.agentType,
        lastTool: meta.lastTool,
        toolUseId: meta.toolUseId,
      });
      spawnedOut?.set(id, new Set(meta.toolUseIds));
      if (meta.prompt !== undefined) {
        promptsOut?.set(id, meta.prompt);
      }
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

/** Claude Code sauvegarde chaque script de workflow sous <session>/workflows/scripts/<nom>-<runId>.js. */
const WORKFLOW_SCRIPT_PATTERN = /^(.+)-(wf_[^/\\]+)\.js$/;

/** Ce qu'on sait d'un run par son script ou son json de fin : nom, et bloc meta (description, phases prévues). */
interface WorkflowInfo {
  name?: string;
  description?: string;
  phases?: WorkflowPhase[];
  /** Label donné par le script à chaque agent (agentId → opts.label) : connu seulement par le json de fin de run. */
  labels?: Map<string, string>;
}

interface WorkflowScript {
  name: string;
  file: string;
}

/** runId → script <nom>-<runId>.js du dossier ; vide si le dossier manque (anciens runs, workflows nommés). */
function readWorkflowScripts(scriptsDir: string): Map<string, WorkflowScript> {
  const scripts = new Map<string, WorkflowScript>();
  let files: string[];
  try {
    files = fs.readdirSync(scriptsDir);
  } catch {
    return scripts;
  }
  for (const file of files) {
    const match = WORKFLOW_SCRIPT_PATTERN.exec(file);
    if (match) {
      scripts.set(match[2], { name: match[1], file: path.join(scriptsDir, file) });
    }
  }
  return scripts;
}

/** Nom du fichier + bloc meta du script (lu une fois : le résultat est mémorisé par runId). */
function readScriptInfo(script: WorkflowScript): WorkflowInfo {
  try {
    return { name: script.name, ...parseWorkflowMeta(fs.readFileSync(script.file, 'utf8')) };
  } catch {
    return { name: script.name };
  }
}

/** workflowProgress du json de fin de run : une entrée workflow_agent par agent, portant le label choisi par le script. */
function readProgressLabels(progress: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  if (Array.isArray(progress)) {
    for (const entry of progress) {
      if (
        isRecord(entry) &&
        entry.type === 'workflow_agent' &&
        typeof entry.agentId === 'string' &&
        typeof entry.label === 'string'
      ) {
        labels.set(entry.agentId, entry.label);
      }
    }
  }
  return labels;
}

/** Infos lues dans <session>/workflows/<runId>.json (script absent, ou relancé sous un autre runId) ; une lecture par version du fichier, qui peut peser des centaines de Ko. */
const workflowJsonInfoCache = new Map<string, { mtimeMs: number; info?: WorkflowInfo }>();

function readWorkflowJsonInfo(jsonPath: string): WorkflowInfo | undefined {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(jsonPath).mtimeMs;
  } catch {
    return undefined;
  }
  const cached = workflowJsonInfoCache.get(jsonPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.info;
  }
  let info: WorkflowInfo | undefined;
  try {
    const json: unknown = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (isRecord(json) && typeof json.workflowName === 'string') {
      info = {
        name: json.workflowName,
        ...(typeof json.script === 'string' ? parseWorkflowMeta(json.script) : {}),
        labels: readProgressLabels(json.workflowProgress),
      };
    }
  } catch {
    info = undefined;
  }
  workflowJsonInfoCache.set(jsonPath, { mtimeMs, info });
  return info;
}

/**
 * Où chercher le nom d'un run : le dossier workflows/ de la session (scripts/ puis <runId>.json, écrit en fin de run),
 * puis les mêmes dossiers dans les autres dossiers de projet — Claude Code range le script d'après le cwd du moment,
 * pas d'après celui de la session.
 */
interface WorkflowNameSources {
  sessionWorkflowsDir: string;
  siblingWorkflowsDirs: string[];
}

/** Infos résolues par runId : elles ne changent jamais une fois connues (plus de json relu ni de dossiers voisins sondés). */
const workflowInfoCache = new Map<string, WorkflowInfo>();

function findScriptInSiblings(runId: string, siblingWorkflowsDirs: string[]): WorkflowScript | undefined {
  for (const dir of siblingWorkflowsDirs) {
    const script = readWorkflowScripts(path.join(dir, 'scripts')).get(runId);
    if (script !== undefined) {
      return script;
    }
  }
  return undefined;
}

/** Runs dont les dossiers voisins ont déjà été sondés : le script est écrit avant le dossier de run, un second sondage ne trouverait rien de plus. */
const siblingsProbed = new Set<string>();

function resolveWorkflowInfo(
  runId: string,
  localScripts: Map<string, WorkflowScript>,
  sources: WorkflowNameSources,
): WorkflowInfo | undefined {
  const known = workflowInfoCache.get(runId);
  if (known !== undefined) {
    return known;
  }
  const local = localScripts.get(runId);
  let info = local ? readScriptInfo(local) : readWorkflowJsonInfo(path.join(sources.sessionWorkflowsDir, `${runId}.json`));
  if (info === undefined && !siblingsProbed.has(runId)) {
    siblingsProbed.add(runId);
    const sibling = findScriptInSiblings(runId, sources.siblingWorkflowsDirs);
    info = sibling ? readScriptInfo(sibling) : undefined;
  }
  if (info !== undefined) {
    workflowInfoCache.set(runId, info);
  }
  return info;
}

/** Agents signalés en échec par le journal du run ({"type":"failed","agentId":…}) ; relu seulement quand le journal change. */
const FAILED_AGENT_PATTERN = /"type"\s*:\s*"failed"[^\n]*?"agentId"\s*:\s*"([^"\n]+)"/g;
const journalFailedCache = new Map<string, { mtimeMs: number; ids: Set<string> }>();

function readFailedAgentIds(journalPath: string): Set<string> {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(journalPath).mtimeMs;
  } catch {
    return new Set();
  }
  const cached = journalFailedCache.get(journalPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.ids;
  }
  const ids = new Set<string>();
  try {
    for (const match of fs.readFileSync(journalPath, 'utf8').matchAll(FAILED_AGENT_PATTERN)) {
      if (match[1]) {
        ids.add(match[1]);
      }
    }
  } catch {
    // Journal illisible : aucun échec connu pour ce scan.
  }
  journalFailedCache.set(journalPath, { mtimeMs, ids });
  return ids;
}

/**
 * Les agents d'un run partagent souvent un long préambule (dépôt, consignes) avant leur tâche propre : le libellé
 * de chacun devient sa première ligne après le préambule commun à tout le run, et `detail` la suite de son prompt
 * (infobulle). Un run d'un seul agent, ou aux prompts tous identiques, garde la première ligne : rien n'y distingue
 * un préambule.
 */
function labelWorkflowAgents(agents: AgentNode[], prompts: Map<string, string>): void {
  const texts = agents.map((agent) => prompts.get(agent.id)).filter((text): text is string => text !== undefined);
  if (texts.length < 2) {
    return;
  }
  const prefix = commonPrefix(texts);
  if (texts.every((text) => text.length === prefix.length)) {
    return;
  }
  // Coupe en début de ligne seulement : « DIMENSION — PARITÉ » et « DIMENSION — PARALLÉLISATION » divergent au milieu d'une ligne.
  const cut = prefix.lastIndexOf('\n') + 1;
  if (cut === 0) {
    return;
  }
  for (const agent of agents) {
    const rest = prompts.get(agent.id)?.slice(cut).trim();
    const label = firstLine(rest);
    if (rest === undefined || label === undefined) {
      continue;
    }
    agent.description = label;
    const detail = truncate(rest);
    if (detail !== label) {
      agent.detail = detail;
    }
  }
}

function commonPrefix(texts: string[]): string {
  let prefix = texts[0];
  for (const text of texts.slice(1)) {
    let length = 0;
    while (length < prefix.length && length < text.length && prefix[length] === text[length]) {
      length++;
    }
    prefix = prefix.slice(0, length);
  }
  return prefix;
}

/** Labels du script pour ce run : le json de fin de run est consulté à chaque scan tant qu'ils manquent, puis mémorisés avec les infos du run. */
function resolveWorkflowLabels(info: WorkflowInfo | undefined, jsonPath: string): Map<string, string> | undefined {
  if (info?.labels !== undefined) {
    return info.labels;
  }
  const labels = readWorkflowJsonInfo(jsonPath)?.labels;
  if (info !== undefined && labels !== undefined) {
    info.labels = labels;
  }
  return labels;
}

/** Le label donné par le script remplace le libellé tiré du prompt, qui reste en détail (infobulle). */
function applyScriptLabels(agents: AgentNode[], labels: Map<string, string> | undefined): void {
  if (labels === undefined) {
    return;
  }
  for (const agent of agents) {
    const label = labels.get(agent.id.replace(/^agent-/, ''));
    if (label === undefined) {
      continue;
    }
    if (agent.detail === undefined) {
      agent.detail = agent.description;
    }
    agent.description = label;
  }
}

function scanWorkflows(
  workflowsDir: string,
  nameSources: WorkflowNameSources,
  now: number,
  activeThresholdMs: number,
  log: Log,
): WorkflowNode[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workflowsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries.filter((entry) => entry.isDirectory());
  const unknown = dirs.some((entry) => !workflowInfoCache.has(entry.name));
  const localScripts = unknown
    ? readWorkflowScripts(path.join(nameSources.sessionWorkflowsDir, 'scripts'))
    : new Map<string, WorkflowScript>();
  return dirs
    .map((entry) => {
      const runDir = path.join(workflowsDir, entry.name);
      const prompts = new Map<string, string>();
      const agents = scanAgentsDir(runDir, now, activeThresholdMs, log, undefined, prompts);
      // Un run sans agent est filtré plus bas : ne pas lire (ni mettre en cache) son journal.
      const failedIds = agents.length > 0 ? readFailedAgentIds(path.join(runDir, 'journal.jsonl')) : new Set<string>();
      for (const agent of agents) {
        if (failedIds.has(agent.id.replace(/^agent-/, ''))) {
          agent.status = 'failed';
        }
      }
      const info = resolveWorkflowInfo(entry.name, localScripts, nameSources);
      if (agents.length > 0) {
        labelWorkflowAgents(agents, prompts);
        applyScriptLabels(
          agents,
          resolveWorkflowLabels(info, path.join(nameSources.sessionWorkflowsDir, `${entry.name}.json`)),
        );
      }
      return {
        id: entry.name,
        name: info?.name,
        description: info?.description,
        phases: info?.phases,
        agents,
        totalCount: agents.length,
        finishedCount: agents.filter((agent) => agent.status === 'finished').length,
        failedCount: agents.filter((agent) => agent.status === 'failed').length,
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

/** Tête de la sortie d'une commande de fond, où un serveur annonce son adresse. */
const OUTPUT_READ_BYTES = 4 * 1024;
/** Queue de cette même sortie, où Claude Code écrit le marqueur de shell tué. */
const OUTPUT_TAIL_BYTES = 512;
/** Dernière ligne écrite par Claude Code quand il tue un shell de fond : aucune notification ne suit. */
const KILLED_MARKER = '[killed]';
/** Une notification enfilée fait ~600 octets : marge de relecture autour de la frontière de la fenêtre. */
const NOTIFICATION_OVERLAP_BYTES = 2 * 1024;
/** Au-delà, on renonce à rattraper les notifications passées hors fenêtre entre deux scans. */
const NOTIFICATION_CATCHUP_MAX_BYTES = 8 * 1024 * 1024;
/** Suite des ids d'une notification de fin telle qu'elle apparaît dans le JSONL brut (\\n = deux caractères). */
const TASK_NOTIFICATION_RAW_PATTERN = /<task-notification>((?:\\n<task-id>[^<\\]+<\/task-id>)+)/g;
/** Chaque id de cette suite. */
const TASK_ID_RAW_PATTERN = /<task-id>([^<\\]+)<\/task-id>/g;

interface CachedBackground {
  tasks: Map<string, BackgroundTask>;
  /** Fichier de sortie de chaque tâche et mtime déjà lu (adresse locale et marqueur de fin). */
  outputs: Map<string, { file: string; mtimeMs: number }>;
  /** Tâches dont la sortie s'est terminée par le marqueur : leur lancement, encore en fenêtre, ne les ressuscite pas. */
  killed: Set<string>;
  /** Taille du transcript au scan précédent : les octets suivants passés hors fenêtre sont relus. */
  scannedSize: number;
}

const backgroundCache = new Map<string, CachedBackground>();

/** Au premier scan d'une session, relecture (bornée) du transcript : un serveur lancé il y a une heure en est loin. */
const BACKGROUND_BOOTSTRAP_BYTES = 8 * 1024 * 1024;
/** Seules les lignes portant l'un de ces marqueurs comptent : pré-filtre avant le JSON.parse. */
const BACKGROUND_MARKER_PATTERN = /run_in_background|running in background with ID|<task-notification>/g;

/** Lignes complètes du bloc contenant un marqueur, dans l'ordre, sans découper tout le bloc. */
function markedLines(chunk: string): string[] {
  const lines: string[] = [];
  let lastStart = -1;
  for (const match of chunk.matchAll(BACKGROUND_MARKER_PATTERN)) {
    const start = chunk.lastIndexOf('\n', match.index) + 1;
    if (start === lastStart) {
      continue;
    }
    lastStart = start;
    const end = chunk.indexOf('\n', match.index);
    lines.push(chunk.slice(start, end === -1 ? chunk.length : end));
  }
  return lines;
}

function bootstrapBackground(transcriptPath: string, size: number): TailAnalysis | undefined {
  if (size <= TAIL_READ_BYTES) {
    return undefined;
  }
  const chunk = readChunk(transcriptPath, 'tail', BACKGROUND_BOOTSTRAP_BYTES);
  if (chunk === undefined) {
    return undefined;
  }
  return analyzeTail(markedLines(chunk).join('\n'));
}

function addBackgroundStarts(cached: CachedBackground, starts: BackgroundStart[]): void {
  for (const start of starts) {
    if (start.taskId === undefined || cached.tasks.has(start.taskId) || cached.killed.has(start.taskId)) {
      continue;
    }
    cached.tasks.set(start.taskId, {
      id: start.taskId,
      command: start.command,
      description: start.description,
      startedAt: start.startedAt,
    });
    if (start.outputFile) {
      cached.outputs.set(start.taskId, { file: start.outputFile, mtimeMs: -1 });
    }
  }
}

/** Un transcript qui grossit de plus d'une fenêtre entre deux scans : relit la partie sautée pour les fins de tâche. */
function catchUpNotifications(transcriptPath: string, cached: CachedBackground, size: number): void {
  const skipped = size - TAIL_READ_BYTES + NOTIFICATION_OVERLAP_BYTES - cached.scannedSize;
  if (cached.tasks.size === 0 || size - TAIL_READ_BYTES <= cached.scannedSize) {
    return;
  }
  const text = readRange(transcriptPath, cached.scannedSize, Math.min(skipped, NOTIFICATION_CATCHUP_MAX_BYTES));
  for (const notification of (text ?? '').matchAll(TASK_NOTIFICATION_RAW_PATTERN)) {
    for (const id of notification[1].matchAll(TASK_ID_RAW_PATTERN)) {
      cached.tasks.delete(id[1]);
    }
  }
}

/** Le shell a été tué : Claude Code l'écrit seul sur la dernière ligne de la sortie, jamais dans le transcript. */
function endsKilled(tail: string): boolean {
  const lines = tail.trimEnd().split('\n');
  return lines[lines.length - 1].trim() === KILLED_MARKER;
}

/**
 * Relit la sortie de chaque tâche à chaque changement du fichier : le marqueur de shell tué en queue,
 * et l'adresse locale en tête tant qu'elle manque.
 */
function refreshFromOutputs(cached: CachedBackground): void {
  for (const task of [...cached.tasks.values()]) {
    const output = cached.outputs.get(task.id);
    if (!output) {
      continue;
    }
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(output.file).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs === output.mtimeMs) {
      continue;
    }
    output.mtimeMs = mtimeMs;
    const tail = readChunk(output.file, 'tail', OUTPUT_TAIL_BYTES);
    if (tail !== undefined && endsKilled(tail)) {
      cached.tasks.delete(task.id);
      cached.outputs.delete(task.id);
      cached.killed.add(task.id);
      continue;
    }
    if (task.url === undefined) {
      const head = readChunk(output.file, 'head', OUTPUT_READ_BYTES);
      const url = head !== undefined ? extractLocalUrl(head) : undefined;
      if (url) {
        task.url = url;
      }
    }
  }
}

/**
 * Tâches de fond encore en cours : lancements vus dans la fenêtre (mémorisés, car ils en sortent vite),
 * retirées à leur notification de fin — vue dans la fenêtre ou rattrapée dans les octets sautés —
 * ou au marqueur de shell tué que Claude Code n'écrit que dans la sortie de la commande.
 */
function updateBackgroundTasks(
  sessionId: string,
  transcriptPath: string,
  size: number,
  meta: TailMeta,
): BackgroundTask[] | undefined {
  let cached = backgroundCache.get(sessionId);
  if (!cached) {
    cached = { tasks: new Map(), outputs: new Map(), killed: new Set(), scannedSize: size };
    backgroundCache.set(sessionId, cached);
    const past = bootstrapBackground(transcriptPath, size);
    if (past) {
      addBackgroundStarts(cached, past.backgroundStarts);
      for (const id of past.notifiedTaskIds) {
        cached.tasks.delete(id);
      }
    }
  }
  addBackgroundStarts(cached, meta.backgroundStarts ?? []);
  catchUpNotifications(transcriptPath, cached, size);
  cached.scannedSize = size;
  for (const id of meta.notifiedTaskIds ?? []) {
    cached.tasks.delete(id);
  }
  refreshFromOutputs(cached);
  if (cached.tasks.size === 0) {
    return undefined;
  }
  return [...cached.tasks.values()].sort((a, b) => a.startedAt - b.startedAt);
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
    name: registryName(entry),
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
    const meta = readSessionTailMeta(transcriptPath, stat.mtimeMs);
    session.activity = meta.activity;
    // Session reprise (--resume) : un prompt sans réponse ou un outil sans résultat datant d'avant le démarrage
    // du processus ne sont plus en cours — sans quoi la carte « réfléchit » depuis des jours.
    if (
      meta.activity &&
      (meta.activity.phase === 'thinking' || meta.activity.phase === 'tool') &&
      meta.activity.since < entry.startedAt
    ) {
      session.activity = { phase: 'idle', since: meta.activity.since };
    }
    // Phase connue : actif tant que le modèle génère ou qu'un outil tourne, au repos dès la fin du tour
    // (une longue réflexion n'écrit rien pendant des minutes) ; sinon, règle historique par mtime.
    session.active = session.activity
      ? session.activity.phase === 'thinking' || session.activity.phase === 'tool'
      : now - stat.mtimeMs < activeThresholdMs;
    session.backgroundTasks = updateBackgroundTasks(entry.sessionId, transcriptPath, stat.size, meta);
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
      rememberTodos(entry.sessionId, meta.todos, meta.todosPromptId);
    }
    const cachedTodos = todosCache.get(entry.sessionId);
    if (cachedTodos && awaitsSupersession(cachedTodos)) {
      const lastPromptId = meta.lastPromptId ?? readLastPromptIdDeep(transcriptPath, stat.mtimeMs);
      if (lastPromptId !== undefined && lastPromptId !== cachedTodos.promptId) {
        cachedTodos.superseded = true;
      }
    }
  } catch {
    // Transcript introuvable : la session reste affichée avec les infos du registre.
  }
  const todos = todosCache.get(entry.sessionId);
  session.todos = todos && !todos.superseded ? todos.items : undefined;
  // Priorité : renommage manuel > titre généré par l'IA > nom du registre (« marketing-94 »).
  const bestTitle = customTitleCache.get(entry.sessionId) ?? aiTitleCache.get(entry.sessionId);
  if (bestTitle) {
    session.name = bestTitle;
  }

  const subagentsDir = path.join(projectDir, entry.sessionId, 'subagents');
  const spawned = new Map<string, Set<string>>();
  session.agents = orderByFiliation(scanAgentsDir(subagentsDir, now, activeThresholdMs, log, spawned), spawned);
  session.workflows = scanWorkflows(
    path.join(subagentsDir, 'workflows'),
    {
      sessionWorkflowsDir: path.join(projectDir, entry.sessionId, 'workflows'),
      siblingWorkflowsDirs: projectDirNames
        .map((dirName) => path.join(projectsRoot, dirName))
        .filter((dir) => dir !== projectDir)
        .map((dir) => path.join(dir, entry.sessionId, 'workflows')),
    },
    now,
    activeThresholdMs,
    log,
  );

  // Une session qui délègue n'écrit plus dans son propre transcript : son activité
  // réelle est celle de ses agents. On agrège statut et dernière activité.
  let delegating = false;
  for (const agent of [...session.agents, ...session.workflows.flatMap((workflow) => workflow.agents)]) {
    if (session.lastActivity === undefined || agent.lastActivity > session.lastActivity) {
      session.lastActivity = agent.lastActivity;
    }
    if (agent.status === 'active') {
      session.active = true;
      delegating = true;
    }
  }
  // Tour terminé mais des agents lancés en arrière-plan tournent : la session attend leur retour.
  if (delegating && session.activity?.phase === 'idle') {
    session.activity = { phase: 'delegating', since: session.activity.since };
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
  deepPromptIdCache.clear();
  workflowJsonInfoCache.clear();
  workflowInfoCache.clear();
  siblingsProbed.clear();
  journalFailedCache.clear();
  backgroundCache.clear();
  effortLevelCache.clear();
}

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/** Horloge fixe injectée dans scan() — les mtimes des fixtures sont posés relativement à elle. */
export const NOW = 1_800_000_000_000;

const created: string[] = [];

/** Crée un faux ~/.claude avec sessions/ et projects/ vides. */
export function makeClaudeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-agents-test-'));
  created.push(dir);
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  mkdirSync(join(dir, 'projects'), { recursive: true });
  return dir;
}

export function cleanupClaudeDirs(): void {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Écrit un fichier de registre sessions/<pid>.json. Passer une chaîne pour un JSON corrompu. */
export function writeRegistry(claudeDir: string, entry: { pid: number } & Record<string, unknown>): void {
  writeFileSync(join(claudeDir, 'sessions', `${entry.pid}.json`), JSON.stringify(entry));
}

export function writeCorruptRegistry(claudeDir: string, fileName: string, content: string): void {
  writeFileSync(join(claudeDir, 'sessions', fileName), content);
}

/** Fixe le mtime d'un fichier à NOW - ageMs. */
export function touch(filePath: string, ageMs: number): void {
  const time = new Date(NOW - ageMs);
  utimesSync(filePath, time, time);
}

/** Ligne JSONL d'entrée assistant portant un champ model (et une branche git optionnelle). */
export function assistantLine(model: string, gitBranch?: string): string {
  return JSON.stringify({
    type: 'assistant',
    ...(gitBranch !== undefined ? { gitBranch } : {}),
    message: { role: 'assistant', model, content: [{ type: 'text', text: 'ok' }] },
  });
}

/**
 * Ligne user telle que Claude Code ≥ 2.1.263 l'écrit : `origin.kind` distingue un prompt tapé par l'humain
 * (`human`) d'une notification de fin de tâche livrée à l'agent (`task-notification`).
 */
export function originLine(kind: 'human' | 'task-notification', text: string, timestamp: number): string {
  return JSON.stringify({
    promptId: `p-${timestamp}`,
    type: 'user',
    timestamp: new Date(timestamp).toISOString(),
    origin: { kind },
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
}

/** Ligne JSONL d'entrée user (content chaîne). */
export function userLine(text: string, promptId?: string): string {
  return JSON.stringify({
    ...(promptId !== undefined ? { promptId } : {}),
    type: 'user',
    message: { role: 'user', content: text },
  });
}

/** Ligne JSONL assistant portant un bloc tool_use (ordre des champs identique aux vrais transcripts). */
export function toolUseLine(
  toolName: string,
  toolUseId: string,
  model = 'claude-fable-5',
  input: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      model,
      content: [{ type: 'tool_use', id: toolUseId, name: toolName, input }],
    },
  });
}

/** Ligne JSONL assistant portant une AskUserQuestion avec son texte de question. */
export function askQuestionLine(toolUseId: string, question: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-fable-5',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'AskUserQuestion',
          input: { questions: [{ question, header: 'Choix', multiSelect: false, options: [] }] },
        },
      ],
    },
  });
}

/** Ligne JSONL user portant le tool_result d'un tool_use antérieur. */
export function toolResultLine(toolUseId: string, promptId?: string): string {
  return JSON.stringify({
    ...(promptId !== undefined ? { promptId } : {}),
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] },
  });
}

/** Ligne JSONL assistant portant un bloc tool_use TodoWrite avec sa liste de tâches. */
export function todoWriteLine(todos: Array<{ content: string; status: string }>): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-fable-5',
      content: [
        {
          type: 'tool_use',
          id: 'tu-todo',
          name: 'TodoWrite',
          input: {
            todos: todos.map((t) => ({ content: t.content, status: t.status, activeForm: `En cours : ${t.content}` })),
          },
        },
      ],
    },
  });
}

/** Écrit projects/<projectDirName>/<sessionId>.jsonl avec le mtime NOW - ageMs. */
export function writeTranscript(
  claudeDir: string,
  projectDirName: string,
  sessionId: string,
  lines: string[],
  ageMs: number,
): string {
  const dir = join(claudeDir, 'projects', projectDirName);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${sessionId}.jsonl`);
  writeFileSync(filePath, lines.join('\n') + '\n');
  touch(filePath, ageMs);
  return filePath;
}

/**
 * Écrit <agentsDir>/agent-<agentId>.jsonl (première ligne = prompt user, seconde = réponse assistant)
 * avec le mtime NOW - ageMs. agentsDir est typiquement .../<sessionId>/subagents ou .../subagents/workflows/<wfId>.
 */
export function writeAgent(
  agentsDir: string,
  agentId: string,
  prompt: string,
  ageMs: number,
  model = 'claude-fable-5',
): string {
  mkdirSync(agentsDir, { recursive: true });
  const filePath = join(agentsDir, `agent-${agentId}.jsonl`);
  writeFileSync(filePath, [userLine(prompt), assistantLine(model)].join('\n') + '\n');
  touch(filePath, ageMs);
  return filePath;
}

/**
 * Ligne JSONL assistant portant model + usage (pour contextTokens). `ephemeral` ventile cache_creation
 * comme l'API (`ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`) ; `effort` = champ racine des
 * lignes assistant depuis Claude Code 2.1.270 ; `timestamp` date la ligne.
 */
export function assistantUsageLine(
  model: string,
  usage: { input: number; cacheRead: number; cacheCreation: number },
  extra: { ephemeral?: '5m' | '1h'; effort?: string; timestamp?: number } = {},
): string {
  const cacheCreation =
    extra.ephemeral === undefined
      ? {}
      : {
          cache_creation: {
            ephemeral_5m_input_tokens: extra.ephemeral === '5m' ? usage.cacheCreation : 0,
            ephemeral_1h_input_tokens: extra.ephemeral === '1h' ? usage.cacheCreation : 0,
          },
        };
  return JSON.stringify({
    type: 'assistant',
    ...(extra.timestamp !== undefined ? { timestamp: new Date(extra.timestamp).toISOString() } : {}),
    ...(extra.effort !== undefined ? { effort: extra.effort } : {}),
    message: {
      role: 'assistant',
      model,
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: usage.input,
        cache_read_input_tokens: usage.cacheRead,
        cache_creation_input_tokens: usage.cacheCreation,
        output_tokens: 42,
        ...cacheCreation,
      },
    },
  });
}

/**
 * Ligne assistant synthétique que Claude Code écrit quand l'API refuse la requête (limite d'usage, 429…) :
 * modèle « <synthetic> », texte lisible dans le message, et à la racine error / isApiErrorMessage / apiErrorStatus.
 */
export function apiErrorLine(text: string, timestamp: number, error = 'rate_limit', status = 429): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(timestamp).toISOString(),
    message: {
      role: 'assistant',
      model: '<synthetic>',
      stop_reason: 'stop_sequence',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    error,
    isApiErrorMessage: true,
    apiErrorStatus: status,
  });
}

/** Ligne system écrite par Claude Code quand il compacte la conversation. */
export function compactBoundaryLine(timestamp: number): string {
  return JSON.stringify({
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    level: 'info',
    timestamp: new Date(timestamp).toISOString(),
    compactMetadata: { trigger: 'auto', preTokens: 490_214, postTokens: 22_230 },
  });
}

/** Bloc <usage> que Claude Code écrit à la fin d'un sous-agent (notification de fin ou fin du tool_result). */
function usageBlock(figures: { tokens: number; toolUses: number; durationMs: number }): string {
  return `<usage><subagent_tokens>${figures.tokens}</subagent_tokens><tool_uses>${figures.toolUses}</tool_uses><duration_ms>${figures.durationMs}</duration_ms></usage>`;
}

/**
 * Notification de fin d'un sous-agent lancé en arrière-plan, telle que Claude Code l'écrit : task-id = agentId,
 * résultat, puis le bloc <usage>. Enfilée (queue-operation) puis livrée à l'agent (ligne user).
 */
export function agentNotificationLine(
  agentId: string,
  status: 'completed' | 'failed' | 'killed',
  figures: { tokens: number; toolUses: number; durationMs: number },
  timestamp: number,
  kind: 'queue' | 'user' = 'user',
): string {
  const content = [
    '<task-notification>',
    `<task-id>${agentId}</task-id>`,
    '<tool-use-id>toolu_agent</tool-use-id>',
    `<output-file>C:\\tmp\\tasks\\${agentId}.output</output-file>`,
    `<status>${status}</status>`,
    `<summary>Agent "x" finished</summary>`,
    '<result>Rapport de l’agent. agentId: ne-pas-confondre</result>',
    usageBlock(figures),
    '</task-notification>',
  ].join('\n');
  const iso = new Date(timestamp).toISOString();
  return kind === 'queue'
    ? JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: iso, content })
    : JSON.stringify({ type: 'user', timestamp: iso, message: { role: 'user', content } });
}

/**
 * tool_result d'un sous-agent exécuté au premier plan, tel que Claude Code 2.1.270 l'écrit : le rapport dans un
 * premier bloc texte, puis un second bloc « agentId: X (…) » suivi d'un <usage> en clés/valeurs sur trois lignes
 * (forme différente de celle, en balises, des notifications de fin).
 */
export function agentResultLine(
  toolUseId: string,
  agentId: string,
  figures: { tokens: number; toolUses: number; durationMs: number },
  timestamp: number,
): string {
  const trailer = `agentId: ${agentId} (use SendMessage with to: '${agentId}', summary: '<5-10 word recap>' to continue this agent)\n<usage>subagent_tokens: ${figures.tokens}\ntool_uses: ${figures.toolUses}\nduration_ms: ${figures.durationMs}</usage>`;
  return JSON.stringify({
    type: 'user',
    timestamp: new Date(timestamp).toISOString(),
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: [
            { type: 'text', text: 'Rapport de l’agent. Il cite agentId: pas-celui-la pour brouiller les pistes.' },
            { type: 'text', text: trailer },
          ],
        },
      ],
    },
  });
}

/** Écrit ~/.claude/settings.json dans la fixture. */
export function writeSettings(claudeDir: string, content: string): void {
  writeFileSync(join(claudeDir, 'settings.json'), content);
}

/** Ajoute un timestamp ISO à une ligne JSONL et, si fourni, le stop_reason du message assistant. */
export function stamp(line: string, timestamp: number, stopReason?: string): string {
  const record = JSON.parse(line);
  record.timestamp = new Date(timestamp).toISOString();
  if (stopReason !== undefined) {
    record.message.stop_reason = stopReason;
  }
  return JSON.stringify(record);
}

/** Ligne assistant texte datée ; end_turn par défaut = fin du tour. */
export function textLine(text: string, timestamp: number, stopReason: string | null = 'end_turn'): string {
  const record: Record<string, unknown> = {
    type: 'assistant',
    timestamp: new Date(timestamp).toISOString(),
    message: { role: 'assistant', model: 'claude-fable-5', content: [{ type: 'text', text }] },
  };
  if (stopReason !== null) {
    (record.message as Record<string, unknown>).stop_reason = stopReason;
  }
  return JSON.stringify(record);
}

/** Bash lancé en arrière-plan (run_in_background: true), daté. */
export function backgroundBashLine(toolUseId: string, command: string, description: string, timestamp: number): string {
  return stamp(
    toolUseLine('Bash', toolUseId, 'claude-fable-5', { command, description, run_in_background: true }),
    timestamp,
    'tool_use',
  );
}

/** tool_result d'un Bash en arrière-plan : identifiant de tâche et fichier de sortie, comme l'écrit Claude Code. */
export function backgroundResultLine(toolUseId: string, taskId: string, outputFile: string, timestamp: number): string {
  return JSON.stringify({
    type: 'user',
    timestamp: new Date(timestamp).toISOString(),
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: `Command running in background with ID: ${taskId}. Output is being written to: ${outputFile}. You will be notified when it completes.`,
        },
      ],
    },
  });
}

/** Notification de fin de tâche : enfilée (queue-operation) dès la fin, puis livrée à l'agent (ligne user). */
export function taskNotificationLine(
  taskId: string,
  status: 'completed' | 'failed',
  timestamp: number,
  kind: 'queue' | 'user' = 'queue',
): string {
  const content = [
    '<task-notification>',
    `<task-id>${taskId}</task-id>`,
    '<tool-use-id>toolu_x</tool-use-id>',
    '<output-file>C:\\tmp\\x.output</output-file>',
    `<status>${status}</status>`,
    `<summary>Background command "x" ${status} (exit code 0)</summary>`,
    '</task-notification>',
  ].join('\n');
  const iso = new Date(timestamp).toISOString();
  return kind === 'queue'
    ? JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: iso, content })
    : JSON.stringify({ type: 'user', timestamp: iso, message: { role: 'user', content } });
}

/**
 * Notification de rattrapage des tâches orphelines, telle que Claude Code l'écrit : plusieurs <task-id>
 * dans un seul bloc, suivis d'un marqueur interne __orphan_summary__ qui n'est pas un identifiant de tâche.
 */
export function orphanNotificationLine(taskIds: string[], timestamp: number, kind: 'queue' | 'user' = 'queue'): string {
  const content = [
    '<task-notification>',
    ...taskIds.map((id) => `<task-id>${id}</task-id>`),
    '<task-id>__orphan_summary__:shell</task-id>',
    '<status>stopped</status>',
    `<summary>${taskIds.length} background shell command tasks didn't finish before the previous session ended. Task ids: ${taskIds.join(', ')}.</summary>`,
    '<note>No completion record was found for them in the previous session.</note>',
    '</task-notification>',
  ].join('\n');
  const iso = new Date(timestamp).toISOString();
  return kind === 'queue'
    ? JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: iso, content })
    : JSON.stringify({ type: 'user', timestamp: iso, message: { role: 'user', content } });
}

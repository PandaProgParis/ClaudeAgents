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

/** Ligne JSONL d'entrée user (content chaîne). */
export function userLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
}

/** Ligne JSONL assistant portant un bloc tool_use (ordre des champs identique aux vrais transcripts). */
export function toolUseLine(toolName: string, toolUseId: string, model = 'claude-fable-5'): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      model,
      content: [{ type: 'tool_use', id: toolUseId, name: toolName, input: {} }],
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
export function toolResultLine(toolUseId: string): string {
  return JSON.stringify({
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

/** Ligne JSONL assistant portant model + usage (pour contextTokens). */
export function assistantUsageLine(
  model: string,
  usage: { input: number; cacheRead: number; cacheCreation: number },
): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      model,
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: usage.input,
        cache_read_input_tokens: usage.cacheRead,
        cache_creation_input_tokens: usage.cacheCreation,
        output_tokens: 42,
      },
    },
  });
}

/** Écrit ~/.claude/settings.json dans la fixture. */
export function writeSettings(claudeDir: string, content: string): void {
  writeFileSync(join(claudeDir, 'settings.json'), content);
}

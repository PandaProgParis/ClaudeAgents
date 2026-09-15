import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { clearScannerCaches, scan } from '../scanner';
import {
  NOW,
  apiErrorLine,
  assistantLine,
  cleanupClaudeDirs,
  makeClaudeDir,
  textLine,
  touch,
  userLine,
  writeAgent,
  writeRegistry,
  writeTranscript,
} from './helpers';

afterEach(() => {
  cleanupClaudeDirs();
  clearScannerCaches();
});

const alive = () => true;
const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const PROJECT_DIR = 'c--dev-mon-projet';
/** Textes réels écrits par Claude Code 2.1.270 (json de fin de run, puis ligne synthétique du transcript). */
const WEEKLY_LIMIT = "You've hit your weekly limit · resets Sep 14, 2am (Asia/Seoul)";
const SESSION_LIMIT = "You've hit your session limit · resets 1:50pm (Asia/Seoul)";

function setupSession(dir: string): { agentsDir: string; runDir: string; wfDir: string } {
  writeRegistry(dir, { pid: 1111, sessionId: SESSION_ID, cwd: 'c:\\dev\\mon-projet', startedAt: NOW - 600_000, name: 'mon-projet-1' });
  writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-opus-5')], 5_000);
  const sessionDir = join(dir, 'projects', PROJECT_DIR, SESSION_ID);
  return {
    agentsDir: join(sessionDir, 'subagents'),
    runDir: join(sessionDir, 'subagents', 'workflows', 'wf_r-1'),
    wfDir: join(sessionDir, 'workflows'),
  };
}

/** Transcript d'un agent arrêté net par un refus de l'API : son prompt, puis la ligne synthétique d'erreur. */
function writeRejectedAgent(agentsDir: string, agentId: string, prompt: string, text: string, ageMs: number): void {
  const filePath = writeAgent(agentsDir, agentId, prompt, ageMs);
  writeFileSync(filePath, [userLine(prompt), apiErrorLine(text, NOW - ageMs)].join('\n') + '\n');
  touch(filePath, ageMs);
}

function runJson(entries: Array<Record<string, unknown>>): string {
  return JSON.stringify({ runId: 'wf_r-1', workflowName: 'refute', workflowProgress: entries });
}

describe('scan — raison d’échec d’un agent', () => {
  it('reprend l’erreur consignée pour l’agent dans le json de fin de run', () => {
    const dir = makeClaudeDir();
    const { runDir, wfDir } = setupSession(dir);
    writeAgent(runDir, 'a1', 'Cohérence finale', 5_000);
    writeFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ type: 'failed', key: 'k1', agentId: 'a1' }) + '\n');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(
      join(wfDir, 'wf_r-1.json'),
      runJson([{ type: 'workflow_agent', index: 23, label: 'cohérence-finale', agentId: 'a1', state: 'error', error: WEEKLY_LIMIT }]),
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const [agent] = project.sessions[0].workflows[0].agents;
    expect(agent.status).toBe('failed');
    expect(agent.description).toBe('cohérence-finale');
    expect(agent.failure).toBe(WEEKLY_LIMIT);
  });

  it('marque en échec, avec sa raison, l’agent dont le json de fin porte state error même sans ligne failed au journal', () => {
    const dir = makeClaudeDir();
    const { runDir, wfDir } = setupSession(dir);
    writeAgent(runDir, 'a1', 'Cohérence finale', 5_000);
    writeAgent(runDir, 'a2', 'Relecture', 120_000);
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(
      join(wfDir, 'wf_r-1.json'),
      runJson([
        { type: 'workflow_agent', index: 1, label: 'cohérence', agentId: 'a1', state: 'error', error: WEEKLY_LIMIT },
        { type: 'workflow_agent', index: 2, label: 'relecture', agentId: 'a2', state: 'done' },
      ]),
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].workflows[0].agents.map((agent) => [agent.status, agent.failure])).toEqual([
      ['failed', WEEKLY_LIMIT],
      ['finished', undefined],
    ]);
    expect(project.sessions[0].workflows[0].failedCount).toBe(1);
  });

  it('lit la raison dans le transcript de l’agent quand il finit sur le refus de l’API, avant que le json de fin existe', () => {
    const dir = makeClaudeDir();
    const { runDir } = setupSession(dir);
    writeRejectedAgent(runDir, 'a1', 'Cohérence finale', SESSION_LIMIT, 5_000);
    writeFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ type: 'failed', key: 'k1', agentId: 'a1' }) + '\n');
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const [agent] = project.sessions[0].workflows[0].agents;
    expect(agent.status).toBe('failed');
    expect(agent.failure).toBe(SESSION_LIMIT);
  });

  it('un sous-agent direct arrêté par l’API est en échec avec sa raison, même si son fichier est tout récent', () => {
    const dir = makeClaudeDir();
    const { agentsDir } = setupSession(dir);
    writeRejectedAgent(agentsDir, 'd1', 'Relecture', SESSION_LIMIT, 2_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const [agent] = project.sessions[0].agents;
    expect(agent.status).toBe('failed');
    expect(agent.failure).toBe(SESSION_LIMIT);
  });

  it('oublie un refus de l’API suivi d’une réponse normale', () => {
    const dir = makeClaudeDir();
    const { agentsDir } = setupSession(dir);
    const filePath = writeAgent(agentsDir, 'd1', 'Relecture', 2_000);
    writeFileSync(
      filePath,
      [userLine('Relecture'), apiErrorLine(SESSION_LIMIT, NOW - 10_000), textLine('Reprise après la limite.', NOW - 2_000)].join('\n') + '\n',
    );
    touch(filePath, 2_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const [agent] = project.sessions[0].agents;
    expect(agent.failure).toBeUndefined();
    expect(agent.status).toBe('active');
  });
});

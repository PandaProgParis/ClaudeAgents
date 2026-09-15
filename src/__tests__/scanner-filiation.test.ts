import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { clearScannerCaches, scan } from '../scanner';
import {
  NOW,
  agentResultLine,
  assistantLine,
  cleanupClaudeDirs,
  makeClaudeDir,
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

function registryEntry() {
  return { pid: 1111, sessionId: SESSION_ID, cwd: 'c:\\dev\\mon-projet', startedAt: NOW - 600_000, name: 'mon-projet-1' };
}

/** Écrit le meta.json d'un agent tel que Claude Code 2.1.270 le pose : parentAgentId explicite pour un petit-fils. */
function writeMeta(agentsDir: string, agentId: string, meta: Record<string, unknown>): void {
  writeFileSync(join(agentsDir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
}

describe('scan — filiation par parentAgentId', () => {
  it('imbrique un agent sous son parent d’après parentAgentId, même quand l’appel a quitté la fenêtre de queue du parent', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-opus-5')], 5_000);
    const agentsDir = join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents');
    // Niveau 1 : son transcript ne montre plus l'appel qui a lancé le niveau 2 (une ligne géante l'a poussé hors de la fenêtre).
    writeAgent(agentsDir, 'n1', 'Niveau 1', 40_000);
    writeFileSync(join(agentsDir, 'agent-n1.jsonl'), [userLine('Niveau 1'), userLine('x'.repeat(70 * 1024)), assistantLine('claude-sonnet-5')].join('\n') + '\n');
    writeMeta(agentsDir, 'n1', { agentType: 'general-purpose', description: 'Niveau 1', toolUseId: 'toolu_1', spawnDepth: 1 });
    writeAgent(agentsDir, 'n2', 'Niveau 2', 30_000);
    writeMeta(agentsDir, 'n2', { agentType: 'general-purpose', description: 'Niveau 2', toolUseId: 'toolu_2', parentAgentId: 'n1', spawnDepth: 2 });
    writeAgent(agentsDir, 'n3', 'Niveau 3', 20_000);
    writeMeta(agentsDir, 'n3', { agentType: 'general-purpose', description: 'Niveau 3', toolUseId: 'toolu_3', parentAgentId: 'n2', spawnDepth: 3 });
    writeAgent(agentsDir, 'n4', 'Niveau 4', 10_000);
    writeMeta(agentsDir, 'n4', { agentType: 'general-purpose', description: 'Niveau 4', toolUseId: 'toolu_4', parentAgentId: 'n3', spawnDepth: 4 });

    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].agents.map((agent) => [agent.description, agent.depth])).toEqual([
      ['Niveau 1', 0],
      ['Niveau 2', 1],
      ['Niveau 3', 2],
      ['Niveau 4', 3],
    ]);
  });

  it('reprend les chiffres de fin d’un petit-fils dans le tool_result écrit dans le transcript de son parent', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-opus-5')], 5_000);
    const agentsDir = join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents');
    writeAgent(agentsDir, 'n1', 'Niveau 1', 5_000);
    // Le parent a reçu la fin de son enfant : le tool_result se termine par « agentId: n2 » et le bloc <usage>.
    writeFileSync(
      join(agentsDir, 'agent-n1.jsonl'),
      [userLine('Niveau 1'), agentResultLine('toolu_2', 'n2', { tokens: 12_345, toolUses: 3, durationMs: 42_000 }, NOW - 6_000), assistantLine('claude-sonnet-5')].join('\n') + '\n',
    );
    writeMeta(agentsDir, 'n1', { agentType: 'general-purpose', description: 'Niveau 1', toolUseId: 'toolu_1', spawnDepth: 1 });
    writeAgent(agentsDir, 'n2', 'Niveau 2', 3_000);
    writeMeta(agentsDir, 'n2', { agentType: 'general-purpose', description: 'Niveau 2', toolUseId: 'toolu_2', parentAgentId: 'n1', spawnDepth: 2 });
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const child = project.sessions[0].agents.find((agent) => agent.description === 'Niveau 2');
    expect(child?.report).toEqual({ tokens: 12_345, toolUses: 3, durationMs: 42_000 });
    expect(child?.status).toBe('finished');
  });

  it('retrouve ces chiffres même quand des pièces jointes volumineuses ont poussé le tool_result hors de la queue du parent', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-opus-5')], 5_000);
    const agentsDir = join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents');
    writeAgent(agentsDir, 'n1', 'Niveau 1', 5_000);
    writeFileSync(
      join(agentsDir, 'agent-n1.jsonl'),
      [
        userLine('Niveau 1'),
        agentResultLine('toolu_2', 'n2', { tokens: 12_345, toolUses: 3, durationMs: 42_000 }, NOW - 6_000),
        JSON.stringify({ type: 'attachment', attachment: { type: 'skill', content: 'x'.repeat(70 * 1024) } }),
        assistantLine('claude-sonnet-5'),
      ].join('\n') + '\n',
    );
    writeMeta(agentsDir, 'n1', { agentType: 'general-purpose', description: 'Niveau 1', toolUseId: 'toolu_1', spawnDepth: 1 });
    writeAgent(agentsDir, 'n2', 'Niveau 2', 60_000);
    writeMeta(agentsDir, 'n2', { agentType: 'general-purpose', description: 'Niveau 2', toolUseId: 'toolu_2', parentAgentId: 'n1', spawnDepth: 2 });
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const child = project.sessions[0].agents.find((agent) => agent.description === 'Niveau 2');
    expect(child?.report).toEqual({ tokens: 12_345, toolUses: 3, durationMs: 42_000 });
  });

  it('place à la racine un agent dont le parentAgentId ne correspond à aucun agent connu', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-opus-5')], 5_000);
    const agentsDir = join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents');
    writeAgent(agentsDir, 'orphan', 'Orphelin', 10_000);
    writeMeta(agentsDir, 'orphan', { agentType: 'general-purpose', description: 'Orphelin', toolUseId: 'toolu_o', parentAgentId: 'disparu', spawnDepth: 2 });
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].agents.map((agent) => [agent.description, agent.depth])).toEqual([['Orphelin', 0]]);
  });
});

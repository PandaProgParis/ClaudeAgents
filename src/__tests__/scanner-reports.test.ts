import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'path';
import { appendFileSync } from 'fs';
import { clearScannerCaches, scan } from '../scanner';
import {
  NOW,
  agentNotificationLine,
  agentResultLine,
  assistantLine,
  assistantUsageLine,
  cleanupClaudeDirs,
  compactBoundaryLine,
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
const USAGE = { input: 2, cacheRead: 422_524, cacheCreation: 2_401 };
const FIGURES = { tokens: 188_030, toolUses: 98, durationMs: 1_014_354 };

function registryEntry(overrides: Record<string, unknown> = {}) {
  return {
    pid: 1111,
    sessionId: SESSION_ID,
    cwd: 'c:\\dev\\mon-projet',
    startedAt: NOW - 600_000,
    name: 'mon-projet-1',
    ...overrides,
  };
}

function firstSession(dir: string) {
  return scan({ claudeDir: dir, now: NOW, isPidAlive: alive })[0].sessions[0];
}

describe('scan — effort de la session', () => {
  it('lit l’effort dans le champ racine des lignes assistant', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantUsageLine('claude-opus-5', USAGE, { effort: 'xhigh' })], 5_000);
    expect(firstSession(dir).effort).toBe('xhigh');
  });

  it('reste absent quand aucune ligne ne le porte (versions antérieures de Claude Code)', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-opus-5')], 5_000);
    expect(firstSession(dir).effort).toBeUndefined();
  });
});

describe('scan — cache d’invite', () => {
  it('ancre le cache sur le dernier message et lit la TTL d’une heure dans la ventilation ephemeral', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [assistantUsageLine('claude-opus-5', USAGE, { ephemeral: '1h', timestamp: NOW - 300_000 })],
      300_000,
    );
    expect(firstSession(dir).cache).toEqual({ anchorAt: NOW - 300_000, ttlMs: 3_600_000 });
  });

  it('lit la TTL de cinq minutes', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [assistantUsageLine('claude-opus-5', USAGE, { ephemeral: '5m', timestamp: NOW - 60_000 })],
      60_000,
    );
    expect(firstSession(dir).cache).toEqual({ anchorAt: NOW - 60_000, ttlMs: 300_000 });
  });

  it('ne dit rien quand le dernier message n’a touché aucun cache', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [
        assistantUsageLine('claude-opus-5', USAGE, { ephemeral: '1h', timestamp: NOW - 120_000 }),
        assistantUsageLine('claude-opus-5', { input: 12_000, cacheRead: 0, cacheCreation: 0 }, { timestamp: NOW - 60_000 }),
      ],
      60_000,
    );
    expect(firstSession(dir).cache).toBeUndefined();
  });

  it('garde la TTL du message précédent quand le dernier ne ventile pas sa création de cache', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [
        assistantUsageLine('claude-opus-5', USAGE, { ephemeral: '1h', timestamp: NOW - 120_000 }),
        assistantUsageLine('claude-opus-5', USAGE, { timestamp: NOW - 60_000 }),
      ],
      60_000,
    );
    expect(firstSession(dir).cache).toEqual({ anchorAt: NOW - 60_000, ttlMs: 3_600_000 });
  });

  it('signale une compaction survenue après le dernier message, pas une compaction antérieure', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [
        compactBoundaryLine(NOW - 400_000),
        assistantUsageLine('claude-opus-5', USAGE, { ephemeral: '1h', timestamp: NOW - 300_000 }),
        compactBoundaryLine(NOW - 100_000),
      ],
      100_000,
    );
    expect(firstSession(dir).cache).toEqual({ anchorAt: NOW - 300_000, ttlMs: 3_600_000, compactedAt: NOW - 100_000 });

    const other = makeClaudeDir();
    writeRegistry(other, registryEntry());
    writeTranscript(
      other,
      PROJECT_DIR,
      SESSION_ID,
      [compactBoundaryLine(NOW - 400_000), assistantUsageLine('claude-opus-5', USAGE, { ephemeral: '1h', timestamp: NOW - 300_000 })],
      300_000,
    );
    expect(firstSession(other).cache).toEqual({ anchorAt: NOW - 300_000, ttlMs: 3_600_000 });
  });

  it('retient le dernier état connu quand une ligne géante chasse le dernier usage de la fenêtre de lecture', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    const transcript = writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [assistantUsageLine('claude-opus-5', USAGE, { ephemeral: '1h', timestamp: NOW - 300_000 })],
      300_000,
    );
    expect(firstSession(dir).cache).toEqual({ anchorAt: NOW - 300_000, ttlMs: 3_600_000 });
    appendFileSync(transcript, userLine('x'.repeat(70 * 1024)) + '\n');
    expect(firstSession(dir).cache).toEqual({ anchorAt: NOW - 300_000, ttlMs: 3_600_000 });
  });
});

describe('scan — chiffres de fin des sous-agents', () => {
  function setupAgent(dir: string, agentId: string, ageMs: number): void {
    writeAgent(join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents'), agentId, 'Réfuter le CLAUDE.md', ageMs);
  }

  it('reprend jetons, outils et durée de la notification de fin, et tient l’agent pour terminé', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    setupAgent(dir, 'a48a492a81822e379', 5_000);
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [assistantLine('claude-opus-5'), agentNotificationLine('a48a492a81822e379', 'completed', FIGURES, NOW - 4_000)],
      4_000,
    );
    const [agent] = firstSession(dir).agents;
    expect(agent.report).toEqual(FIGURES);
    expect(agent.status).toBe('finished');
  });

  it('marque en échec un agent dont la notification dit failed', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    setupAgent(dir, 'a48a492a81822e379', 5_000);
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [agentNotificationLine('a48a492a81822e379', 'failed', FIGURES, NOW - 4_000, 'queue')],
      4_000,
    );
    const [agent] = firstSession(dir).agents;
    expect(agent.status).toBe('failed');
    expect(agent.report).toEqual(FIGURES);
  });

  it('lit aussi le bloc <usage> qui termine le tool_result d’un agent exécuté au premier plan', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    setupAgent(dir, 'b1b1b1b1b1b1b1b1b', 5_000);
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [agentResultLine('toolu_fg', 'b1b1b1b1b1b1b1b1b', { tokens: 51_486, toolUses: 39, durationMs: 185_000 }, NOW - 4_000)],
      4_000,
    );
    const [agent] = firstSession(dir).agents;
    expect(agent.report).toEqual({ tokens: 51_486, toolUses: 39, durationMs: 185_000 });
    expect(agent.status).toBe('finished');
  });

  it('laisse sans chiffres un agent dont la notification n’est pas encore écrite', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    setupAgent(dir, 'a48a492a81822e379', 5_000);
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-opus-5')], 4_000);
    const [agent] = firstSession(dir).agents;
    expect(agent.report).toBeUndefined();
    expect(agent.status).toBe('active');
  });

  it('retrouve une notification passée hors de la fenêtre de queue au premier scan', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    setupAgent(dir, 'a48a492a81822e379', 5_000);
    const filler = Array.from({ length: 80 }, (_, i) => userLine(`bruit ${i} ` + 'x'.repeat(1024)));
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [agentNotificationLine('a48a492a81822e379', 'completed', FIGURES, NOW - 200_000), ...filler],
      4_000,
    );
    expect(firstSession(dir).agents[0].report).toEqual(FIGURES);
  });

  it('retient la notification quand elle sort de la fenêtre entre deux scans', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    setupAgent(dir, 'a48a492a81822e379', 5_000);
    const transcript = writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [agentNotificationLine('a48a492a81822e379', 'completed', FIGURES, NOW - 4_000)],
      4_000,
    );
    expect(firstSession(dir).agents[0].report).toEqual(FIGURES);
    appendFileSync(transcript, userLine('x'.repeat(70 * 1024)) + '\n');
    expect(firstSession(dir).agents[0].report).toEqual(FIGURES);
  });
});

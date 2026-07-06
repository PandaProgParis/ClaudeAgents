import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildState } from './state';
import { clearScannerCaches } from './scanner';
import {
  NOW,
  assistantLine,
  cleanupClaudeDirs,
  makeClaudeDir,
  writeRegistry,
  writeTranscript,
} from './__tests__/helpers';
import type { FinishedAgentSettings } from './types';

const SETTINGS: FinishedAgentSettings = { mode: 'temporarily', retentionSeconds: 60 };
const alive = (): boolean => true;

/** Deux sessions vivantes dans deux projets : c:\dev\alpha et c:\dev\beta. */
function setupTwoProjects(dir: string): void {
  const sessions = [
    { pid: 11, cwd: 'c:\\dev\\alpha', projectDir: 'c--dev-alpha', sessionId: 'aaaaaaaa-1111-2222-3333-444444444444' },
    { pid: 12, cwd: 'c:\\dev\\beta', projectDir: 'c--dev-beta', sessionId: 'bbbbbbbb-1111-2222-3333-444444444444' },
  ];
  for (const { pid, cwd, projectDir, sessionId } of sessions) {
    writeRegistry(dir, { pid, sessionId, cwd, startedAt: NOW - 60_000, name: 'x', kind: 'main' });
    writeTranscript(dir, projectDir, sessionId, [assistantLine('claude-opus-5')], 1_000);
  }
}

describe('buildState', () => {
  beforeEach(() => clearScannerCaches());
  afterEach(() => cleanupClaudeDirs());

  it('assemble projets, réglages, locale et horloge dans le message poussé à la webview', () => {
    const dir = makeClaudeDir();
    setupTwoProjects(dir);
    const state = buildState({
      claudeDir: dir,
      now: NOW,
      settings: SETTINGS,
      inactiveSessionRetentionMinutes: 10,
      locale: 'en',
      isPidAlive: alive,
    });
    expect(state.projects.map((project) => project.name)).toEqual(['alpha', 'beta']);
    expect(state.settings).toEqual(SETTINGS);
    expect(state.locale).toBe('en');
    expect(state.now).toBe(NOW);
    expect(state.inactiveSessionRetentionMinutes).toBe(10);
    expect(state.effortLevel).toBeUndefined();
  });

  it('ne garde que les projets du workspace quand ses dossiers sont fournis', () => {
    const dir = makeClaudeDir();
    setupTwoProjects(dir);
    const state = buildState({
      claudeDir: dir,
      now: NOW,
      settings: SETTINGS,
      inactiveSessionRetentionMinutes: 10,
      locale: 'fr',
      workspaceFolders: ['c:\\dev\\beta'],
      isPidAlive: alive,
    });
    expect(state.projects.map((project) => project.name)).toEqual(['beta']);
  });
});

import { describe, expect, it } from 'vitest';
import { filterProjectsForWorkspace, filterVisibleSessions } from './visibility';
import type { ProjectNode, SessionNode } from './types';

const NOW = 1_800_000_000_000;

function session(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
    pid: 1,
    cwd: 'c:\\dev\\marketing',
    name: 'Gamini > JSON HTML',
    startedAt: NOW - 3_600_000,
    active: false,
    lastActivity: NOW - 60_000,
    agents: [],
    workflows: [],
    ...overrides,
  };
}

describe('filterVisibleSessions', () => {
  it('garde une session active quel que soit son âge', () => {
    const old = session({ active: true, lastActivity: NOW - 7_200_000 });
    expect(filterVisibleSessions([old], 10, NOW)).toEqual([old]);
  });

  it('masque une session inactive au-delà de la rétention', () => {
    const idle = session({ lastActivity: NOW - 601_000 });
    expect(filterVisibleSessions([idle], 10, NOW)).toEqual([]);
  });

  it('garde une session inactive sous la rétention', () => {
    const recent = session({ lastActivity: NOW - 599_000 });
    expect(filterVisibleSessions([recent], 10, NOW)).toEqual([recent]);
  });

  it('replie sur startedAt quand lastActivity est absent', () => {
    const idle = session({ lastActivity: undefined, startedAt: NOW - 700_000 });
    const fresh = session({ lastActivity: undefined, startedAt: NOW - 30_000 });
    expect(filterVisibleSessions([idle, fresh], 10, NOW)).toEqual([fresh]);
  });

  it('ne masque rien quand la rétention vaut 0', () => {
    const idle = session({ lastActivity: NOW - 86_400_000 });
    expect(filterVisibleSessions([idle], 0, NOW)).toEqual([idle]);
  });

  it('garde une session en attente de réponse au-delà de la rétention', () => {
    const waiting = session({ lastActivity: NOW - 3_600_000, pendingQuestion: true });
    expect(filterVisibleSessions([waiting], 10, NOW)).toEqual([waiting]);
  });
});

function projectNode(cwd: string): ProjectNode {
  return { cwd, name: cwd.split(/[\\/]/).pop() ?? cwd, hasActiveSession: true, sessions: [] };
}

describe('filterProjectsForWorkspace', () => {
  it('garde un projet dont le cwd égale un dossier du workspace (casse et séparateurs ignorés)', () => {
    const project = projectNode('c:\\Dev\\Marketing');
    expect(filterProjectsForWorkspace([project], ['C:/dev/marketing/'])).toEqual([project]);
  });

  it('garde un projet dont le cwd est un sous-dossier du workspace', () => {
    const project = projectNode('c:\\dev\\marketing\\backend');
    expect(filterProjectsForWorkspace([project], ['c:\\dev\\marketing'])).toEqual([project]);
  });

  it("garde un projet parent d'un dossier du workspace", () => {
    const project = projectNode('c:\\dev\\marketing');
    expect(filterProjectsForWorkspace([project], ['c:\\dev\\marketing\\frontend'])).toEqual([project]);
  });

  it('écarte les projets sans lien avec le workspace', () => {
    const marketing = projectNode('c:\\dev\\marketing');
    const marketing2 = projectNode('c:\\dev\\marketing2');
    expect(filterProjectsForWorkspace([marketing, marketing2], ['c:\\dev\\marketing'])).toEqual([marketing]);
  });

  it('ne garde rien sans dossier de workspace', () => {
    expect(filterProjectsForWorkspace([projectNode('c:\\dev\\marketing')], [])).toEqual([]);
  });
});

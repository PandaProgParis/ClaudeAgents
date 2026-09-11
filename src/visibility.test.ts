import { describe, expect, it } from 'vitest';
import { countWaitingSessions, filterProjectsForWorkspace, filterVisibleSessions, visibleSessionViews } from './visibility';
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

describe('countWaitingSessions', () => {
  it('compte les sessions en attente d’une réponse, tous projets confondus', () => {
    const projects: ProjectNode[] = [
      {
        cwd: 'c:\\dev\\a',
        name: 'a',
        hasActiveSession: true,
        sessions: [session({ pendingQuestion: true }), session({ sessionId: 'b', pendingQuestion: false })],
      },
      { cwd: 'c:\\dev\\c', name: 'c', hasActiveSession: true, sessions: [session({ sessionId: 'c', pendingQuestion: true })] },
    ];
    expect(countWaitingSessions(projects)).toBe(2);
  });

  it('vaut zéro sans session en attente', () => {
    expect(countWaitingSessions([{ cwd: 'c:\\dev\\a', name: 'a', hasActiveSession: false, sessions: [session()] }])).toBe(0);
    expect(countWaitingSessions([])).toBe(0);
  });
});

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

describe('visibleSessionViews', () => {
  const liveTask = { id: 't1', command: 'npm run dev', startedAt: NOW - 60_000, url: 'http://localhost:6602/', urlAlive: true };
  const deadTask = { id: 't2', command: 'npm run dev', startedAt: NOW - 60_000, url: 'http://localhost:6603/', urlAlive: false };
  const expired = () => session({ lastActivity: NOW - 3_600_000 });

  it('laisse une session visible dépliée', () => {
    const fresh = session({ lastActivity: NOW - 60_000 });
    expect(visibleSessionViews([fresh], 10, NOW)).toEqual([{ session: fresh, collapsed: false }]);
  });

  it('réduit une session expirée qui sert encore une adresse locale', () => {
    const s = expired();
    s.backgroundTasks = [liveTask];
    expect(visibleSessionViews([s], 10, NOW)).toEqual([{ session: s, collapsed: true }]);
  });

  it('supprime une session expirée dont les ports sont morts', () => {
    const s = expired();
    s.backgroundTasks = [deadTask];
    expect(visibleSessionViews([s], 10, NOW)).toEqual([]);
  });

  it('ne ressuscite pas une session expirée sur une URL jamais sondée : il faut une preuve de vie', () => {
    const s = expired();
    s.backgroundTasks = [{ id: 't3', command: 'x', startedAt: NOW, url: 'http://localhost:7000/' }];
    expect(visibleSessionViews([s], 10, NOW)).toEqual([]);
  });

  it('supprime une session expirée sans commande de fond', () => {
    expect(visibleSessionViews([expired()], 10, NOW)).toEqual([]);
  });

  it('garde tout déplié quand la rétention est désactivée', () => {
    const s = expired();
    expect(visibleSessionViews([s], 0, NOW)).toEqual([{ session: s, collapsed: false }]);
  });
});

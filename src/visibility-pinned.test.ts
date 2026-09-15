import { describe, expect, it } from 'vitest';
import { filterVisibleSessions, isInFolders, visibleSessionViews } from './visibility';
import type { SessionNode } from './types';

const NOW = 1_800_000_000_000;

function session(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
    pid: 1,
    cwd: 'c:\\dev\\marketing',
    name: 'Gamini > JSON HTML',
    startedAt: NOW - 3_600_000,
    active: false,
    lastActivity: NOW - 1_800_000,
    agents: [],
    workflows: [],
    ...overrides,
  };
}

describe('isInFolders', () => {
  it('reconnaît un cwd égal à un dossier, contenu dedans ou le contenant, quels que soient la casse et les séparateurs', () => {
    expect(isInFolders('c:\\dev\\marketing', ['C:/dev/marketing/'])).toBe(true);
    expect(isInFolders('c:\\dev\\marketing\\web', ['c:\\dev\\marketing'])).toBe(true);
    expect(isInFolders('c:\\dev', ['c:\\dev\\marketing'])).toBe(true);
  });

  it('refuse un dossier étranger, un préfixe de nom trompeur et une liste vide', () => {
    expect(isInFolders('c:\\dev\\marketing', ['c:\\dev\\autre'])).toBe(false);
    expect(isInFolders('c:\\dev\\marketing2', ['c:\\dev\\marketing'])).toBe(false);
    expect(isInFolders('c:\\dev\\marketing', [])).toBe(false);
  });
});

describe('sessions épinglées', () => {
  const pinned = (candidate: SessionNode) => isInFolders(candidate.cwd, ['c:\\dev\\marketing']);

  it('filterVisibleSessions garde une session inactive au-delà de la rétention quand elle est épinglée', () => {
    const idle = session();
    expect(filterVisibleSessions([idle], 10, NOW)).toEqual([]);
    expect(filterVisibleSessions([idle], 10, NOW, pinned)).toEqual([idle]);
  });

  it('visibleSessionViews la rend en card complète, pas réduite', () => {
    const idle = session();
    expect(visibleSessionViews([idle], 10, NOW, pinned)).toEqual([{ session: idle, collapsed: false }]);
  });

  it('une session épinglée d’un autre dossier reste soumise à la rétention', () => {
    const other = session({ cwd: 'c:\\dev\\autre' });
    expect(visibleSessionViews([other], 10, NOW, pinned)).toEqual([]);
  });
});

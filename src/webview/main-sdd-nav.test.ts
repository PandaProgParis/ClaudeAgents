// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SddRun, SessionNode, StateMessage } from '../types';

/**
 * Webview réelle (main.ts) chargée dans un DOM : les flèches ‹ › de l'historique des plans et le dépli
 * sont câblés ici, pas dans le rendu — seul un clic de bout en bout prouve qu'ils agissent et que l'état est retenu.
 */

const SID = 'aaaaaaaa-1111-2222-3333-444444444444';
const savedStates: Array<Record<string, unknown>> = [];

function plan(name: string, updatedAt: number): SddRun {
  return {
    dir: `c:\\dev\\projet\\.superpowers\\sdd\\${name}`,
    plan: name,
    totalCount: 1,
    doneCount: 1,
    finalReview: true,
    updatedAt,
    tasks: [{ number: 1, state: 'done', title: `Tâche de ${name}`, brief: true, report: true, review: true }],
  };
}

const CURRENT = plan('courant', new Date(2026, 8, 17, 12, 49).getTime());
const RECENT = plan('recent', new Date(2026, 8, 16, 9, 7).getTime());
const OLDEST = plan('le-plus-ancien', new Date(2026, 8, 10, 8, 0).getTime());

const root = () => document.getElementById('root') as HTMLElement;
const click = (title: string) => (root().querySelector(`.sdd-nav[title="${title}"]`) as HTMLElement).click();
const lastSaved = (key: string) => savedStates[savedStates.length - 1]?.[key];
const isOpen = () => root().querySelector('.sdd')?.classList.contains('open');

function send(plans: Pick<SessionNode, 'sdd' | 'sddPlans'>): void {
  const now = Date.now();
  const session: SessionNode = {
    sessionId: SID,
    pid: 1,
    cwd: 'c:\\dev\\projet',
    name: 'Calendrier planning',
    startedAt: now - 60_000,
    active: true,
    lastActivity: now,
    agents: [],
    workflows: [],
    ...plans,
  };
  const state: StateMessage = {
    projects: [{ cwd: session.cwd, name: 'projet', hasActiveSession: true, sessions: [session] }],
    settings: { mode: 'temporarily', retentionSeconds: 60 },
    now,
    locale: 'fr',
  };
  window.dispatchEvent(new MessageEvent('message', { data: state }));
}

beforeAll(async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"></div>';
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
    getState: () => undefined,
    setState: (state: Record<string, unknown>) => savedStates.push(state),
    postMessage: () => {},
  });
  await import('./main');
});

describe('webview — flèches de l’historique des plans', () => {
  // Plan courant retiré : il ne reste que l'historique.
  beforeAll(() => send({ sddPlans: [RECENT, OLDEST] }));

  it('part de la ligne d’accès discrète', () => {
    expect(root().querySelector('.sdd-history')?.textContent).toContain('2 plans');
  });

  it('‹ ouvre le plus récent des anciens plans et retient la position', () => {
    click('Plan précédent');

    expect(root().innerHTML).toContain('class="sdd past"');
    expect(root().innerHTML).toContain('Tâche de recent');
    expect(lastSaved('sddViewed')).toEqual([[SID, RECENT.dir]]);
  });

  it('‹ mène au plus ancien sans déplier la liste', () => {
    click('Plan précédent');

    expect(root().innerHTML).toContain('Tâche de le-plus-ancien');
    expect(isOpen()).toBe(false);
    expect(root().querySelector('.sdd-nav[title="Plan précédent"]')).toBeNull();
  });

  it('‹ grisé du plus ancien ne fait rien', () => {
    const saves = savedStates.length;
    (root().querySelector('.sdd-nav-off') as HTMLElement).click();

    expect(root().innerHTML).toContain('Tâche de le-plus-ancien');
    expect(savedStates.length).toBe(saves);
  });

  it('› revient au plan plus récent', () => {
    click('Plan suivant');

    expect(root().innerHTML).toContain('Tâche de recent');
  });

  it('› depuis le plus récent referme sur la ligne d’accès et oublie la position', () => {
    click('Plan suivant');

    expect(root().querySelector('.sdd-history')).not.toBeNull();
    expect(root().querySelector('.sdd')).toBeNull();
    expect(lastSaved('sddViewed')).toEqual([]);
  });
});

describe('webview — dépli des tâches du plan', () => {
  beforeAll(() => send({ sdd: CURRENT, sddPlans: [CURRENT, RECENT] }));

  it('se déplie au clic sur « Plan » et retient l’état', () => {
    (root().querySelector('.sdd-head .sdd-toggle') as HTMLElement).click();

    expect(isOpen()).toBe(true);
    expect(lastSaved('sdd')).toEqual([SID]);
  });

  it('se replie au clic sur un carré', () => {
    (root().querySelector('.sdd-sq') as HTMLElement).click();

    expect(isOpen()).toBe(false);
    expect(lastSaved('sdd')).toEqual([]);
  });

  it('un clic sur la date, entre les flèches, ne déplie rien', () => {
    (root().querySelector('.sdd-when') as HTMLElement).click();

    expect(isOpen()).toBe(false);
  });
});

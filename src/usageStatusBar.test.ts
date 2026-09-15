import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { UsageSnapshot } from './types';

interface FakeItem {
  id: string;
  alignment: number;
  priority: number;
  text: string;
  tooltip: unknown;
  backgroundColor: { id: string } | undefined;
  command: unknown;
  name: string;
  visible: boolean;
  disposed: boolean;
  show(): void;
  hide(): void;
  dispose(): void;
}

const created: FakeItem[] = [];

// Le module `vscode` n'existe qu'à l'intérieur de l'hôte d'extension : on ne simule que ce que la barre d'état touche.
vi.mock('vscode', () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  QuickPickItemKind: { Separator: -1, Default: 0 },
  ThemeColor: class {
    constructor(readonly id: string) {}
  },
  MarkdownString: class {
    constructor(readonly value: string) {}
  },
  window: {
    createStatusBarItem: (id: string, alignment: number, priority: number) => {
      const item: FakeItem = {
        id,
        alignment,
        priority,
        text: '',
        tooltip: undefined,
        backgroundColor: undefined,
        command: undefined,
        name: '',
        visible: false,
        disposed: false,
        show: () => (item.visible = true),
        hide: () => (item.visible = false),
        dispose: () => (item.disposed = true),
      };
      created.push(item);
      return item;
    },
    showQuickPick: vi.fn(),
  },
}));

import { UsageStatusBar, type UsageStatusSettings } from './usageStatusBar';

const NOW = Date.parse('2026-09-15T10:00:00Z');
const HOUR = 3_600_000;

function snapshot(sessionPercent = 2): UsageSnapshot {
  return {
    updatedAt: NOW - 60_000,
    limits: [
      { kind: 'session', percent: sessionPercent, resetsAt: NOW + 4 * HOUR + 9 * 60_000 + 21_000, severity: 'normal' },
      { kind: 'weekly_all', percent: 18, resetsAt: NOW + 76 * HOUR + 5 * 60_000, severity: 'normal' },
    ],
  };
}

/** `usage: null` = fichier absent ou illisible. */
function setup(overrides: Partial<UsageStatusSettings> = {}, usage: UsageSnapshot | null = snapshot()) {
  const state = {
    now: NOW,
    usage,
    settings: { format: 'text', side: 'right', usageFile: 'C:\\usage.json', showUsage: true, ...overrides } as UsageStatusSettings,
  };
  const updateSetting = vi.fn();
  const bar = new UsageStatusBar({
    locale: 'fr',
    now: () => state.now,
    readSettings: () => state.settings,
    readUsage: () => state.usage ?? undefined,
    updateSetting,
  });
  bar.refresh();
  const live = () => created.filter((item) => !item.disposed);
  const byId = (suffix: string) => live().find((item) => item.id.endsWith(suffix))!;
  return { bar, state, updateSetting, live, byId };
}

beforeEach(() => {
  created.length = 0;
  vi.mocked(vscode.window.showQuickPick).mockReset();
});

describe('UsageStatusBar — affichage', () => {
  it('ancre session, hebdo puis le menu tout à droite, dans cet ordre', () => {
    const { byId } = setup();
    const session = byId('session');
    const weekly = byId('weekly');
    const menu = byId('menu');
    expect(session.text).toBe('Session 2% 4:09:21');
    expect(weekly.text).toBe('Hebdo 18% 3j 04h');
    expect(menu.text).toBe('$(chevron-down)');
    expect([session, weekly, menu].every((item) => item.visible && item.alignment === vscode.StatusBarAlignment.Right)).toBe(true);
    expect(session.priority).toBeGreaterThan(weekly.priority);
    expect(weekly.priority).toBeGreaterThan(menu.priority);
  });

  it('ouvre la vue Claude Agents au clic sur une limite', () => {
    const { byId } = setup();
    expect(byId('session').command).toBe('claudeAgentsCards.focus');
    expect(byId('menu').command).toBe('claudeAgents.usageStatusBarMenu');
  });

  it('ne montre rien sans fichier d’usage lisible', () => {
    const { live } = setup({}, null);
    expect(live().some((item) => item.visible)).toBe(false);
  });

  it('ne montre rien en mode masqué', () => {
    const { live } = setup({ format: 'off' });
    expect(live().some((item) => item.visible)).toBe(false);
  });

  it('colore seulement la limite en alerte, avec les couleurs du thème', () => {
    const { byId } = setup({}, snapshot(86));
    expect(byId('session').backgroundColor?.id).toBe('statusBarItem.warningBackground');
    expect(byId('weekly').backgroundColor).toBeUndefined();
  });

  it('fait avancer le compte à rebours à chaque seconde', () => {
    const { bar, state, byId } = setup();
    state.now += 1000;
    bar.tick();
    expect(byId('session').text).toBe('Session 2% 4:09:20');
  });

  it('recrée les éléments à gauche quand le côté change', () => {
    const { bar, state, live } = setup();
    state.settings = { ...state.settings, side: 'left' };
    bar.refresh();
    expect(live()).toHaveLength(3);
    expect(live().every((item) => item.alignment === vscode.StatusBarAlignment.Left)).toBe(true);
    expect(created.filter((item) => item.disposed)).toHaveLength(3);
  });

  it('libère ses éléments', () => {
    const { bar, live } = setup();
    bar.dispose();
    expect(live()).toHaveLength(0);
  });
});

describe('UsageStatusBar — menu', () => {
  type Pick = { label: string; description?: string; kind?: number; run?: () => void };
  const pick = async (bar: UsageStatusBar, match: (item: Pick) => boolean): Promise<Pick[]> => {
    let offered: Pick[] = [];
    vi.mocked(vscode.window.showQuickPick).mockImplementation((async (items: Pick[]) => {
      offered = items;
      return items.find(match);
    }) as never);
    await bar.showMenu();
    return offered;
  };

  it('propose texte, anneaux, masquer, puis côté et card, en 5 lignes et un séparateur', async () => {
    const { bar } = setup();
    const items = await pick(bar, () => false);
    expect(items.map((item) => item.label)).toEqual([
      '$(check) $(layout-statusbar) Texte',
      '$(blank) $(claude-agents-ring-4) Anneaux',
      '$(blank) $(eye-closed) Masquer de la barre d’état',
      '',
      '$(blank) $(arrow-left) Placer à gauche',
      '$(check) $(layout-panel) Card d’usage dans la vue',
    ]);
    expect(items[0].description).toBe('Session 2% 4:09:21 · Hebdo 18% 3j 04h');
    expect(items[4].description).toBe('actuellement à droite');
  });

  it('enregistre le format choisi', async () => {
    const { bar, updateSetting } = setup();
    await pick(bar, (item) => item.label.includes('Anneaux'));
    expect(updateSetting).toHaveBeenCalledWith('usageStatusBar', 'rings');
  });

  it('bascule le côté et la card de la vue', async () => {
    const { bar, updateSetting } = setup({ side: 'left' });
    const items = await pick(bar, (item) => item.label.includes('Placer'));
    expect(items[4].label).toBe('$(blank) $(arrow-right) Placer à droite');
    expect(updateSetting).toHaveBeenCalledWith('usageStatusBarSide', 'right');
    await pick(bar, (item) => item.label.includes('Card'));
    expect(updateSetting).toHaveBeenCalledWith('showUsage', false);
  });
});

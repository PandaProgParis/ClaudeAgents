import * as vscode from 'vscode';
import { STRINGS, type Locale } from './i18n';
import type { UsageSnapshot } from './types';
import { RING_ICON_PREFIX, RING_STEPS, statusItems, statusTooltip, type StatusFormat, type StatusKey, type StatusLevel } from './usageStatus';

export type StatusSide = 'right' | 'left';

export interface UsageStatusSettings {
  format: StatusFormat;
  side: StatusSide;
  usageFile: string;
  showUsage: boolean;
}

export interface UsageStatusBarDeps {
  locale: Locale;
  now: () => number;
  readSettings: () => UsageStatusSettings;
  readUsage: (file: string) => UsageSnapshot | undefined;
  /** Clé relative à `claudeAgents` (ex. `usageStatusBar`). */
  updateSetting: (key: string, value: unknown) => unknown;
}

export const MENU_COMMAND = 'claudeAgents.usageStatusBarMenu';
const OPEN_VIEW_COMMAND = 'claudeAgentsCards.focus';
/** Priorités basses : collés au bout de leur côté, session puis hebdo puis menu (plus haut = plus à gauche). */
const PRIORITIES: Record<StatusKey | 'menu', number> = { session: -1000, weekly: -1001, menu: -1002 };
const BACKGROUNDS: Record<StatusLevel, string | undefined> = {
  normal: undefined,
  warning: 'statusBarItem.warningBackground',
  critical: 'statusBarItem.errorBackground',
};

interface MenuItem extends vscode.QuickPickItem {
  run?: () => unknown;
}

/**
 * Usage dans la barre d'état : un élément par limite (session, hebdo) et un menu d'affichage.
 * `refresh` relit réglages et fichier ; `tick` ne fait qu'avancer les comptes à rebours.
 */
export class UsageStatusBar implements vscode.Disposable {
  private items: Record<StatusKey | 'menu', vscode.StatusBarItem> | undefined;
  private side: StatusSide | undefined;
  private settings: UsageStatusSettings | undefined;
  private usage: UsageSnapshot | undefined;
  private readonly tooltips = new Map<StatusKey, string>();

  constructor(private readonly deps: UsageStatusBarDeps) {}

  refresh(): void {
    this.settings = this.deps.readSettings();
    this.usage = this.settings.format === 'off' ? undefined : this.deps.readUsage(this.settings.usageFile);
    this.render();
  }

  tick(): void {
    this.render();
  }

  private ensureItems(side: StatusSide): Record<StatusKey | 'menu', vscode.StatusBarItem> {
    if (this.items && this.side === side) {
      return this.items;
    }
    this.disposeItems();
    const alignment = side === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right;
    const strings = STRINGS[this.deps.locale];
    const create = (key: StatusKey | 'menu', name: string): vscode.StatusBarItem => {
      const item = vscode.window.createStatusBarItem(`claudeAgents.usage.${key}`, alignment, PRIORITIES[key]);
      item.name = `${strings.statusTitle} — ${name}`;
      return item;
    };
    this.side = side;
    this.items = {
      session: create('session', strings.statusSession),
      weekly: create('weekly', strings.statusWeekly),
      menu: create('menu', strings.statusMenu),
    };
    this.items.menu.text = '$(chevron-down)';
    this.items.menu.tooltip = strings.statusMenu;
    this.items.menu.command = MENU_COMMAND;
    return this.items;
  }

  private render(): void {
    const settings = this.settings;
    if (!settings || !this.usage) {
      this.hideAll();
      return;
    }
    const items = this.ensureItems(settings.side);
    const now = this.deps.now();
    const models = statusItems(this.usage, { now, locale: this.deps.locale, format: settings.format });
    if (models.length === 0) {
      this.hideAll();
      return;
    }
    const tooltip = `${statusTooltip(this.usage, { now, locale: this.deps.locale })}\n\n${STRINGS[this.deps.locale].statusOpenView}`;
    for (const key of ['session', 'weekly'] as const) {
      const item = items[key];
      const model = models.find((candidate) => candidate.key === key);
      if (!model) {
        item.hide();
        continue;
      }
      item.text = model.text;
      const background = BACKGROUNDS[model.level];
      item.backgroundColor = background === undefined ? undefined : new vscode.ThemeColor(background);
      // Une nouvelle infobulle referme le survol en cours : on ne la remplace que si son contenu change.
      if (this.tooltips.get(key) !== tooltip) {
        this.tooltips.set(key, tooltip);
        item.tooltip = new vscode.MarkdownString(tooltip);
      }
      item.command = OPEN_VIEW_COMMAND;
      item.show();
    }
    items.menu.show();
  }

  async showMenu(): Promise<void> {
    const settings = this.settings ?? this.deps.readSettings();
    const strings = STRINGS[this.deps.locale];
    const mark = (on: boolean): string => (on ? '$(check)' : '$(blank)');
    const preview = (format: StatusFormat): string | undefined =>
      this.usage === undefined
        ? undefined
        : statusItems(this.usage, { now: this.deps.now(), locale: this.deps.locale, format })
            .map((model) => model.text)
            .join(format === 'text' ? ' · ' : ' ');
    const toRight = settings.side === 'left';
    const choices: MenuItem[] = [
      {
        label: `${mark(settings.format === 'text')} $(layout-statusbar) ${strings.statusText}`,
        description: preview('text'),
        run: () => this.deps.updateSetting('usageStatusBar', 'text'),
      },
      {
        label: `${mark(settings.format === 'rings')} $(${RING_ICON_PREFIX}${RING_STEPS / 2}) ${strings.statusRings}`,
        description: preview('rings'),
        run: () => this.deps.updateSetting('usageStatusBar', 'rings'),
      },
      {
        label: `${mark(settings.format === 'off')} $(eye-closed) ${strings.statusHide}`,
        run: () => this.deps.updateSetting('usageStatusBar', 'off'),
      },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      {
        label: `$(blank) $(arrow-${toRight ? 'right' : 'left'}) ${toRight ? strings.statusMoveRight : strings.statusMoveLeft}`,
        description: toRight ? strings.statusOnLeft : strings.statusOnRight,
        run: () => this.deps.updateSetting('usageStatusBarSide', toRight ? 'right' : 'left'),
      },
      {
        label: `${mark(settings.showUsage)} $(layout-panel) ${strings.statusCard}`,
        run: () => this.deps.updateSetting('showUsage', !settings.showUsage),
      },
    ];
    const chosen = await vscode.window.showQuickPick(choices, { placeHolder: strings.statusTitle });
    await chosen?.run?.();
  }

  private hideAll(): void {
    if (this.items) {
      for (const item of Object.values(this.items)) {
        item.hide();
      }
    }
  }

  private disposeItems(): void {
    if (this.items) {
      for (const item of Object.values(this.items)) {
        item.dispose();
      }
    }
    this.items = undefined;
    this.tooltips.clear();
  }

  dispose(): void {
    this.disposeItems();
  }
}

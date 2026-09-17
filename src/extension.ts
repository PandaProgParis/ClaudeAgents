import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { STRINGS, resolveLocale } from './i18n';
import { buildState, localUrls } from './state';
import { probeUrls } from './portProbe';
import { countWaitingSessions } from './visibility';
import { CardsViewProvider } from './cardsView';
import { RatingRefresher, fetchMarketplaceRating, type StoredRating } from './marketplace';
import { readUsage } from './usage';
import { MENU_COMMAND, UsageStatusBar, type StatusSide } from './usageStatusBar';
import type { StatusFormat } from './usageStatus';

const POLL_INTERVAL_MS = 2000;
/** Vue masquée : on continue à scanner, plus lentement, pour tenir à jour le badge « sessions en attente ». */
const HIDDEN_POLL_INTERVAL_MS = 5000;
const SCOPE_STATE_KEY = 'currentProjectOnly';
const SCOPE_CONTEXT_KEY = 'claudeAgents.currentProjectOnly';
/** Barre d'état : le compte à rebours avance chaque seconde, le fichier d'usage est relu toutes les 5 s. */
const STATUS_TICK_MS = 1000;
const STATUS_TICKS_PER_READ = 5;
/** Dernière note lue sur le Marketplace, resservie au démarrage suivant sans requête. */
const RATING_STATE_KEY = 'marketplaceRating';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Claude Agents');
  const claudeDir = path.join(os.homedir(), '.claude');
  const provider = new CardsViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CardsViewProvider.viewType, provider),
  );

  let currentProjectOnly = context.workspaceState.get<boolean>(SCOPE_STATE_KEY, false);
  void vscode.commands.executeCommand('setContext', SCOPE_CONTEXT_KEY, currentProjectOnly);

  // Note de l'encart de notation : le scan ne tourne que vue résolue, la requête part donc seulement
  // quand la vue a été ouverte, au plus toutes les 6 h.
  const rating = new RatingRefresher({
    fetch: fetchMarketplaceRating,
    now: Date.now,
    load: () => context.globalState.get<StoredRating>(RATING_STATE_KEY),
    save: (value) => void context.globalState.update(RATING_STATE_KEY, value),
  });

  const runScan = (): void => {
    const now = Date.now();
    rating.maybeRefresh();
    try {
      const config = vscode.workspace.getConfiguration('claudeAgents');
      const locale = resolveLocale(vscode.env.language);
      const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
      const state = buildState({
        claudeDir,
        now,
        settings: {
          mode: config.get<'always' | 'temporarily' | 'never'>('showFinishedAgents', 'temporarily'),
          retentionSeconds: config.get<number>('finishedAgentRetentionSeconds', 60),
        },
        inactiveSessionRetentionMinutes: config.get<number>('inactiveSessionRetentionMinutes', 10),
        showUsage: config.get<boolean>('showUsage', true),
        usageFile: config.get<string>('usageFile', ''),
        rating: rating.current,
        locale,
        workspaceFolders: currentProjectOnly ? workspaceFolders : undefined,
        // Les sessions du workspace ouvert restent affichées au-delà de la rétention d'inactivité.
        pinnedFolders: config.get<boolean>('alwaysShowWorkspaceSessions', true) ? workspaceFolders : undefined,
        log: (message) => output.appendLine(message),
      });
      // Sondage des adresses locales en arrière-plan : le prochain scan lira le résultat.
      void probeUrls(localUrls(state.projects)).catch(() => undefined);
      const waiting = countWaitingSessions(state.projects);
      provider.setBadge(waiting > 0 ? { value: waiting, tooltip: STRINGS[locale].waitingBadge(waiting) } : undefined);
      provider.postState(state);
    } catch (error) {
      output.appendLine(`Scan en échec : ${String(error)}`);
    }
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  let pollIntervalMs: number | undefined;
  /** Vue visible : 2 s pour l'affichage ; vue masquée mais résolue : 5 s, juste pour le badge ; undefined : arrêt. */
  const setPolling = (intervalMs: number | undefined): void => {
    if (intervalMs === pollIntervalMs) {
      return;
    }
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    pollIntervalMs = intervalMs;
    if (intervalMs !== undefined) {
      runScan();
      timer = setInterval(runScan, intervalMs);
    }
  };

  provider.onDidChangeVisibility(
    (visible) => setPolling(visible ? POLL_INTERVAL_MS : provider.resolved ? HIDDEN_POLL_INTERVAL_MS : undefined),
    undefined,
    context.subscriptions,
  );

  const setScope = (value: boolean): void => {
    currentProjectOnly = value;
    void context.workspaceState.update(SCOPE_STATE_KEY, value);
    void vscode.commands.executeCommand('setContext', SCOPE_CONTEXT_KEY, value);
    runScan();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeAgents.focusCurrentProject', () => setScope(true)),
    vscode.commands.registerCommand('claudeAgents.showAllProjects', () => setScope(false)),
    // Roue dentée de la barre de titre : réglages filtrés sur l'extension.
    vscode.commands.registerCommand('claudeAgents.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:pandaprog.claude-agents'),
    ),
  );

  // Usage dans la barre d'état : indépendant de la vue, visible même quand elle est fermée.
  const usageBar = new UsageStatusBar({
    locale: resolveLocale(vscode.env.language),
    now: Date.now,
    readSettings: () => {
      const config = vscode.workspace.getConfiguration('claudeAgents');
      return {
        format: config.get<StatusFormat>('usageStatusBar', 'text'),
        side: config.get<StatusSide>('usageStatusBarSide', 'right'),
        usageFile: config.get<string>('usageFile', ''),
        showUsage: config.get<boolean>('showUsage', true),
      };
    },
    readUsage,
    updateSetting: (key, value) =>
      vscode.workspace.getConfiguration('claudeAgents').update(key, value, vscode.ConfigurationTarget.Global),
  });
  usageBar.refresh();
  let statusTicks = 0;
  const statusTimer = setInterval(() => {
    statusTicks = (statusTicks + 1) % STATUS_TICKS_PER_READ;
    if (statusTicks === 0) {
      usageBar.refresh();
    } else {
      usageBar.tick();
    }
  }, STATUS_TICK_MS);
  context.subscriptions.push(
    usageBar,
    { dispose: () => clearInterval(statusTimer) },
    vscode.commands.registerCommand(MENU_COMMAND, () => usageBar.showMenu()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('claudeAgents')) {
        return;
      }
      usageBar.refresh();
      if (provider.resolved) {
        runScan();
      }
    }),
  );

  // fs.watch émet des rafales (rename+change par fichier sous Windows) : on coalesce en un seul scan.
  let watcher: fs.FSWatcher | undefined;
  let watchDebounce: ReturnType<typeof setTimeout> | undefined;
  try {
    watcher = fs.watch(path.join(claudeDir, 'sessions'), () => {
      if (!provider.resolved) {
        return;
      }
      clearTimeout(watchDebounce);
      watchDebounce = setTimeout(runScan, 200);
    });
  } catch (error) {
    output.appendLine(`Watcher indisponible, polling seul : ${String(error)}`);
  }

  context.subscriptions.push(output, {
    dispose: () => {
      setPolling(undefined);
      clearTimeout(watchDebounce);
      watcher?.close();
    },
  });
}

export function deactivate(): void {}

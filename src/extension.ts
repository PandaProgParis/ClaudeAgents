import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { STRINGS, resolveLocale } from './i18n';
import { buildState } from './state';
import { countWaitingSessions } from './visibility';
import { CardsViewProvider } from './cardsView';

const POLL_INTERVAL_MS = 2000;
/** Vue masquée : on continue à scanner, plus lentement, pour tenir à jour le badge « sessions en attente ». */
const HIDDEN_POLL_INTERVAL_MS = 5000;
const SCOPE_STATE_KEY = 'currentProjectOnly';
const SCOPE_CONTEXT_KEY = 'claudeAgents.currentProjectOnly';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Claude Agents');
  const claudeDir = path.join(os.homedir(), '.claude');
  const provider = new CardsViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CardsViewProvider.viewType, provider),
  );

  let currentProjectOnly = context.workspaceState.get<boolean>(SCOPE_STATE_KEY, false);
  void vscode.commands.executeCommand('setContext', SCOPE_CONTEXT_KEY, currentProjectOnly);

  const runScan = (): void => {
    const now = Date.now();
    try {
      const config = vscode.workspace.getConfiguration('claudeAgents');
      const locale = resolveLocale(vscode.env.language);
      const state = buildState({
        claudeDir,
        now,
        settings: {
          mode: config.get<'always' | 'temporarily' | 'never'>('showFinishedAgents', 'temporarily'),
          retentionSeconds: config.get<number>('finishedAgentRetentionSeconds', 60),
        },
        inactiveSessionRetentionMinutes: config.get<number>('inactiveSessionRetentionMinutes', 10),
        locale,
        workspaceFolders: currentProjectOnly
          ? (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
          : undefined,
        log: (message) => output.appendLine(message),
      });
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

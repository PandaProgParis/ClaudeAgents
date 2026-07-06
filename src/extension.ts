import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { readEffortLevel, scan } from './scanner';
import { resolveLocale } from './i18n';
import { filterProjectsForWorkspace } from './visibility';
import { CardsViewProvider } from './cardsView';

const POLL_INTERVAL_MS = 2000;
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

  const scanProjects = (now: number): ReturnType<typeof scan> => {
    const projects = scan({ claudeDir, now, log: (message) => output.appendLine(message) });
    if (!currentProjectOnly) {
      return projects;
    }
    const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    return filterProjectsForWorkspace(projects, folders);
  };

  const runScan = (): void => {
    const now = Date.now();
    try {
      const config = vscode.workspace.getConfiguration('claudeAgents');
      provider.postState({
        projects: scanProjects(now),
        effortLevel: readEffortLevel(claudeDir),
        settings: {
          mode: config.get<'always' | 'temporarily' | 'never'>('showFinishedAgents', 'temporarily'),
          retentionSeconds: config.get<number>('finishedAgentRetentionSeconds', 60),
        },
        inactiveSessionRetentionMinutes: config.get<number>('inactiveSessionRetentionMinutes', 10),
        locale: resolveLocale(vscode.env.language),
        now,
      });
    } catch (error) {
      output.appendLine(`Scan en échec : ${String(error)}`);
    }
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  const startPolling = (): void => {
    if (timer === undefined) {
      runScan();
      timer = setInterval(runScan, POLL_INTERVAL_MS);
    }
  };
  const stopPolling = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  provider.onDidChangeVisibility((visible) => (visible ? startPolling() : stopPolling()), undefined, context.subscriptions);

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
      if (!provider.visible) {
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
      stopPolling();
      clearTimeout(watchDebounce);
      watcher?.close();
    },
  });
}

export function deactivate(): void {}

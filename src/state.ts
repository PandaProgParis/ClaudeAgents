import { readEffortLevel, scan } from './scanner';
import { filterProjectsForWorkspace } from './visibility';
import type { Locale } from './i18n';
import type { FinishedAgentSettings, StateMessage } from './types';

export interface StateOptions {
  claudeDir: string;
  now: number;
  settings: FinishedAgentSettings;
  inactiveSessionRetentionMinutes: number;
  locale: Locale;
  /** Dossiers du workspace : s'ils sont fournis, seuls leurs projets sont gardés (filtre « projet courant »). */
  workspaceFolders?: string[];
  log?: (message: string) => void;
  isPidAlive?: (pid: number) => boolean;
}

/**
 * Assemble l'état complet poussé à la webview. Partagé par l'extension (extension.ts) et par le serveur
 * d'aperçu local (dev/server.ts), pour que l'aperçu montre exactement ce que VS Code afficherait.
 */
export function buildState(options: StateOptions): StateMessage {
  const projects = scan({
    claudeDir: options.claudeDir,
    now: options.now,
    log: options.log,
    isPidAlive: options.isPidAlive,
  });
  return {
    projects: options.workspaceFolders ? filterProjectsForWorkspace(projects, options.workspaceFolders) : projects,
    effortLevel: readEffortLevel(options.claudeDir),
    settings: options.settings,
    inactiveSessionRetentionMinutes: options.inactiveSessionRetentionMinutes,
    locale: options.locale,
    now: options.now,
  };
}

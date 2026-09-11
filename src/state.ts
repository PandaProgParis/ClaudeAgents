import { readEffortLevel, scan } from './scanner';
import { isUrlAlive } from './portProbe';
import { filterProjectsForWorkspace } from './visibility';
import type { Locale } from './i18n';
import type { FinishedAgentSettings, ProjectNode, StateMessage } from './types';

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
  const kept = options.workspaceFolders ? filterProjectsForWorkspace(projects, options.workspaceFolders) : projects;
  annotateUrlLiveness(kept);
  return {
    projects: kept,
    effortLevel: readEffortLevel(options.claudeDir),
    settings: options.settings,
    inactiveSessionRetentionMinutes: options.inactiveSessionRetentionMinutes,
    locale: options.locale,
    now: options.now,
  };
}

/** Adresses locales servies par les commandes de fond : ce que l'hôte donne à sonder après chaque scan. */
export function localUrls(projects: ProjectNode[]): string[] {
  const urls: string[] = [];
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const task of session.backgroundTasks ?? []) {
        if (task.url !== undefined) {
          urls.push(task.url);
        }
      }
    }
  }
  return urls;
}

/** Reporte sur chaque commande la vivacité déjà mesurée de son port (le scan ne sonde rien lui-même). */
function annotateUrlLiveness(projects: ProjectNode[]): void {
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const task of session.backgroundTasks ?? []) {
        task.urlAlive = task.url === undefined ? undefined : isUrlAlive(task.url);
      }
    }
  }
}

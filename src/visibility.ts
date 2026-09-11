import type { AgentNode, FinishedAgentSettings, ProjectNode, SessionNode } from './types';

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

/** Garde les projets liés aux dossiers du workspace (cwd égal, contenu ou contenant). */
export function filterProjectsForWorkspace(projects: ProjectNode[], workspaceFolders: string[]): ProjectNode[] {
  const folders = workspaceFolders.map(normalizePath).filter((folder) => folder.length > 0);
  return projects.filter((project) => {
    const cwd = normalizePath(project.cwd);
    return folders.some(
      (folder) => cwd === folder || cwd.startsWith(`${folder}/`) || folder.startsWith(`${cwd}/`),
    );
  });
}

/** Nombre de sessions bloquées sur une question, tous projets du périmètre confondus (badge de l'icône). */
export function countWaitingSessions(projects: ProjectNode[]): number {
  return projects.reduce(
    (total, project) => total + project.sessions.filter((session) => session.pendingQuestion === true).length,
    0,
  );
}

/** Masque les sessions inactives depuis plus de `retentionMinutes` (0 = toujours afficher).
 * Une session en attente de réponse utilisateur reste toujours visible. */
export function filterVisibleSessions(
  sessions: SessionNode[],
  retentionMinutes: number,
  now: number,
): SessionNode[] {
  if (retentionMinutes <= 0) {
    return sessions;
  }
  return sessions.filter(
    (session) =>
      session.active ||
      session.pendingQuestion === true ||
      now - (session.lastActivity ?? session.startedAt) < retentionMinutes * 60_000,
  );
}

/** Une session affichée, dépliée ou réduite à ses seules adresses locales encore servies. */
export interface SessionView {
  session: SessionNode;
  collapsed: boolean;
}

/** Vrai si au moins une commande de fond sert une adresse dont le port a répondu. */
function hasLiveUrl(session: SessionNode): boolean {
  return (session.backgroundTasks ?? []).some((task) => task.url !== undefined && task.urlAlive === true);
}

/**
 * Sessions à afficher. Au-delà de la rétention, une session n'est plus supprimée si elle sert encore
 * une adresse locale : elle est réduite à ces adresses. La preuve doit être positive (`urlAlive === true`),
 * sinon une session éteinte depuis des heures ressusciterait le temps que son port soit sondé.
 */
export function visibleSessionViews(
  sessions: SessionNode[],
  retentionMinutes: number,
  now: number,
): SessionView[] {
  const visible = new Set(filterVisibleSessions(sessions, retentionMinutes, now));
  const views: SessionView[] = [];
  for (const session of sessions) {
    if (visible.has(session)) {
      views.push({ session, collapsed: false });
    } else if (hasLiveUrl(session)) {
      views.push({ session, collapsed: true });
    }
  }
  return views;
}

export function filterVisibleAgents(
  agents: AgentNode[],
  settings: FinishedAgentSettings,
  now: number,
): AgentNode[] {
  return agents.filter((agent) => {
    if (agent.status === 'active') {
      return true;
    }
    if (settings.mode === 'always') {
      return true;
    }
    if (settings.mode === 'never') {
      return false;
    }
    return now - agent.lastActivity < settings.retentionSeconds * 1000;
  });
}

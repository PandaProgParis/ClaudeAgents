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

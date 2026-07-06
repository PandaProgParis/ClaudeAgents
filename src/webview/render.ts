import type { AgentNode, FinishedAgentSettings, ProjectNode, SessionNode, WorkflowNode } from '../types';
import { filterVisibleAgents, filterVisibleSessions } from '../visibility';
import { abbreviateModel, contextLimitFor, formatDuration, formatTokens } from '../format';
import { STRINGS, type Locale } from '../i18n';
import { activityVerb, agentDescription, agentLabel, workflowDescription, workflowLabel } from '../labels';

export interface RenderOptions {
  now: number;
  effortLevel?: string;
  settings: FinishedAgentSettings;
  /** Minutes avant masquage d'une session inactive (0 = toujours afficher). */
  inactiveSessionRetentionMinutes?: number;
  locale?: Locale;
}

const DEFAULT_SESSION_RETENTION_MINUTES = 10;

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderApp(projects: ProjectNode[], options: RenderOptions): string {
  const retention = options.inactiveSessionRetentionMinutes ?? DEFAULT_SESSION_RETENTION_MINUTES;
  const visible = projects
    .map((project) => ({ project, sessions: filterVisibleSessions(project.sessions, retention, options.now) }))
    .filter(({ sessions }) => sessions.length > 0);
  if (visible.length === 0) {
    return `<p class="empty">${escapeHtml(STRINGS[options.locale ?? 'fr'].empty)}</p>`;
  }
  return visible.map(({ project, sessions }) => renderProject(project, sessions, options)).join('');
}

function renderProject(project: ProjectNode, sessions: SessionNode[], options: RenderOptions): string {
  const cards = sessions.map((session) => renderSessionCard(session, options)).join('');
  return `<section class="project" data-key="proj:${escapeHtml(project.cwd)}"><h2 title="${escapeHtml(project.cwd)}">${escapeHtml(project.name)}</h2><div class="sessions">${cards}</div></section>`;
}

function renderSessionCard(session: SessionNode, options: RenderOptions): string {
  const locale = options.locale ?? 'fr';
  const dot = `<span class="dot${session.active ? ' active' : ''}"></span>`;
  const meta = [
    options.effortLevel,
    formatDuration(options.now - session.startedAt),
    session.active && session.lastTool ? activityVerb(session.lastTool, locale) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const model = session.model ? abbreviateModel(session.model) : undefined;
  const modelBadge = model
    ? `<span class="badge model-${escapeHtml(model)}">${escapeHtml(model)}</span>`
    : '';
  const branch = session.gitBranch ? `<span class="branch">⎇ ${escapeHtml(session.gitBranch)}</span>` : '';
  const cardClass = `card${session.active ? ' active' : ''}${session.pendingQuestion ? ' waiting' : ''}`;
  const questionText = session.pendingQuestionText ?? STRINGS[locale].waiting;
  const question = session.pendingQuestion
    ? `<div class="question" title="${escapeHtml(questionText)}">⏳ ${escapeHtml(questionText)}</div>`
    : '';
  return [
    `<article class="${cardClass}" data-key="sess:${escapeHtml(session.sessionId)}">`,
    `<header>${dot}<h3 title="${escapeHtml(session.name)}">${escapeHtml(session.name)}</h3><span class="timer">${escapeHtml(sessionActivityTimer(session, options.now))}</span></header>`,
    `<div class="meta">${modelBadge}${branch}<span class="meta-text">${escapeHtml(meta)}</span></div>`,
    question,
    renderAgents(session, options),
    renderTodos(session),
    renderContext(session, options.locale ?? 'fr'),
    '</article>',
  ].join('');
}

const TODO_MAX = 15;

/** Liste de tâches (TodoWrite) en cases cochées : ✅ terminée, 🔵 en cours, ⬜ à faire. */
function renderTodos(session: SessionNode): string {
  const todos = session.todos;
  if (!todos || todos.length === 0) {
    return '';
  }
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const shown = todos.slice(0, TODO_MAX);
  const items = shown
    .map((todo) => {
      const cls = todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'doing' : 'pending';
      const icon = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔵' : '⬜';
      return `<li class="todo ${cls}"><span class="todo-tick">${icon}</span><span class="todo-text" title="${escapeHtml(todo.content)}">${escapeHtml(todo.content)}</span></li>`;
    })
    .join('');
  const extra = todos.length - shown.length;
  const more = extra > 0 ? `<li class="todo more">+${extra}</li>` : '';
  return `<div class="todos"><div class="todos-head">📋 ${done}/${todos.length}</div><ul>${items}${more}</ul></div>`;
}

/** Timer compact en haut à droite : durée depuis la dernière activité, ⏳ en attente, ⏸ au repos. */
function sessionActivityTimer(session: SessionNode, now: number): string {
  if (session.lastActivity === undefined) {
    return session.pendingQuestion ? '⏳' : '';
  }
  const duration = formatDuration(now - session.lastActivity);
  if (session.pendingQuestion) {
    return `⏳ ${duration}`;
  }
  return session.active ? duration : `⏸ ${duration}`;
}

function renderContext(session: SessionNode, locale: Locale): string {
  if (session.contextTokens === undefined) {
    return '';
  }
  const limit = session.model ? contextLimitFor(session.model) : undefined;
  if (limit === undefined) {
    return `<div class="ctx"><span class="ctx-label">${formatTokens(session.contextTokens, locale)} tokens</span></div>`;
  }
  const pct = Math.min(100, Math.round((session.contextTokens / limit) * 100));
  const level = pct > 85 ? 'crit' : pct > 60 ? 'warn' : 'ok';
  const labelClass = level === 'ok' ? 'ctx-label' : `ctx-label ${level}`;
  const alert = level === 'crit' ? '⚠ ' : '';
  return [
    '<div class="ctx">',
    `<svg class="bar" viewBox="0 0 100 6" preserveAspectRatio="none"><rect class="fill ${level}" x="0" y="0" width="${pct}" height="6" rx="2"/></svg>`,
    `<span class="${labelClass}">${alert}${formatTokens(session.contextTokens, locale)} / ${formatTokens(limit, locale)}</span>`,
    '</div>',
  ].join('');
}

function renderAgents(session: SessionNode, options: RenderOptions): string {
  const direct = filterVisibleAgents(session.agents, options.settings, options.now)
    .map((agent) => renderAgentLine(agent, options))
    .join('');
  const workflows = session.workflows
    .filter((workflow) => filterVisibleAgents(workflow.agents, options.settings, options.now).length > 0)
    .map((workflow) => renderWorkflow(workflow, options))
    .join('');
  if (!direct && !workflows) {
    return '';
  }
  return `<ul class="agents">${direct}${workflows}</ul>`;
}

function renderWorkflow(workflow: WorkflowNode, options: RenderOptions): string {
  const lines = filterVisibleAgents(workflow.agents, options.settings, options.now)
    .map((agent) => renderAgentLine(agent, options))
    .join('');
  return [
    `<li class="workflow" data-key="wf:${escapeHtml(workflow.id)}">`,
    `<span class="wf-label">${escapeHtml(workflowLabel(workflow))}</span> `,
    `<span class="wf-count">${escapeHtml(workflowDescription(workflow))}</span>`,
    `<ul>${lines}</ul>`,
    '</li>',
  ].join('');
}

function renderAgentLine(agent: AgentNode, options: RenderOptions): string {
  const locale = options.locale ?? 'fr';
  const context = agent.contextTokens !== undefined ? ` · ${formatTokens(agent.contextTokens, locale)}` : '';
  const icon =
    agent.status === 'active' ? '<span class="dot active"></span>' : '<span class="check">✓</span>';
  const gauge =
    agent.status === 'finished' && options.settings.mode === 'temporarily'
      ? renderRetentionGauge(agent, options)
      : '';
  const label = agentLabel(agent);
  const typeBadge = agent.agentType
    ? `<span class="agent-type">${escapeHtml(agent.agentType.split(':').pop() ?? agent.agentType)}</span>`
    : '';
  const verb =
    agent.status === 'active' && agent.lastTool
      ? `<span class="agent-verb">${escapeHtml(activityVerb(agent.lastTool, locale))}</span>`
      : '';
  const left = typeBadge || verb ? `<span class="agent-left">${typeBadge}${verb}</span>` : '';
  const depthClass = agent.depth ? ` depth-${Math.min(agent.depth, 3)}` : '';
  return [
    `<li class="agent${depthClass}" data-key="ag:${escapeHtml(agent.id)}">`,
    icon,
    left,
    `<span class="agent-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`,
    `<span class="agent-desc">${escapeHtml(agentDescription(agent, options.now, locale) + context)}</span>`,
    gauge,
    '</li>',
  ].join('');
}

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 6;

/** Jauge du temps restant avant disparition, ancrée en fin de ligne près du compteur de tokens. */
function renderRetentionGauge(agent: AgentNode, options: RenderOptions): string {
  const elapsed = options.now - agent.lastActivity;
  const remaining = Math.max(0, 1 - elapsed / (options.settings.retentionSeconds * 1000));
  const offset = (GAUGE_CIRCUMFERENCE * (1 - remaining)).toFixed(2);
  return [
    '<svg class="gauge" viewBox="0 0 16 16" width="14" height="14">',
    '<circle class="gauge-track" cx="8" cy="8" r="6"/>',
    `<circle class="gauge-fill" cx="8" cy="8" r="6" stroke-dasharray="${GAUGE_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${offset}" transform="rotate(-90 8 8)"/>`,
    '</svg>',
  ].join('');
}

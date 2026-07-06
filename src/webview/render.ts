import type { AgentNode, FinishedAgentSettings, ProjectNode, SessionNode, WorkflowNode } from '../types';
import { filterVisibleAgents, filterVisibleSessions } from '../visibility';
import { abbreviateModel, contextLimitFor, formatDuration, formatTokens, modelFamily } from '../format';
import { STRINGS, type Locale } from '../i18n';
import {
  activityVerb,
  agentDescription,
  agentLabel,
  backgroundTaskTitle,
  squareTitle,
  workflowDescription,
  workflowLabel,
} from '../labels';

export interface RenderOptions {
  now: number;
  effortLevel?: string;
  settings: FinishedAgentSettings;
  /** Minutes avant masquage d'une session inactive (0 = toujours afficher). */
  inactiveSessionRetentionMinutes?: number;
  locale?: Locale;
  /** Ids des workflows dont le détail est déplié (état tenu par la webview). */
  expandedWorkflows?: ReadonlySet<string>;
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
  const meta = [options.effortLevel, formatDuration(options.now - session.startedAt), sessionVerb(session, locale)]
    .filter(Boolean)
    .join(' · ');
  const modelBadge = session.model
    ? `<span class="badge model-${modelFamily(session.model) ?? 'other'}">${escapeHtml(abbreviateModel(session.model))}</span>`
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
    renderBackgroundTasks(session, options),
    renderAgents(session, options),
    renderTodos(session),
    renderContext(session, options.locale ?? 'fr'),
    '</article>',
  ].join('');
}

/** Verbe de l'agent principal : phase déduite du transcript si connue, sinon dernier outil d'une session active. */
function sessionVerb(session: SessionNode, locale: Locale): string | undefined {
  const activity = session.activity;
  if (activity) {
    if (activity.phase === 'thinking') {
      return STRINGS[locale].thinking;
    }
    if (activity.phase === 'delegating') {
      return STRINGS[locale].verbs.delegate;
    }
    return activity.phase === 'tool' && activity.tool ? activityVerb(activity.tool, locale) : undefined;
  }
  return session.active && session.lastTool ? activityVerb(session.lastTool, locale) : undefined;
}

/** Une ligne par commande de fond encore en cours : commande, durée, adresse locale cliquable. */
function renderBackgroundTasks(session: SessionNode, options: RenderOptions): string {
  const tasks = session.backgroundTasks;
  if (!tasks || tasks.length === 0) {
    return '';
  }
  const locale = options.locale ?? 'fr';
  return tasks
    .map((task) => {
      const link = task.url
        ? ` · <a href="${escapeHtml(task.url)}" target="_blank" rel="noopener">${escapeHtml(hostOf(task.url))}</a>`
        : '';
      return [
        `<div class="bg-task" data-key="bg:${escapeHtml(task.id)}">`,
        `<span class="bg-icon" title="${escapeHtml(STRINGS[locale].backgroundTask)}">⏵</span>`,
        `<span class="bg-label" title="${escapeHtml(task.command)}">${escapeHtml(backgroundTaskTitle(task))}</span>`,
        `<span class="bg-meta">${escapeHtml(formatDuration(options.now - task.startedAt))}${link}</span>`,
        '</div>',
      ].join('');
    })
    .join('');
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
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

function squareClass(status: AgentNode['status']): string {
  return status === 'active' ? 'running' : status === 'failed' ? 'failed' : 'done';
}

/**
 * Un workflow = une ligne de titre + compteur, une bande d'un carré par agent (gris terminé, bleu en cours,
 * rouge en échec), et en dessous seulement les agents en cours ou en échec — ces derniers soumis au même
 * réglage de rétention qu'un agent terminé. Chaque agent porte son rang (#n) dans le run, car les agents
 * d'un même workflow ont souvent la même première ligne de prompt. Un workflow où plus rien ne tourne garde
 * sa jauge de disparition sur la ligne de titre.
 */
function renderWorkflow(workflow: WorkflowNode, options: RenderOptions): string {
  const locale = options.locale ?? 'fr';
  const squares = workflow.agents
    .map(
      (agent, index) =>
        `<i class="sq ${squareClass(agent.status)}" title="${escapeHtml(squareTitle(agent, options.now, locale, index + 1))}"></i>`,
    )
    .join('');
  const open = options.expandedWorkflows?.has(workflow.id) ?? false;
  const visible = new Set(filterVisibleAgents(workflow.agents, options.settings, options.now));
  const lines = open
    ? ''
    : workflow.agents
        .map((agent, index) =>
          agent.status !== 'finished' && visible.has(agent) ? renderAgentLine(agent, options, index + 1) : '',
        )
        .join('');
  const settled = workflow.agents.length > 0 && workflow.agents.every((agent) => agent.status !== 'active');
  const gauge =
    settled && options.settings.mode === 'temporarily'
      ? renderRetentionGauge(Math.max(...workflow.agents.map((agent) => agent.lastActivity)), options)
      : '';
  return [
    `<li class="workflow${open ? ' open' : ''}" data-key="wf:${escapeHtml(workflow.id)}">`,
    `<div class="wf-head"><span class="wf-caret">${open ? '▾' : '▸'}</span><span class="wf-label">${escapeHtml(workflowLabel(workflow))}</span>`,
    `<span class="wf-count">${escapeHtml(workflowDescription(workflow, locale))}</span>${gauge}</div>`,
    `<div class="wf-strip">${squares}</div>`,
    open ? renderWorkflowDetail(workflow, options) : lines ? `<ul>${lines}</ul>` : '',
    '</li>',
  ].join('');
}

/**
 * Détail déplié d'un workflow, uniquement des faits : effectif et durée du run, description et phases déclarées
 * par le script, puis un tableau de tous les agents (rang, libellé, modèle, contexte, durée d'exécution).
 * La progression par phase n'est pas sur le disque pendant le run : elle n'est pas affichée.
 */
function renderWorkflowDetail(workflow: WorkflowNode, options: RenderOptions): string {
  const locale = options.locale ?? 'fr';
  const strings = STRINGS[locale];
  const startedAt = Math.min(...workflow.agents.map((agent) => agent.createdAt));
  // Run terminé : durée jusqu'à la dernière activité d'un agent ; run en cours : jusqu'à maintenant.
  const endedAt = workflow.agents.some((agent) => agent.status === 'active')
    ? options.now
    : Math.max(...workflow.agents.map((agent) => agent.lastActivity));
  const stats = `<p class="wf-stats">${escapeHtml(strings.agentCount(workflow.agents.length))} · ${escapeHtml(formatDuration(endedAt - startedAt))}</p>`;
  const description = workflow.description ? `<p class="wf-desc">${escapeHtml(workflow.description)}</p>` : '';
  const phases =
    workflow.phases && workflow.phases.length > 0
      ? `<p class="wf-phases"><span class="wf-phases-label">${escapeHtml(strings.phases)}</span> ${workflow.phases
          .map((phase) =>
            phase.detail
              ? `<span class="wf-phase" title="${escapeHtml(phase.detail)}">${escapeHtml(phase.title)}</span>`
              : `<span class="wf-phase">${escapeHtml(phase.title)}</span>`,
          )
          .join(' › ')}</p>`
      : '';
  const rows = workflow.agents
    .map((agent, index) => {
      const label = agentLabel(agent);
      const end = agent.status === 'active' ? options.now : agent.lastActivity;
      return [
        `<tr class="wf-agent ${squareClass(agent.status)}" data-key="wa:${escapeHtml(agent.id)}">`,
        `<td class="wf-n">#${index + 1}</td>`,
        `<td class="wf-name" title="${escapeHtml(label)}">${escapeHtml(label)}</td>`,
        `<td class="wf-model">${escapeHtml(agent.model ? abbreviateModel(agent.model) : '')}</td>`,
        `<td class="wf-num">${agent.contextTokens !== undefined ? escapeHtml(formatTokens(agent.contextTokens, locale)) : ''}</td>`,
        `<td class="wf-num">${escapeHtml(formatDuration(end - agent.createdAt))}</td>`,
        '</tr>',
      ].join('');
    })
    .join('');
  return `<div class="wf-detail">${stats}${description}${phases}<table class="wf-agents">${rows}</table></div>`;
}

/** Ligne d'un agent ; `ordinal` = rang dans son workflow (absent pour un sous-agent direct). */
function renderAgentLine(agent: AgentNode, options: RenderOptions, ordinal?: number): string {
  const locale = options.locale ?? 'fr';
  const context = agent.contextTokens !== undefined ? ` · ${formatTokens(agent.contextTokens, locale)}` : '';
  const index = ordinal === undefined ? '' : `<span class="agent-idx">#${ordinal}</span>`;
  const icon =
    agent.status === 'active'
      ? '<span class="dot active"></span>'
      : agent.status === 'failed'
        ? '<span class="cross">✗</span>'
        : '<span class="check">✓</span>';
  const gauge =
    agent.status !== 'active' && options.settings.mode === 'temporarily'
      ? renderRetentionGauge(agent.lastActivity, options)
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
    index,
    left,
    `<span class="agent-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`,
    `<span class="agent-desc">${escapeHtml(agentDescription(agent, options.now, locale) + context)}</span>`,
    gauge,
    '</li>',
  ].join('');
}

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 6;

/** Jauge du temps restant avant disparition (agent terminé, ou workflow entier où plus rien ne tourne). */
function renderRetentionGauge(lastActivity: number, options: RenderOptions): string {
  const elapsed = options.now - lastActivity;
  const remaining = Math.max(0, 1 - elapsed / (options.settings.retentionSeconds * 1000));
  const offset = (GAUGE_CIRCUMFERENCE * (1 - remaining)).toFixed(2);
  return [
    '<svg class="gauge" viewBox="0 0 16 16" width="14" height="14">',
    '<circle class="gauge-track" cx="8" cy="8" r="6"/>',
    `<circle class="gauge-fill" cx="8" cy="8" r="6" stroke-dasharray="${GAUGE_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${offset}" transform="rotate(-90 8 8)"/>`,
    '</svg>',
  ].join('');
}

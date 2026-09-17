import type { AgentNode, FinishedAgentSettings, ProjectNode, SddRun, SddTaskState, SessionNode, WorkflowNode } from '../types';
import { filterVisibleAgents, isInFolders, visibleSessionViews, type SessionPin, type SessionView } from '../visibility';
import { abbreviateModel, contextLimitFor, formatDuration, formatTokens, modelFamily } from '../format';
import { STRINGS, type Locale, type LocaleStrings } from '../i18n';
import {
  activityVerb,
  agentDescription,
  agentFigures,
  agentLabel,
  agentTokens,
  backgroundTaskTitle,
  sddFiguresText,
  sddTaskFigures,
  sddTaskTitle,
  squareTitle,
  workflowDescription,
  workflowLabel,
} from '../labels';

export interface RenderOptions {
  now: number;
  /** Effort global des réglages, en repli quand la session ne porte pas le sien. */
  effortLevel?: string;
  settings: FinishedAgentSettings;
  /** Minutes avant masquage d'une session inactive (0 = toujours afficher). */
  inactiveSessionRetentionMinutes?: number;
  locale?: Locale;
  /** Ids des workflows dont le détail est déplié (état tenu par la webview). */
  expandedWorkflows?: ReadonlySet<string>;
  /** Ids des sessions dont la carte des agents est dépliée (état tenu par la webview). */
  expandedMaps?: ReadonlySet<string>;
  /** Ids des sessions dont la liste des tâches SDD est dépliée (état tenu par la webview). */
  expandedSdd?: ReadonlySet<string>;
  /** Ancien plan consulté par session (dossier du workspace) ; absent = position par défaut. */
  sddViewed?: ReadonlyMap<string, string>;
  /** Dossiers du workspace : leurs sessions restent en card complète au-delà de la rétention. */
  pinnedFolders?: string[];
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
  const pinned = options.pinnedFolders ?? [];
  const isPinned: SessionPin | undefined =
    pinned.length > 0 ? (session) => isInFolders(session.cwd, pinned) : undefined;
  const visible = projects
    .map((project) => ({ project, views: visibleSessionViews(project.sessions, retention, options.now, isPinned) }))
    .filter(({ views }) => views.length > 0);
  if (visible.length === 0) {
    return `<p class="empty">${escapeHtml(STRINGS[options.locale ?? 'fr'].empty)}</p>`;
  }
  return visible.map(({ project, views }) => renderProject(project, views, options)).join('');
}

function renderProject(project: ProjectNode, views: SessionView[], options: RenderOptions): string {
  const cards = views
    .map(({ session, collapsed }) =>
      collapsed ? renderCollapsedCard(session, options) : renderSessionCard(session, options),
    )
    .join('');
  return `<section class="project" data-key="proj:${escapeHtml(project.cwd)}"><h2 title="${escapeHtml(project.cwd)}">${escapeHtml(project.name)}</h2><div class="sessions">${cards}</div></section>`;
}

function renderSessionCard(session: SessionNode, options: RenderOptions): string {
  const locale = options.locale ?? 'fr';
  const dot = `<span class="dot${session.active ? ' active' : ''}"></span>`;
  // L'effort de la session (transcript) prime sur l'effort global des réglages, qui ne vaut qu'à défaut.
  const effort = session.effort ?? options.effortLevel;
  const meta = [effort, formatDuration(options.now - session.startedAt), sessionVerb(session, locale)]
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
  const mapOpen = options.expandedMaps?.has(session.sessionId) ?? false;
  return [
    `<article class="${cardClass}" data-key="sess:${escapeHtml(session.sessionId)}">`,
    `<header>${dot}<h3 title="${escapeHtml(session.name)}">${escapeHtml(session.name)}</h3><span class="timer">${escapeHtml(sessionActivityTimer(session, options.now))}</span></header>`,
    `<div class="meta">${modelBadge}${branch}${renderCacheIndicator(session, options.now, locale)}${renderAgentsPill(session, locale)}<span class="meta-text">${escapeHtml(meta)}</span></div>`,
    question,
    renderBackgroundTasks(session, options),
    mapOpen ? renderAgentMap(session, options) : renderAgents(session, options),
    renderSdd(session, options),
    renderTodos(session),
    renderContext(session, options.locale ?? 'fr'),
    '</article>',
  ].join('');
}

/**
 * Cache d'invite, avec la règle de Claude Code : chaud tant que dernier message + TTL dépasse l'instant du rendu
 * (minutes restantes affichées, recalculées à chaque rendu), sinon « probablement expiré » ; une compaction
 * postérieure au dernier message rend le cache sans effet. Rien quand le transcript ne permet pas de conclure.
 */
function renderCacheIndicator(session: SessionNode, now: number, locale: Locale): string {
  const cache = session.cache;
  if (cache === undefined) {
    return '';
  }
  const strings = STRINGS[locale];
  if (cache.compactedAt !== undefined) {
    return `<span class="cache compacted" title="${escapeHtml(strings.cacheCompacted)}">⏱</span>`;
  }
  const remaining = cache.anchorAt + cache.ttlMs - now;
  if (remaining > 0) {
    const minutes = Math.ceil(remaining / 60_000);
    return `<span class="cache warm" title="${escapeHtml(strings.cacheWarm(minutes))}">⏱ ${minutes} min</span>`;
  }
  return `<span class="cache cold" title="${escapeHtml(strings.cacheCold(formatDuration(now - cache.anchorAt)))}">⏱</span>`;
}

/** Tous les agents de la session, sous-agents directs et agents de workflow, terminés compris. */
function allAgents(session: SessionNode): AgentNode[] {
  return [...session.agents, ...session.workflows.flatMap((workflow) => workflow.agents)];
}

/** « 5 agents · 2 en cours · 2 terminés · 1 en échec » : les comptes nuls sont tus. */
function agentCounts(session: SessionNode, locale: Locale): string {
  const strings = STRINGS[locale];
  const agents = allAgents(session);
  const running = agents.filter((agent) => agent.status === 'active').length;
  const finished = agents.filter((agent) => agent.status === 'finished').length;
  const failed = agents.filter((agent) => agent.status === 'failed').length;
  const parts = [strings.agentCount(agents.length)];
  if (running > 0) {
    parts.push(strings.running(running));
  }
  if (finished > 0) {
    parts.push(strings.finishedCount(finished));
  }
  if (failed > 0) {
    parts.push(strings.failedCount(failed));
  }
  return parts.join(' · ');
}

/** Pastille « N agents » de la ligne méta : compte tous les agents de la session et ouvre la carte au clic. */
function renderAgentsPill(session: SessionNode, locale: Locale): string {
  const total = allAgents(session).length;
  if (total === 0) {
    return '';
  }
  return `<span class="agents-pill" role="button" title="${escapeHtml(agentCounts(session, locale))}">${escapeHtml(STRINGS[locale].agentCount(total))}</span>`;
}

/**
 * Carte des agents : l'équivalent en lecture seule de celle de Claude Code. Tous les agents de la session,
 * terminés compris et hors rétention, en arbre par filiation ; chaque ligne porte durée et jetons — ceux écrits
 * par Claude Code pour un agent terminé, le temps écoulé et le contexte courant pour un agent qui tourne.
 * Les workflows y forment un groupe avec leur compteur. Remplace la liste habituelle tant qu'elle est dépliée.
 */
function renderAgentMap(session: SessionNode, options: RenderOptions): string {
  const locale = options.locale ?? 'fr';
  const direct = session.agents.map((agent) => renderMapRow(agent, options)).join('');
  const workflows = session.workflows
    .map((workflow) =>
      [
        `<li class="map-wf" data-key="mw:${escapeHtml(workflow.id)}">`,
        `<div class="map-wf-head"><span class="wf-label">${escapeHtml(workflowLabel(workflow))}</span><span class="map-meta">${escapeHtml(workflowDescription(workflow, locale))}</span></div>`,
        `<ul>${workflow.agents.map((agent, index) => renderMapRow(agent, options, index + 1)).join('')}</ul>`,
        '</li>',
      ].join(''),
    )
    .join('');
  return [
    '<div class="agent-map">',
    `<div class="map-head"><span class="map-title">${escapeHtml(agentCounts(session, locale))}</span><span class="map-close" role="button" title="${escapeHtml(STRINGS[locale].mapClose)}">✕</span></div>`,
    `<ul class="map-tree">${direct}${workflows}</ul>`,
    '</div>',
  ].join('');
}

/** Une ligne de la carte : picto de statut, rang dans son workflow, libellé (prompt, modèle et outils en infobulle), durée · jetons. */
function renderMapRow(agent: AgentNode, options: RenderOptions, ordinal?: number): string {
  const locale = options.locale ?? 'fr';
  const label = agentLabel(agent);
  const facts = [
    agent.model ? abbreviateModel(agent.model) : undefined,
    agent.report ? STRINGS[locale].toolUses(agent.report.toolUses) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const tooltip = labelTooltip(agent, label, facts);
  const index = ordinal === undefined ? '' : `<span class="agent-idx">#${ordinal}</span>`;
  const depthClass = agent.depth ? ` depth-${Math.min(agent.depth, 3)}` : '';
  return [
    `<li class="map-agent ${squareClass(agent.status)}${depthClass}" data-key="ma:${escapeHtml(agent.id)}">`,
    statusIcon(agent.status, agent.failure),
    index,
    `<span class="map-label" title="${tooltip}">${escapeHtml(label)}</span>`,
    `<span class="map-meta">${escapeHtml(agentFigures(agent, options.now, locale))}</span>`,
    '</li>',
  ].join('');
}

/** Pastille pulsée en cours, ✗ en échec (la raison lue sur le disque en infobulle), ✓ terminé. */
function statusIcon(status: AgentNode['status'], failure?: string): string {
  return status === 'active'
    ? '<span class="dot active"></span>'
    : status === 'failed'
      ? `<span class="cross"${failure ? ` title="${escapeHtml(failure)}"` : ''}>✗</span>`
      : '<span class="check">✓</span>';
}

/** Infobulle d'un libellé d'agent : prompt (ou libellé), faits optionnels, puis la raison d'échec sur sa propre ligne. */
function labelTooltip(agent: AgentNode, label: string, ...facts: Array<string | undefined>): string {
  const lines = [agent.detail ?? label, ...facts, agent.failure ? `✗ ${agent.failure}` : undefined];
  return escapeHtml(lines.filter(Boolean).join('\n')).replaceAll('\n', '&#10;');
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

/**
 * Session au-delà de la rétention qui sert encore une adresse locale : on ne garde que son nom et
 * ses serveurs vivants. Ni agents, ni todos, ni jauge — le lien est la seule raison de la garder.
 */
function renderCollapsedCard(session: SessionNode, options: RenderOptions): string {
  return [
    `<article class="card collapsed" data-key="sess:${escapeHtml(session.sessionId)}">`,
    `<header><span class="dot"></span><h3 title="${escapeHtml(session.name)}">${escapeHtml(session.name)}</h3></header>`,
    renderBackgroundTasks(session, options, true),
    '</article>',
  ].join('');
}

/**
 * Une ligne par commande de fond encore en cours : commande, durée, adresse locale cliquable.
 * Le lien tombe dès que le port a été mesuré mort ; tant qu'il n'a pas été sondé (`undefined`), il reste.
 * `onlyLive` ne garde que les commandes servant encore une adresse : c'est le contenu de la card réduite.
 */
function renderBackgroundTasks(session: SessionNode, options: RenderOptions, onlyLive = false): string {
  const all = session.backgroundTasks;
  if (!all || all.length === 0) {
    return '';
  }
  const tasks = onlyLive ? all.filter((task) => task.url !== undefined && task.urlAlive === true) : all;
  if (tasks.length === 0) {
    return '';
  }
  const locale = options.locale ?? 'fr';
  return tasks
    .map((task) => {
      const link = task.url !== undefined && task.urlAlive !== false
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

/** Pictos de la liste dépliée, un par état. */
const SDD_ICONS: Record<SddTaskState, string> = {
  done: '✅',
  doing: '🔵',
  review: '🟡',
  pending: '⬜',
};

/** Chevrons ‹ › en SVG : un glyphe n'occupe qu'une partie de sa boîte, petit et bas quelle que soit la police. */
const SDD_CHEVRONS = {
  prev: '<svg class="sdd-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M6.5 1.5 L3 5 L6.5 8.5"/></svg>',
  next: '<svg class="sdd-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 1.5 L7 5 L3.5 8.5"/></svg>',
};

/**
 * Flèche vers un autre plan : une cible vide ramène à la position par défaut (plan courant, ou ligne d'accès).
 * Sans cible, la flèche reste à sa place mais grisée, et n'est pas un .sdd-nav : rien à cliquer.
 */
function sddArrow(direction: 'prev' | 'next', target: string | undefined, strings: LocaleStrings): string {
  if (target === undefined) {
    const title = direction === 'prev' ? strings.sddNoPrevious : strings.sddNoNext;
    return `<span class="sdd-nav-off" title="${escapeHtml(title)}">${SDD_CHEVRONS[direction]}</span>`;
  }
  const title = direction === 'prev' ? strings.sddPrevious : strings.sddNext;
  return `<button class="sdd-nav" data-sdd-plan="${escapeHtml(target)}" title="${escapeHtml(title)}">${SDD_CHEVRONS[direction]}</button>`;
}

/**
 * Tâches d'un plan exécuté en subagent-driven development : une rangée de carrés, dépliable en liste.
 * Le SDD n'écrit pas de TodoWrite — ce bloc est lu dans son workspace, et coexiste donc avec la todo-list.
 *
 * Les autres plans du dossier (anciens, ou le courant une fois retiré) se parcourent avec ‹ ›, du plus récent
 * au plus ancien ; la position la plus à droite est la position par défaut.
 */
function renderSdd(session: SessionNode, options: RenderOptions): string {
  const strings = STRINGS[options.locale ?? 'fr'];
  const current = session.sdd;
  const history = (session.sddPlans ?? []).filter((plan) => plan.dir !== current?.dir);
  const viewedDir = options.sddViewed?.get(session.sessionId);
  const index = history.findIndex((plan) => plan.dir === viewedDir);
  const key = `sdd:${escapeHtml(session.sessionId)}`;

  if (index !== -1) {
    const prev = sddArrow('prev', history[index + 1]?.dir, strings);
    const next = sddArrow('next', index === 0 ? '' : history[index - 1].dir, strings);
    return renderSddPlan(session, history[index], options, { key, past: true, prev, next });
  }
  const prev = sddArrow('prev', history[0]?.dir, strings);
  const next = sddArrow('next', undefined, strings);
  if (current) {
    return renderSddPlan(session, current, options, { key, past: false, prev, next });
  }
  if (history.length === 0) {
    return '';
  }
  return `<div class="sdd-history" data-key="${key}">${prev}<span>📋 ${escapeHtml(strings.sddHistory(history.length))}</span><span class="sdd-pager">${next}</span></div>`;
}

function renderSddPlan(
  session: SessionNode,
  sdd: SddRun,
  options: RenderOptions,
  nav: { key: string; past: boolean; prev: string; next: string },
): string {
  if (sdd.tasks.length === 0) {
    return '';
  }
  const locale = options.locale ?? 'fr';
  const strings = STRINGS[locale];
  const open = options.expandedSdd?.has(session.sessionId) ?? false;
  const agents = allAgents(session);
  const tasks = sdd.tasks.map((task) => {
    const figures = sddTaskFigures(agents, sdd.plan, task.number, options.now);
    const title = sddTaskTitle(task, locale);
    return {
      task,
      title: figures ? `${title} · ${sddFiguresText(figures, locale, 'tooltip')}` : title,
      figures: figures ? `<span class="sdd-figures">${escapeHtml(sddFiguresText(figures, locale, 'line'))}</span>` : '',
    };
  });
  const squares = tasks
    .map(({ task, title }) => `<li class="sdd-sq ${task.state}" title="${escapeHtml(title)}"></li>`)
    .join('');
  const list = open
    ? `<ul class="sdd-list">${tasks
        .map(({ task, title, figures }) => {
          const icon = SDD_ICONS[task.state];
          const label = strings.sddTask(task.number, task.title);
          return `<li class="sdd-task ${task.state}" title="${escapeHtml(title)}"><span class="sdd-tick">${icon}</span><span class="sdd-text">${escapeHtml(label)}</span>${figures}</li>`;
        })
        .join('')}</ul>`
    : '';
  const inReview = sdd.tasks.filter((task) => task.state === 'review').length;
  const review = inReview > 0 ? ` <span class="sdd-review">· ${escapeHtml(strings.sddInReview(inReview))}</span>` : '';
  // ‹ « Plan » compteur … date › : « Plan », son compteur et les carrés déplient la liste (main.ts : .sdd-toggle).
  return [
    `<div class="sdd${nav.past ? ' past' : ''}${open ? ' open' : ''}" data-key="${nav.key}">`,
    `<div class="sdd-head">${nav.prev}<span class="sdd-toggle">`,
    `<span title="${escapeHtml(strings.sddPlanTitle(sdd.plan))}">📋 ${escapeHtml(strings.sddLabel)}</span>`,
    sdd.finalReview
      ? `<span class="sdd-count" title="${escapeHtml(strings.sddFinished)}">${escapeHtml(strings.sddCount(sdd.doneCount, sdd.totalCount))} ✓</span>`
      : `<span class="sdd-count">${escapeHtml(strings.sddCount(sdd.doneCount, sdd.totalCount))}${review}</span>`,
    `</span><span class="sdd-pager"><span class="sdd-when" title="${escapeHtml(strings.sddUpdatedTitle)}">${escapeHtml(strings.sddUpdated(sdd.updatedAt))}</span>${nav.next}</span></div>`,
    `<ul class="sdd-squares sdd-toggle">${squares}</ul>`,
    list,
    '</div>',
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
        `<td class="wf-name" title="${labelTooltip(agent, label)}">${escapeHtml(label)}</td>`,
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
  const tokens = agentTokens(agent);
  const context = tokens !== undefined ? ` · ${formatTokens(tokens, locale)}` : '';
  const index = ordinal === undefined ? '' : `<span class="agent-idx">#${ordinal}</span>`;
  const icon = statusIcon(agent.status, agent.failure);
  const gauge =
    agent.status !== 'active' && options.settings.mode === 'temporarily'
      ? renderRetentionGauge(agent.lastActivity, options)
      : '';
  const label = agentLabel(agent);
  // Type en infobulle seulement : presque toujours « general-purpose », il mangeait la place du titre.
  const type = agent.agentType ? STRINGS[locale].agentType(agent.agentType) : undefined;
  const verb =
    agent.status === 'active' && agent.lastTool
      ? `<span class="agent-verb">${escapeHtml(activityVerb(agent.lastTool, locale))}</span>`
      : '';
  const depthClass = agent.depth ? ` depth-${Math.min(agent.depth, 3)}` : '';
  return [
    `<li class="agent${depthClass}" data-key="ag:${escapeHtml(agent.id)}">`,
    icon,
    index,
    `<span class="agent-label" title="${labelTooltip(agent, label, type)}">${escapeHtml(label)}</span>`,
    verb,
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

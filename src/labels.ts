import type { AgentNode, SddTask, WorkflowNode } from './types';
import { abbreviateModel, formatDuration, formatRelativeTime, formatTokens } from './format';
import { STRINGS, type Locale, type LocaleStrings } from './i18n';

export function agentLabel(agent: AgentNode): string {
  return agent.description ?? agent.id;
}

const ACTIVITY_TOOLS: Array<{ tools: string[]; verb: keyof LocaleStrings['verbs'] }> = [
  { tools: ['Edit', 'Write'], verb: 'edit' },
  { tools: ['Bash', 'PowerShell'], verb: 'run' },
  { tools: ['Read'], verb: 'read' },
  { tools: ['Grep', 'Glob'], verb: 'search' },
  { tools: ['WebFetch', 'WebSearch'], verb: 'web' },
  { tools: ['Agent', 'Task'], verb: 'delegate' },
  { tools: ['AskUserQuestion'], verb: 'question' },
];

/** Picto + verbe décrivant le dernier outil utilisé (« ce qu'il fait maintenant »). */
export function activityVerb(toolName: string, locale: Locale = 'fr'): string {
  const entry = ACTIVITY_TOOLS.find(({ tools }) => tools.includes(toolName));
  return entry ? STRINGS[locale].verbs[entry.verb] : `⚙ ${toolName}`;
}

/**
 * Le statut est porté par le picto (pastille / ✓) et le verbe par le tag de gauche, pas par du texte ici.
 * Agent terminé : la durée du run écrite par Claude Code quand on l'a, sinon l'ancienneté de sa dernière écriture.
 */
export function agentDescription(agent: AgentNode, now: number, locale: Locale = 'fr'): string {
  const parts: string[] = [];
  if (agent.model) {
    parts.push(abbreviateModel(agent.model));
  }
  if (agent.status === 'active') {
    parts.push(formatDuration(now - agent.lastActivity));
  } else if (agent.report !== undefined) {
    parts.push(formatDuration(agent.report.durationMs));
  } else {
    parts.push(formatRelativeTime(now - agent.lastActivity, locale));
  }
  return parts.join(' · ');
}

/** Jetons à afficher : ceux écrits par Claude Code pour un agent terminé, sinon le contexte lu dans son transcript. */
export function agentTokens(agent: AgentNode): number | undefined {
  return agent.status !== 'active' && agent.report !== undefined ? agent.report.tokens : agent.contextTokens;
}

/** Durée d'un agent : écoulée s'il tourne ; écrite par Claude Code s'il a fini ; sinon création → dernière écriture. */
function agentDuration(agent: AgentNode, now: number): number {
  if (agent.status === 'active') {
    return now - agent.createdAt;
  }
  return agent.report?.durationMs ?? agent.lastActivity - agent.createdAt;
}

/** « durée · jetons » d'une ligne de la carte des agents (les mêmes chiffres que la carte de Claude Code). */
export function agentFigures(agent: AgentNode, now: number, locale: Locale = 'fr'): string {
  const parts = [formatDuration(agentDuration(agent, now))];
  const tokens = agentTokens(agent);
  if (tokens !== undefined) {
    parts.push(formatTokens(tokens, locale));
  }
  return parts.join(' · ');
}

export function workflowLabel(workflow: WorkflowNode): string {
  return workflow.name ?? `Workflow ${workflow.id}`;
}

/** « 24/33 ✓ · 3 en cours · 1 en échec » : les deux derniers seulement s'ils sont non nuls. */
export function workflowDescription(workflow: WorkflowNode, locale: Locale = 'fr'): string {
  const strings = STRINGS[locale];
  const running = workflow.agents.filter((agent) => agent.status === 'active').length;
  const failed = workflow.failedCount ?? 0;
  const parts = [`${workflow.finishedCount}/${workflow.totalCount} ✓`];
  if (running > 0) {
    parts.push(strings.running(running));
  }
  if (failed > 0) {
    parts.push(strings.failedCount(failed));
  }
  return parts.join(' · ');
}

/** Une description de prompt peut faire 500 caractères : l'infobulle la coupe bien avant. */
const SQUARE_TITLE_MAX_LENGTH = 120;

/**
 * Infobulle d'un carré de la bande : « #n libellé · modèle · durée », plus « en échec » le cas échéant.
 * Le numéro (rang de l'agent dans le run) distingue des agents dont le prompt commence par la même ligne.
 */
export function squareTitle(agent: AgentNode, now: number, locale: Locale = 'fr', ordinal?: number): string {
  const label = agentLabel(agent);
  const short = label.length > SQUARE_TITLE_MAX_LENGTH ? label.slice(0, SQUARE_TITLE_MAX_LENGTH - 1) + '…' : label;
  const parts = [ordinal === undefined ? short : `#${ordinal} ${short}`, agentDescription(agent, now, locale)];
  if (agent.status === 'failed') {
    parts.push(STRINGS[locale].failed);
    if (agent.failure !== undefined) {
      parts.push(agent.failure);
    }
  }
  return parts.join(' · ');
}

const BACKGROUND_LABEL_MAX_LENGTH = 60;
/** « cd "…" && », « cd … ; » ou « cd … || exit 1; » en tête d'une commande : du bruit pour l'affichage. */
const LEADING_CD_PATTERN = /^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:\|\|\s*exit(?:\s+\d+)?\s*)?(?:&&|;|\n)\s*/;

function shorten(text: string): string {
  return text.length > BACKGROUND_LABEL_MAX_LENGTH ? text.slice(0, BACKGROUND_LABEL_MAX_LENGTH - 1) + '…' : text;
}

/** Commande d'une tâche de fond sans son cd initial, raccourcie à 60 caractères. */
export function backgroundTaskLabel(command: string): string {
  return shorten(command.replace(LEADING_CD_PATTERN, '').trim() || command.trim());
}

/** Libellé affiché : la description écrite par l'agent (lisible), sinon la commande nettoyée. */
export function backgroundTaskTitle(task: { command: string; description?: string }): string {
  return task.description ? shorten(task.description.trim()) : backgroundTaskLabel(task.command);
}

/**
 * Infobulle d'une tâche SDD : son numéro, son titre s'il a pu être lu, son état, puis les artefacts
 * réellement présents dans le workspace — « Tâche 9 : Script SQL — terminée · brief, rapport, revue, correction 1 ».
 */
export function sddTaskTitle(task: SddTask, locale: Locale = 'fr'): string {
  const strings = STRINGS[locale];
  const artifacts = [
    ...(task.brief ? [strings.sddArtifacts.brief] : []),
    ...(task.report ? [strings.sddArtifacts.report] : []),
    ...(task.review ? [strings.sddArtifacts.review] : []),
    ...(task.fixRound !== undefined ? [strings.sddFix(task.fixRound)] : []),
  ];
  const head = `${strings.sddTask(task.number, task.title)} — ${strings.sddStates[task.state]}`;
  return artifacts.length > 0 ? `${head} · ${artifacts.join(', ')}` : head;
}

export interface SddTaskFigures {
  count: number;
  durationMs: number;
  tokens?: number;
}

/**
 * Chiffres des agents d'une tâche de plan (ceux dont le prompt nomme ses fichiers). Durée du premier départ
 * à la dernière fin, pas la somme : implémentation et revue d'une même tâche se chevauchent souvent.
 */
export function sddTaskFigures(agents: AgentNode[], plan: string, number: number, now: number): SddTaskFigures | undefined {
  const own = agents.filter((agent) => agent.sddTask?.plan === plan && agent.sddTask.number === number);
  if (own.length === 0) {
    return undefined;
  }
  const start = Math.min(...own.map((agent) => agent.createdAt));
  const end = Math.max(...own.map((agent) => agent.createdAt + agentDuration(agent, now)));
  const tokens = own.map(agentTokens).filter((value): value is number => value !== undefined);
  return {
    count: own.length,
    durationMs: end - start,
    ...(tokens.length > 0 ? { tokens: tokens.reduce((sum, value) => sum + value, 0) } : {}),
  };
}

/** Infobulle : « 2 agents · 42 min · 610k jetons cumulés » ; ligne de la liste, où la place manque : « 🤖×2 · 42 min · 610k ». */
export function sddFiguresText(figures: SddTaskFigures, locale: Locale, form: 'tooltip' | 'line'): string {
  const strings = STRINGS[locale];
  const tooltip = form === 'tooltip';
  const parts = [tooltip ? strings.agentCount(figures.count) : `🤖×${figures.count}`, formatDuration(figures.durationMs)];
  if (figures.tokens !== undefined) {
    const tokens = formatTokens(figures.tokens, locale);
    parts.push(tooltip ? strings.sddTokensTotal(tokens) : tokens);
  }
  return parts.join(' · ');
}

import type { AgentNode, WorkflowNode } from './types';
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

import type { AgentNode, WorkflowNode } from './types';
import { abbreviateModel, formatDuration, formatRelativeTime } from './format';
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

/** Le statut est porté par le picto (pastille / ✓) et le verbe par le tag de gauche, pas par du texte ici. */
export function agentDescription(agent: AgentNode, now: number, locale: Locale = 'fr'): string {
  const parts: string[] = [];
  if (agent.model) {
    parts.push(abbreviateModel(agent.model));
  }
  parts.push(
    agent.status === 'active'
      ? formatDuration(now - agent.lastActivity)
      : formatRelativeTime(now - agent.lastActivity, locale),
  );
  return parts.join(' · ');
}

export function workflowLabel(workflow: WorkflowNode): string {
  return `Workflow ${workflow.id}`;
}

export function workflowDescription(workflow: WorkflowNode): string {
  return `${workflow.finishedCount}/${workflow.totalCount} ✓`;
}

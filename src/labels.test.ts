import { describe, expect, it } from 'vitest';
import { activityVerb, agentDescription, agentLabel, workflowDescription, workflowLabel } from './labels';
import type { AgentNode, WorkflowNode } from './types';

const NOW = 1_800_000_000_000;

function agent(overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    id: 'agent-aaa',
    filePath: 'x',
    status: 'active',
    lastActivity: NOW - 12_000,
    createdAt: NOW - 60_000,
    description: 'Analyse des bugs',
    model: 'claude-opus-4-8',
    ...overrides,
  };
}

describe('agentLabel', () => {
  it('utilise la description quand elle existe', () => {
    expect(agentLabel(agent())).toBe('Analyse des bugs');
  });

  it("retombe sur l'id sinon", () => {
    expect(agentLabel(agent({ description: undefined }))).toBe('agent-aaa');
  });
});

describe('agentDescription', () => {
  it('agent actif : modèle et durée, sans libellé de statut (la pastille le dit)', () => {
    expect(agentDescription(agent(), NOW)).toBe('opus · 12 s');
  });

  it('agent terminé : modèle et ancienneté, sans libellé de statut (le ✓ le dit)', () => {
    expect(agentDescription(agent({ status: 'finished', lastActivity: NOW - 180_000 }), NOW)).toBe(
      'opus · il y a 3 min',
    );
  });

  it('sans modèle : durée seule', () => {
    expect(agentDescription(agent({ model: undefined }), NOW)).toBe('12 s');
  });

  it("agent actif : la description n'inclut pas le verbe (affiché sous le tag de gauche)", () => {
    expect(agentDescription(agent({ lastTool: 'Edit' }), NOW)).toBe('opus · 12 s');
  });

  it("agent terminé : pas de verbe d'activité même avec un dernier outil connu", () => {
    expect(agentDescription(agent({ status: 'finished', lastActivity: NOW - 180_000, lastTool: 'Edit' }), NOW)).toBe(
      'opus · il y a 3 min',
    );
  });
});

describe('activityVerb', () => {
  it('mappe les outils connus vers un picto + verbe', () => {
    expect(activityVerb('Edit')).toBe('✎ édite');
    expect(activityVerb('Write')).toBe('✎ édite');
    expect(activityVerb('Bash')).toBe('⏵ commande');
    expect(activityVerb('PowerShell')).toBe('⏵ commande');
    expect(activityVerb('Read')).toBe('📖 lit');
    expect(activityVerb('Grep')).toBe('🔍 cherche');
    expect(activityVerb('Glob')).toBe('🔍 cherche');
    expect(activityVerb('WebFetch')).toBe('🌐 web');
    expect(activityVerb('WebSearch')).toBe('🌐 web');
    expect(activityVerb('Agent')).toBe('🤖 délègue');
    expect(activityVerb('Task')).toBe('🤖 délègue');
    expect(activityVerb('AskUserQuestion')).toBe('⏳ question');
  });

  it('replie sur ⚙ + nom brut pour un outil inconnu', () => {
    expect(activityVerb('NotebookEdit')).toBe('⚙ NotebookEdit');
  });

  it('traduit les verbes en anglais', () => {
    expect(activityVerb('Edit', 'en')).toBe('✎ editing');
    expect(activityVerb('Bash', 'en')).toBe('⏵ running');
    expect(activityVerb('Grep', 'en')).toBe('🔍 searching');
  });
});

describe('agentDescription en anglais', () => {
  it('agent terminé : ancienneté suffixée ago', () => {
    expect(agentDescription(agent({ status: 'finished', lastActivity: NOW - 180_000 }), NOW, 'en')).toBe(
      'opus · 3 min ago',
    );
  });
});

describe('workflow', () => {
  const workflow: WorkflowNode = { id: 'wf_test-123', agents: [], totalCount: 3, finishedCount: 2 };

  it('label', () => {
    expect(workflowLabel(workflow)).toBe('Workflow wf_test-123');
  });

  it('description de progression', () => {
    expect(workflowDescription(workflow)).toBe('2/3 ✓');
  });
});

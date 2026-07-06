import { describe, expect, it } from 'vitest';
import {
  activityVerb,
  agentDescription,
  agentLabel,
  backgroundTaskLabel,
  backgroundTaskTitle,
  squareTitle,
  workflowDescription,
  workflowLabel,
} from './labels';
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

  it('label générique sans nom connu', () => {
    expect(workflowLabel(workflow)).toBe('Workflow wf_test-123');
  });

  it('label = nom réel du workflow quand il est connu', () => {
    expect(workflowLabel({ ...workflow, name: 'review-0-8-0' })).toBe('review-0-8-0');
  });

  it('description de progression', () => {
    expect(workflowDescription(workflow)).toBe('2/3 ✓');
  });

  it('ajoute les agents en cours et en échec au compteur, dans chaque langue', () => {
    const mixed: WorkflowNode = {
      id: 'wf_m',
      agents: [agent({ id: 'a' }), agent({ id: 'b' }), agent({ id: 'c', status: 'finished' }), agent({ id: 'd', status: 'failed' })],
      totalCount: 4,
      finishedCount: 1,
      failedCount: 1,
    };
    expect(workflowDescription(mixed)).toBe('1/4 ✓ · 2 en cours · 1 en échec');
    expect(workflowDescription(mixed, 'en')).toBe('1/4 ✓ · 2 running · 1 failed');
  });
});

describe('backgroundTaskLabel', () => {
  it('retire le cd initial et raccourcit une commande longue', () => {
    expect(backgroundTaskLabel('cd "c:/dev/mon projet" && npm run dev')).toBe('npm run dev');
    expect(backgroundTaskLabel("cd '/tmp/x'; python -m http.server")).toBe('python -m http.server');
    expect(backgroundTaskLabel('npm start')).toBe('npm start');
    expect(backgroundTaskLabel('cd /a/b || exit 1; SP="x"; exec node s.ts')).toBe('SP="x"; exec node s.ts');
    expect(backgroundTaskLabel('node ' + 'a'.repeat(80))).toBe(('node ' + 'a'.repeat(80)).slice(0, 59) + '…');
  });
});

describe('backgroundTaskTitle', () => {
  it('préfère la description donnée par l’agent, sinon la commande nettoyée', () => {
    expect(backgroundTaskTitle({ command: 'cd "c:/x" && npm run dev', description: 'Start the live preview server' })).toBe(
      'Start the live preview server',
    );
    expect(backgroundTaskTitle({ command: 'cd "c:/x" && npm run dev' })).toBe('npm run dev');
    expect(backgroundTaskTitle({ command: 'x', description: 'd'.repeat(80) })).toBe('d'.repeat(59) + '…');
  });
});

describe('squareTitle', () => {
  it('décrit un agent en cours : libellé · modèle · durée', () => {
    expect(squareTitle(agent(), NOW)).toBe('Analyse des bugs · opus · 12 s');
  });

  it('préfixe le numéro de l’agent dans le run quand il est fourni', () => {
    expect(squareTitle(agent(), NOW, 'fr', 3)).toBe('#3 Analyse des bugs · opus · 12 s');
    expect(squareTitle(agent({ status: 'failed' }), NOW, 'en', 12)).toBe('#12 Analyse des bugs · opus · 12 s ago · failed');
  });

  it('raccourcit une description longue dans l’infobulle', () => {
    const long = agent({ description: 'x'.repeat(200) });
    expect(squareTitle(long, NOW)).toBe('x'.repeat(119) + '… · opus · 12 s');
  });

  it('signale un agent en échec', () => {
    expect(squareTitle(agent({ status: 'failed' }), NOW)).toBe('Analyse des bugs · opus · il y a 12 s · en échec');
    expect(squareTitle(agent({ status: 'failed' }), NOW, 'en')).toBe('Analyse des bugs · opus · 12 s ago · failed');
  });
});

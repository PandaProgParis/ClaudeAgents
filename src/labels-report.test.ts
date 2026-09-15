import { describe, expect, it } from 'vitest';
import { agentDescription, agentFigures, agentTokens, squareTitle } from './labels';
import type { AgentNode } from './types';

const NOW = 1_800_000_000_000;
const REPORT = { tokens: 188_030, toolUses: 98, durationMs: 1_014_354 };

function agent(overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    id: 'agent-aaa',
    filePath: 'x',
    status: 'finished',
    lastActivity: NOW - 180_000,
    createdAt: NOW - 1_200_000,
    description: 'Réfuter le CLAUDE.md',
    model: 'claude-opus-5',
    contextTokens: 183_150,
    ...overrides,
  };
}

describe('agentDescription avec les chiffres de fin', () => {
  it('agent terminé : la durée écrite par Claude Code remplace l’ancienneté', () => {
    expect(agentDescription(agent({ report: REPORT }), NOW)).toBe('opus · 16 min');
  });

  it('agent terminé sans chiffres : ancienneté comme avant', () => {
    expect(agentDescription(agent(), NOW)).toBe('opus · il y a 3 min');
  });

  it('agent encore actif : temps écoulé, même si un rapport traîne', () => {
    expect(agentDescription(agent({ status: 'active', lastActivity: NOW - 12_000, report: REPORT }), NOW)).toBe('opus · 12 s');
  });
});

describe('agentTokens', () => {
  it('agent terminé : les jetons de Claude Code priment sur le contexte lu dans son transcript', () => {
    expect(agentTokens(agent({ report: REPORT }))).toBe(188_030);
    expect(agentTokens(agent())).toBe(183_150);
  });

  it('agent actif : toujours le contexte courant', () => {
    expect(agentTokens(agent({ status: 'active', report: REPORT }))).toBe(183_150);
  });
});

describe('agentFigures (carte des agents)', () => {
  it('agent terminé avec chiffres : durée du run et jetons', () => {
    expect(agentFigures(agent({ report: REPORT }), NOW)).toBe('16 min · 188k');
  });

  it('agent terminé sans chiffres : durée création → dernière écriture et contexte', () => {
    expect(agentFigures(agent(), NOW)).toBe('17 min · 183k');
  });

  it('agent actif : temps écoulé depuis la création et contexte courant', () => {
    expect(agentFigures(agent({ status: 'active', createdAt: NOW - 90_000, lastActivity: NOW - 1_000 }), NOW)).toBe('1 min · 183k');
  });

  it('sans aucun jeton connu : durée seule', () => {
    expect(agentFigures(agent({ contextTokens: undefined }), NOW)).toBe('17 min');
  });
});

describe('squareTitle avec les chiffres de fin', () => {
  it('reprend la durée du run pour un carré d’agent terminé', () => {
    expect(squareTitle(agent({ report: REPORT }), NOW, 'fr', 3)).toBe('#3 Réfuter le CLAUDE.md · opus · 16 min');
  });
});

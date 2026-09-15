import { describe, expect, it } from 'vitest';
import { renderApp } from './render';
import type { AgentNode, FinishedAgentSettings, ProjectNode, SessionNode, WorkflowNode } from '../types';

const NOW = 1_800_000_000_000;
const SETTINGS: FinishedAgentSettings = { mode: 'temporarily', retentionSeconds: 60 };
const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const REPORT = { tokens: 188_030, toolUses: 98, durationMs: 1_014_354 };

function agent(overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    id: 'agent-aaa',
    filePath: 'x',
    status: 'active',
    lastActivity: NOW - 12_000,
    createdAt: NOW - 60_000,
    description: 'Analyse des bugs',
    model: 'claude-opus-5',
    contextTokens: 45_000,
    ...overrides,
  };
}

function session(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    sessionId: SESSION_ID,
    pid: 1,
    cwd: 'c:\\dev\\marketing',
    name: 'Gamini > JSON HTML',
    startedAt: NOW - 1_500_000,
    active: true,
    lastActivity: NOW - 3_000,
    model: 'claude-opus-5',
    contextTokens: 424_927,
    agents: [],
    workflows: [],
    ...overrides,
  };
}

function project(sessions: SessionNode[], name = 'marketing'): ProjectNode {
  return { cwd: 'c:\\dev\\' + name, name, hasActiveSession: true, sessions };
}

function workflow(agents: AgentNode[], overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: 'wf_1',
    name: 'refute',
    agents,
    totalCount: agents.length,
    finishedCount: agents.filter((a) => a.status === 'finished').length,
    failedCount: agents.filter((a) => a.status === 'failed').length,
    ...overrides,
  };
}

const render = (projects: ProjectNode[], extra: Record<string, unknown> = {}) =>
  renderApp(projects, { now: NOW, settings: SETTINGS, ...extra });

describe('effort de la session', () => {
  it('préfère l’effort lu dans le transcript de la session à l’effort global des réglages', () => {
    const html = render([project([session({ effort: 'high' })])], { effortLevel: 'xhigh' });
    expect(html).toContain('<span class="meta-text">high · 25 min</span>');
  });

  it('replie sur l’effort global quand la session ne le porte pas', () => {
    const html = render([project([session()])], { effortLevel: 'xhigh' });
    expect(html).toContain('<span class="meta-text">xhigh · 25 min</span>');
  });
});

describe('indicateur du cache d’invite', () => {
  it('cache chaud : horloge et minutes restantes, calculées à l’instant du rendu', () => {
    const html = render([project([session({ cache: { anchorAt: NOW - 600_000, ttlMs: 3_600_000 } })])]);
    expect(html).toContain('class="cache warm"');
    expect(html).toContain('⏱ 50 min');
    expect(html).toContain('title="Cache d’invite chaud, encore 50 min"');
  });

  it('cache probablement expiré : horloge seule, inactivité en infobulle', () => {
    const html = render([project([session({ cache: { anchorAt: NOW - 2 * 3_600_000 - 60_000, ttlMs: 3_600_000 } })])]);
    expect(html).toContain('class="cache cold"');
    expect(html).toContain('title="Cache d’invite probablement expiré · inactif depuis 2 h 1 min"');
    expect(html).not.toContain('⏱ 0 min');
  });

  it('conversation compactée : le cache ne couvre plus la conversation', () => {
    const html = render([
      project([session({ cache: { anchorAt: NOW - 600_000, ttlMs: 3_600_000, compactedAt: NOW - 60_000 } })]),
    ]);
    expect(html).toContain('class="cache compacted"');
    expect(html).toContain('title="Cache d’invite sans effet : conversation compactée"');
  });

  it('rien quand le cache est inconnu, et en anglais quand la locale est en', () => {
    expect(render([project([session()])])).not.toContain('class="cache');
    const html = render([project([session({ cache: { anchorAt: NOW - 600_000, ttlMs: 300_000 } })])], { locale: 'en' });
    expect(html).toContain('title="Prompt cache likely expired · idle 10 min"');
  });
});

describe('raison d’échec en infobulle', () => {
  const REASON = "You've hit your weekly limit · resets Sep 14, 2am (Asia/Seoul)";
  const ESCAPED = 'You&#39;ve hit your weekly limit · resets Sep 14, 2am (Asia/Seoul)';
  const failed = agent({
    id: 'agent-w23',
    description: 'cohérence-finale',
    status: 'failed',
    lastActivity: NOW - 900_000,
    failure: REASON,
  });

  it('bande et détail du workflow : le carré et le nom portent la raison lue sur le disque', () => {
    const html = render([project([session({ workflows: [workflow([failed])] })])], {
      settings: { mode: 'always', retentionSeconds: 60 },
      expandedWorkflows: new Set(['wf_1']),
    });
    expect(html).toContain(`title="#1 cohérence-finale · opus · il y a 15 min · en échec · ${ESCAPED}"`);
    expect(html).toContain(`class="wf-name" title="cohérence-finale&#10;✗ ${ESCAPED}"`);
  });

  it('liste des sous-agents directs : la croix et le libellé portent la raison', () => {
    const html = render([project([session({ agents: [failed] })])], { settings: { mode: 'always', retentionSeconds: 60 } });
    expect(html).toContain(`<span class="cross" title="${ESCAPED}">✗</span>`);
    expect(html).toContain(`class="agent-label" title="cohérence-finale&#10;✗ ${ESCAPED}"`);
  });

  it('carte des agents : même raison sur la croix et à la fin de l’infobulle du libellé', () => {
    const html = render([project([session({ workflows: [workflow([failed])] })])], { expandedMaps: new Set([SESSION_ID]) });
    expect(html).toContain(`<span class="cross" title="${ESCAPED}">✗</span>`);
    expect(html).toContain(`class="map-label" title="cohérence-finale&#10;opus&#10;✗ ${ESCAPED}"`);
  });

  it('sans raison connue, la croix reste muette', () => {
    const html = render([project([session({ workflows: [workflow([agent({ ...failed, failure: undefined })])] })])], {
      expandedMaps: new Set([SESSION_ID]),
    });
    expect(html).toContain('<span class="cross">✗</span>');
  });
});

describe('pastille « N agents » et carte des agents', () => {
  const agents = [
    agent({ id: 'agent-run', description: 'Cartographier le web' }),
    agent({ id: 'agent-done', description: 'Réfuter le CLAUDE.md', status: 'finished', lastActivity: NOW - 900_000, report: REPORT }),
  ];
  const wf = workflow([
    agent({ id: 'agent-w1', description: 'impl:A', status: 'finished', lastActivity: NOW - 900_000 }),
    agent({ id: 'agent-w2', description: 'impl:B', status: 'failed', lastActivity: NOW - 900_000 }),
    agent({ id: 'agent-w3', description: 'impl:C' }),
  ]);

  it('compte tous les agents de la session, terminés compris, avec les statuts en infobulle', () => {
    const html = render([project([session({ agents, workflows: [wf] })])]);
    expect(html).toContain('class="agents-pill"');
    expect(html).toContain('>5 agents<');
    expect(html).toContain('title="5 agents · 2 en cours · 2 terminés · 1 en échec"');
  });

  it('n’affiche pas de pastille sans agent', () => {
    expect(render([project([session()])])).not.toContain('agents-pill');
  });

  it('carte repliée par défaut : les agents terminés restent soumis à la rétention', () => {
    const html = render([project([session({ agents, workflows: [wf] })])]);
    expect(html).not.toContain('class="agent-map"');
    expect(html).not.toContain('Réfuter le CLAUDE.md');
  });

  it('carte dépliée : tous les agents, chacun avec durée et jetons, et les workflows regroupés', () => {
    const html = render([project([session({ agents, workflows: [wf] })])], { expandedMaps: new Set([SESSION_ID]) });
    expect(html).toContain('class="agent-map"');
    expect(html).toContain('5 agents · 2 en cours · 2 terminés · 1 en échec');
    // agent terminé : chiffres écrits par Claude Code
    expect(html).toContain('Réfuter le CLAUDE.md');
    expect(html).toMatch(/Réfuter le CLAUDE\.md.{0,200}16 min · 188k/s);
    // agent en cours : temps écoulé et contexte courant
    expect(html).toMatch(/Cartographier le web.{0,200}1 min · 45k/s);
    // workflow : titre, compteur, agents numérotés
    expect(html).toContain('class="map-wf"');
    expect(html).toContain('refute');
    expect(html).toContain('1/3 ✓ · 1 en cours · 1 en échec');
    expect(html).toContain('#2');
    expect(html).toContain('impl:B');
    // la liste habituelle des agents n’est pas dupliquée sous la carte
    expect(html).not.toContain('<ul class="agents">');
  });

  it('carte dépliée : infobulle avec le prompt, le modèle et le nombre d’outils ; statut par picto', () => {
    const html = render(
      [project([session({ agents: [agents[1]] })])],
      { expandedMaps: new Set([SESSION_ID]) },
    );
    expect(html).toContain('title="Réfuter le CLAUDE.md&#10;opus · 98 outils"');
    expect(html).toContain('<span class="check">✓</span>');
  });
});

describe('ligne d’un agent terminé', () => {
  it('affiche la durée et les jetons écrits par Claude Code plutôt que l’ancienneté et le contexte', () => {
    const html = render(
      [project([session({ agents: [agent({ status: 'finished', lastActivity: NOW - 10_000, report: REPORT })] })])],
    );
    expect(html).toContain('opus · 16 min · 188k');
    expect(html).not.toContain('il y a');
  });
});

describe('sessions épinglées (dossiers du workspace)', () => {
  const idle = session({ active: false, lastActivity: NOW - 1_800_000 });

  it('garde en card complète une session inactive de longue date quand son dossier est épinglé', () => {
    const html = render([project([idle])], { pinnedFolders: ['c:\\dev\\marketing'] });
    expect(html).toContain('data-key="sess:' + SESSION_ID + '"');
    expect(html).not.toContain('card collapsed');
  });

  it('la masque sans dossier épinglé, ou si le dossier épinglé est un autre projet', () => {
    expect(render([project([idle])])).toContain('Aucune session Claude en cours.');
    expect(render([project([idle])], { pinnedFolders: ['c:\\dev\\autre'] })).toContain('Aucune session Claude en cours.');
  });
});

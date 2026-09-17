import { describe, expect, it } from 'vitest';
import { escapeHtml, renderApp } from './render';
import type { AgentNode, FinishedAgentSettings, ProjectNode, SessionNode } from '../types';
import type { SddRun } from '../types';

const NOW = 1_800_000_000_000;
const SETTINGS: FinishedAgentSettings = { mode: 'temporarily', retentionSeconds: 60 };

function agent(overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    id: 'agent-aaa',
    filePath: 'x',
    status: 'active',
    lastActivity: NOW - 12_000,
    createdAt: NOW - 60_000,
    description: 'Analyse des bugs',
    model: 'claude-opus-4-8',
    contextTokens: 45_000,
    ...overrides,
  };
}

function session(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
    pid: 1,
    cwd: 'c:\\dev\\marketing',
    name: 'Gamini > JSON HTML',
    startedAt: NOW - 1_500_000,
    active: true,
    lastActivity: NOW - 3_000,
    model: 'claude-fable-5',
    contextTokens: 482_851,
    agents: [],
    workflows: [],
    ...overrides,
  };
}

function project(sessions: SessionNode[], name = 'marketing'): ProjectNode {
  return { cwd: 'c:\\dev\\' + name, name, hasActiveSession: true, sessions };
}

/** Run SDD de référence : deux tâches faites, une en cours, une à faire, sur un plan de quatre. */
const SDD: SddRun = {
  dir: 'c:\\dev\\marketing\\.superpowers\\sdd\\mon-plan',
  plan: 'mon-plan',
  totalCount: 4,
  doneCount: 2,
  finalReview: false,
  updatedAt: NOW - 60_000,
  tasks: [
    { number: 1, state: 'done', title: 'Socle commun', brief: true, report: true, review: true, fixRound: 1 },
    { number: 2, state: 'done', title: 'Lecture du plan', brief: true, report: true, review: true },
    { number: 3, state: 'doing', title: 'Endpoint bougies', brief: true, report: false, review: false },
    { number: 4, state: 'pending', title: 'Datafeed porté', brief: false, report: false, review: false },
  ],
};

describe('escapeHtml', () => {
  it('neutralise les balises et quotes', () => {
    expect(escapeHtml(`<script>alert("x")&'</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;&lt;/script&gt;',
    );
  });
});

describe('renderApp', () => {
  it('affiche le message vide sans projet', () => {
    expect(renderApp([], { now: NOW, settings: SETTINGS })).toContain('Aucune session Claude en cours.');
  });

  it('rend la webview en anglais quand la locale est en', () => {
    expect(renderApp([], { now: NOW, settings: SETTINGS, locale: 'en' })).toContain('No Claude session running.');
    const waiting = renderApp([project([session({ pendingQuestion: true })])], {
      now: NOW,
      settings: SETTINGS,
      locale: 'en',
    });
    expect(waiting).toContain('⏳ waiting for an answer');
    const active = renderApp([project([session({ lastTool: 'Bash' })])], {
      now: NOW,
      settings: SETTINGS,
      locale: 'en',
    });
    expect(active).toContain('⏵ running');
  });

  it('échappe le titre de session', () => {
    const html = renderApp([project([session({ name: '<script>x</script>' })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });

  it('rend la barre de contexte avec pourcentage et libellé', () => {
    const html = renderApp([project([session()])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('width="48"');
    expect(html).toContain('483k / 1M');
    expect(html).toContain('class="fill ok"');
  });

  it('colore la barre selon le remplissage', () => {
    const warn = renderApp([project([session({ contextTokens: 700_000 })])], { now: NOW, settings: SETTINGS });
    expect(warn).toContain('class="fill warn"');
    const crit = renderApp([project([session({ contextTokens: 900_000 })])], { now: NOW, settings: SETTINGS });
    expect(crit).toContain('class="fill crit"');
  });

  it('replie sur la valeur brute quand le modèle est inconnu', () => {
    const html = renderApp([project([session({ model: 'claude-opus-4-5-20251101' })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('483k tokens');
    expect(html).not.toContain('class="bar"');
  });

  it('affiche le modèle en badge coloré et l’effort dans le texte méta', () => {
    const html = renderApp([project([session()])], { now: NOW, effortLevel: 'xhigh', settings: SETTINGS });
    expect(html).toContain('<span class="badge model-fable">fable</span>');
    expect(html).toContain('<span class="meta-text">xhigh · 25 min</span>');
  });

  it('ne reprend pas le nom du projet en badge (déjà dans le titre de section)', () => {
    const html = renderApp([project([session()])], { now: NOW, settings: SETTINGS });
    expect(html).not.toContain('<span class="badge">marketing</span>');
  });

  it('affiche tel quel un modèle hors des familles connues, en badge neutre', () => {
    const html = renderApp([project([session({ model: 'claude-zeus-6' })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('<span class="badge model-other">claude-zeus-6</span>');
    expect(html).toContain('483k tokens');
    expect(html).not.toContain('class="bar"');
  });

  it('omet le badge modèle quand le modèle est inconnu', () => {
    const html = renderApp([project([session({ model: undefined })])], { now: NOW, settings: SETTINGS });
    expect(html).not.toContain('class="badge');
  });

  it('rend un agent actif avec pastille et contexte compact', () => {
    const html = renderApp([project([session({ agents: [agent()] })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('Analyse des bugs');
    expect(html).toContain('45k');
    expect(html).toContain('class="dot active"');
  });

  it('rend une jauge à moitié vidée pour un agent terminé à mi-rétention', () => {
    const html = renderApp(
      [project([session({ agents: [agent({ status: 'finished', lastActivity: NOW - 30_000 })] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('class="gauge"');
    // circonférence 2π×6 ≈ 37.70 ; à 50 % restant, offset ≈ 18.85
    expect(html).toContain('stroke-dashoffset="18.85"');
  });

  it('rend ✓ sans jauge en mode always', () => {
    const html = renderApp(
      [project([session({ agents: [agent({ status: 'finished', lastActivity: NOW - 300_000 })] })])],
      { now: NOW, settings: { mode: 'always', retentionSeconds: 60 } },
    );
    expect(html).toContain('class="check"');
    expect(html).not.toContain('class="gauge"');
  });

  it('masque un agent terminé au-delà de la rétention et le workflow vidé', () => {
    const finished = agent({ status: 'finished', lastActivity: NOW - 120_000 });
    const html = renderApp(
      [project([session({ workflows: [{ id: 'wf_x', agents: [finished], totalCount: 1, finishedCount: 1 }] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).not.toContain('wf_x');
  });

  it('rend un workflow en bande de carrés, un par agent, coloré par état', () => {
    const agents = [
      agent({ id: 'agent-1', status: 'finished', lastActivity: NOW - 30_000, description: 'fini' }),
      agent({ id: 'agent-2', status: 'active', description: 'review:bugs' }),
      agent({ id: 'agent-3', status: 'failed', lastActivity: NOW - 20_000, description: 'cassé' }),
    ];
    const html = renderApp(
      [project([session({ workflows: [{ id: 'wf_s', agents, totalCount: 3, finishedCount: 1, failedCount: 1 }] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html.match(/class="sq /g)).toHaveLength(3);
    expect(html).toContain('class="sq done"');
    expect(html).toContain('class="sq running"');
    expect(html).toContain('class="sq failed"');
    expect(html).toContain('1/3 ✓ · 1 en cours · 1 en échec');
  });

  it('ne liste sous la bande que les agents en cours ou en échec', () => {
    const agents = [
      agent({ id: 'agent-1', status: 'finished', lastActivity: NOW - 30_000, description: 'fini' }),
      agent({ id: 'agent-2', status: 'active', description: 'review:bugs' }),
      agent({ id: 'agent-3', status: 'failed', lastActivity: NOW - 20_000, description: 'cassé' }),
    ];
    const html = renderApp(
      [project([session({ workflows: [{ id: 'wf_s', agents, totalCount: 3, finishedCount: 1, failedCount: 1 }] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).not.toContain('data-key="ag:agent-1"');
    expect(html).toContain('data-key="ag:agent-2"');
    expect(html).toContain('data-key="ag:agent-3"');
    expect(html).toContain('<span class="cross">✗</span>');
  });

  it('donne à chaque carré une infobulle libellé · modèle · durée', () => {
    const running = agent({ id: 'agent-2', status: 'active', description: 'review:bugs' });
    const html = renderApp(
      [project([session({ workflows: [{ id: 'wf_s', agents: [running], totalCount: 1, finishedCount: 0 }] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('<i class="sq running" title="#1 review:bugs · opus · 12 s"></i>');
  });

  it('numérote les carrés et les lignes pour distinguer des agents au même libellé', () => {
    const agents = [
      agent({ id: 'agent-1', status: 'active', description: 'review:bugs' }),
      agent({ id: 'agent-2', status: 'active', description: 'review:bugs' }),
    ];
    const html = renderApp(
      [project([session({ workflows: [{ id: 'wf_s', agents, totalCount: 2, finishedCount: 0 }] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('title="#1 review:bugs · opus · 12 s"');
    expect(html).toContain('title="#2 review:bugs · opus · 12 s"');
    expect(html).toContain('data-key="ag:agent-1"><span class="dot active"></span><span class="agent-idx">#1</span>');
    expect(html).toContain('data-key="ag:agent-2"><span class="dot active"></span><span class="agent-idx">#2</span>');
  });

  it('ne numérote pas les sous-agents directs (hors workflow)', () => {
    const html = renderApp([project([session({ agents: [agent()] })])], { now: NOW, settings: SETTINGS });
    expect(html).not.toContain('agent-idx');
  });

  it('masque la ligne d’un agent en échec passé le délai de rétention, comme un agent terminé', () => {
    const agents = [
      agent({ id: 'agent-1', status: 'active', description: 'review:bugs' }),
      agent({ id: 'agent-2', status: 'failed', lastActivity: NOW - 90_000, description: 'cassé' }),
    ];
    const html = renderApp(
      [project([session({ workflows: [{ id: 'wf_s', agents, totalCount: 2, finishedCount: 0, failedCount: 1 }] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('class="sq failed"');
    expect(html).toContain('data-key="ag:agent-1"');
    expect(html).not.toContain('data-key="ag:agent-2"');
  });

  it('ne liste jamais les agents en échec en mode never', () => {
    const agents = [
      agent({ id: 'agent-1', status: 'active', description: 'review:bugs' }),
      agent({ id: 'agent-2', status: 'failed', lastActivity: NOW - 5_000, description: 'cassé' }),
    ];
    const html = renderApp(
      [project([session({ workflows: [{ id: 'wf_s', agents, totalCount: 2, finishedCount: 0, failedCount: 1 }] })])],
      { now: NOW, settings: { mode: 'never', retentionSeconds: 60 } },
    );
    expect(html).toContain('class="sq failed"');
    expect(html).not.toContain('data-key="ag:agent-2"');
  });

  it('donne à la ligne d’un agent en échec sa jauge de rétention', () => {
    const agents = [
      agent({ id: 'agent-1', status: 'active', description: 'review:bugs' }),
      agent({ id: 'agent-2', status: 'failed', lastActivity: NOW - 20_000, description: 'cassé' }),
    ];
    const html = renderApp(
      [project([session({ workflows: [{ id: 'wf_s', agents, totalCount: 2, finishedCount: 0, failedCount: 1 }] })])],
      { now: NOW, settings: SETTINGS },
    );
    const line = html.match(/<li class="agent" data-key="ag:agent-2">[\s\S]*?<\/li>/)?.[0] ?? '';
    expect(line).toContain('<span class="cross">✗</span>');
    expect(line).toContain('class="gauge"');
  });

  it('déplie au clic le détail d’un workflow : description, phases prévues, tableau de tous les agents', () => {
    const agents = [
      agent({
        id: 'agent-1',
        status: 'finished',
        createdAt: NOW - 120_000,
        lastActivity: NOW - 30_000,
        description: 'fini',
        contextTokens: 154_000,
      }),
      agent({ id: 'agent-2', status: 'active', description: 'review:bugs' }),
    ];
    const workflow = {
      id: 'wf_s',
      name: 'suite-ui',
      description: 'Deux chantiers',
      phases: [{ title: 'Implémentation', detail: 'un par chantier' }, { title: 'Revue' }],
      agents,
      totalCount: 2,
      finishedCount: 1,
    };
    const projects = [project([session({ workflows: [workflow] })])];
    const collapsed = renderApp(projects, { now: NOW, settings: SETTINGS });
    expect(collapsed).toContain('<span class="wf-caret">▸</span>');
    expect(collapsed).not.toContain('wf-detail');
    const open = renderApp(projects, { now: NOW, settings: SETTINGS, expandedWorkflows: new Set(['wf_s']) });
    expect(open).toContain('<li class="workflow open" data-key="wf:wf_s">');
    expect(open).toContain('<span class="wf-caret">▾</span>');
    expect(open).toContain('<p class="wf-desc">Deux chantiers</p>');
    expect(open).toContain('2 agents · 2 min');
    expect(open).toContain('<span class="wf-phase" title="un par chantier">Implémentation</span>');
    expect(open).toContain('<span class="wf-phase">Revue</span>');
    expect(open).toContain('<tr class="wf-agent done" data-key="wa:agent-1"><td class="wf-n">#1</td>');
    expect(open).toContain('<td class="wf-name" title="fini">fini</td>');
    expect(open).toContain('<td class="wf-num">154k</td>');
    expect(open).toContain('<td class="wf-num">1 min</td>');
    expect(open).toContain('<tr class="wf-agent running" data-key="wa:agent-2">');
    expect(open).not.toContain('<li class="agent"');
  });

  it('arrête la durée d’un run terminé à sa dernière activité, pas à maintenant', () => {
    const agents = [
      agent({ id: 'agent-1', status: 'finished', createdAt: NOW - 600_000, lastActivity: NOW - 300_000 }),
      agent({ id: 'agent-2', status: 'finished', createdAt: NOW - 500_000, lastActivity: NOW - 400_000 }),
    ];
    const html = renderApp(
      [project([session({ workflows: [{ id: 'wf_d', agents, totalCount: 2, finishedCount: 2 }] })])],
      { now: NOW, settings: { mode: 'always', retentionSeconds: 60 }, expandedWorkflows: new Set(['wf_d']) },
    );
    expect(html).toContain('<p class="wf-stats">2 agents · 5 min</p>');
  });

  it('résume un workflow terminé sur une ligne avec sa jauge pendant la rétention', () => {
    const done = agent({ id: 'agent-1', status: 'finished', lastActivity: NOW - 30_000, description: 'fini' });
    const html = renderApp(
      [project([session({ workflows: [{ id: 'wf_d', agents: [done], totalCount: 1, finishedCount: 1 }] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('data-key="wf:wf_d"');
    expect(html).toContain('class="sq done"');
    expect(html).toContain('class="gauge"');
    expect(html).not.toContain('<li class="agent"');
  });

  it('affiche un workflow avec compteur et agents visibles', () => {
    const running = agent({ id: 'agent-run', status: 'active', description: 'review:bugs' });
    const html = renderApp(
      [project([session({ workflows: [{ id: 'wf_y', agents: [running], totalCount: 3, finishedCount: 2 }] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('Workflow wf_y');
    expect(html).toContain('2/3 ✓');
    expect(html).toContain('review:bugs');
  });

  it("affiche le timer d'activité en haut à droite et l'âge de session dans le texte méta ancré à droite", () => {
    const html = renderApp([project([session()])], { now: NOW, effortLevel: 'xhigh', settings: SETTINGS });
    expect(html).toContain('<span class="timer">3 s</span>');
    expect(html).toContain('<span class="meta-text">xhigh · 25 min</span>');
    expect(html).not.toContain('démarrée');
  });

  it("affiche l'inactivité d'une session au repos par un picto pause dans le timer", () => {
    const html = renderApp([project([session({ active: false, lastActivity: NOW - 300_000 })])], {
      now: NOW,
      settings: SETTINGS,
    });
    expect(html).toContain('<span class="timer">⏸ 5 min</span>');
  });

  it("n'affiche aucun libellé textuel de statut (pictos uniquement)", () => {
    const html = renderApp(
      [project([session({ active: false, lastActivity: NOW - 60_000, agents: [agent(), agent({ id: 'agent-bbb', status: 'finished', lastActivity: NOW - 30_000 })] })])],
      { now: NOW, settings: SETTINGS },
    );
    // Les comptes par statut n'existent qu'en infobulle de la pastille « N agents », jamais en texte visible.
    const visible = html.replace(/ title="[^"]*"/g, '');
    expect(visible).not.toContain('actif');
    expect(visible).not.toContain('terminé');
    expect(visible).not.toContain('inactive ');
  });

  it('ancre la jauge de rétention à droite, après le compteur de tokens', () => {
    const finished = agent({ status: 'finished', lastActivity: NOW - 30_000 });
    const html = renderApp([project([session({ agents: [finished] })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('class="check"');
    expect(html.indexOf('class="gauge"')).toBeGreaterThan(html.indexOf('class="agent-desc"'));
  });

  it('expose les libellés complets en tooltip (title) sur le titre et les agents', () => {
    const html = renderApp([project([session({ agents: [agent()] })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('<h3 title="Gamini &gt; JSON HTML">Gamini &gt; JSON HTML</h3>');
    expect(html).toContain('<span class="agent-label" title="Analyse des bugs">Analyse des bugs</span>');
  });

  it('masque une session inactive depuis plus de 10 minutes', () => {
    const html = renderApp([project([session({ active: false, lastActivity: NOW - 700_000 })])], {
      now: NOW,
      settings: SETTINGS,
    });
    expect(html).toContain('Aucune session Claude en cours.');
    expect(html).not.toContain('Gamini');
  });

  it('masque uniquement le projet dont toutes les sessions sont inactives', () => {
    const idle = project([session({ active: false, lastActivity: NOW - 700_000 })], 'dormant');
    const busy = project([session()], 'marketing');
    const html = renderApp([idle, busy], { now: NOW, settings: SETTINGS });
    expect(html).not.toContain('dormant');
    expect(html).toContain('marketing');
  });

  it('ne masque jamais les sessions quand la rétention vaut 0', () => {
    const html = renderApp(
      [project([session({ active: false, lastActivity: NOW - 7_200_000 })])],
      { now: NOW, settings: SETTINGS, inactiveSessionRetentionMinutes: 0 },
    );
    expect(html).toContain('Gamini &gt; JSON HTML');
  });

  it('place la barre de contexte après la liste des agents', () => {
    const html = renderApp([project([session({ agents: [agent()] })])], { now: NOW, settings: SETTINGS });
    expect(html.indexOf('class="ctx"')).toBeGreaterThan(html.indexOf('class="agents"'));
  });

  it('enveloppe les cards dans un conteneur sessions pour les guides d’arbre', () => {
    const html = renderApp([project([session()])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('<div class="sessions">');
  });

  it('affiche la branche git en badge dans la ligne méta', () => {
    const html = renderApp([project([session({ gitBranch: 'develop' })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('<span class="branch">⎇ develop</span>');
  });

  // Presque toujours « general-purpose », le type par défaut : en badge il prenait la place du titre.
  it('donne le type du sous-agent dans l’infobulle du titre, pas en badge', () => {
    const html = renderApp(
      [project([session({ agents: [agent({ agentType: 'superpowers:code-reviewer' })] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).not.toContain('agent-type');
    expect(html).toContain('<span class="agent-label" title="Analyse des bugs&#10;type : superpowers:code-reviewer">');
  });

  it('signale le contexte critique par un ⚠ et colore le libellé selon le niveau', () => {
    const crit = renderApp([project([session({ contextTokens: 900_000 })])], { now: NOW, settings: SETTINGS });
    expect(crit).toContain('class="ctx-label crit"');
    expect(crit).toContain('⚠ 900k / 1M');
    const warn = renderApp([project([session({ contextTokens: 700_000 })])], { now: NOW, settings: SETTINGS });
    expect(warn).toContain('class="ctx-label warn"');
    expect(warn).not.toContain('⚠');
    const ok = renderApp([project([session()])], { now: NOW, settings: SETTINGS });
    expect(ok).toContain('class="ctx-label"');
    expect(ok).not.toContain('ctx-label warn');
  });

  it("affiche le verbe d'activité d'une session active dans la ligne méta", () => {
    const html = renderApp([project([session({ lastTool: 'Bash' })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('⏵ commande');
  });

  it('affiche « réfléchit » quand le modèle génère, dans chaque langue', () => {
    const thinking = session({ activity: { phase: 'thinking', since: NOW - 40_000 } });
    expect(renderApp([project([thinking])], { now: NOW, settings: SETTINGS })).toContain('💭 réfléchit');
    expect(renderApp([project([thinking])], { now: NOW, settings: SETTINGS, locale: 'en' })).toContain('💭 thinking');
  });

  it("affiche le verbe de l'outil en cours d'après l'activité, pas d'après le dernier outil vu", () => {
    const html = renderApp(
      [project([session({ lastTool: 'Bash', activity: { phase: 'tool', tool: 'Edit', since: NOW - 3_000 } })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('✎ édite');
    expect(html).not.toContain('⏵ commande');
  });

  it("n'affiche aucun verbe pour un tour terminé même si un outil a été vu", () => {
    const html = renderApp(
      [project([session({ active: false, lastTool: 'Bash', activity: { phase: 'idle', since: NOW - 3_000 } })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).not.toContain('⏵ commande');
    expect(html).not.toContain('💭');
  });

  it('liste les tâches de fond avec commande nettoyée, durée et lien local', () => {
    const html = renderApp(
      [
        project([
          session({
            backgroundTasks: [
              {
                id: 'abc123',
                command: 'cd "c:/dev/x" && npm run dev',
                description: 'Start the live preview server',
                startedAt: NOW - 14 * 60_000,
                url: 'http://localhost:5173/',
              },
            ],
          }),
        ]),
      ],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('<div class="bg-task" data-key="bg:abc123">');
    expect(html).toContain(
      'title="cd &quot;c:/dev/x&quot; &amp;&amp; npm run dev">Start the live preview server</span>',
    );
    expect(html).toContain('14 min');
    expect(html).toContain('<a href="http://localhost:5173/" target="_blank" rel="noopener">localhost:5173</a>');
  });

  it('affiche « délègue » quand le tour est fini mais que des sous-agents tournent encore', () => {
    const delegating = session({ activity: { phase: 'delegating', since: NOW - 25_000 } });
    expect(renderApp([project([delegating])], { now: NOW, settings: SETTINGS })).toContain('🤖 délègue');
    expect(renderApp([project([delegating])], { now: NOW, settings: SETTINGS, locale: 'en' })).toContain('🤖 delegating');
  });

  it("masque le verbe d'activité d'une session au repos", () => {
    const html = renderApp(
      [project([session({ active: false, lastActivity: NOW - 300_000, lastTool: 'Bash' })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).not.toContain('⏵ commande');
  });

  it('marque une session en attente de réponse : card waiting et timer ⏳', () => {
    const html = renderApp(
      [project([session({ active: false, lastActivity: NOW - 300_000, pendingQuestion: true })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('class="card waiting"');
    expect(html).toContain('<span class="timer">⏳ 5 min</span>');
  });

  it('affiche le texte de la question en attente sur la card', () => {
    const html = renderApp(
      [
        project([
          session({ pendingQuestion: true, pendingQuestionText: 'Où placer ce guide <d’usage> ?' }),
        ]),
      ],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('class="question"');
    expect(html).toContain('⏳ Où placer ce guide &lt;d’usage&gt; ?');
    expect(html).not.toContain('<d’usage>');
  });

  it("affiche un libellé générique quand la question en attente n'a pas de texte", () => {
    const html = renderApp([project([session({ pendingQuestion: true })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('⏳ attend une réponse');
  });

  it("n'affiche aucune ligne question sans attente", () => {
    const html = renderApp([project([session()])], { now: NOW, settings: SETTINGS });
    expect(html).not.toContain('class="question"');
  });

  it("affiche le verbe d'activité d'un agent actif juste à droite de son titre", () => {
    const html = renderApp(
      [project([session({ agents: [agent({ agentType: 'claude', lastTool: 'Bash' })] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toMatch(/Analyse des bugs<\/span><span class="agent-verb">⏵ commande<\/span><span class="agent-desc">/);
  });

  it("n'affiche pas de verbe pour un agent terminé ni sans tag quand rien à montrer", () => {
    const html = renderApp(
      [
        project([
          session({
            agents: [agent({ status: 'finished', lastActivity: NOW - 30_000, agentType: 'claude', lastTool: 'Bash' })],
          }),
        ]),
      ],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).not.toContain('agent-verb');
    const bare = renderApp([project([session({ agents: [agent()] })])], { now: NOW, settings: SETTINGS });
    expect(bare).not.toContain('agent-left');
  });

  it('décale un sous-agent selon sa profondeur de filiation', () => {
    const html = renderApp(
      [project([session({ agents: [agent(), agent({ id: 'agent-bbb', depth: 1 }), agent({ id: 'agent-ccc', depth: 2 })] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('<li class="agent" data-key="ag:agent-aaa">');
    expect(html).toContain('<li class="agent depth-1" data-key="ag:agent-bbb">');
    expect(html).toContain('<li class="agent depth-2" data-key="ag:agent-ccc">');
  });

  it('affiche la todo-list en cases cochées avec compteur', () => {
    const html = renderApp(
      [
        project([
          session({
            todos: [
              { content: 'Route import-image', status: 'completed' },
              { content: 'Moteur engine <image>', status: 'in_progress' },
              { content: 'Contrôleur generer', status: 'pending' },
            ],
          }),
        ]),
      ],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('class="todos"');
    expect(html).toContain('1/3'); // 1 terminée sur 3
    expect(html).toContain('class="todo done"');
    expect(html).toContain('class="todo doing"');
    expect(html).toContain('class="todo pending"');
    expect(html).toContain('Moteur engine &lt;image&gt;');
    expect(html).not.toContain('Moteur engine <image>');
  });

  it("n'affiche pas de todo-list sans tâches", () => {
    const html = renderApp([project([session()])], { now: NOW, settings: SETTINGS });
    expect(html).not.toContain('class="todos"');
  });

  it('affiche les tâches SDD en carrés, avec le compte et le total du plan', () => {
    const html = renderApp([project([session({ sdd: SDD })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('class="sdd"');
    expect(html).toContain('2/4');
    expect(html).toContain('class="sdd-sq done"');
    expect(html).toContain('class="sdd-sq doing"');
    expect(html).toContain('class="sdd-sq pending"');
  });

  it('énonce dans l’infobulle du carré le titre de la tâche et ses artefacts', () => {
    const html = renderApp([project([session({ sdd: SDD })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('Tâche 1 : Socle commun — terminée · brief, rapport, revue, correction 1');
    expect(html).toContain('Tâche 3 : Endpoint bougies — en cours · brief');
    expect(html).toContain('Tâche 4 : Datafeed porté — à faire');
  });

  it('reste replié par défaut : les carrés, pas la liste', () => {
    const html = renderApp([project([session({ sdd: SDD })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('class="sdd-squares sdd-toggle"');
    expect(html).not.toContain('class="sdd-list"');
  });

  it('déplie la liste des tâches pour la session dépliée', () => {
    const html = renderApp([project([session({ sdd: SDD })])], {
      now: NOW,
      settings: SETTINGS,
      expandedSdd: new Set(['aaaaaaaa-1111-2222-3333-444444444444']),
    });
    expect(html).toContain('class="sdd-list"');
    expect(html).toContain('Endpoint bougies');
  });

  it('échappe le titre d’une tâche', () => {
    const sdd = { ...SDD, tasks: [{ ...SDD.tasks[0], title: 'Moteur <image>' }] };
    const html = renderApp([project([session({ sdd })])], {
      now: NOW,
      settings: SETTINGS,
      expandedSdd: new Set(['aaaaaaaa-1111-2222-3333-444444444444']),
    });
    expect(html).toContain('Moteur &lt;image&gt;');
    expect(html).not.toContain('Moteur <image>');
  });

  it('sans total lisible dans le plan, annonce le nombre de tâches faites sans inventer de total', () => {
    const sdd = { ...SDD, totalCount: undefined };
    const html = renderApp([project([session({ sdd })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('2 faites');
    expect(html).not.toContain('2/4');
  });

  it("n'affiche pas de bloc SDD sans run", () => {
    const html = renderApp([project([session()])], { now: NOW, settings: SETTINGS });
    expect(html).not.toContain('class="sdd"');
  });

  it('distingue la tâche dont le rapport est rendu mais l’achèvement non attesté', () => {
    const sdd: SddRun = {
      ...SDD,
      doneCount: 3,
      tasks: [
        ...SDD.tasks.slice(0, 3).map((task) => ({ ...task, state: 'done' as const })),
        { number: 4, state: 'review', title: 'Datafeed porté', brief: true, report: true, review: true },
      ],
    };
    const html = renderApp([project([session({ sdd })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('class="sdd-sq review"');
    expect(html).toContain('Tâche 4 : Datafeed porté — en revue · brief, rapport, revue');
    expect(html).toContain('3/4');
    expect(html).toContain('1 en revue');
  });

  describe('chiffres des agents de chaque tâche', () => {
    const MIN = 60_000;
    const OPEN = { expandedSdd: new Set(['aaaaaaaa-1111-2222-3333-444444444444']) };
    function agent(id: string, sddTask: AgentNode['sddTask'], figures: Partial<AgentNode>): AgentNode {
      return { id, filePath: `${id}.jsonl`, status: 'finished', createdAt: NOW, lastActivity: NOW, sddTask, ...figures };
    }
    // Implémentation de la tâche 1, et sa revue lancée pendant qu'elle tournait encore : 10 min de chevauchement.
    const IMPL = agent('agent-impl', { plan: 'mon-plan', number: 1 }, {
      createdAt: NOW - 90 * MIN,
      report: { tokens: 400_000, toolUses: 30, durationMs: 30 * MIN },
    });
    const REVIEW = agent('agent-review', { plan: 'mon-plan', number: 1 }, {
      createdAt: NOW - 70 * MIN,
      report: { tokens: 210_000, toolUses: 12, durationMs: 22 * MIN },
    });
    const render = (agents: AgentNode[], options = {}) =>
      renderApp([project([session({ sdd: SDD, agents })])], { now: NOW, settings: SETTINGS, ...options });

    it('donne en infobulle le nombre d’agents, la durée du premier départ à la dernière fin et les jetons cumulés', () => {
      const html = render([IMPL, REVIEW]);
      // 90 min avant → 48 min avant : 42 min, pas la somme 52 min des deux durées.
      expect(html).toContain('Tâche 1 : Socle commun — terminée · brief, rapport, revue, correction 1 · 2 agents · 42 min · 610k jetons cumulés');
    });

    it('reporte les chiffres sur la ligne de la tâche en abrégé, le nombre d’agents en 🤖×N', () => {
      const html = render([IMPL, REVIEW], OPEN);
      expect(html).toMatch(/Socle commun<\/span><span class="sdd-figures">🤖×2 · 42 min · 610k<\/span>/);
    });

    it('fait courir la durée d’un agent encore en cours, avec son contexte actuel', () => {
      const running = agent('agent-run', { plan: 'mon-plan', number: 3 }, {
        status: 'active',
        createdAt: NOW - 4 * MIN,
        contextTokens: 89_000,
      });
      const html = render([running]);
      expect(html).toContain('Tâche 3 : Endpoint bougies — en cours · brief · 1 agent · 4 min · 89k jetons cumulés');
    });

    it('ne compte ni les agents d’un autre plan, ni ceux d’une autre tâche, ni ceux sans tâche', () => {
      const html = render([
        agent('agent-autre-plan', { plan: 'autre-plan', number: 1 }, { report: { tokens: 1, toolUses: 1, durationMs: MIN } }),
        agent('agent-tache-2', { plan: 'mon-plan', number: 2 }, { report: { tokens: 1, toolUses: 1, durationMs: MIN } }),
        agent('agent-libre', undefined, { report: { tokens: 1, toolUses: 1, durationMs: MIN } }),
      ]);
      expect(html).toContain('title="Tâche 1 : Socle commun — terminée · brief, rapport, revue, correction 1"');
    });

    it('une tâche sans agent n’a pas de chiffres', () => {
      const html = render([IMPL], OPEN);
      expect(html).toContain('title="Tâche 4 : Datafeed porté — à faire"');
      expect(html).not.toMatch(/Datafeed porté<\/span><span class="sdd-figures">/);
    });
  });

  describe('historique des plans', () => {
    const SID = 'aaaaaaaa-1111-2222-3333-444444444444';
    // Dates construites en heure locale : le rendu formate en heure locale, le test ne dépend pas du fuseau.
    const OLD: SddRun = {
      dir: 'c:\\dev\\marketing\\.superpowers\\sdd\\ancien',
      plan: 'ancien',
      totalCount: 2,
      doneCount: 1,
      finalReview: false,
      updatedAt: new Date(2026, 8, 12, 18, 26).getTime(),
      tasks: [
        { number: 1, state: 'done', title: 'A', brief: true, report: true, review: true },
        { number: 2, state: 'doing', title: 'B', brief: true, report: false, review: false },
      ],
    };
    const OLDER: SddRun = {
      ...OLD,
      dir: 'c:\\dev\\marketing\\.superpowers\\sdd\\plus-ancien',
      plan: 'plus-ancien',
      updatedAt: new Date(2026, 7, 1, 8, 5).getTime(),
    };
    const navTo = (run: SddRun | 'défaut') => `data-sdd-plan="${run === 'défaut' ? '' : run.dir}"`;
    const render = (overrides: Partial<SessionNode>, viewed?: string) =>
      renderApp([project([session(overrides)])], {
        now: NOW,
        settings: SETTINGS,
        ...(viewed !== undefined ? { sddViewed: new Map([[SID, viewed]]) } : {}),
      });

    const OFF_PREV = '<span class="sdd-nav-off" title="Aucun plan précédent">';
    const OFF_NEXT = '<span class="sdd-nav-off" title="Aucun plan plus récent">';

    it('le plan courant offre ‹ vers le plus récent des anciens, et un › grisé', () => {
      const html = render({ sdd: SDD, sddPlans: [SDD, OLD] });
      expect(html).toContain(navTo(OLD));
      expect(html).toContain(OFF_NEXT);
      expect(html).not.toContain('Plan suivant');
    });

    it('sans ancien plan, les deux flèches sont là mais grisées, et le plan reste daté', () => {
      const current = { ...SDD, updatedAt: new Date(2026, 8, 17, 12, 49).getTime() };
      const html = render({ sdd: current, sddPlans: [current] });
      expect(html).not.toContain('<button class="sdd-nav"');
      expect(html).toContain(OFF_PREV);
      expect(html).toContain(OFF_NEXT);
      expect(html).toContain('17/09 12:49');
    });

    it('sans plan courant, une ligne discrète donne accès aux anciens', () => {
      const html = render({ sddPlans: [OLD, OLDER] });
      expect(html).toContain('class="sdd-history"');
      expect(html).toContain('📋 2 plans');
      expect(html).toContain(navTo(OLD));
      expect(html).not.toContain('sdd-squares');
    });

    it('sur la ligne discrète, ‹ précède « 2 plans » et › grisé reste à droite', () => {
      const html = render({ sddPlans: [OLD, OLDER] });
      const at = (text: string) => html.indexOf(text);
      expect(at('title="Plan précédent"')).toBeLessThan(at('📋 2 plans'));
      expect(at('📋 2 plans')).toBeLessThan(at('class="sdd-pager"'));
      expect(at('class="sdd-pager"')).toBeLessThan(at(OFF_NEXT));
    });

    it('‹ à gauche de « Plan », la date et › à droite du compteur', () => {
      const html = render({ sddPlans: [OLD, OLDER] }, OLD.dir);
      const at = (text: string) => html.indexOf(text);
      expect(at('title="Plan précédent"')).toBeLessThan(at('📋 Plan'));
      expect(at('📋 Plan')).toBeLessThan(at('1/2'));
      expect(at('1/2')).toBeLessThan(at('class="sdd-pager"'));
      expect(at('class="sdd-pager"')).toBeLessThan(at('12/09 18:26'));
      expect(at('12/09 18:26')).toBeLessThan(at('title="Plan suivant"'));
    });

    // Un glyphe ‹ › n'occupe qu'une partie de sa boîte et reste petit et bas à toute taille de police.
    it('dessine les flèches en chevrons vectoriels, pas en glyphes', () => {
      const html = render({ sddPlans: [OLD, OLDER] }, OLD.dir);
      expect(html).toContain('<svg class="sdd-chevron"');
      expect(html).not.toMatch(/[‹›]/);
    });

    it('un plan fini retiré est l’un de ces anciens plans', () => {
      const html = render({ sdd: undefined, sddPlans: [{ ...SDD, finalReview: true }] });
      expect(html).toContain('📋 1 plan');
    });

    it('sans aucun plan, ni bloc ni ligne', () => {
      const html = render({});
      expect(html).not.toContain('sdd-history');
      expect(html).not.toContain('class="sdd');
    });

    it('un ancien plan consulté s’affiche daté, sans pulsation, avec ses deux flèches', () => {
      const html = render({ sddPlans: [OLD, OLDER] }, OLD.dir);
      expect(html).toContain('class="sdd past"');
      expect(html).toContain('12/09 18:26');
      expect(html).toContain('title="ancien — plan exécuté par sous-agents (superpowers)"');
      expect(html).toContain(navTo(OLDER));
      expect(html).toContain(navTo('défaut'));
    });

    // Une flèche grisée n'est pas un .sdd-nav : la webview n'y voit rien à cliquer.
    it('le plus ancien grise ‹ et garde › vers le plan plus récent', () => {
      const html = render({ sddPlans: [OLD, OLDER] }, OLDER.dir);
      expect(html).toContain(navTo(OLD));
      expect(html).toContain(OFF_PREV);
      expect(html).not.toContain('title="Plan précédent"');
    });

    it('› depuis le plus récent des anciens revient au plan courant', () => {
      const html = render({ sdd: SDD, sddPlans: [SDD, OLD] }, OLD.dir);
      expect(html).toContain(navTo('défaut'));
    });

    it('un plan consulté qui a disparu du disque ramène à la position par défaut', () => {
      const html = render({ sdd: SDD, sddPlans: [SDD, OLD] }, 'c:\\dev\\supprime');
      expect(html).not.toContain('class="sdd past"');
      expect(html).toContain('Endpoint bougies');
    });

    it('le plan courant n’est pas marqué comme passé', () => {
      const html = render({ sdd: SDD, sddPlans: [SDD, OLD] });
      expect(html).toContain('class="sdd"');
    });
  });

  it('se déplie au clic sur « Plan » ou sur les carrés, sans picto de dépliage', () => {
    const html = renderApp([project([session({ sdd: SDD })])], { now: NOW, settings: SETTINGS });
    expect(html).toMatch(/<span class="sdd-toggle">[^]*📋 Plan[^]*2\/4[^]*<\/span><\/div>/);
    expect(html).toContain('<ul class="sdd-squares sdd-toggle">');
    expect(html).not.toMatch(/[▸▾]/);
    expect(html).not.toContain('sdd-caret');
  });

  it('intitule le bloc « Plan » et donne son nom et son origine en infobulle', () => {
    const html = renderApp([project([session({ sdd: SDD })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('📋 Plan');
    expect(html).not.toContain('SDD');
    expect(html).toContain('title="mon-plan — plan exécuté par sous-agents (superpowers)"');
  });

  it('annonce un plan fini d’un ✓, avec la preuve en infobulle', () => {
    const tasks = SDD.tasks.map((task) => ({ ...task, state: 'done' as const }));
    const sdd: SddRun = { ...SDD, tasks, doneCount: 4, finalReview: true };
    const html = renderApp([project([session({ sdd })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('4/4 ✓');
    expect(html).toContain('Plan terminé — revue finale présente');
    expect(html).not.toContain('sdd-sq doing');
    expect(html).not.toContain('sdd-sq review');
  });

  it('pas de ✓ tant que la revue finale n’est pas là', () => {
    const html = renderApp([project([session({ sdd: SDD })])], { now: NOW, settings: SETTINGS });
    expect(html).not.toContain('✓');
    expect(html).not.toContain('Plan terminé');
  });

  it('ne parle de revue que lorsqu’une tâche y est', () => {
    const html = renderApp([project([session({ sdd: SDD })])], { now: NOW, settings: SETTINGS });
    expect(html).not.toContain('en revue');
  });

  it("n'affiche pas de bloc SDD quand le run ne porte aucune tâche", () => {
    const html = renderApp([project([session({ sdd: { ...SDD, tasks: [], doneCount: 0 } })])], {
      now: NOW,
      settings: SETTINGS,
    });
    expect(html).not.toContain('class="sdd"');
  });

  it('pose des data-key stables sur projets, sessions, agents et workflows (morph DOM)', () => {
    const running = agent({ id: 'agent-run', status: 'active' });
    const html = renderApp(
      [
        project([
          session({
            agents: [agent()],
            workflows: [{ id: 'wf_y', agents: [running], totalCount: 1, finishedCount: 0 }],
          }),
        ]),
      ],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('data-key="proj:c:\\dev\\marketing"');
    expect(html).toContain('data-key="sess:aaaaaaaa-1111-2222-3333-444444444444"');
    expect(html).toContain('data-key="ag:agent-aaa"');
    expect(html).toContain('data-key="wf:wf_y"');
    expect(html).toContain('data-key="ag:agent-run"');
  });
});

describe('renderApp — infobulle des agents de workflow', () => {
  it('met en infobulle le détail du prompt propre à l’agent, sur la ligne comme dans le tableau', () => {
    const detailed = agent({
      id: 'agent-1',
      description: 'Tu es RÉFUTATEUR — lentille CORRECTION.',
      detail: 'Tu es RÉFUTATEUR — lentille CORRECTION.\nCONSTAT : "anchorRef"',
    });
    const workflow = { id: 'wf_t', agents: [detailed], totalCount: 1, finishedCount: 0 };
    const projects = [project([session({ workflows: [workflow] })])];
    const collapsed = renderApp(projects, { now: NOW, settings: SETTINGS });
    // Le saut de ligne est écrit &#10; : même rendu dans l'infobulle, et lisible dans le HTML.
    expect(collapsed).toContain(
      '<span class="agent-label" title="Tu es RÉFUTATEUR — lentille CORRECTION.&#10;CONSTAT : &quot;anchorRef&quot;">Tu es RÉFUTATEUR — lentille CORRECTION.</span>',
    );
    const open = renderApp(projects, { now: NOW, settings: SETTINGS, expandedWorkflows: new Set(['wf_t']) });
    expect(open).toContain(
      '<td class="wf-name" title="Tu es RÉFUTATEUR — lentille CORRECTION.&#10;CONSTAT : &quot;anchorRef&quot;">Tu es RÉFUTATEUR — lentille CORRECTION.</td>',
    );
  });
});

describe('adresses locales des commandes de fond', () => {
  const task = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    command: 'npm run dev',
    description: 'Relance le serveur de dev',
    startedAt: NOW - 60_000,
    url: 'http://localhost:6602/',
    ...overrides,
  });

  it('affiche le lien tant que le port n’a pas été démenti', () => {
    const html = renderApp([project([session({ backgroundTasks: [task()] })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('localhost:6602');
  });

  it('affiche le lien d’un port qui répond', () => {
    const html = renderApp([project([session({ backgroundTasks: [task({ urlAlive: true })] })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('localhost:6602');
  });

  it('retire le lien d’un port mort mais garde la ligne de commande', () => {
    const html = renderApp([project([session({ backgroundTasks: [task({ urlAlive: false })] })])], { now: NOW, settings: SETTINGS });
    expect(html).not.toContain('localhost:6602');
    expect(html).toContain('Relance le serveur de dev');
  });

  it('ne garde que le port vivant quand plusieurs ont été écrits', () => {
    const tasks = [
      task({ id: 'a', url: 'http://localhost:6603/', urlAlive: false }),
      task({ id: 'b', url: 'http://localhost:6610/', urlAlive: false }),
      task({ id: 'c', url: 'http://localhost:6602/', urlAlive: true }),
    ];
    const html = renderApp([project([session({ backgroundTasks: tasks })])], { now: NOW, settings: SETTINGS });
    expect(html).toContain('localhost:6602');
    expect(html).not.toContain('localhost:6603');
    expect(html).not.toContain('localhost:6610');
  });
});

describe('card réduite à ses adresses locales', () => {
  const expired = (overrides: Partial<SessionNode> = {}) =>
    session({ active: false, lastActivity: NOW - 3_600_000, startedAt: NOW - 7_200_000, ...overrides });
  const live = { id: 't1', command: 'npm run dev', description: 'Relance le serveur', startedAt: NOW - 60_000, url: 'http://localhost:6602/', urlAlive: true };

  it('réduit une session expirée qui sert encore une adresse', () => {
    const html = renderApp([project([expired({ backgroundTasks: [live] })])], {
      now: NOW,
      settings: SETTINGS,
      inactiveSessionRetentionMinutes: 10,
    });
    expect(html).toContain('collapsed');
    expect(html).toContain('localhost:6602');
  });

  it('n’affiche ni agents ni todos dans une card réduite', () => {
    const html = renderApp([project([expired({ backgroundTasks: [live], agents: [agent({ description: 'Analyse des bugs' })] })])], {
      now: NOW,
      settings: SETTINGS,
      inactiveSessionRetentionMinutes: 10,
    });
    expect(html).not.toContain('Analyse des bugs');
  });

  it('fait disparaître le projet quand le dernier port meurt', () => {
    const dead = { ...live, urlAlive: false };
    const html = renderApp([project([expired({ backgroundTasks: [dead] })])], {
      now: NOW,
      settings: SETTINGS,
      inactiveSessionRetentionMinutes: 10,
    });
    expect(html).toContain('Aucune session Claude en cours.');
  });
});

import { describe, expect, it } from 'vitest';
import { escapeHtml, renderApp } from './render';
import type { AgentNode, FinishedAgentSettings, ProjectNode, SessionNode } from '../types';

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
    expect(html).not.toContain('actif');
    expect(html).not.toContain('terminé');
    expect(html).not.toContain('inactive ');
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

  it("affiche le type du sous-agent en badge, sans le préfixe plugin", () => {
    const html = renderApp(
      [project([session({ agents: [agent({ agentType: 'superpowers:code-reviewer' })] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain('<span class="agent-type">code-reviewer</span>');
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

  it("affiche le verbe d'activité d'un agent actif sous le tag de gauche", () => {
    const html = renderApp(
      [project([session({ agents: [agent({ agentType: 'claude', lastTool: 'Bash' })] })])],
      { now: NOW, settings: SETTINGS },
    );
    expect(html).toContain(
      '<span class="agent-left"><span class="agent-type">claude</span><span class="agent-verb">⏵ commande</span></span>',
    );
    expect(html).not.toContain('⏵ commande</span>' + '<span class="agent-desc"');
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

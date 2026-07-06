import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import {
  clearScannerCaches,
  compareAgents,
  defaultIsPidAlive,
  extractDescription,
  extractTailMeta,
  filterVisibleAgents,
  readEffortLevel,
  scan,
} from '../scanner';
import type { AgentNode } from '../types';
import {
  NOW,
  askQuestionLine,
  assistantLine,
  assistantUsageLine,
  cleanupClaudeDirs,
  makeClaudeDir,
  todoWriteLine,
  toolResultLine,
  toolUseLine,
  touch,
  userLine,
  writeAgent,
  writeCorruptRegistry,
  writeRegistry,
  writeSettings,
  writeTranscript,
} from './helpers';

afterEach(() => {
  cleanupClaudeDirs();
  clearScannerCaches();
});

const alive = () => true;

function registryEntry(overrides: Record<string, unknown> = {}) {
  return {
    pid: 1111,
    sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
    cwd: 'c:\\dev\\mon-projet',
    startedAt: NOW - 600_000,
    name: 'mon-projet-1',
    ...overrides,
  };
}

describe('scan — registre des sessions', () => {
  it('retourne [] quand le dossier sessions est absent', () => {
    const dir = makeClaudeDir();
    const result = scan({ claudeDir: join(dir, 'n-existe-pas'), now: NOW, isPidAlive: alive });
    expect(result).toEqual([]);
  });

  it('liste une session vivante avec les infos du registre', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    const result = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('mon-projet');
    expect(result[0].cwd).toBe('c:\\dev\\mon-projet');
    expect(result[0].sessions).toHaveLength(1);
    const session = result[0].sessions[0];
    expect(session.name).toBe('mon-projet-1');
    expect(session.pid).toBe(1111);
    expect(session.startedAt).toBe(NOW - 600_000);
    expect(session.active).toBe(false);
    expect(session.agents).toEqual([]);
    expect(session.workflows).toEqual([]);
  });

  it('ignore les sessions dont le PID est mort', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry({ pid: 1111 }));
    writeRegistry(dir, registryEntry({ pid: 2222, sessionId: 'bbbbbbbb-1111-2222-3333-444444444444' }));
    const result = scan({ claudeDir: dir, now: NOW, isPidAlive: (pid) => pid !== 2222 });
    expect(result).toHaveLength(1);
    expect(result[0].sessions).toHaveLength(1);
    expect(result[0].sessions[0].pid).toBe(1111);
  });

  it('ignore un JSON corrompu et le journalise', () => {
    const dir = makeClaudeDir();
    writeCorruptRegistry(dir, '9999.json', '{pas du json');
    writeRegistry(dir, registryEntry());
    const logged: string[] = [];
    const result = scan({ claudeDir: dir, now: NOW, isPidAlive: alive, log: (m) => logged.push(m) });
    expect(result).toHaveLength(1);
    expect(logged.some((m) => m.includes('9999.json'))).toBe(true);
  });

  it('ignore un registre sans champs obligatoires', () => {
    const dir = makeClaudeDir();
    writeCorruptRegistry(dir, '8888.json', JSON.stringify({ pid: 8888 }));
    const result = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(result).toEqual([]);
  });

  it('regroupe par cwd sans tenir compte de la casse', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry({ pid: 1111, cwd: 'c:\\dev\\mon-projet' }));
    writeRegistry(dir, registryEntry({ pid: 2222, sessionId: 'bbbbbbbb-1111-2222-3333-444444444444', cwd: 'C:\\dev\\mon-projet' }));
    const result = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(result).toHaveLength(1);
    expect(result[0].sessions).toHaveLength(2);
  });

  it('trie les sessions les plus récentes en premier au sein d’un projet', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry({ pid: 1111, startedAt: NOW - 600_000 }));
    writeRegistry(dir, registryEntry({ pid: 2222, sessionId: 'bbbbbbbb-1111-2222-3333-444444444444', startedAt: NOW - 60_000 }));
    const result = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(result[0].sessions.map((s) => s.pid)).toEqual([2222, 1111]);
  });
});

describe('scan — transcript de session', () => {
  const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  // encodeProjectDirName('c:\\dev\\mon-projet') === 'c--dev-mon-projet'
  const PROJECT_DIR = 'c--dev-mon-projet';

  it('marque active une session dont le transcript vient d’être modifié', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [userLine('salut'), assistantLine('claude-fable-5')], 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].active).toBe(true);
    expect(project.sessions[0].lastActivity).toBe(NOW - 5_000);
    expect(project.hasActiveSession).toBe(true);
  });

  it('marque inactive une session dont le transcript est vieux de plus de 30 s', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 45_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].active).toBe(false);
  });

  it('retrouve le dossier projet malgré une casse différente', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, 'C--dev-mon-projet', SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].active).toBe(true);
  });

  it('extrait le dernier modèle en ignorant <synthetic>', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [assistantLine('claude-opus-4-8'), assistantLine('claude-fable-5'), assistantLine('<synthetic>')],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].model).toBe('claude-fable-5');
  });

  it('affiche la session sans transcript avec les seules infos du registre', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].active).toBe(false);
    expect(project.sessions[0].lastActivity).toBeUndefined();
    expect(project.sessions[0].model).toBeUndefined();
  });

  it('extrait le dernier outil utilisé de la queue du transcript', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [toolUseLine('Read', 't1'), toolResultLine('t1'), toolUseLine('Edit', 't2'), toolResultLine('t2')],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].lastTool).toBe('Edit');
  });

  it('signale une question AskUserQuestion restée sans réponse', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [toolUseLine('Edit', 't1'), toolResultLine('t1'), toolUseLine('AskUserQuestion', 'tq')],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].pendingQuestion).toBe(true);
  });

  it('extrait le texte de la question en attente', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [askQuestionLine('tq', 'Où placer ce guide d’usage ?')],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].pendingQuestion).toBe(true);
    expect(project.sessions[0].pendingQuestionText).toBe('Où placer ce guide d’usage ?');
  });

  it('efface le texte de la question une fois la réponse donnée', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [askQuestionLine('tq', 'Où placer ce guide ?'), toolResultLine('tq')],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].pendingQuestionText).toBeUndefined();
  });

  it('ne signale plus la question une fois la réponse donnée', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [toolUseLine('AskUserQuestion', 'tq'), toolResultLine('tq'), assistantLine('claude-fable-5')],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].pendingQuestion).toBe(false);
  });

  it('extrait la dernière liste de tâches TodoWrite de la queue', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [
        todoWriteLine([
          { content: 'Ancienne tâche', status: 'completed' },
        ]),
        todoWriteLine([
          { content: 'Route import-image', status: 'completed' },
          { content: 'Moteur engine image', status: 'in_progress' },
          { content: 'Contrôleur generer', status: 'pending' },
        ]),
      ],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].todos).toEqual([
      { content: 'Route import-image', status: 'completed' },
      { content: 'Moteur engine image', status: 'in_progress' },
      { content: 'Contrôleur generer', status: 'pending' },
    ]);
  });

  it('retient la dernière todo-list sortie de la fenêtre de lecture (cache collant)', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [todoWriteLine([{ content: 'Tâche mémorisée', status: 'in_progress' }])],
      10_000,
    );
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].todos).toEqual([{ content: 'Tâche mémorisée', status: 'in_progress' }]);
  });

  it('laisse todos indéfini sans TodoWrite', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].todos).toBeUndefined();
  });

  it('extrait la dernière branche git de la queue du transcript', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [assistantLine('claude-fable-5', 'feature/x'), assistantLine('claude-fable-5', 'develop')],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].gitBranch).toBe('develop');
  });

  it('laisse gitBranch indéfini quand le transcript ne le porte pas', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].gitBranch).toBeUndefined();
  });

  it('ne relit pas la queue du transcript de session quand le mtime est inchangé', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 45_000);
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    // Réécrit avec un autre modèle mais repose le même mtime : le cache doit servir l'ancienne valeur.
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-opus-4-8')], 45_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].model).toBe('claude-fable-5');
  });

  it('relit la queue du transcript de session quand le mtime change', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 45_000);
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-opus-4-8')], 20_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].model).toBe('claude-opus-4-8');
    expect(project.sessions[0].active).toBe(true);
  });
});

describe('defaultIsPidAlive', () => {
  it('reconnaît le process courant comme vivant', () => {
    expect(defaultIsPidAlive(process.pid)).toBe(true);
  });

  it('considère mort un PID improbable', () => {
    expect(defaultIsPidAlive(999_999_999)).toBe(false);
  });
});

describe('scan — sous-agents et workflows', () => {
  const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const PROJECT_DIR = 'c--dev-mon-projet';

  function setupSession(dir: string): string {
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    return join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents');
  }

  it('liste les agents directs avec statut, description et modèle', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(agentsDir, 'aaa', 'Analyse des bugs du module paiement', 5_000, 'claude-opus-4-8');
    writeAgent(agentsDir, 'bbb', 'Exploration du code', 120_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const agents = project.sessions[0].agents;
    expect(agents).toHaveLength(2);
    const active = agents.find((a) => a.id === 'agent-aaa');
    const finished = agents.find((a) => a.id === 'agent-bbb');
    expect(active?.status).toBe('active');
    expect(active?.description).toBe('Analyse des bugs du module paiement');
    expect(active?.model).toBe('claude-opus-4-8');
    expect(finished?.status).toBe('finished');
    expect(finished?.lastActivity).toBe(NOW - 120_000);
  });

  it("extrait le dernier outil utilisé par un agent", () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    mkdirSync(agentsDir, { recursive: true });
    const filePath = join(agentsDir, 'agent-tool.jsonl');
    writeFileSync(filePath, [userLine('tâche'), toolUseLine('Bash', 't1')].join('\n') + '\n');
    touch(filePath, 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].agents[0].lastTool).toBe('Bash');
  });

  it('indente les sous-agents sous leur parent via le toolUseId (filiation)', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    mkdirSync(agentsDir, { recursive: true });
    // Niveau 1 (lancé par la session) : son transcript lance tu-2.
    const level1 = join(agentsDir, 'agent-aaa.jsonl');
    writeFileSync(level1, [userLine('Niveau 1'), toolUseLine('Agent', 'tu-2')].join('\n') + '\n');
    touch(level1, 10_000);
    writeFileSync(join(agentsDir, 'agent-aaa.meta.json'), JSON.stringify({ agentType: 'claude', toolUseId: 'tu-1' }));
    // Niveau 2 (spawné par tu-2) : lance tu-3.
    const level2 = join(agentsDir, 'agent-bbb.jsonl');
    writeFileSync(level2, [userLine('Niveau 2'), toolUseLine('Agent', 'tu-3')].join('\n') + '\n');
    touch(level2, 8_000);
    writeFileSync(join(agentsDir, 'agent-bbb.meta.json'), JSON.stringify({ agentType: 'claude', toolUseId: 'tu-2' }));
    // Niveau 3 (spawné par tu-3).
    writeAgent(agentsDir, 'ccc', 'Niveau 3', 5_000);
    writeFileSync(join(agentsDir, 'agent-ccc.meta.json'), JSON.stringify({ agentType: 'claude', toolUseId: 'tu-3' }));
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].agents.map((a) => [a.id, a.depth])).toEqual([
      ['agent-aaa', 0],
      ['agent-bbb', 1],
      ['agent-ccc', 2],
    ]);
  });

  it('regroupe chaque enfant derrière son parent, les racines gardant leur ordre chronologique', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    mkdirSync(agentsDir, { recursive: true });
    // Deux racines : rrr (ancienne) et sss (récente) ; sss a un enfant kkk créé AVANT sss (id trié avant).
    const rootOld = join(agentsDir, 'agent-rrr.jsonl');
    writeFileSync(rootOld, [userLine('Racine ancienne')].join('\n') + '\n');
    touch(rootOld, 60_000);
    const rootRecent = join(agentsDir, 'agent-sss.jsonl');
    writeFileSync(rootRecent, [userLine('Racine récente'), toolUseLine('Agent', 'tu-k')].join('\n') + '\n');
    touch(rootRecent, 30_000);
    writeAgent(agentsDir, 'kkk', 'Enfant', 5_000);
    writeFileSync(join(agentsDir, 'agent-kkk.meta.json'), JSON.stringify({ agentType: 'claude', toolUseId: 'tu-k' }));
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].agents.map((a) => [a.id, a.depth])).toEqual([
      ['agent-rrr', 0],
      ['agent-sss', 0],
      ['agent-kkk', 1],
    ]);
  });

  it("lit le type d'agent depuis agent-<id>.meta.json", () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(agentsDir, 'aaa', 'Analyse des bugs', 5_000);
    writeFileSync(
      join(agentsDir, 'agent-aaa.meta.json'),
      JSON.stringify({ agentType: 'superpowers:code-reviewer', description: 'x' }),
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].agents[0].agentType).toBe('superpowers:code-reviewer');
  });

  it('absorbe un meta.json absent ou corrompu', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(agentsDir, 'aaa', 'Sans meta', 5_000);
    writeAgent(agentsDir, 'bbb', 'Meta corrompu', 5_000);
    writeFileSync(join(agentsDir, 'agent-bbb.meta.json'), '{pas du json');
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].agents.map((a) => a.agentType)).toEqual([undefined, undefined]);
  });

  it('tronque une description trop longue à 500 caractères (tooltip, ellipse visuelle en CSS)', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(agentsDir, 'aaa', 'x'.repeat(600), 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const description = project.sessions[0].agents[0].description ?? '';
    expect(description.length).toBe(500);
    expect(description.endsWith('…')).toBe(true);
  });

  it('lit une description dont le content est un tableau de blocs', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    mkdirSync(agentsDir, { recursive: true });
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Vérifier la connexion' }] },
    });
    const filePath = join(agentsDir, 'agent-ccc.jsonl');
    writeFileSync(filePath, line + '\n');
    touch(filePath, 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].agents[0].description).toBe('Vérifier la connexion');
  });

  it('groupe les agents de workflow avec compteur de progression', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    const wfDir = join(agentsDir, 'workflows', 'wf_test-123');
    writeAgent(wfDir, 'aaa', 'review:perf', 120_000);
    writeAgent(wfDir, 'bbb', 'review:bugs', 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const workflows = project.sessions[0].workflows;
    expect(workflows).toHaveLength(1);
    expect(workflows[0].id).toBe('wf_test-123');
    expect(workflows[0].totalCount).toBe(2);
    expect(workflows[0].finishedCount).toBe(1);
    // Les agents de workflow ne doivent pas apparaître dans les agents directs.
    expect(project.sessions[0].agents).toHaveLength(0);
  });

  it('donne un label générique à un agent au transcript illisible', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    mkdirSync(agentsDir, { recursive: true });
    const filePath = join(agentsDir, 'agent-ddd.jsonl');
    writeFileSync(filePath, 'pas du json du tout\n');
    touch(filePath, 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const agent = project.sessions[0].agents[0];
    expect(agent.id).toBe('agent-ddd');
    expect(agent.description).toBeUndefined();
  });
});

describe('extractDescription', () => {
  it('retourne undefined pour un fichier absent', () => {
    expect(extractDescription('z:\\nulle\\part\\agent-x.jsonl')).toBeUndefined();
  });
});

// Le birthtime des fixtures n'est pas contrôlable (utimesSync ne le change pas) :
// l'ordre de tri se teste donc directement sur le comparateur, avec des nœuds construits à la main.
describe('compareAgents', () => {
  function node(id: string, createdAt: number): AgentNode {
    return { id, filePath: 'x', status: 'finished', lastActivity: createdAt, createdAt };
  }

  it('trie par date de création croissante', () => {
    const sorted = [node('agent-bbb', NOW - 1_000), node('agent-aaa', NOW - 60_000)].sort(compareAgents);
    expect(sorted.map((a) => a.id)).toEqual(['agent-aaa', 'agent-bbb']);
  });

  it('départage par id à date de création égale', () => {
    const sorted = [node('agent-bbb', NOW), node('agent-aaa', NOW)].sort(compareAgents);
    expect(sorted.map((a) => a.id)).toEqual(['agent-aaa', 'agent-bbb']);
  });
});

describe('filterVisibleAgents', () => {
  function agent(status: 'active' | 'finished', ageMs: number): AgentNode {
    return {
      id: `agent-${status}-${ageMs}`,
      filePath: 'x',
      status,
      lastActivity: NOW - ageMs,
      createdAt: NOW - ageMs,
    };
  }

  const activeAgent = agent('active', 5_000);
  const freshFinished = agent('finished', 45_000); // terminé depuis moins de 60 s
  const oldFinished = agent('finished', 90_000); // terminé depuis plus de 60 s
  const all = [activeAgent, freshFinished, oldFinished];

  it('mode always : tout est visible', () => {
    expect(filterVisibleAgents(all, { mode: 'always', retentionSeconds: 60 }, NOW)).toEqual(all);
  });

  it('mode never : seuls les actifs sont visibles', () => {
    expect(filterVisibleAgents(all, { mode: 'never', retentionSeconds: 60 }, NOW)).toEqual([activeAgent]);
  });

  it('mode temporarily : les terminés disparaissent après la rétention', () => {
    expect(filterVisibleAgents(all, { mode: 'temporarily', retentionSeconds: 60 }, NOW)).toEqual([
      activeAgent,
      freshFinished,
    ]);
  });

  it('mode temporarily avec rétention 0 : équivalent à never', () => {
    expect(filterVisibleAgents(all, { mode: 'temporarily', retentionSeconds: 0 }, NOW)).toEqual([activeAgent]);
  });
});

describe('scan — cache des métadonnées agents', () => {
  const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const PROJECT_DIR = 'c--dev-mon-projet';

  function setupSession(dir: string): string {
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    return join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents');
  }

  it('ne relit pas un agent dont le mtime est inchangé', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    const filePath = writeAgent(agentsDir, 'aaa', 'première description', 120_000);
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    // Réécrit le contenu puis repose exactement le même mtime : le cache doit servir l'ancienne valeur.
    writeFileSync(filePath, [userLine('description modifiée'), assistantLine('claude-fable-5')].join('\n') + '\n');
    touch(filePath, 120_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].agents[0].description).toBe('première description');
  });

  it('relit la queue au changement de mtime mais garde la description initiale (immuable)', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    const filePath = writeAgent(agentsDir, 'bbb', 'première description', 120_000);
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    writeFileSync(filePath, [userLine('description modifiée'), assistantLine('claude-opus-4-8')].join('\n') + '\n');
    touch(filePath, 60_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    // La description (premier message user, append-only en réalité) reste collante…
    expect(project.sessions[0].agents[0].description).toBe('première description');
    // …mais la queue (modèle, contexte) est bien relue.
    expect(project.sessions[0].agents[0].model).toBe('claude-opus-4-8');
  });

  it('élague du cache les agents disparus du scan courant', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    const filePath = writeAgent(agentsDir, 'ccc', 'première description', 120_000);
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    // L'agent disparaît (session morte) : le scan suivant doit purger son entrée de cache.
    rmSync(filePath);
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    // L'agent réapparaît avec un nouveau contenu mais le MÊME mtime qu'avant :
    // sans élagage, le cache servirait l'ancienne description.
    writeFileSync(filePath, [userLine('description modifiée'), assistantLine('claude-fable-5')].join('\n') + '\n');
    touch(filePath, 120_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].agents[0].description).toBe('description modifiée');
  });
});

describe('scan — activité agrégée, titres custom et tri stable', () => {
  const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const PROJECT_DIR = 'c--dev-mon-projet';

  function customTitleLine(title: string, sessionId: string): string {
    return JSON.stringify({ type: 'custom-title', customTitle: title, sessionId });
  }

  function aiTitleLine(title: string, sessionId: string): string {
    return JSON.stringify({ type: 'ai-title', aiTitle: title, sessionId });
  }

  it('utilise le titre IA à défaut de titre custom (au lieu du nom du registre)', () => {
    const dir = makeClaudeDir();
    const sessionId = '11111111-2222-3333-4444-555555555555';
    writeRegistry(dir, registryEntry({ sessionId, name: 'mon-projet-94' }));
    writeTranscript(
      dir,
      PROJECT_DIR,
      sessionId,
      [aiTitleLine('Refonte du pipeline ETL', sessionId), assistantLine('claude-fable-5')],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].name).toBe('Refonte du pipeline ETL');
  });

  it('le titre custom (renommage manuel) prime sur le titre IA', () => {
    const dir = makeClaudeDir();
    const sessionId = '22222222-2222-3333-4444-555555555555';
    writeRegistry(dir, registryEntry({ sessionId }));
    writeTranscript(
      dir,
      PROJECT_DIR,
      sessionId,
      [aiTitleLine('Titre IA', sessionId), customTitleLine('Titre custom', sessionId)],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].name).toBe('Titre custom');
  });

  it('retient le titre IA sorti de la fenêtre de lecture bornée', () => {
    const dir = makeClaudeDir();
    const sessionId = '33333333-2222-3333-4444-555555555555';
    writeRegistry(dir, registryEntry({ sessionId }));
    writeTranscript(
      dir,
      PROJECT_DIR,
      sessionId,
      [aiTitleLine('Titre IA mémorisé', sessionId), assistantLine('claude-fable-5')],
      10_000,
    );
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    writeTranscript(dir, PROJECT_DIR, sessionId, [assistantLine('claude-fable-5')], 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].name).toBe('Titre IA mémorisé');
  });

  it('marque active une session dont un sous-agent direct est actif', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    // Transcript principal silencieux (45 s) : la session délègue, seul l'agent écrit.
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 45_000);
    const agentsDir = join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents');
    writeAgent(agentsDir, 'aaa', 'tâche en cours', 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].active).toBe(true);
    expect(project.sessions[0].lastActivity).toBe(NOW - 5_000);
    expect(project.hasActiveSession).toBe(true);
  });

  it('marque active une session dont un agent de workflow est actif', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 45_000);
    const wfDir = join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents', 'workflows', 'wf_x-1');
    writeAgent(wfDir, 'bbb', 'tâche workflow', 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].active).toBe(true);
  });

  it("reste inactive quand tous ses agents sont terminés", () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 45_000);
    const agentsDir = join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents');
    writeAgent(agentsDir, 'ccc', 'tâche finie', 120_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].active).toBe(false);
    // La dernière activité reste celle du transcript, plus récente que l'agent terminé.
    expect(project.sessions[0].lastActivity).toBe(NOW - 45_000);
  });

  it('utilise le titre custom du transcript comme nom de session', () => {
    const dir = makeClaudeDir();
    const sessionId = 'bbbbbbbb-2222-3333-4444-555555555555';
    writeRegistry(dir, registryEntry({ sessionId }));
    writeTranscript(
      dir,
      PROJECT_DIR,
      sessionId,
      [customTitleLine('Gamini > JSON HTML', sessionId), assistantLine('claude-fable-5')],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].name).toBe('Gamini > JSON HTML');
  });

  it('le dernier titre custom du transcript gagne', () => {
    const dir = makeClaudeDir();
    const sessionId = 'cccccccc-2222-3333-4444-555555555555';
    writeRegistry(dir, registryEntry({ sessionId }));
    writeTranscript(
      dir,
      PROJECT_DIR,
      sessionId,
      [customTitleLine('Ancien titre', sessionId), customTitleLine('Nouveau titre', sessionId)],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].name).toBe('Nouveau titre');
  });

  it('conserve le titre en cache quand il sort de la fenêtre de lecture', () => {
    const dir = makeClaudeDir();
    const sessionId = 'dddddddd-2222-3333-4444-555555555555';
    writeRegistry(dir, registryEntry({ sessionId }));
    writeTranscript(
      dir,
      PROJECT_DIR,
      sessionId,
      [customTitleLine('Titre mémorisé', sessionId), assistantLine('claude-fable-5')],
      10_000,
    );
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    // Le transcript grossit et le titre n'est plus dans la queue lue : le cache doit le retenir.
    writeTranscript(dir, PROJECT_DIR, sessionId, [assistantLine('claude-fable-5')], 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].name).toBe('Titre mémorisé');
  });

  it('trie les sessions par démarrage décroissant même si une plus ancienne est active', () => {
    const dir = makeClaudeDir();
    const oldActiveId = 'eeeeeeee-2222-3333-4444-555555555555';
    const recentIdleId = 'ffffffff-2222-3333-4444-555555555555';
    writeRegistry(dir, registryEntry({ pid: 1111, sessionId: oldActiveId, startedAt: NOW - 600_000 }));
    writeRegistry(dir, registryEntry({ pid: 2222, sessionId: recentIdleId, startedAt: NOW - 60_000 }));
    writeTranscript(dir, PROJECT_DIR, oldActiveId, [assistantLine('claude-fable-5')], 5_000);
    writeTranscript(dir, PROJECT_DIR, recentIdleId, [assistantLine('claude-fable-5')], 120_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions.map((s) => s.pid)).toEqual([2222, 1111]);
  });

  it("trie les projets par ordre alphabétique quelle que soit l'activité", () => {
    const dir = makeClaudeDir();
    const activeId = '11111111-2222-3333-4444-555555555555';
    writeRegistry(dir, registryEntry({ pid: 1111, cwd: 'c:\\dev\\zzz-projet', sessionId: activeId }));
    writeRegistry(dir, registryEntry({ pid: 2222, cwd: 'c:\\dev\\aaa-projet' }));
    writeTranscript(dir, 'c--dev-zzz-projet', activeId, [assistantLine('claude-fable-5')], 5_000);
    const result = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(result.map((p) => p.name)).toEqual(['aaa-projet', 'zzz-projet']);
  });
});

describe('scan — contexte, lecture unifiée et effort', () => {
  const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const PROJECT_DIR = 'c--dev-mon-projet';

  it('calcule contextTokens de la session depuis le dernier usage', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [
        assistantUsageLine('claude-fable-5', { input: 10, cacheRead: 100, cacheCreation: 5 }),
        assistantUsageLine('claude-fable-5', { input: 2, cacheRead: 482_192, cacheCreation: 657 }),
      ],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].contextTokens).toBe(2 + 482_192 + 657);
    expect(project.sessions[0].model).toBe('claude-fable-5');
  });

  it('laisse contextTokens undefined sans bloc usage', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].contextTokens).toBeUndefined();
  });

  it('remplit contextTokens des agents via le cache mtime', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    const agentsDir = join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents');
    mkdirSync(agentsDir, { recursive: true });
    const filePath = join(agentsDir, 'agent-ctx.jsonl');
    writeFileSync(
      filePath,
      [userLine('tâche'), assistantUsageLine('claude-opus-4-8', { input: 5, cacheRead: 44_000, cacheCreation: 1_000 })].join('\n') + '\n',
    );
    touch(filePath, 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].agents[0].contextTokens).toBe(45_005);
  });

  it('extractTailMeta retourne un objet vide pour un fichier absent', () => {
    expect(extractTailMeta('z:\\nulle\\part\\x.jsonl')).toEqual({});
  });

  it('readEffortLevel lit la valeur globale', () => {
    const dir = makeClaudeDir();
    writeSettings(dir, JSON.stringify({ effortLevel: 'xhigh' }));
    expect(readEffortLevel(dir)).toBe('xhigh');
  });

  it('readEffortLevel ne relit settings.json que si son mtime change', () => {
    const dir = makeClaudeDir();
    const settingsPath = join(dir, 'settings.json');
    writeSettings(dir, JSON.stringify({ effortLevel: 'high' }));
    touch(settingsPath, 60_000);
    expect(readEffortLevel(dir)).toBe('high');
    // Réécrit avec une autre valeur mais repose le même mtime : le cache doit servir l'ancienne.
    writeSettings(dir, JSON.stringify({ effortLevel: 'low' }));
    touch(settingsPath, 60_000);
    expect(readEffortLevel(dir)).toBe('high');
    touch(settingsPath, 30_000);
    expect(readEffortLevel(dir)).toBe('low');
  });

  it('readEffortLevel absorbe absence et corruption', () => {
    const dir = makeClaudeDir();
    expect(readEffortLevel(dir)).toBeUndefined();
    writeSettings(dir, '{pas du json');
    expect(readEffortLevel(dir)).toBeUndefined();
    writeSettings(dir, JSON.stringify({ effortLevel: 42 }));
    expect(readEffortLevel(dir)).toBeUndefined();
  });
});

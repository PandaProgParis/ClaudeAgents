import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'path';
import { appendFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
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
  stamp,
  textLine,
  backgroundBashLine,
  backgroundResultLine,
  taskNotificationLine,
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

  it('ignore l’alias de modèle d’un appel Agent au profit du modèle de la ligne', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [
        assistantLine('claude-opus-5'),
        toolUseLine('Agent', 'ta', 'claude-opus-5', { subagent_type: 'general-purpose', model: 'sonnet' }),
      ],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].model).toBe('claude-opus-5');
  });

  it('conserve tel quel un modèle non Claude servi par une passerelle locale', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('glm-4.6')], 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].model).toBe('glm-4.6');
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

  it('masque une liste entièrement terminée dès qu’un nouveau prompt humain suit', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [
        userLine('implémente la feature', 'prompt-1'),
        todoWriteLine([
          { content: 'Route', status: 'completed' },
          { content: 'Tests', status: 'completed' },
        ]),
        userLine('passons à autre chose', 'prompt-2'),
      ],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].todos).toBeUndefined();
  });

  it('garde une liste terminée tant que le tour qui l’a produite continue', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [
        userLine('implémente la feature', 'prompt-1'),
        todoWriteLine([{ content: 'Route', status: 'completed' }]),
        toolResultLine('tu-todo', 'prompt-1'),
      ],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].todos).toEqual([{ content: 'Route', status: 'completed' }]);
  });

  it('garde une liste inachevée même après un nouveau prompt humain', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [
        userLine('implémente la feature', 'prompt-1'),
        todoWriteLine([
          { content: 'Route', status: 'completed' },
          { content: 'Tests', status: 'pending' },
        ]),
        userLine('au fait, une question', 'prompt-2'),
      ],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].todos).toEqual([
      { content: 'Route', status: 'completed' },
      { content: 'Tests', status: 'pending' },
    ]);
  });

  it('masque une liste terminée sortie de la fenêtre de lecture quand un nouveau prompt arrive', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [userLine('implémente la feature', 'prompt-1'), todoWriteLine([{ content: 'Route', status: 'completed' }])],
      10_000,
    );
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [userLine('passons à autre chose', 'prompt-2'), assistantLine('claude-fable-5')],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].todos).toBeUndefined();
  });

  it('date la liste par le tool_result de sa TodoWrite quand la ligne user précédente est hors fenêtre', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [
        todoWriteLine([{ content: 'Route', status: 'completed' }]),
        toolResultLine('tu-todo', 'prompt-1'),
        userLine('passons à autre chose', 'prompt-2'),
      ],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].todos).toBeUndefined();
  });

  it('ne ressuscite pas une liste masquée quand la fenêtre ne montre plus aucun promptId', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [
        userLine('implémente la feature', 'prompt-1'),
        todoWriteLine([{ content: 'Route', status: 'completed' }]),
        toolResultLine('tu-todo', 'prompt-1'),
        userLine('passons à autre chose', 'prompt-2'),
      ],
      10_000,
    );
    const [first] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(first.sessions[0].todos).toBeUndefined();
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [todoWriteLine([{ content: 'Route', status: 'completed' }]), assistantLine('claude-fable-5')],
      5_000,
    );
    const [second] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(second.sessions[0].todos).toBeUndefined();
  });

  it('affiche une nouvelle liste après une liste terminée masquée', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    const before = [
      userLine('implémente la feature', 'prompt-1'),
      todoWriteLine([{ content: 'Route', status: 'completed' }]),
      toolResultLine('tu-todo', 'prompt-1'),
      userLine('passons à autre chose', 'prompt-2'),
    ];
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, before, 10_000);
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [...before, todoWriteLine([{ content: 'Nouvelle tâche', status: 'in_progress' }])],
      5_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].todos).toEqual([{ content: 'Nouvelle tâche', status: 'in_progress' }]);
  });

  it('détecte le nouveau prompt même quand sa ligne dépasse la fenêtre de lecture', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    const turn = [
      userLine('implémente la feature', 'prompt-1'),
      todoWriteLine([{ content: 'Route', status: 'completed' }]),
      toolResultLine('tu-todo', 'prompt-1'),
    ];
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, turn, 10_000);
    const [first] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(first.sessions[0].todos).toEqual([{ content: 'Route', status: 'completed' }]);
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [...turn, userLine('x'.repeat(70_000), 'prompt-2')], 5_000);
    const [second] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(second.sessions[0].todos).toBeUndefined();
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
    expect(workflows[0].name).toBeUndefined();
  });

  it('marque en échec les agents signalés failed dans le journal du run', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    const wfDir = join(agentsDir, 'workflows', 'wf_j-1');
    writeAgent(wfDir, 'aaa', 'relecture', 120_000);
    writeAgent(wfDir, 'bbb', 'réfutation', 5_000);
    writeFileSync(
      join(wfDir, 'journal.jsonl'),
      [
        JSON.stringify({ type: 'started', key: 'k1', agentId: 'aaa' }),
        JSON.stringify({ type: 'result', key: 'k1', agentId: 'aaa', result: {} }),
        JSON.stringify({ type: 'started', key: 'k2', agentId: 'bbb' }),
        JSON.stringify({ type: 'failed', key: 'k2', agentId: 'bbb' }),
      ].join('\n') + '\n',
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const workflow = project.sessions[0].workflows[0];
    expect(workflow.agents.map((a) => [a.id, a.status])).toEqual([
      ['agent-aaa', 'finished'],
      ['agent-bbb', 'failed'],
    ]);
    expect(workflow.finishedCount).toBe(1);
    expect(workflow.failedCount).toBe(1);
    expect(workflow.totalCount).toBe(2);
  });

  it('élague du cache le journal d’un run disparu (même mtime, contenu différent)', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    const wfDir = join(agentsDir, 'workflows', 'wf_j-2');
    writeAgent(wfDir, 'aaa', 'relecture', 120_000);
    const journal = join(wfDir, 'journal.jsonl');
    writeFileSync(journal, JSON.stringify({ type: 'failed', key: 'k1', agentId: 'aaa' }) + '\n');
    touch(journal, 120_000);
    expect(scan({ claudeDir: dir, now: NOW, isPidAlive: alive })[0].sessions[0].workflows[0].failedCount).toBe(1);
    // Le run disparaît : son entrée doit être purgée au scan suivant…
    rmSync(wfDir, { recursive: true });
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    // …sinon un run recréé avec le MÊME mtime de journal serait servi depuis l'ancien cache.
    writeAgent(wfDir, 'aaa', 'relecture', 120_000);
    writeFileSync(journal, JSON.stringify({ type: 'result', key: 'k1', agentId: 'aaa', result: {} }) + '\n');
    touch(journal, 120_000);
    expect(scan({ claudeDir: dir, now: NOW, isPidAlive: alive })[0].sessions[0].workflows[0].failedCount).toBe(0);
  });

  const META_SCRIPT = [
    'export const meta = {',
    "  name: 'suite-ui',",
    '  description: "Deux chantiers : contrepartie et densité de l\'interface",',
    "  phases: [{ title: 'Implémentation', detail: 'un implémenteur par chantier' }, { title: 'Revue' }],",
    '}',
  ].join('\n');

  it('lit la description et les phases prévues dans le bloc meta du script du run', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(join(agentsDir, 'workflows', 'wf_m-1'), 'aaa', 'relecture', 5_000);
    const scriptsDir = join(agentsDir, '..', 'workflows', 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, 'suite-ui-wf_m-1.js'), META_SCRIPT);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const workflow = project.sessions[0].workflows[0];
    expect(workflow.name).toBe('suite-ui');
    expect(workflow.description).toBe("Deux chantiers : contrepartie et densité de l'interface");
    expect(workflow.phases).toEqual([
      { title: 'Implémentation', detail: 'un implémenteur par chantier' },
      { title: 'Revue' },
    ]);
  });

  it('lit la description dans le champ script du <runId>.json quand le script local manque', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(join(agentsDir, 'workflows', 'wf_m-2'), 'aaa', 'relecture', 5_000);
    const wfDir = join(agentsDir, '..', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'wf_m-2.json'), JSON.stringify({ runId: 'wf_m-2', script: META_SCRIPT, workflowName: 'suite-ui' }));
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const workflow = project.sessions[0].workflows[0];
    expect(workflow.name).toBe('suite-ui');
    expect(workflow.description).toBe("Deux chantiers : contrepartie et densité de l'interface");
    expect(workflow.phases?.map((phase) => phase.title)).toEqual(['Implémentation', 'Revue']);
  });

  it('retrouve le nom du workflow dans le fichier script <nom>-<runId>.js de la session', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(join(agentsDir, 'workflows', 'wf_f40840ea-183'), 'aaa', 'relecture:exactitude', 5_000);
    const scriptsDir = join(agentsDir, '..', 'workflows', 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, 'review-0-8-0-wf_f40840ea-183.js'), 'export const meta = {}');
    writeFileSync(join(scriptsDir, 'autre-run-wf_deadbeef-000.js'), 'export const meta = {}');
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].workflows[0].name).toBe('review-0-8-0');
  });

  it('retrouve le nom du workflow dans <session>/workflows/<runId>.json quand le script manque', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(join(agentsDir, 'workflows', 'wf_a4bd5e75-dbc'), 'aaa', 'review:depenses', 5_000);
    const wfDir = join(agentsDir, '..', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(
      join(wfDir, 'wf_a4bd5e75-dbc.json'),
      JSON.stringify({ runId: 'wf_a4bd5e75-dbc', script: 'export const meta = { name: "x" }', workflowName: 'review-depenses-integration' }),
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].workflows[0].name).toBe('review-depenses-integration');
  });

  it('retrouve le nom du workflow dans le dossier de projet voisin où le cwd du moment a rangé le script', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(join(agentsDir, 'workflows', 'wf_a318c39a-e3d'), 'aaa', 'relecture', 5_000);
    const siblingScripts = join(dir, 'projects', 'C--Users-cyril--claude-projects', SESSION_ID, 'workflows', 'scripts');
    mkdirSync(siblingScripts, { recursive: true });
    writeFileSync(join(siblingScripts, 'review-0-8-0-ter-wf_a318c39a-e3d.js'), 'export const meta = {}');
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].workflows[0].name).toBe('review-0-8-0-ter');
  });

  it('mémorise le nom d’un run une fois connu, même si son script disparaît', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(join(agentsDir, 'workflows', 'wf_x-1'), 'aaa', 'review', 5_000);
    const scriptsDir = join(agentsDir, '..', 'workflows', 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    const script = join(scriptsDir, 'nom-connu-wf_x-1.js');
    writeFileSync(script, 'export const meta = {}');
    const [first] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(first.sessions[0].workflows[0].name).toBe('nom-connu');
    rmSync(script);
    const [second] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(second.sessions[0].workflows[0].name).toBe('nom-connu');
  });

  it('ne sonde les dossiers voisins qu’une fois par run (le script précède toujours le dossier de run)', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(join(agentsDir, 'workflows', 'wf_x-1'), 'aaa', 'review', 5_000);
    const [miss] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(miss.sessions[0].workflows[0].name).toBeUndefined();
    const siblingScripts = join(dir, 'projects', 'autre-projet', SESSION_ID, 'workflows', 'scripts');
    mkdirSync(siblingScripts, { recursive: true });
    writeFileSync(join(siblingScripts, 'arrive-tard-wf_x-1.js'), 'export const meta = {}');
    const [again] = scan({ claudeDir: dir, now: NOW + 2_000, isPidAlive: alive });
    expect(again.sessions[0].workflows[0].name).toBeUndefined();
    // Le json de fin de run, lui, reste consulté à chaque scan.
    mkdirSync(join(agentsDir, '..', 'workflows'), { recursive: true });
    writeFileSync(join(agentsDir, '..', 'workflows', 'wf_x-1.json'), JSON.stringify({ workflowName: 'nom-final' }));
    const [done] = scan({ claudeDir: dir, now: NOW + 4_000, isPidAlive: alive });
    expect(done.sessions[0].workflows[0].name).toBe('nom-final');
  });

  it('préfère le nom du script à celui du json du run', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(join(agentsDir, 'workflows', 'wf_x-1'), 'aaa', 'review', 5_000);
    const wfDir = join(agentsDir, '..', 'workflows');
    mkdirSync(join(wfDir, 'scripts'), { recursive: true });
    writeFileSync(join(wfDir, 'scripts', 'nom-du-script-wf_x-1.js'), 'export const meta = {}');
    writeFileSync(join(wfDir, 'wf_x-1.json'), JSON.stringify({ runId: 'wf_x-1', workflowName: 'nom-du-json' }));
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].workflows[0].name).toBe('nom-du-script');
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
  it('saute les lignes vides en tête du prompt (workflows dont le prompt commence par un saut de ligne)', () => {
    const dir = makeClaudeDir();
    const filePath = writeAgent(join(dir, 'agents'), 'nl', '\n\nContexte : relecture du diff\nSuite du prompt', 5_000);
    expect(extractDescription(filePath)).toBe('Contexte : relecture du diff');
  });

  it('laisse la description indéfinie pour un prompt sans texte', () => {
    const dir = makeClaudeDir();
    const filePath = writeAgent(join(dir, 'agents'), 'blank', '  \n\t\n', 5_000);
    expect(extractDescription(filePath)).toBeUndefined();
  });

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

describe('scan — activité de l’agent principal', () => {
  const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const PROJECT_DIR = 'c--dev-mon-projet';

  function scanOne(dir: string, lines: string[], ageMs: number) {
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, lines, ageMs);
    return scan({ claudeDir: dir, now: NOW, isPidAlive: alive })[0].sessions[0];
  }

  it('réfléchit quand la dernière ligne est un prompt sans réponse, même sans écriture depuis 40 s', () => {
    const session = scanOne(makeClaudeDir(), [stamp(userLine('fais X', 'p1'), NOW - 40_000)], 40_000);
    expect(session.activity).toEqual({ phase: 'thinking', since: NOW - 40_000 });
    expect(session.active).toBe(true);
  });

  it('réfléchit aussi après un tool_result, et quand un bloc assistant n’a pas encore de stop_reason', () => {
    const afterResult = scanOne(
      makeClaudeDir(),
      [stamp(toolUseLine('Read', 't1'), NOW - 9_000, 'tool_use'), stamp(toolResultLine('t1'), NOW - 8_000)],
      8_000,
    );
    expect(afterResult.activity).toEqual({ phase: 'thinking', since: NOW - 8_000 });
    const streaming = scanOne(
      makeClaudeDir(),
      [stamp(userLine('fais X', 'p1'), NOW - 9_000), textLine('je regarde', NOW - 3_000, null)],
      3_000,
    );
    expect(streaming.activity).toEqual({ phase: 'thinking', since: NOW - 3_000 });
  });

  it('signale l’outil en cours tant que son tool_result manque', () => {
    const session = scanOne(
      makeClaudeDir(),
      [stamp(userLine('fais X', 'p1'), NOW - 60_000), stamp(toolUseLine('Bash', 't1'), NOW - 20_000, 'tool_use')],
      20_000,
    );
    expect(session.activity).toEqual({ phase: 'tool', tool: 'Bash', since: NOW - 20_000 });
    expect(session.active).toBe(true);
  });

  it('avec des outils parallèles, reste en cours sur celui dont le résultat manque', () => {
    const session = scanOne(
      makeClaudeDir(),
      [
        stamp(toolUseLine('Bash', 't1'), NOW - 20_000, 'tool_use'),
        stamp(toolUseLine('Read', 't2'), NOW - 19_000, 'tool_use'),
        stamp(toolResultLine('t1'), NOW - 10_000),
      ],
      10_000,
    );
    expect(session.activity).toEqual({ phase: 'tool', tool: 'Read', since: NOW - 19_000 });
  });

  it('passe au repos dès que le tour est terminé, même si le transcript vient d’être écrit', () => {
    const session = scanOne(
      makeClaudeDir(),
      [
        stamp(userLine('fais X', 'p1'), NOW - 60_000),
        stamp(toolUseLine('Read', 't1'), NOW - 50_000, 'tool_use'),
        stamp(toolResultLine('t1'), NOW - 40_000),
        textLine('voilà', NOW - 5_000),
      ],
      5_000,
    );
    expect(session.activity).toEqual({ phase: 'idle', since: NOW - 5_000 });
    expect(session.active).toBe(false);
  });

  it('est en attente quand une question est posée à l’utilisateur', () => {
    const session = scanOne(makeClaudeDir(), [stamp(askQuestionLine('q1', 'Quel port ?'), NOW - 5_000, 'tool_use')], 5_000);
    expect(session.activity).toEqual({ phase: 'waiting', since: NOW - 5_000 });
    expect(session.pendingQuestion).toBe(true);
    expect(session.active).toBe(false);
  });

  it('délègue quand le tour est terminé mais qu’un sous-agent lancé en arrière-plan tourne encore', () => {
    const dir = makeClaudeDir();
    writeAgent(join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents'), 'bg1', 'travail en fond', 2_000);
    const session = scanOne(
      dir,
      [
        stamp(toolUseLine('Agent', 't1'), NOW - 30_000, 'tool_use'),
        stamp(toolResultLine('t1'), NOW - 29_000),
        textLine('je lance en fond', NOW - 25_000),
      ],
      25_000,
    );
    expect(session.activity).toEqual({ phase: 'delegating', since: NOW - 25_000 });
    expect(session.active).toBe(true);
  });

  it('garde la règle d’activité par mtime quand la queue ne porte aucune ligne datée', () => {
    const session = scanOne(makeClaudeDir(), [assistantLine('claude-fable-5')], 5_000);
    expect(session.activity).toBeUndefined();
    expect(session.active).toBe(true);
  });
});

describe('scan — tâches en arrière-plan', () => {
  const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const PROJECT_DIR = 'c--dev-mon-projet';
  const OUTPUT = 'C:\\tmp\\claude\\tasks\\abc123.output';

  function serverLines(dir: string): string[] {
    return [
      backgroundBashLine('t1', 'cd "c:/dev/x" && npm run dev', 'Start the live preview server', NOW - 600_000),
      backgroundResultLine('t1', 'abc123', join(dir, 'tasks', 'abc123.output'), NOW - 599_000),
      textLine('Le serveur tourne.', NOW - 598_000),
    ];
  }

  it('liste un Bash lancé en arrière-plan tant que sa notification de fin n’est pas arrivée', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, serverLines(dir), 598_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].backgroundTasks).toEqual([
      {
        id: 'abc123',
        command: 'cd "c:/dev/x" && npm run dev',
        description: 'Start the live preview server',
        startedAt: NOW - 600_000,
      },
    ]);
    expect(OUTPUT).toContain('abc123');
  });

  it('retire la tâche dès que sa notification de fin est enfilée', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [...serverLines(dir), taskNotificationLine('abc123', 'completed', NOW - 1_000)],
      1_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].backgroundTasks).toBeUndefined();
  });

  it('extrait l’adresse locale écrite dans le fichier de sortie de la tâche', () => {
    const dir = makeClaudeDir();
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    writeFileSync(
      join(dir, 'tasks', 'abc123.output'),
      '\n> claude-agents@0.8.0 dev\n\nClaude Agents — aperçu live sur http://localhost:5173/  (Ctrl+C pour arrêter)\n',
    );
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, serverLines(dir), 598_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].backgroundTasks?.[0].url).toBe('http://localhost:5173/');
  });

  it('n’affiche aucune adresse tant que la sortie de la commande n’en contient pas, puis la lit', () => {
    const dir = makeClaudeDir();
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    const output = join(dir, 'tasks', 'srv1.output');
    writeFileSync(output, '');
    writeRegistry(dir, registryEntry());
    const filePath = writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [
        backgroundBashLine('t9', 'cd /x || exit 1; exec node srv.ts', 'Start the API server on 3110 (background)', NOW - 60_000),
        backgroundResultLine('t9', 'srv1', output, NOW - 59_000),
        textLine('ok', NOW - 58_000),
      ],
      58_000,
    );
    const first = scan({ claudeDir: dir, now: NOW, isPidAlive: alive })[0].sessions[0].backgroundTasks?.[0];
    expect(first?.url).toBeUndefined();
    writeFileSync(output, 'API ready: http://127.0.0.1:3110/api\n');
    touch(output, 30_000);
    touch(filePath, 30_000);
    const second = scan({ claudeDir: dir, now: NOW, isPidAlive: alive })[0].sessions[0].backgroundTasks?.[0];
    expect(second?.url).toBe('http://127.0.0.1:3110/api');
  });

  it('garde la tâche en mémoire quand son lancement est sorti de la fenêtre de queue', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    const filePath = writeTranscript(dir, PROJECT_DIR, SESSION_ID, serverLines(dir), 598_000);
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const filler = Array.from({ length: 200 }, (_, i) => textLine('x'.repeat(400) + i, NOW - 500_000 + i));
    appendFileSync(filePath, filler.join('\n') + '\n');
    touch(filePath, 100_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].backgroundTasks?.map((task) => task.id)).toEqual(['abc123']);
  });

  it('retrouve au premier scan une commande lancée bien avant la fenêtre de queue', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    const filler = Array.from({ length: 200 }, (_, i) => textLine('x'.repeat(400) + i, NOW - 500_000 + i));
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [...serverLines(dir), ...filler], 100_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].backgroundTasks?.map((task) => task.id)).toEqual(['abc123']);
  });

  it('ne ressuscite pas au premier scan une commande dont la fin est elle aussi hors fenêtre', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    const filler = Array.from({ length: 200 }, (_, i) => textLine('x'.repeat(400) + i, NOW - 500_000 + i));
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [...serverLines(dir), taskNotificationLine('abc123', 'completed', NOW - 550_000), ...filler],
      100_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].backgroundTasks).toBeUndefined();
  });

  it('rattrape une notification de fin passée hors de la fenêtre entre deux scans', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry());
    const filePath = writeTranscript(dir, PROJECT_DIR, SESSION_ID, serverLines(dir), 598_000);
    scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const filler = Array.from({ length: 200 }, (_, i) => textLine('x'.repeat(400) + i, NOW - 500_000 + i));
    appendFileSync(filePath, [taskNotificationLine('abc123', 'completed', NOW - 550_000), ...filler].join('\n') + '\n');
    touch(filePath, 100_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].backgroundTasks).toBeUndefined();
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

describe('scan — libellés des agents de workflow', () => {
  const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const PROJECT_DIR = 'c--dev-mon-projet';
  const PREAMBLE =
    'Repo: c:/dev/mon-projet. Application Next.js dans data-comparator (lancer jest depuis là).\nLa spec qui fait autorité : docs/spec.md\n\n';
  const FIRST_LINE = 'Repo: c:/dev/mon-projet. Application Next.js dans data-comparator (lancer jest depuis là).';

  function setupRun(dir: string, runId = 'wf_r-1'): { runDir: string; wfDir: string } {
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    const sessionDir = join(dir, 'projects', PROJECT_DIR, SESSION_ID);
    return { runDir: join(sessionDir, 'subagents', 'workflows', runId), wfDir: join(sessionDir, 'workflows') };
  }

  function labels(dir: string, now = NOW): Array<[string | undefined, string | undefined]> {
    const [project] = scan({ claudeDir: dir, now, isPidAlive: alive });
    return project.sessions[0].workflows[0].agents.map((agent) => [agent.description, agent.detail]);
  }

  it('libelle chaque agent par sa première ligne après le préambule commun au run, la suite en détail', () => {
    const dir = makeClaudeDir();
    const { runDir } = setupRun(dir);
    writeAgent(runDir, 'a1', PREAMBLE + 'DIMENSION — SÛRETÉ DE LA BASCULE.\nFichiers : lib/db/store.ts', 5_000);
    writeAgent(runDir, 'a2', PREAMBLE + 'DIMENSION — PARITÉ DU FILTRAGE.\nFichiers : components/client.tsx', 5_000);
    writeAgent(
      runDir,
      'a3',
      PREAMBLE + 'Tu es RÉFUTATEUR — lentille CORRECTION.\n\nCONSTAT :\n{ "title": "anchorRef lu dans l’updater" }',
      5_000,
    );
    expect(labels(dir)).toEqual([
      ['DIMENSION — SÛRETÉ DE LA BASCULE.', 'DIMENSION — SÛRETÉ DE LA BASCULE.\nFichiers : lib/db/store.ts'],
      ['DIMENSION — PARITÉ DU FILTRAGE.', 'DIMENSION — PARITÉ DU FILTRAGE.\nFichiers : components/client.tsx'],
      [
        'Tu es RÉFUTATEUR — lentille CORRECTION.',
        'Tu es RÉFUTATEUR — lentille CORRECTION.\n\nCONSTAT :\n{ "title": "anchorRef lu dans l’updater" }',
      ],
    ]);
  });

  it('coupe le préambule en début de ligne quand les prompts divergent au milieu d’une ligne', () => {
    const dir = makeClaudeDir();
    const { runDir } = setupRun(dir);
    writeAgent(runDir, 'a1', PREAMBLE + 'DIMENSION — PARITÉ.', 5_000);
    writeAgent(runDir, 'a2', PREAMBLE + 'DIMENSION — PARALLÉLISATION.', 5_000);
    // Une seule ligne propre à l’agent : pas de détail, l’infobulle reprendrait le libellé.
    expect(labels(dir)).toEqual([
      ['DIMENSION — PARITÉ.', undefined],
      ['DIMENSION — PARALLÉLISATION.', undefined],
    ]);
  });

  it('garde la première ligne du prompt quand le run n’a qu’un agent, ou des prompts tous identiques', () => {
    const dir = makeClaudeDir();
    const { runDir } = setupRun(dir);
    writeAgent(runDir, 'seul', PREAMBLE + 'TÂCHE unique', 5_000);
    expect(labels(dir)).toEqual([[FIRST_LINE, undefined]]);
    writeAgent(runDir, 'jumeau', PREAMBLE + 'TÂCHE unique', 5_000);
    expect(labels(dir, NOW + 2_000)).toEqual([
      [FIRST_LINE, undefined],
      [FIRST_LINE, undefined],
    ]);
  });

  it('prend le label du script dans <runId>.json en fin de run, le libellé de prompt passant en détail', () => {
    const dir = makeClaudeDir();
    const { runDir, wfDir } = setupRun(dir);
    writeAgent(runDir, 'a1', PREAMBLE + 'TA VOIE : A-lib-pure\nLis la spec.', 5_000);
    writeAgent(runDir, 'a2', PREAMBLE + 'TA VOIE : B-backend\nLis la spec.', 5_000);
    mkdirSync(join(wfDir, 'scripts'), { recursive: true });
    writeFileSync(join(wfDir, 'scripts', 'suite-ui-wf_r-1.js'), 'export const meta = { name: "suite-ui" }');
    // Pendant le run : nom du script local, libellés tirés des prompts.
    const [running] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(running.sessions[0].workflows[0].name).toBe('suite-ui');
    expect(running.sessions[0].workflows[0].agents.map((agent) => agent.description)).toEqual([
      'TA VOIE : A-lib-pure',
      'TA VOIE : B-backend',
    ]);
    // Fin du run : le json arrive avec les labels du script ; a2 n’y figure pas et garde son libellé.
    writeFileSync(
      join(wfDir, 'wf_r-1.json'),
      JSON.stringify({
        runId: 'wf_r-1',
        workflowName: 'suite-ui',
        workflowProgress: [
          { type: 'workflow_phase', index: 1, title: 'Implémentation' },
          { type: 'workflow_agent', index: 1, label: 'impl:A-lib-pure', agentId: 'a1', state: 'done' },
          { type: 'workflow_agent', index: 2, agentId: 'zzz', state: 'done' },
        ],
      }),
    );
    expect(labels(dir, NOW + 2_000)).toEqual([
      ['impl:A-lib-pure', 'TA VOIE : A-lib-pure\nLis la spec.'],
      ['TA VOIE : B-backend', 'TA VOIE : B-backend\nLis la spec.'],
    ]);
  });

  it('lit aussi les labels quand le json du run est la seule source d’infos', () => {
    const dir = makeClaudeDir();
    const { runDir, wfDir } = setupRun(dir);
    writeAgent(runDir, 'a1', 'relecture', 5_000);
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(
      join(wfDir, 'wf_r-1.json'),
      JSON.stringify({
        workflowName: 'revue',
        workflowProgress: [{ type: 'workflow_agent', index: 1, label: 'review:bugs', agentId: 'a1' }],
      }),
    );
    expect(labels(dir)).toEqual([['review:bugs', 'relecture']]);
  });
});

describe('scan — libellé des sous-agents directs', () => {
  const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const PROJECT_DIR = 'c--dev-mon-projet';
  const PROMPT = 'Repo: c:/dev/mon-projet. Application Next.js dans data-comparator.\nCorrige les largeurs des colonnes du tableau des procédures.';

  function setupSession(dir: string): string {
    writeRegistry(dir, registryEntry());
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    return join(dir, 'projects', PROJECT_DIR, SESSION_ID, 'subagents');
  }

  it('libelle un sous-agent par la description de son meta.json, le début du prompt en détail', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(agentsDir, 'aaa', PROMPT, 5_000);
    writeFileSync(
      join(agentsDir, 'agent-aaa.meta.json'),
      JSON.stringify({ agentType: 'general-purpose', description: 'Corrige les largeurs du tableau', toolUseId: 'tu-1' }),
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const [agent] = project.sessions[0].agents;
    expect(agent.description).toBe('Corrige les largeurs du tableau');
    expect(agent.detail).toBe(PROMPT);
    // Le meta.json ne se relit pas : la description tient au second scan, transcript modifié ou non.
    touch(join(agentsDir, 'agent-aaa.jsonl'), 1_000);
    const [again] = scan({ claudeDir: dir, now: NOW + 2_000, isPidAlive: alive });
    expect(again.sessions[0].agents[0].description).toBe('Corrige les largeurs du tableau');
  });

  it('garde la première ligne du prompt quand le meta.json ne décrit pas l’agent', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(agentsDir, 'bbb', PROMPT, 5_000);
    writeFileSync(join(agentsDir, 'agent-bbb.meta.json'), JSON.stringify({ agentType: 'claude', toolUseId: 'tu-2' }));
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const [agent] = project.sessions[0].agents;
    expect(agent.description).toBe('Repo: c:/dev/mon-projet. Application Next.js dans data-comparator.');
    expect(agent.detail).toBeUndefined();
  });
});

describe('scan — session reprise et nom du registre', () => {
  const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const PROJECT_DIR = 'c--dev-mon-projet';
  const TWO_DAYS = 2 * 86_400_000;

  it('ne « réfléchit » pas sur un prompt antérieur au démarrage du processus (session reprise)', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry({ startedAt: NOW - 600_000 }));
    // Prompt resté sans réponse il y a deux jours, session reprise depuis : rien n'est en cours.
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [stamp(userLine('fais X', 'p1'), NOW - TWO_DAYS)], 36 * 3_600_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].activity?.phase).toBe('idle');
    expect(project.sessions[0].active).toBe(false);
  });

  it('idem pour un outil resté sans résultat avant la reprise', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry({ startedAt: NOW - 600_000 }));
    writeTranscript(
      dir,
      PROJECT_DIR,
      SESSION_ID,
      [stamp(toolUseLine('Bash', 't1'), NOW - TWO_DAYS, 'tool_use')],
      36 * 3_600_000,
    );
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].activity?.phase).toBe('idle');
    expect(project.sessions[0].active).toBe(false);
  });

  it('retire le suffixe aléatoire d’un nom dérivé du dossier (mon-projet-4e → mon-projet)', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry({ name: 'mon-projet-4e', nameSource: 'derived' }));
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    expect(project.sessions[0].name).toBe('mon-projet');
  });

  it('garde tel quel un nom de source inconnue ou choisi par l’utilisateur', () => {
    const dir = makeClaudeDir();
    writeRegistry(dir, registryEntry({ name: 'mon-projet-94' }));
    writeTranscript(dir, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    expect(scan({ claudeDir: dir, now: NOW, isPidAlive: alive })[0].sessions[0].name).toBe('mon-projet-94');
    const other = makeClaudeDir();
    writeRegistry(other, registryEntry({ name: 'release-4e', nameSource: 'user' }));
    writeTranscript(other, PROJECT_DIR, SESSION_ID, [assistantLine('claude-fable-5')], 5_000);
    expect(scan({ claudeDir: other, now: NOW, isPidAlive: alive })[0].sessions[0].name).toBe('release-4e');
  });
});

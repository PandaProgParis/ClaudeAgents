import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { clearScannerCaches, scan } from '../scanner';
import {
  NOW,
  assistantLine,
  cleanupClaudeDirs,
  makeClaudeDir,
  originLine,
  textLine,
  writeAgent,
  writeRegistry,
  writeTranscript,
} from './helpers';

const repos: string[] = [];

afterEach(() => {
  cleanupClaudeDirs();
  clearScannerCaches();
  for (const dir of repos.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const alive = () => true;
const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';

/** Dépôt réel sur disque : le scanner lit le workspace SDD sous le cwd de la session, pas sous ~/.claude. */
function makeRepoWithSdd(files: string[], plan = 'mon-plan'): string {
  const root = mkdtempSync(join(tmpdir(), 'claude-agents-scan-sdd-'));
  repos.push(root);
  const workspace = join(root, '.superpowers', 'sdd', plan);
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'progress.md'), `# SDD ledger — plan: plans/${plan}.md\n`);
  for (const file of files) {
    writeFileSync(join(workspace, file), 'contenu\n');
  }
  mkdirSync(join(root, 'plans'), { recursive: true });
  writeFileSync(join(root, 'plans', `${plan}.md`), '## Tâche 1 : A\n## Tâche 2 : B\n## Tâche 3 : C\n');
  return root;
}

function projectDirNameOf(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

describe('scan — tâches SDD', () => {
  it('attache à la session le run SDD trouvé sous son dossier', () => {
    const cwd = makeRepoWithSdd(['task-1-brief.md', 'task-1-report.md', 'task-2-brief.md']);
    const dir = makeClaudeDir();
    writeRegistry(dir, { pid: 1111, sessionId: SESSION_ID, cwd, startedAt: NOW - 600_000, name: 'mon-projet-1' });
    writeTranscript(dir, projectDirNameOf(cwd), SESSION_ID, [assistantLine('claude-opus-5')], 5_000);

    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const sdd = project?.sessions[0]?.sdd;

    expect(sdd?.plan).toBe('mon-plan');
    expect(sdd?.totalCount).toBe(3);
    // Brief 2 posé, mais aucun agent ne l'a reçu : la tâche 1 est encore la dernière lancée.
    expect(sdd?.tasks.map((task) => task.state)).toEqual(['review', 'pending', 'pending']);
  });

  it('une tâche dont un agent de la session a reçu les fichiers est lancée', () => {
    const cwd = makeRepoWithSdd(['task-1-brief.md', 'task-1-report.md', 'task-2-brief.md']);
    const dir = makeClaudeDir();
    writeRegistry(dir, { pid: 1111, sessionId: SESSION_ID, cwd, startedAt: NOW - 600_000, name: 'mon-projet-1' });
    writeTranscript(dir, projectDirNameOf(cwd), SESSION_ID, [assistantLine('claude-opus-5')], 5_000);
    const brief = join(cwd, '.superpowers', 'sdd', 'mon-plan', 'task-2-brief.md');
    writeAgent(join(dir, 'projects', projectDirNameOf(cwd), SESSION_ID, 'subagents'), 'impl2', `Brief : \`${brief}\``, 5_000);

    const sdd = scan({ claudeDir: dir, now: NOW, isPidAlive: alive })[0]?.sessions[0]?.sdd;

    expect(sdd?.tasks.map((task) => task.state)).toEqual(['done', 'doing', 'pending']);
    expect(sdd?.doneCount).toBe(1);
  });

  it('laisse le champ absent quand la session ne porte aucun run SDD', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-agents-scan-plain-'));
    repos.push(cwd);
    const dir = makeClaudeDir();
    writeRegistry(dir, { pid: 1111, sessionId: SESSION_ID, cwd, startedAt: NOW - 600_000, name: 'mon-projet-1' });
    writeTranscript(dir, projectDirNameOf(cwd), SESSION_ID, [assistantLine('claude-opus-5')], 5_000);

    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });

    expect(project?.sessions[0]?.sdd).toBeUndefined();
  });
});

describe('scan — agents rattachés aux tâches d’un plan', () => {
  const WORKSPACE = 'C:\\dev\\projet\\.superpowers\\sdd\\mon-plan';

  /** Session sans workspace sur disque : seul le prompt des agents compte ici. */
  function agentsOf(prompts: Record<string, string>) {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-agents-scan-sdd-agents-'));
    repos.push(cwd);
    const dir = makeClaudeDir();
    writeRegistry(dir, { pid: 1111, sessionId: SESSION_ID, cwd, startedAt: NOW - 600_000, name: 'mon-projet-1' });
    writeTranscript(dir, projectDirNameOf(cwd), SESSION_ID, [assistantLine('claude-opus-5')], 5_000);
    const agentsDir = join(dir, 'projects', projectDirNameOf(cwd), SESSION_ID, 'subagents');
    const files = Object.fromEntries(
      Object.entries(prompts).map(([id, prompt]) => [id, writeAgent(agentsDir, id, prompt, 60_000)]),
    );
    const link = (id: string) =>
      scan({ claudeDir: dir, now: NOW, isPidAlive: alive })[0]?.sessions[0]?.agents.find((agent) => agent.id === `agent-${id}`)
        ?.sddTask;
    return { files, link };
  }

  it('rattache l’agent à la tâche dont son prompt nomme les fichiers', () => {
    const { link } = agentsOf({
      impl: `Lis ton brief : \`${WORKSPACE}\\task-2-brief.md\`. Écris ton rapport dans \`${WORKSPACE}\\task-2-report.md\`.`,
    });

    expect(link('impl')).toEqual({ plan: 'mon-plan', number: 2 });
  });

  it('accepte un chemin relatif à barres obliques', () => {
    const { link } = agentsOf({ review: 'Entrées : `.superpowers/sdd/mon-plan/task-11-fix-1.md` puis la revue.' });

    expect(link('review')).toEqual({ plan: 'mon-plan', number: 11 });
  });

  it('ne rattache rien quand le prompt nomme les fichiers de plusieurs tâches', () => {
    const { link } = agentsOf({
      final: `Revue finale : \`${WORKSPACE}\\task-1-report.md\` et \`${WORKSPACE}\\task-2-report.md\`.`,
    });

    expect(link('final')).toBeUndefined();
  });

  it('ne rattache rien sans fichier de tâche dans le prompt', () => {
    const { link } = agentsOf({ scan: `Scan de pré-vol du plan \`${WORKSPACE}\\progress.md\`.` });

    expect(link('scan')).toBeUndefined();
  });

  // Prompts réels du contrôleur : 6 à 9 Ko, chemin du brief parfois au-delà des 8 Ko lus pour le libellé.
  it('lit le prompt en entier, même long', () => {
    const { link } = agentsOf({ impl: `${'Contexte. '.repeat(1_200)}Brief : \`${WORKSPACE}\\task-7-brief.md\`.` });

    expect(link('impl')).toEqual({ plan: 'mon-plan', number: 7 });
  });

  it('ne lit que le prompt : un fichier d’une autre tâche ouvert ensuite par l’agent ne change rien', () => {
    const { files, link } = agentsOf({ impl: `Brief : \`${WORKSPACE}\\task-3-brief.md\`.` });
    appendFileSync(files.impl, JSON.stringify({ type: 'user', message: { role: 'user', content: `${WORKSPACE}\\task-9-report.md` } }) + '\n');

    expect(link('impl')).toEqual({ plan: 'mon-plan', number: 3 });
  });
});

describe('scan — plan fini retiré quand la conversation passe à autre chose', () => {
  const HOUR = 3_600_000;
  /** Dernière écriture du workspace : toutes les dates du scénario se lisent par rapport à elle. */
  const FINISHED_AT = NOW - 5 * HOUR;

  /** Fige les dates du dossier et du ledger, après que tous les fichiers ont été écrits. */
  function setWorkspaceTime(cwd: string, at: number): void {
    const workspace = join(cwd, '.superpowers', 'sdd', 'mon-plan');
    utimesSync(join(workspace, 'progress.md'), new Date(at), new Date(at));
    utimesSync(workspace, new Date(at), new Date(at));
  }

  function sddAfter(cwd: string, lines: string[]) {
    const dir = makeClaudeDir();
    writeRegistry(dir, { pid: 1111, sessionId: SESSION_ID, cwd, startedAt: NOW - 24 * HOUR, name: 'mon-projet-1' });
    const transcript = writeTranscript(dir, projectDirNameOf(cwd), SESSION_ID, lines, 5_000);
    const session = () => scan({ claudeDir: dir, now: NOW, isPidAlive: alive })[0]?.sessions[0];
    return { transcript, session, sdd: () => session()?.sdd };
  }

  /** Réponses de l'agent sans aucun prompt humain, sur `megabytes` Mo : de quoi chasser le prompt loin de la fin. */
  function answers(megabytes: number, at: number): string[] {
    return Array.from({ length: megabytes * 10 }, () => textLine('x'.repeat(100_000), at));
  }

  const FINISHED = ['task-1-brief.md', 'task-2-brief.md', 'task-3-brief.md', 'task-3-report.md', 'revue-finale.md'];

  it('retire un plan fini dès qu’un prompt humain suit sa dernière écriture', () => {
    const cwd = makeRepoWithSdd(FINISHED);
    setWorkspaceTime(cwd, FINISHED_AT);

    const { sdd } = sddAfter(cwd, [originLine('human', 'on passe au calendrier', FINISHED_AT + HOUR)]);

    expect(sdd()).toBeUndefined();
  });

  it('garde un plan fini tant que le dernier prompt humain le précède', () => {
    const cwd = makeRepoWithSdd(FINISHED);
    setWorkspaceTime(cwd, FINISHED_AT);

    const { sdd } = sddAfter(cwd, [originLine('human', 'lance le plan', FINISHED_AT - HOUR)]);

    expect(sdd()?.finalReview).toBe(true);
  });

  it('ne retire jamais un plan en cours, même après un prompt humain', () => {
    const cwd = makeRepoWithSdd(['task-1-brief.md', 'task-2-brief.md']);
    setWorkspaceTime(cwd, FINISHED_AT);

    const { sdd } = sddAfter(cwd, [originLine('human', 'où en est-on ?', FINISHED_AT + HOUR)]);

    expect(sdd()?.finalReview).toBe(false);
  });

  it('une notification de fin de tâche n’est pas une reprise de la conversation', () => {
    const cwd = makeRepoWithSdd(FINISHED);
    setWorkspaceTime(cwd, FINISHED_AT);

    const { sdd } = sddAfter(cwd, [
      originLine('human', 'lance le plan', FINISHED_AT - HOUR),
      originLine('task-notification', '<task-notification>…</task-notification>', FINISHED_AT + HOUR),
    ]);

    expect(sdd()).toBeDefined();
  });

  it('le retrait est collant : une écriture ultérieure dans le workspace ne ramène pas le bloc', () => {
    const cwd = makeRepoWithSdd(FINISHED);
    setWorkspaceTime(cwd, FINISHED_AT);
    const { sdd } = sddAfter(cwd, [originLine('human', 'on passe au calendrier', FINISHED_AT + HOUR)]);
    expect(sdd()).toBeUndefined();

    // L'agent range le workspace pendant ce nouveau tour : sa dernière écriture passe après le prompt.
    setWorkspaceTime(cwd, FINISHED_AT + 2 * HOUR);

    expect(sdd()).toBeUndefined();
  });

  it('retrouve le prompt humain sorti de la fenêtre de lecture de la queue', () => {
    const cwd = makeRepoWithSdd(FINISHED);
    setWorkspaceTime(cwd, FINISHED_AT);
    const longAnswer = textLine('x'.repeat(120_000), FINISHED_AT + 2 * HOUR);

    const { sdd } = sddAfter(cwd, [originLine('human', 'on passe au calendrier', FINISHED_AT + HOUR), longAnswer]);

    expect(sdd()).toBeUndefined();
  });

  // Session réelle : 28 Mo de transcript, dernier prompt humain à plus de 2 Mo de la fin après un long tour.
  it('retrouve le prompt humain quelle que soit sa distance à la fin du transcript', () => {
    const cwd = makeRepoWithSdd(FINISHED);
    setWorkspaceTime(cwd, FINISHED_AT);
    const hugeAnswer = textLine('y'.repeat(1_500_000), FINISHED_AT + 2 * HOUR);

    const { sdd } = sddAfter(cwd, [
      originLine('human', 'lance le plan', FINISHED_AT - HOUR),
      originLine('human', 'on passe au calendrier', FINISHED_AT + HOUR),
      ...answers(3, FINISHED_AT + 2 * HOUR),
      hugeAnswer,
    ]);

    expect(sdd()).toBeUndefined();
  });

  it('recolle le prompt humain coupé entre deux blocs de lecture', () => {
    const cwd = makeRepoWithSdd(FINISHED);
    setWorkspaceTime(cwd, FINISHED_AT);
    const prompt = originLine('human', 'on passe au calendrier', FINISHED_AT + HOUR);
    // Lecture par blocs de 1 Mo depuis la fin : la limite du premier bloc tombe 50 octets avant la fin du prompt.
    const overhead = Buffer.byteLength(textLine('', FINISHED_AT + 2 * HOUR));
    const answer = textLine('x'.repeat(1024 * 1024 - 52 - overhead), FINISHED_AT + 2 * HOUR);

    const { sdd } = sddAfter(cwd, [prompt, answer]);

    expect(sdd()).toBeUndefined();
  });

  it('suit le transcript qui grandit sans perdre le prompt humain déjà trouvé', () => {
    const cwd = makeRepoWithSdd(FINISHED);
    // Le plan a encore écrit après le prompt : il reste affiché.
    setWorkspaceTime(cwd, FINISHED_AT + 2 * HOUR);
    const { transcript, sdd } = sddAfter(cwd, [
      originLine('human', 'on passe au calendrier', FINISHED_AT + HOUR),
      ...answers(1, FINISHED_AT + 3 * HOUR),
    ]);
    expect(sdd()).toBeDefined();

    appendFileSync(transcript, answers(3, FINISHED_AT + 4 * HOUR).join('\n') + '\n');
    utimesSync(transcript, new Date(NOW - 1_000), new Date(NOW - 1_000));
    expect(sdd()).toBeDefined();

    // Sa dernière écriture repasse avant le prompt, lu lors d'une lecture précédente du fichier.
    setWorkspaceTime(cwd, FINISHED_AT);
    expect(sdd()).toBeUndefined();
  });

  it('un plan fini retiré reste dans la liste des plans du dossier, pour être rouvert', () => {
    const cwd = makeRepoWithSdd(FINISHED);
    setWorkspaceTime(cwd, FINISHED_AT);

    const { session } = sddAfter(cwd, [originLine('human', 'on passe au calendrier', FINISHED_AT + HOUR)]);

    expect(session()?.sdd).toBeUndefined();
    expect(session()?.sddPlans?.map((run) => run.plan)).toEqual(['mon-plan']);
  });

  it('liste le plan courant et les anciens, du plus récent au plus ancien', () => {
    const cwd = makeRepoWithSdd(['task-1-brief.md']);
    setWorkspaceTime(cwd, FINISHED_AT);
    const old = join(cwd, '.superpowers', 'sdd', 'ancien-plan');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, 'progress.md'), '# SDD ledger — plan: plans/ancien-plan.md\n');
    utimesSync(old, new Date(FINISHED_AT - 24 * HOUR), new Date(FINISHED_AT - 24 * HOUR));

    const { session } = sddAfter(cwd, [originLine('human', 'où en est-on ?', FINISHED_AT - HOUR)]);

    expect(session()?.sdd?.plan).toBe('mon-plan');
    expect(session()?.sddPlans?.map((run) => run.plan)).toEqual(['mon-plan', 'ancien-plan']);
  });

  it('sans aucun plan, la liste est absente', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-agents-scan-plain-'));
    repos.push(cwd);

    const { session } = sddAfter(cwd, [originLine('human', 'bonjour', NOW - HOUR)]);

    expect(session()?.sddPlans).toBeUndefined();
  });
});

import { afterEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findSddRun, findSddRuns } from './sdd';
import type { SddTaskLink } from './types';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Agents qui ont reçu les fichiers de ces tâches du plan `p` (lien lu dans leur prompt par le scanner). */
function dispatched(...numbers: number[]): SddTaskLink[] {
  return numbers.map((number) => ({ plan: 'p', number }));
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-agents-sdd-'));
  created.push(dir);
  return dir;
}

/** Crée <root>/<sub?>/.superpowers/sdd/<plan>/ avec son ledger et les fichiers demandés. */
function makeWorkspace(
  root: string,
  plan: string,
  files: string[],
  options: { sub?: string; ledgerFirstLine?: string } = {},
): string {
  const base = options.sub === undefined ? root : join(root, options.sub);
  const dir = join(base, '.superpowers', 'sdd', plan);
  mkdirSync(dir, { recursive: true });
  const first = options.ledgerFirstLine ?? `# SDD ledger — plan: features/plans/${plan}.md`;
  writeFileSync(join(dir, 'progress.md'), `${first}\n\n## Mise en place\n`);
  for (const file of files) {
    writeFileSync(join(dir, file), 'contenu\n');
  }
  return dir;
}

describe('findSddRun — détection du workspace', () => {
  test('trouve le workspace à la racine du dossier de la session', () => {
    const root = makeRepo();
    const dir = makeWorkspace(root, 'mon-plan', ['task-1-brief.md']);

    expect(findSddRun(root)?.dir).toBe(dir);
  });

  test('trouve le workspace dans un sous-projet (monorepo)', () => {
    const root = makeRepo();
    const dir = makeWorkspace(root, 'tv-chart', ['task-1-brief.md'], { sub: 'chart' });

    expect(findSddRun(root)?.dir).toBe(dir);
  });

  test('ne descend pas au-delà du premier niveau de sous-dossier', () => {
    const root = makeRepo();
    makeWorkspace(root, 'trop-loin', ['task-1-brief.md'], { sub: join('a', 'b') });

    expect(findSddRun(root)).toBeUndefined();
  });

  // Les noms placent volontairement le workspace périmé en tête de l'ordre alphabétique de readdir :
  // sans tri par date, c'est lui qui serait rendu.
  test('entre plusieurs workspaces, retient le plus récemment modifié', () => {
    const root = makeRepo();
    const vieux = makeWorkspace(root, 'a-plan-fini', ['task-1-brief.md']);
    const recent = makeWorkspace(root, 'z-plan-en-cours', ['task-1-brief.md']);
    const ancien = new Date(Date.now() - 86_400_000);
    utimesSync(vieux, ancien, ancien);

    expect(findSddRun(root)?.dir).toBe(recent);
  });

  test('rend le nom du plan, qui est celui du dossier du workspace', () => {
    const root = makeRepo();
    makeWorkspace(root, '2026-09-16-tv-chart-abonnes', ['task-1-brief.md']);

    expect(findSddRun(root)?.plan).toBe('2026-09-16-tv-chart-abonnes');
  });

  test("ignore un dossier sans progress.md : ce n'est pas un workspace SDD", () => {
    const root = makeRepo();
    const dir = join(root, '.superpowers', 'sdd', 'sans-ledger');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'task-1-brief.md'), 'contenu\n');

    expect(findSddRun(root)).toBeUndefined();
  });

  test('rend undefined quand le dossier de la session est introuvable', () => {
    expect(findSddRun(join(tmpdir(), 'dossier-qui-nexiste-pas-claude-agents'))).toBeUndefined();
  });
});

describe('findSddRuns — tous les plans du dossier', () => {
  const DAY = 86_400_000;

  function age(dir: string, days: number): void {
    const at = new Date(Date.now() - days * DAY);
    utimesSync(dir, at, at);
  }

  test('liste les plans de la racine et des sous-projets, du plus récent au plus ancien', () => {
    const root = makeRepo();
    age(makeWorkspace(root, 'ancien', ['task-1-brief.md']), 3);
    age(makeWorkspace(root, 'recent', ['task-1-brief.md'], { sub: 'front' }), 1);
    age(makeWorkspace(root, 'milieu', ['task-1-brief.md']), 2);

    expect(findSddRuns(root).map((run) => run.plan)).toEqual(['recent', 'milieu', 'ancien']);
  });

  test('le plan courant est le plus récent de tous, où qu’il soit', () => {
    const root = makeRepo();
    age(makeWorkspace(root, 'a-la-racine', ['task-1-brief.md']), 2);
    age(makeWorkspace(root, 'dans-le-front', ['task-1-brief.md'], { sub: 'front' }), 1);

    expect(findSddRun(root)?.plan).toBe('dans-le-front');
  });

  // Ancien format du skill : un ledger posé directement dans .superpowers/sdd/, sans dossier ni nom de plan.
  test('ignore le ledger à plat de l’ancien format', () => {
    const root = makeRepo();
    const flat = join(root, '.superpowers', 'sdd');
    mkdirSync(flat, { recursive: true });
    writeFileSync(join(flat, 'progress.md'), 'Task 1: complete\n');
    writeFileSync(join(flat, 'task-1-brief.md'), 'contenu\n');

    expect(findSddRuns(root)).toEqual([]);
  });

  test('aucun plan : liste vide', () => {
    expect(findSddRuns(makeRepo())).toEqual([]);
  });
});

describe('findSddRun — état des tâches, déduit des fichiers', () => {
  test('la plus haute tâche lancée est en cours, celles du dessous sont terminées', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', [
      'task-1-brief.md',
      'task-1-report.md',
      'task-1-review.md',
      'task-2-brief.md',
      'task-2-report.md',
      'task-3-brief.md',
    ]);

    const run = findSddRun(root, dispatched(3));

    expect(run?.tasks.map((task) => [task.number, task.state])).toEqual([
      [1, 'done'],
      [2, 'done'],
      [3, 'doing'],
    ]);
  });

  test('une seule tâche lancée est en cours, aucune terminée', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md']);

    const run = findSddRun(root, dispatched(1));

    expect(run?.tasks.map((task) => task.state)).toEqual(['doing']);
    expect(run?.doneCount).toBe(0);
  });

  test('compte les tâches terminées', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md', 'task-3-brief.md']);

    expect(findSddRun(root, dispatched(3))?.doneCount).toBe(2);
  });

  // Cas réel : un contrôleur a extrait les 7 briefs de son plan d'un coup, avant le premier agent.
  test('un brief préparé d’avance ne lance pas sa tâche', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', [
      'task-1-brief.md',
      'task-1-report.md',
      'task-2-brief.md',
      'task-3-brief.md',
      'task-4-brief.md',
    ]);

    const run = findSddRun(root);

    expect(run?.tasks.map((task) => task.state)).toEqual(['review', 'pending', 'pending', 'pending']);
    expect(run?.doneCount).toBe(0);
  });

  test('sans travail rendu ni agent, aucune tâche n’est lancée', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md']);

    expect(findSddRun(root)?.tasks.map((task) => task.state)).toEqual(['pending', 'pending']);
  });

  test.each([['task-2-review.md'], ['task-2-fix-1.md']])('%s prouve aussi que la tâche a été lancée', (name) => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md', name, 'task-3-brief.md']);

    expect(findSddRun(root)?.tasks.map((task) => task.state)).toEqual(['done', 'doing', 'pending']);
  });

  test('un agent rattaché à une tâche d’un autre plan ne lance rien ici', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md']);

    expect(findSddRun(root, [{ plan: 'autre', number: 2 }])?.tasks.map((task) => task.state)).toEqual([
      'pending',
      'pending',
    ]);
  });

  test('un workspace sans brief ne porte aucune tâche', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', []);

    expect(findSddRun(root)?.tasks).toEqual([]);
  });

  test('rapporte les artefacts présents, sans les interpréter', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-1-report.md', 'task-2-brief.md']);

    const [first, second] = findSddRun(root)?.tasks ?? [];

    expect(first).toMatchObject({ number: 1, brief: true, report: true, review: false });
    expect(second).toMatchObject({ number: 2, brief: true, report: false, review: false });
  });

  test('retient la dernière ronde de correction présente', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', [
      'task-1-brief.md',
      'task-1-fix-1.md',
      'task-1-fix-1-report.md',
      'task-1-fix-2.md',
      'task-2-brief.md',
    ]);

    expect(findSddRun(root)?.tasks[0]?.fixRound).toBe(2);
  });

  test('aucune ronde de correction : le champ est absent', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md']);

    expect(findSddRun(root)?.tasks[0]?.fixRound).toBeUndefined();
  });

  test('trie les tâches par numéro, pas par ordre alphabétique des fichiers', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-10-brief.md', 'task-2-brief.md', 'task-1-brief.md']);

    expect(findSddRun(root)?.tasks.map((task) => task.number)).toEqual([1, 2, 10]);
  });
});

describe('findSddRun — achèvement attesté par le ledger', () => {
  test('le marqueur canonique du skill termine une tâche que les fichiers laisseraient en cours', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md']);
    writeFileSync(
      join(root, '.superpowers', 'sdd', 'p', 'progress.md'),
      '# SDD ledger — plan: features/plans/p.md\n\n## Fin\n\nTask 1: complete\nTask 2: complete\n',
    );

    const run = findSddRun(root);

    expect(run?.tasks.map((task) => task.state)).toEqual(['done', 'done']);
    expect(run?.doneCount).toBe(2);
  });

  test('la dernière tâche du plan, attestée au ledger, ferme le compteur', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md']);
    writeFileSync(
      join(root, '.superpowers', 'sdd', 'p', 'progress.md'),
      '# SDD ledger — plan: features/plans/p.md\nTask 1: complete\nTask 2: complete\n',
    );
    writePlan(root, join('features', 'plans', 'p.md'), '## Tâche 1 : A\n## Tâche 2 : B\n');

    const run = findSddRun(root);

    expect(run?.doneCount).toBe(2);
    expect(run?.totalCount).toBe(2);
  });

  test('un marqueur en tête de puce compte aussi', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md']);
    writeFileSync(
      join(root, '.superpowers', 'sdd', 'p', 'progress.md'),
      '# SDD ledger — plan: features/plans/p.md\n- Task 1: complete\n',
    );

    expect(findSddRun(root)?.tasks[0]?.state).toBe('done');
  });

  test('« parked » et « minor (deferred) » n’attestent aucun achèvement', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md']);
    writeFileSync(
      join(root, '.superpowers', 'sdd', 'p', 'progress.md'),
      '# SDD ledger — plan: features/plans/p.md\nTask 1: parked — rien\nTask 1: minor (deferred): rien\n',
    );

    expect(findSddRun(root)?.tasks[0]?.state).not.toBe('done');
  });

  test('un ledger en prose n’atteste rien : la règle des fichiers reste seule', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md']);
    writeFileSync(
      join(root, '.superpowers', 'sdd', 'p', 'progress.md'),
      '# SDD ledger — plan: features/plans/p.md\n\n## Tâche 2 — ronde 1 terminée. Tâche COMPLETE.\n',
    );

    expect(findSddRun(root, dispatched(2))?.tasks.map((task) => task.state)).toEqual(['done', 'doing']);
  });
});

describe('findSddRun — revue finale', () => {
  // Le skill ne dispatche la revue finale qu'une fois qu'il ne reste aucune tâche : sa présence
  // prouve que toutes les tâches du plan sont terminées, y compris la dernière.
  test('un fichier de revue finale termine toutes les tâches du plan', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', [
      'task-1-brief.md',
      'task-2-brief.md',
      'task-3-brief.md',
      'task-3-report.md',
      'revue-finale-front.md',
    ]);
    writePlan(root, join('features', 'plans', 'p.md'), '## Tâche 1 : A\n## Tâche 2 : B\n## Tâche 3 : C\n');

    const run = findSddRun(root);

    expect(run?.tasks.map((task) => task.state)).toEqual(['done', 'done', 'done']);
    expect(run?.doneCount).toBe(3);
    expect(run?.finalReview).toBe(true);
  });

  test.each(['final-review.md', 'review-final-api.md', 'Revue_Finale.md'])('reconnaît %s', (name) => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', name]);

    expect(findSddRun(root)?.finalReview).toBe(true);
  });

  test.each(['task-12-review-final.md', 'review-finalisation.md', 'finaliser-review.md'])(
    'ne prend pas %s pour une revue finale',
    (name) => {
      const root = makeRepo();
      makeWorkspace(root, 'p', ['task-1-brief.md', name]);

      expect(findSddRun(root)?.finalReview).toBe(false);
    },
  );

  test('sans revue finale, la dernière tâche garde son état lu sur les fichiers', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-1-report.md']);

    const run = findSddRun(root);

    expect(run?.finalReview).toBe(false);
    expect(run?.tasks[0]?.state).toBe('review');
  });
});

describe('findSddRun — dernière écriture du workspace', () => {
  const HOUR = 3_600_000;

  test('retient le ledger quand il a été écrit après le dernier fichier ajouté', () => {
    const root = makeRepo();
    const dir = makeWorkspace(root, 'p', ['task-1-brief.md']);
    const base = Date.now() - 10 * HOUR;
    utimesSync(dir, new Date(base), new Date(base));
    utimesSync(join(dir, 'progress.md'), new Date(base + HOUR), new Date(base + HOUR));

    expect(findSddRun(root)?.updatedAt).toBe(base + HOUR);
  });

  test('retient le dossier quand un fichier y a été ajouté après la dernière écriture du ledger', () => {
    const root = makeRepo();
    const dir = makeWorkspace(root, 'p', ['task-1-brief.md']);
    const base = Date.now() - 10 * HOUR;
    utimesSync(join(dir, 'progress.md'), new Date(base), new Date(base));
    utimesSync(dir, new Date(base + 2 * HOUR), new Date(base + 2 * HOUR));

    expect(findSddRun(root)?.updatedAt).toBe(base + 2 * HOUR);
  });
});

describe('findSddRun — variantes des fichiers de revue', () => {
  test.each(['task-1-review.md', 'task-1-review-2.md', 'task-1-review-acceptance.md', 'task-1-rereview-1.md'])(
    '%s compte comme une revue',
    (name) => {
      const root = makeRepo();
      makeWorkspace(root, 'p', ['task-1-brief.md', name]);

      expect(findSddRun(root)?.tasks[0]?.review).toBe(true);
    },
  );

  test('la re-revue d’une ronde de correction reste une ronde, pas une revue de tâche', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-1-fix-1-rereview.md']);

    const [task] = findSddRun(root)?.tasks ?? [];

    expect(task?.review).toBe(false);
    expect(task?.fixRound).toBe(1);
  });
});

describe('findSddRun — état de la tâche courante', () => {
  test('la tâche courante dont le rapport est rendu passe en revue', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md', 'task-2-report.md']);

    expect(findSddRun(root)?.tasks.map((task) => task.state)).toEqual(['done', 'review']);
  });

  test('la tâche courante sans rapport reste en cours', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md']);

    expect(findSddRun(root, dispatched(2))?.tasks[1]?.state).toBe('doing');
  });

  test('une tâche en revue ne compte pas comme terminée', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-1-report.md', 'task-1-review.md']);

    const run = findSddRun(root);

    expect(run?.tasks[0]?.state).toBe('review');
    expect(run?.doneCount).toBe(0);
  });
});

/** Écrit le plan que le ledger désigne, à `<racine>/<relative>`. */
function writePlan(root: string, relative: string, body: string): void {
  const filePath = join(root, relative);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, body);
}

describe('findSddRun — plan nommé par le ledger', () => {
  test('lit le total et les titres dans un plan en français', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md']);
    writePlan(
      root,
      join('features', 'plans', 'p.md'),
      '# Plan\n\n## Tâche 1 : Socle commun\n\ntexte\n\n## Tâche 2 : Endpoint bougies\n\n## Tâche 3 : Datafeed porté\n',
    );

    const run = findSddRun(root);

    expect(run?.totalCount).toBe(3);
    expect(run?.tasks.map((task) => task.title)).toEqual(['Socle commun', 'Endpoint bougies', 'Datafeed porté']);
  });

  test('lit un plan en anglais', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md']);
    writePlan(root, join('features', 'plans', 'p.md'), '## Task 1: Shared endpoint base\n\n## Task 2: Candles\n');

    const run = findSddRun(root);

    expect(run?.totalCount).toBe(2);
    expect(run?.tasks[0]?.title).toBe('Shared endpoint base');
  });

  test('les tâches du plan pas encore lancées sont à faire', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md']);
    writePlan(root, join('features', 'plans', 'p.md'), '## Tâche 1 : A\n## Tâche 2 : B\n## Tâche 3 : C\n## Tâche 4 : D\n');

    expect(findSddRun(root, dispatched(2))?.tasks.map((task) => task.state)).toEqual(['done', 'doing', 'pending', 'pending']);
  });

  test('suit un chemin de plan absolu', () => {
    const root = makeRepo();
    const planPath = join(root, 'ailleurs', 'plan.md');
    makeWorkspace(root, 'p', ['task-1-brief.md'], { ledgerFirstLine: `# SDD ledger — plan: ${planPath}` });
    writePlan(root, join('ailleurs', 'plan.md'), '## Tâche 1 : A\n## Tâche 2 : B\n');

    expect(findSddRun(root)?.totalCount).toBe(2);
  });

  test('plan introuvable : ni total ni titres, et aucune tâche inventée', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md']);

    const run = findSddRun(root);

    expect(run?.totalCount).toBeUndefined();
    expect(run?.tasks.map((task) => task.title)).toEqual([undefined, undefined]);
    expect(run?.tasks).toHaveLength(2);
  });

  test("ledger sans ligne d'identité : aucun plan cherché", () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md'], { ledgerFirstLine: '# Notes en vrac' });
    writePlan(root, join('features', 'plans', 'p.md'), '## Tâche 1 : A\n## Tâche 2 : B\n');

    expect(findSddRun(root)?.totalCount).toBeUndefined();
  });

  test('un plan qui compte moins de tâches que le disque ne tronque pas les tâches lancées', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md', 'task-2-brief.md', 'task-3-brief.md']);
    writePlan(root, join('features', 'plans', 'p.md'), '## Tâche 1 : A\n## Tâche 2 : B\n');

    expect(findSddRun(root)?.tasks.map((task) => task.number)).toEqual([1, 2, 3]);
  });

  // Deux plans réels, deux formes : « ## Tâche N : Titre » et, quand les tâches sont imbriquées
  // sous une section « ## Tâches », « ### Tâche N — Titre ».
  test('lit des tâches en en-tête de niveau trois', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md']);
    writePlan(root, join('features', 'plans', 'p.md'), '## Tâches\n\n### Tâche 1 : A\n\n### Tâche 2 : B\n');

    expect(findSddRun(root)?.totalCount).toBe(2);
  });

  test('accepte le tiret cadratin comme séparateur du titre', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md']);
    writePlan(root, join('features', 'plans', 'p.md'), '### Tâche 1 — `parseBp` réel et strict\n### Tâche 2 — Moteur\n');

    const run = findSddRun(root);

    expect(run?.totalCount).toBe(2);
    expect(run?.tasks[0]?.title).toBe('`parseBp` réel et strict');
  });

  test("ignore les en-têtes trop profonds pour être ceux d'une tâche", () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md']);
    writePlan(root, join('features', 'plans', 'p.md'), '## Tâche 1 : A\n#### Tâche 2 : note interne\n');

    expect(findSddRun(root)?.totalCount).toBe(1);
  });

  test('un numéro répété ne compte qu’une fois', () => {
    const root = makeRepo();
    makeWorkspace(root, 'p', ['task-1-brief.md']);
    writePlan(root, join('features', 'plans', 'p.md'), '## Tâche 1 : A\n## Tâche 2 : B\n### Tâche 2 : rappel\n');

    expect(findSddRun(root)?.totalCount).toBe(2);
  });
});

/**
 * Run subagent-driven-development (skill du plugin superpowers) lu sur le disque.
 *
 * Le SDD ne passe pas par TodoWrite : il tient ses tâches en fichiers, dans un workspace par plan
 * (`<racine du dépôt>/.superpowers/sdd/<nom du plan>/`) — ledger `progress.md`, puis `task-N-brief.md`,
 * `task-N-report.md`, `task-N-review.md` et les rondes de correction. Ce module ne lit que ces faits.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SddRun, SddTask, SddTaskLink, SddTaskState } from './types';

const LEDGER = 'progress.md';

/** Ligne d'identité que le skill impose au ledger : `# SDD ledger — plan: <chemin>`. */
const LEDGER_IDENTITY = /^#\s+SDD ledger\b.*?\bplan:\s*(.+?)\s*$/i;

/**
 * Achèvement attesté par le contrôleur, au format du skill : « Task <N>: complete ».
 * `Task <N>: parked …` et `Task <N>: minor (deferred) …` partagent le préfixe sans rien attester.
 */
const LEDGER_COMPLETE = /^[ \t]*(?:[-*][ \t]+)?Task[ \t]+(\d+)[ \t]*:[ \t]*complete\b/gim;

/**
 * En-tête de tâche d'un plan. Les plans réels varient sur deux axes : le niveau (`##` quand les tâches
 * sont des sections de premier rang, `###` quand elles sont imbriquées sous un « ## Tâches ») et le
 * séparateur du titre (deux-points ou tiret). La langue varie aussi — le skill écrit en anglais.
 */
const PLAN_TASK = /^#{2,3}[ \t]+(?:T[âa]che|Task)[ \t]+(\d+)[ \t]*[:—–-][ \t]*(.+?)[ \t]*$/gm;

const BRIEF = /^task-(\d+)-brief\.md$/;
const REPORT = /^task-(\d+)-report\.md$/;
/** `task-N-review.md` et ses variantes réelles : `-review-2`, `-review-acceptance`, `-rereview-1`… */
const REVIEW = /^task-(\d+)-(?:re)?review(?:-[^.]+)?\.md$/;
/** `task-N-fix-K.md` et ses satellites `-report` / `-rereview`. */
const FIX = /^task-(\d+)-fix-(\d+)(?:-report|-rereview)?\.md$/;

/**
 * Revue finale de la branche (`revue-finale-front.md`, `final-review.md`…), jamais préfixée par `task-`.
 * Le skill ne la dispatche qu'une fois qu'il ne reste aucune tâche : sa présence prouve le plan fini.
 */
const FINAL_REVIEW =
  /^(?!task-).*?(?:(?<![a-zà-ÿ])(?:revue|review)[-_]finale?|(?<![a-zà-ÿ])finale?[-_](?:revue|review))(?![a-zà-ÿ])/i;

interface Artifacts {
  brief: boolean;
  report: boolean;
  review: boolean;
  fixRound?: number;
}

function noArtifacts(): Artifacts {
  return { brief: false, report: false, review: false };
}

function artifactsByTask(fileNames: string[]): Map<number, Artifacts> {
  const byTask = new Map<number, Artifacts>();
  const at = (number: number): Artifacts => {
    const existing = byTask.get(number);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = noArtifacts();
    byTask.set(number, fresh);
    return fresh;
  };
  for (const name of fileNames) {
    const brief = BRIEF.exec(name);
    if (brief) {
      at(Number(brief[1])).brief = true;
      continue;
    }
    const report = REPORT.exec(name);
    if (report) {
      at(Number(report[1])).report = true;
      continue;
    }
    const review = REVIEW.exec(name);
    if (review) {
      at(Number(review[1])).review = true;
      continue;
    }
    const fix = FIX.exec(name);
    if (fix) {
      const task = at(Number(fix[1]));
      task.fixRound = Math.max(task.fixRound ?? 0, Number(fix[2]));
    }
  }
  return byTask;
}

/**
 * Une tâche sous la tâche courante est terminée parce que le SDD ne dispatche N+1 qu'après avoir porté
 * l'achèvement de N au ledger — règle tirée de son graphe de flux, indépendante de la langue du ledger.
 * La tâche courante, elle, passe « en revue » dès son rapport rendu : c'est tout ce qu'on peut dire de
 * la dernière tâche d'un plan, qu'aucune tâche suivante ne viendra jamais faire basculer.
 */
function stateOf(
  number: number,
  current: number | undefined,
  artifacts: Artifacts,
  completed: ReadonlySet<number>,
  finalReview: boolean,
): SddTaskState {
  if (finalReview || completed.has(number)) {
    return 'done';
  }
  if (current === undefined || number > current) {
    return 'pending';
  }
  if (number < current) {
    return 'done';
  }
  return artifacts.report ? 'review' : 'doing';
}

/**
 * Tâches lancées : un travail rendu (rapport, revue, ronde de correction) ou un agent qui a reçu leurs fichiers.
 * Pas le brief seul — un contrôleur peut extraire ceux de tout le plan avant de dispatcher le premier agent.
 */
function startedTasks(byTask: Map<number, Artifacts>, dispatched: ReadonlySet<number>): number[] {
  const worked = [...byTask.entries()]
    .filter(([, artifacts]) => artifacts.report || artifacts.review || artifacts.fixRound !== undefined)
    .map(([number]) => number);
  return [...new Set([...worked, ...dispatched])];
}

function tasksFrom(
  fileNames: string[],
  titles: Map<number, string>,
  completed: ReadonlySet<number>,
  finalReview: boolean,
  dispatched: ReadonlySet<number>,
): SddTask[] {
  const byTask = artifactsByTask(fileNames);
  const briefed = [...byTask.entries()].filter(([, artifacts]) => artifacts.brief).map(([number]) => number);
  const started = startedTasks(byTask, dispatched);
  const current = started.length > 0 ? Math.max(...started) : undefined;
  const numbers = [...new Set([...briefed, ...started, ...titles.keys()])].sort((a, b) => a - b);
  return numbers.map((number) => {
    const artifacts = byTask.get(number) ?? noArtifacts();
    const title = titles.get(number);
    return {
      number,
      state: stateOf(number, current, artifacts, completed, finalReview),
      brief: artifacts.brief,
      report: artifacts.report,
      review: artifacts.review,
      ...(artifacts.fixRound !== undefined ? { fixRound: artifacts.fixRound } : {}),
      ...(title !== undefined ? { title } : {}),
    };
  });
}

interface Workspace {
  dir: string;
  /** Date du dossier : bouge à chaque artefact déposé. */
  dirMtimeMs: number;
  /** Dernière écriture : un artefact déposé ou une entrée ajoutée au ledger. */
  updatedAt: number;
}

/**
 * Workspaces (dossiers portant un ledger) sous `<base>/.superpowers/sdd/`. Le ledger à plat de l'ancien format
 * (`sdd/progress.md`, sans dossier ni nom de plan) n'en est pas un : son stat `progress.md/progress.md` échoue.
 */
function workspacesIn(base: string): Workspace[] {
  const sddRoot = path.join(base, '.superpowers', 'sdd');
  let names: string[];
  try {
    names = fs.readdirSync(sddRoot);
  } catch {
    return [];
  }
  const found: Workspace[] = [];
  for (const name of names) {
    const dir = path.join(sddRoot, name);
    try {
      const ledgerMtimeMs = fs.statSync(path.join(dir, LEDGER)).mtimeMs;
      const dirMtimeMs = fs.statSync(dir).mtimeMs;
      found.push({ dir, dirMtimeMs, updatedAt: Math.max(dirMtimeMs, ledgerMtimeMs) });
    } catch {
      // Pas de ledger (ce n'est pas un workspace SDD), ou dossier disparu entre le readdir et le stat.
    }
  }
  return found;
}

function fileNamesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

interface Cached<T> {
  mtimeMs: number;
  value: T;
}

/** Fichier parsé une fois puis mémorisé jusqu'à son prochain changement : ledger et plan pèsent des centaines de kilo-octets. */
function readCached<T>(filePath: string, cache: Map<string, Cached<T>>, parse: (text: string) => T): T | undefined {
  let mtimeMs: number;
  let text: string;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.value;
    }
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
  const value = parse(text);
  cache.set(filePath, { mtimeMs, value });
  return value;
}

/** Faits lus dans le ledger : le plan qu'il nomme, et les tâches dont il atteste l'achèvement. */
interface LedgerFacts {
  planPath?: string;
  completed: Set<number>;
}

const ledgerCache = new Map<string, Cached<LedgerFacts>>();
const planTitlesCache = new Map<string, Cached<Map<number, string>>>();

/**
 * Le plan est nommé par la première ligne du ledger ; un chemin relatif se lit depuis la racine du dépôt,
 * que le workspace situe exactement trois niveaux plus haut. Les marqueurs d'achèvement sont pris partout.
 */
function parseLedger(text: string, workspaceDir: string): LedgerFacts {
  const firstLine = (text.split('\n', 1)[0] ?? '').replace(/\r$/, '');
  const named = LEDGER_IDENTITY.exec(firstLine)?.[1];
  const repoRoot = path.resolve(workspaceDir, '..', '..', '..');
  const completed = new Set<number>();
  for (const match of text.matchAll(LEDGER_COMPLETE)) {
    completed.add(Number(match[1]));
  }
  return {
    ...(named === undefined ? {} : { planPath: path.isAbsolute(named) ? named : path.join(repoRoot, named) }),
    completed,
  };
}

function readLedger(workspaceDir: string): LedgerFacts {
  const ledgerPath = path.join(workspaceDir, LEDGER);
  return readCached(ledgerPath, ledgerCache, (text) => parseLedger(text, workspaceDir)) ?? { completed: new Set() };
}

/** Titres des tâches du plan, par numéro. Vide quand le plan est introuvable ou muet. */
function planTitles(planPath: string | undefined): Map<number, string> {
  if (planPath === undefined) {
    return new Map();
  }
  const parse = (text: string): Map<number, string> => {
    const titles = new Map<number, string>();
    for (const match of text.matchAll(PLAN_TASK)) {
      titles.set(Number(match[1]), match[2]);
    }
    return titles;
  };
  return readCached(planPath, planTitlesCache, parse) ?? new Map();
}

/** Vide les caches du module (tests, et rechargement de la vue). */
export function resetSddCaches(): void {
  planTitlesCache.clear();
  ledgerCache.clear();
}

/** Sous-dossiers directs du dossier de la session : un monorepo range le workspace dans un sous-projet. */
function subdirectories(cwd: string): string[] {
  try {
    return fs
      .readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(cwd, entry.name));
  } catch {
    return [];
  }
}

function runOf({ dir, updatedAt }: Workspace, dispatched: readonly SddTaskLink[]): SddRun {
  const plan = path.basename(dir);
  const ledger = readLedger(dir);
  const titles = planTitles(ledger.planPath);
  const fileNames = fileNamesIn(dir);
  const finalReview = fileNames.some((name) => FINAL_REVIEW.test(name));
  const ownDispatched = new Set(dispatched.filter((link) => link.plan === plan).map((link) => link.number));
  const tasks = tasksFrom(fileNames, titles, ledger.completed, finalReview, ownDispatched);
  return {
    dir,
    plan,
    tasks,
    doneCount: tasks.filter((task) => task.state === 'done').length,
    finalReview,
    updatedAt,
    ...(titles.size > 0 ? { totalCount: titles.size } : {}),
  };
}

/**
 * Plans du dossier de la session, à sa racine et dans ses sous-dossiers directs, du plus récent au plus ancien.
 * Un plan livré laisse souvent son workspace derrière lui : la date du dossier départage, le nom ne dit rien.
 * `dispatched` : tâches dont un agent de la session a reçu les fichiers (lien lu dans son prompt).
 */
export function findSddRuns(cwd: string, dispatched: readonly SddTaskLink[] = []): SddRun[] {
  return [cwd, ...subdirectories(cwd)]
    .flatMap(workspacesIn)
    .sort((a, b) => b.dirMtimeMs - a.dirMtimeMs)
    .map((workspace) => runOf(workspace, dispatched));
}

/** Plan courant : le plus récent du dossier. */
export function findSddRun(cwd: string, dispatched: readonly SddTaskLink[] = []): SddRun | undefined {
  return findSddRuns(cwd, dispatched)[0];
}

/** Fichier d'une tâche dans un workspace, tel que le contrôleur le passe à ses agents, en chemin absolu ou relatif. */
const TASK_FILE_PATH = /\.superpowers[\\/]+sdd[\\/]+([^\\/\s`'"]+)[\\/]+task-(\d+)-[^\\/\s`'"]*\.md/g;

/** Tâche dont un prompt d'agent nomme les fichiers ; aucune s'il n'en nomme pas, ou s'il nomme ceux de plusieurs tâches. */
export function sddTaskOfPrompt(prompt: string): SddTaskLink | undefined {
  const tasks = new Map<string, SddTaskLink>();
  for (const [, plan, number] of prompt.matchAll(TASK_FILE_PATH)) {
    tasks.set(`${plan}/${number}`, { plan, number: Number(number) });
  }
  return tasks.size === 1 ? [...tasks.values()][0] : undefined;
}

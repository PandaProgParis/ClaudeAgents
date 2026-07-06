# Claude Agents — Plan d'implémentation de la vue arbre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extension VSCode affichant en vue arbre native toutes les sessions Claude Code en cours de la machine, avec leurs agents et sous-agents, rafraîchie toutes les 2 s.

**Architecture:** Trois couches : `scanner.ts` (logique pure de scan de `~/.claude`, testable sans VSCode), `labels.ts`/`format.ts` (construction pure des textes affichés), `treeProvider.ts` + `extension.ts` (couche VSCode fine : TreeDataProvider, polling, watcher). Spec de référence : `docs/superpowers/specs/2026-07-03-claude-agents-tree-design.md`.

**Tech Stack:** TypeScript strict, esbuild (bundle), vitest (tests unitaires), @vscode/vsce (packaging). Zéro dépendance runtime.

## Global Constraints

- Textes d'interface en **français** (« Aucune session Claude en cours. », « terminé », « actif »…).
- **Aucune dépendance runtime** : uniquement l'API VSCode et les modules Node (`fs`, `path`, `os`).
- **Jamais d'écriture** dans `~/.claude` — lecture seule, on ne supprime pas les fichiers périmés.
- **Lectures bornées** des transcripts : 8 Ko en tête (description), 16 Ko en queue (modèle). Jamais de lecture complète.
- Seuils : actif si `mtime` < **30 s** ; polling **2 s** ; rétention des agents terminés **60 s** par défaut.
- Settings : `claudeAgents.showFinishedAgents` (`always`|`temporarily`|`never`, défaut `temporarily`) et `claudeAgents.finishedAgentRetentionSeconds` (défaut `60`).
- Encodage répertoire projet : `cwd.replace(/[^a-zA-Z0-9]/g, '-')`, correspondance **insensible à la casse**.
- Chemins toujours construits via `path.join` (Windows d'abord, mais portable).
- TypeScript `strict: true` ; `engines.vscode: ^1.90.0` ; `@types/vscode@1.90.0` exactement (vsce refuse un `@types/vscode` plus récent que `engines`).
- Un commit par tâche, message en français, terminé par `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Toutes les commandes s'exécutent depuis `c:\Users\cyril\Documents\Developpement\PANDAPROG\ClaudeAgents`.

---

### Task 1: Scaffolding du projet

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.mjs`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.vscodeignore`
- Create: `assets/icon.svg`
- Create: `README.md`
- Create: `src/extension.ts` (stub)

**Interfaces:**
- Consumes: rien.
- Produces: un projet qui compile (`npm run build` → `dist/extension.js`, `npm run typecheck` passe), avec les settings `claudeAgents.*` déclarés dans le manifeste. Les tâches suivantes créent des fichiers sous `src/` sans retoucher ce scaffolding.

- [ ] **Step 1: Créer `package.json`**

```json
{
  "name": "claude-agents",
  "displayName": "Claude Agents",
  "description": "Vue arbre des sessions, agents et sous-agents Claude Code en cours",
  "version": "0.1.0",
  "publisher": "pandaprog",
  "private": true,
  "license": "MIT",
  "engines": {
    "vscode": "^1.90.0"
  },
  "categories": ["Other"],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "claude-agents",
          "title": "Claude Agents",
          "icon": "assets/icon.svg"
        }
      ]
    },
    "views": {
      "claude-agents": [
        {
          "id": "claudeAgentsTree",
          "name": "Sessions"
        }
      ]
    },
    "viewsWelcome": [
      {
        "view": "claudeAgentsTree",
        "contents": "Aucune session Claude en cours."
      }
    ],
    "configuration": {
      "title": "Claude Agents",
      "properties": {
        "claudeAgents.showFinishedAgents": {
          "type": "string",
          "enum": ["always", "temporarily", "never"],
          "default": "temporarily",
          "markdownDescription": "Affichage des agents terminés : `always` (toujours visibles, grisés), `temporarily` (masqués après le délai de rétention), `never` (agents actifs uniquement)."
        },
        "claudeAgents.finishedAgentRetentionSeconds": {
          "type": "number",
          "default": 60,
          "minimum": 0,
          "markdownDescription": "Délai (en secondes depuis la dernière activité) avant masquage d'un agent terminé, en mode `temporarily`."
        }
      }
    }
  },
  "scripts": {
    "build": "node esbuild.mjs",
    "watch": "node esbuild.mjs --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "vscode:prepublish": "npm run build",
    "package": "npm run typecheck && npm run test && vsce package"
  }
}
```

- [ ] **Step 2: Créer `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Créer `esbuild.mjs`**

```js
import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

- [ ] **Step 4: Créer `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: Créer `.gitignore`**

```
node_modules/
dist/
*.vsix
```

- [ ] **Step 6: Créer `.vscodeignore`**

```
node_modules/**
src/**
docs/**
.vscode/**
.gitignore
esbuild.mjs
vitest.config.ts
tsconfig.json
*.vsix
```

- [ ] **Step 7: Créer `assets/icon.svg`** (icône monochrome de la barre d'activité — VSCode la teinte lui-même)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
  <circle cx="12" cy="5" r="2.5"/>
  <circle cx="5" cy="19" r="2.5"/>
  <circle cx="19" cy="19" r="2.5"/>
  <path d="M12 7.5v4M12 11.5l-7 5M12 11.5l7 5"/>
</svg>
```

- [ ] **Step 8: Créer `README.md`** (stub, complété en Task 9)

```markdown
# Claude Agents

Extension VSCode : vue arbre des sessions, agents et sous-agents Claude Code en cours.

En construction — voir `docs/superpowers/specs/2026-07-03-claude-agents-tree-design.md`.
```

- [ ] **Step 9: Créer `src/extension.ts`** (stub qui compile)

```ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.window.createOutputChannel('Claude Agents'));
}

export function deactivate(): void {}
```

- [ ] **Step 10: Installer les dépendances de dev**

Run: `npm install -D typescript @types/node @types/vscode@1.90.0 esbuild vitest @vscode/vsce`
Expected: `package-lock.json` créé, aucune erreur. (`@types/vscode` épinglé à 1.90.0 pour rester ≤ `engines.vscode`.)

- [ ] **Step 11: Vérifier build et typecheck**

Run: `npm run typecheck; npm run build`
Expected: typecheck sans erreur ; `dist/extension.js` créé.

- [ ] **Step 12: Commit**

```powershell
git add -A
git commit -m @'
chore: scaffolding de l'extension VSCode Claude Agents

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 2: Modèle de données et formatage (`types.ts`, `format.ts`)

**Files:**
- Create: `src/types.ts`
- Create: `src/format.ts`
- Test: `src/format.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - Types : `SessionRegistryEntry`, `AgentStatus`, `AgentNode`, `WorkflowNode`, `SessionNode`, `ProjectNode`, `FinishedAgentSettings` (formes exactes ci-dessous, utilisées par toutes les tâches suivantes).
  - `formatDuration(deltaMs: number): string` — « 12 s », « 2 min », « 1 h 5 min ».
  - `formatRelativeTime(deltaMs: number): string` — « il y a 12 s ».
  - `abbreviateModel(model: string): string` — « claude-fable-5 » → « fable ».

- [ ] **Step 1: Créer `src/types.ts`**

```ts
export interface SessionRegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  name?: string;
  kind?: string;
  entrypoint?: string;
  version?: string;
}

export type AgentStatus = 'active' | 'finished';

export interface AgentNode {
  id: string;
  filePath: string;
  status: AgentStatus;
  lastActivity: number;
  createdAt: number;
  description?: string;
  model?: string;
}

export interface WorkflowNode {
  id: string;
  agents: AgentNode[];
  finishedCount: number;
  totalCount: number;
}

export interface SessionNode {
  sessionId: string;
  pid: number;
  cwd: string;
  name: string;
  startedAt: number;
  active: boolean;
  lastActivity?: number;
  model?: string;
  agents: AgentNode[];
  workflows: WorkflowNode[];
}

export interface ProjectNode {
  cwd: string;
  name: string;
  hasActiveSession: boolean;
  sessions: SessionNode[];
}

export interface FinishedAgentSettings {
  mode: 'always' | 'temporarily' | 'never';
  retentionSeconds: number;
}
```

- [ ] **Step 2: Écrire les tests qui échouent (`src/format.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { abbreviateModel, formatDuration, formatRelativeTime } from './format';

describe('formatDuration', () => {
  it('affiche les secondes sous la minute', () => {
    expect(formatDuration(12_000)).toBe('12 s');
  });

  it('affiche les minutes entières sous l’heure', () => {
    expect(formatDuration(150_000)).toBe('2 min');
  });

  it('affiche heures et minutes', () => {
    expect(formatDuration(3_900_000)).toBe('1 h 5 min');
  });

  it('affiche les heures rondes sans minutes', () => {
    expect(formatDuration(7_200_000)).toBe('2 h');
  });

  it('plancher à zéro pour les deltas négatifs', () => {
    expect(formatDuration(-5_000)).toBe('0 s');
  });
});

describe('formatRelativeTime', () => {
  it('préfixe avec « il y a »', () => {
    expect(formatRelativeTime(120_000)).toBe('il y a 2 min');
  });
});

describe('abbreviateModel', () => {
  it('réduit un id de modèle Claude à sa famille', () => {
    expect(abbreviateModel('claude-fable-5')).toBe('fable');
    expect(abbreviateModel('claude-opus-4-8')).toBe('opus');
    expect(abbreviateModel('claude-haiku-4-5-20251001')).toBe('haiku');
  });

  it('prend le premier segment pour un id inconnu', () => {
    expect(abbreviateModel('gpt-x')).toBe('gpt');
  });
});
```

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module './format'` (ou équivalent).

- [ ] **Step 4: Créer `src/format.ts`**

```ts
export function formatDuration(deltaMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(deltaMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function formatRelativeTime(deltaMs: number): string {
  return `il y a ${formatDuration(deltaMs)}`;
}

export function abbreviateModel(model: string): string {
  return model.replace(/^claude-/, '').split('-')[0];
}
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `npm test`
Expected: PASS (8 tests).

- [ ] **Step 6: Typecheck puis commit**

Run: `npm run typecheck`
Expected: aucune erreur.

```powershell
git add src/types.ts src/format.ts src/format.test.ts
git commit -m @'
feat: modele de donnees et formatage des durees et modeles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 3: Scanner — registre des sessions, vivacité PID, regroupement par projet

**Files:**
- Create: `src/scanner.ts`
- Create: `src/__tests__/helpers.ts`
- Test: `src/__tests__/scanner.test.ts`

**Interfaces:**
- Consumes: types de `src/types.ts`.
- Produces:
  - `interface ScanOptions { claudeDir: string; now?: number; isPidAlive?: (pid: number) => boolean; activeThresholdMs?: number; log?: (message: string) => void }`
  - `scan(options: ScanOptions): ProjectNode[]` — point d'entrée unique du scan, enrichi par les Tasks 4 et 5.
  - `defaultIsPidAlive(pid: number): boolean`
  - Helpers de test : `NOW`, `makeClaudeDir()`, `cleanupClaudeDirs()`, `writeRegistry()`, `touch()` (enrichis en Task 4).

- [ ] **Step 1: Créer `src/__tests__/helpers.ts`**

```ts
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/** Horloge fixe injectée dans scan() — les mtimes des fixtures sont posés relativement à elle. */
export const NOW = 1_800_000_000_000;

const created: string[] = [];

/** Crée un faux ~/.claude avec sessions/ et projects/ vides. */
export function makeClaudeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-agents-test-'));
  created.push(dir);
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  mkdirSync(join(dir, 'projects'), { recursive: true });
  return dir;
}

export function cleanupClaudeDirs(): void {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Écrit un fichier de registre sessions/<pid>.json. Passer une chaîne pour un JSON corrompu. */
export function writeRegistry(claudeDir: string, entry: { pid: number } & Record<string, unknown>): void {
  writeFileSync(join(claudeDir, 'sessions', `${entry.pid}.json`), JSON.stringify(entry));
}

export function writeCorruptRegistry(claudeDir: string, fileName: string, content: string): void {
  writeFileSync(join(claudeDir, 'sessions', fileName), content);
}

/** Fixe le mtime d'un fichier à NOW - ageMs. */
export function touch(filePath: string, ageMs: number): void {
  const time = new Date(NOW - ageMs);
  utimesSync(filePath, time, time);
}
```

- [ ] **Step 2: Écrire les tests qui échouent (`src/__tests__/scanner.test.ts`)**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'path';
import { defaultIsPidAlive, scan } from '../scanner';
import { NOW, cleanupClaudeDirs, makeClaudeDir, writeCorruptRegistry, writeRegistry } from './helpers';

afterEach(cleanupClaudeDirs);

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

describe('defaultIsPidAlive', () => {
  it('reconnaît le process courant comme vivant', () => {
    expect(defaultIsPidAlive(process.pid)).toBe(true);
  });

  it('considère mort un PID improbable', () => {
    expect(defaultIsPidAlive(999_999_999)).toBe(false);
  });
});
```

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scanner'`.

- [ ] **Step 4: Créer `src/scanner.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import type { ProjectNode, SessionNode, SessionRegistryEntry } from './types';

export interface ScanOptions {
  claudeDir: string;
  now?: number;
  isPidAlive?: (pid: number) => boolean;
  activeThresholdMs?: number;
  log?: (message: string) => void;
}

type Log = (message: string) => void;

const DEFAULT_ACTIVE_THRESHOLD_MS = 30_000;

export function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = le process existe mais ne nous appartient pas
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function scan(options: ScanOptions): ProjectNode[] {
  const now = options.now ?? Date.now();
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  const activeThresholdMs = options.activeThresholdMs ?? DEFAULT_ACTIVE_THRESHOLD_MS;
  const log = options.log ?? (() => {});

  const aliveEntries = readRegistry(path.join(options.claudeDir, 'sessions'), log).filter((entry) =>
    isPidAlive(entry.pid),
  );
  const projectsRoot = path.join(options.claudeDir, 'projects');

  const projectsByCwd = new Map<string, ProjectNode>();
  for (const entry of aliveEntries) {
    const session = buildSessionNode(entry, projectsRoot, now, activeThresholdMs, log);
    const key = entry.cwd.toLowerCase();
    let project = projectsByCwd.get(key);
    if (!project) {
      project = { cwd: entry.cwd, name: path.basename(entry.cwd), hasActiveSession: false, sessions: [] };
      projectsByCwd.set(key, project);
    }
    project.sessions.push(session);
    if (session.active) {
      project.hasActiveSession = true;
    }
  }

  const projects = [...projectsByCwd.values()];
  for (const project of projects) {
    project.sessions.sort((a, b) => Number(b.active) - Number(a.active) || b.startedAt - a.startedAt);
  }
  projects.sort((a, b) => Number(b.hasActiveSession) - Number(a.hasActiveSession) || a.name.localeCompare(b.name));
  return projects;
}

function readRegistry(sessionsDir: string, log: Log): SessionRegistryEntry[] {
  let files: string[];
  try {
    files = fs.readdirSync(sessionsDir).filter((file) => file.endsWith('.json'));
  } catch {
    return [];
  }
  const entries: SessionRegistryEntry[] = [];
  for (const file of files) {
    const filePath = path.join(sessionsDir, file);
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const entry = parsed as Partial<SessionRegistryEntry>;
      if (
        typeof entry.pid === 'number' &&
        typeof entry.sessionId === 'string' &&
        typeof entry.cwd === 'string' &&
        typeof entry.startedAt === 'number'
      ) {
        entries.push(entry as SessionRegistryEntry);
      } else {
        log(`Registre ignoré (champs manquants) : ${filePath}`);
      }
    } catch (error) {
      log(`Registre illisible : ${filePath} — ${String(error)}`);
    }
  }
  return entries;
}

function buildSessionNode(
  entry: SessionRegistryEntry,
  projectsRoot: string,
  now: number,
  activeThresholdMs: number,
  log: Log,
): SessionNode {
  return {
    sessionId: entry.sessionId,
    pid: entry.pid,
    cwd: entry.cwd,
    name: entry.name ?? entry.sessionId.slice(0, 8),
    startedAt: entry.startedAt,
    active: false,
    agents: [],
    workflows: [],
  };
}
```

Note : `projectsRoot`, `now`, `activeThresholdMs` et `log` sont inutilisés dans `buildSessionNode` à ce stade — la Task 4 les exploite. Si le typecheck se plaint des paramètres inutilisés, les préfixer `_` temporairement puis retirer le préfixe en Task 4.

- [ ] **Step 5: Vérifier que les tests passent**

Run: `npm test`
Expected: PASS (tous les tests, y compris ceux de Task 2).

- [ ] **Step 6: Typecheck puis commit**

Run: `npm run typecheck`
Expected: aucune erreur.

```powershell
git add src/scanner.ts src/__tests__
git commit -m @'
feat: scan du registre des sessions avec vivacite PID et regroupement par projet

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 4: Scanner — transcript de session : activité, casse du dossier projet, extraction du modèle

**Files:**
- Modify: `src/scanner.ts` (remplace `buildSessionNode`, ajoute `encodeProjectDirName`, `findProjectDir`, `readChunk`, `extractModel`)
- Modify: `src/__tests__/helpers.ts` (ajoute `writeTranscript`, `assistantLine`, `userLine`)
- Test: `src/__tests__/scanner.test.ts` (nouveau bloc `describe`)

**Interfaces:**
- Consumes: `scan`/`ScanOptions` de Task 3, helpers de test de Task 3.
- Produces:
  - `encodeProjectDirName(cwd: string): string` (exportée pour les tests).
  - `extractModel(filePath: string): string | undefined` (exportée pour les tests).
  - `SessionNode.active`, `SessionNode.lastActivity`, `SessionNode.model` désormais renseignés.
  - Helpers : `writeTranscript(claudeDir, projectDirName, sessionId, lines, ageMs): string`, `assistantLine(model): string`, `userLine(text): string`.

- [ ] **Step 1: Ajouter les helpers dans `src/__tests__/helpers.ts`** (à la fin du fichier)

```ts
/** Ligne JSONL d'entrée assistant portant un champ model. */
export function assistantLine(model: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', model, content: [{ type: 'text', text: 'ok' }] },
  });
}

/** Ligne JSONL d'entrée user (content chaîne). */
export function userLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
}

/** Écrit projects/<projectDirName>/<sessionId>.jsonl avec le mtime NOW - ageMs. */
export function writeTranscript(
  claudeDir: string,
  projectDirName: string,
  sessionId: string,
  lines: string[],
  ageMs: number,
): string {
  const dir = join(claudeDir, 'projects', projectDirName);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${sessionId}.jsonl`);
  writeFileSync(filePath, lines.join('\n') + '\n');
  touch(filePath, ageMs);
  return filePath;
}
```

- [ ] **Step 2: Ajouter les tests qui échouent** (nouveau bloc à la fin de `src/__tests__/scanner.test.ts`)

```ts
import { assistantLine, userLine, writeTranscript } from './helpers';
// (fusionner avec l'import existant de './helpers')

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
});
```

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `npm test`
Expected: FAIL — `active` reste `false`, `lastActivity`/`model` restent `undefined`.

- [ ] **Step 4: Implémenter dans `src/scanner.ts`**

Ajouter les constantes et fonctions suivantes, et remplacer `buildSessionNode` :

```ts
const MODEL_READ_BYTES = 16 * 1024;

export function encodeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function findProjectDir(projectsRoot: string, cwd: string): string | undefined {
  const wanted = encodeProjectDirName(cwd).toLowerCase();
  let dirNames: string[];
  try {
    dirNames = fs.readdirSync(projectsRoot);
  } catch {
    return undefined;
  }
  const match = dirNames.find((name) => name.toLowerCase() === wanted);
  return match ? path.join(projectsRoot, match) : undefined;
}

/** Lit au plus maxBytes en tête ou en queue de fichier, sans jamais le charger entier. */
function readChunk(filePath: string, where: 'head' | 'tail', maxBytes: number): string | undefined {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return undefined;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    if (length === 0) {
      return '';
    }
    const position = where === 'head' ? 0 : size - length;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, position);
    return buffer.toString('utf8');
  } catch {
    return undefined;
  } finally {
    fs.closeSync(fd);
  }
}

export function extractModel(filePath: string): string | undefined {
  const tail = readChunk(filePath, 'tail', MODEL_READ_BYTES);
  if (tail === undefined) {
    return undefined;
  }
  const models = [...tail.matchAll(/"model"\s*:\s*"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((model) => model !== '<synthetic>');
  return models.length > 0 ? models[models.length - 1] : undefined;
}

function buildSessionNode(
  entry: SessionRegistryEntry,
  projectsRoot: string,
  now: number,
  activeThresholdMs: number,
  log: Log,
): SessionNode {
  const session: SessionNode = {
    sessionId: entry.sessionId,
    pid: entry.pid,
    cwd: entry.cwd,
    name: entry.name ?? entry.sessionId.slice(0, 8),
    startedAt: entry.startedAt,
    active: false,
    agents: [],
    workflows: [],
  };

  const projectDir = findProjectDir(projectsRoot, entry.cwd);
  if (!projectDir) {
    return session;
  }

  const transcriptPath = path.join(projectDir, `${entry.sessionId}.jsonl`);
  try {
    const stat = fs.statSync(transcriptPath);
    session.lastActivity = stat.mtimeMs;
    session.active = now - stat.mtimeMs < activeThresholdMs;
    session.model = extractModel(transcriptPath);
  } catch {
    // Transcript introuvable : la session reste affichée avec les infos du registre.
  }

  return session;
}
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `npm test`
Expected: PASS (tous les tests).

- [ ] **Step 6: Typecheck puis commit**

Run: `npm run typecheck`
Expected: aucune erreur.

```powershell
git add src/scanner.ts src/__tests__
git commit -m @'
feat: activite et modele des sessions depuis le transcript, casse insensible

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 5: Scanner — sous-agents, workflows et description de tâche

**Files:**
- Modify: `src/scanner.ts` (ajoute `extractDescription`, `scanAgentsDir`, `scanWorkflows` ; complète `buildSessionNode`)
- Modify: `src/__tests__/helpers.ts` (ajoute `writeAgent`)
- Test: `src/__tests__/scanner.test.ts` (nouveau bloc `describe`)

**Interfaces:**
- Consumes: `scan`, `readChunk`, types `AgentNode`/`WorkflowNode`, helpers de test.
- Produces:
  - `extractDescription(filePath: string): string | undefined` (exportée pour les tests).
  - `compareAgents(a: AgentNode, b: AgentNode): number` (exportée pour les tests) — tri par `createdAt` croissant, départage par `id`.
  - `SessionNode.agents: AgentNode[]` (agents directs, triés via `compareAgents`) et `SessionNode.workflows: WorkflowNode[]` renseignés.
  - Helper : `writeAgent(agentsDir: string, agentId: string, prompt: string, ageMs: number, model?: string): string`.

- [ ] **Step 1: Ajouter le helper dans `src/__tests__/helpers.ts`** (à la fin du fichier)

```ts
/**
 * Écrit <agentsDir>/agent-<agentId>.jsonl (première ligne = prompt user, seconde = réponse assistant)
 * avec le mtime NOW - ageMs. agentsDir est typiquement .../<sessionId>/subagents ou .../subagents/workflows/<wfId>.
 */
export function writeAgent(
  agentsDir: string,
  agentId: string,
  prompt: string,
  ageMs: number,
  model = 'claude-fable-5',
): string {
  mkdirSync(agentsDir, { recursive: true });
  const filePath = join(agentsDir, `agent-${agentId}.jsonl`);
  writeFileSync(filePath, [userLine(prompt), assistantLine(model)].join('\n') + '\n');
  touch(filePath, ageMs);
  return filePath;
}
```

- [ ] **Step 2: Ajouter les tests qui échouent** (nouveau bloc à la fin de `src/__tests__/scanner.test.ts`)

```ts
import { touch, writeAgent } from './helpers';
// (fusionner avec l'import existant de './helpers')
import { compareAgents, extractDescription } from '../scanner';
// (fusionner avec l'import existant de '../scanner')
import type { AgentNode } from '../types';
import { writeFileSync, mkdirSync } from 'fs';

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

  it('tronque une description trop longue à 60 caractères', () => {
    const dir = makeClaudeDir();
    const agentsDir = setupSession(dir);
    writeAgent(agentsDir, 'aaa', 'x'.repeat(100), 5_000);
    const [project] = scan({ claudeDir: dir, now: NOW, isPidAlive: alive });
    const description = project.sessions[0].agents[0].description ?? '';
    expect(description.length).toBe(60);
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
```

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `npm test`
Expected: FAIL — `agents` reste `[]`, `extractDescription` n'existe pas.

- [ ] **Step 4: Implémenter dans `src/scanner.ts`**

Ajouter les constantes/fonctions suivantes (les imports de types s'élargissent à `AgentNode` et `WorkflowNode`) :

```ts
import type { AgentNode, ProjectNode, SessionNode, SessionRegistryEntry, WorkflowNode } from './types';
// (remplace l'import de types existant)

const DESCRIPTION_READ_BYTES = 8 * 1024;
const DESCRIPTION_MAX_LENGTH = 60;
const AGENT_FILE_PATTERN = /^agent-[^.]+\.jsonl$/;

/** Tri chronologique de création, départage par id (le birthtime peut être identique ou absent selon les FS). */
export function compareAgents(a: AgentNode, b: AgentNode): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

export function extractDescription(filePath: string): string | undefined {
  const head = readChunk(filePath, 'head', DESCRIPTION_READ_BYTES);
  if (head === undefined) {
    return undefined;
  }
  for (const line of head.split('\n')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // ligne tronquée par la lecture bornée ou bruit
    }
    const entry = parsed as { type?: string; message?: { content?: unknown } };
    if (entry.type !== 'user') {
      continue;
    }
    const content = entry.message?.content;
    let text: string | undefined;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      const block = content.find(
        (part): part is { type: string; text: string } =>
          typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text',
      );
      text = block?.text;
    }
    if (text) {
      const firstLine = text.split('\n')[0].trim();
      return firstLine.length > DESCRIPTION_MAX_LENGTH
        ? firstLine.slice(0, DESCRIPTION_MAX_LENGTH - 1) + '…'
        : firstLine;
    }
  }
  return undefined;
}

function scanAgentsDir(dir: string, now: number, activeThresholdMs: number, log: Log): AgentNode[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((file) => AGENT_FILE_PATTERN.test(file));
  } catch {
    return [];
  }
  const agents: AgentNode[] = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const stat = fs.statSync(filePath);
      agents.push({
        id: file.replace(/\.jsonl$/, ''),
        filePath,
        status: now - stat.mtimeMs < activeThresholdMs ? 'active' : 'finished',
        lastActivity: stat.mtimeMs,
        createdAt: stat.birthtimeMs || stat.mtimeMs,
        description: extractDescription(filePath),
        model: extractModel(filePath),
      });
    } catch (error) {
      log(`Agent illisible : ${filePath} — ${String(error)}`);
    }
  }
  agents.sort(compareAgents);
  return agents;
}

function scanWorkflows(workflowsDir: string, now: number, activeThresholdMs: number, log: Log): WorkflowNode[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workflowsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const agents = scanAgentsDir(path.join(workflowsDir, entry.name), now, activeThresholdMs, log);
      return {
        id: entry.name,
        agents,
        totalCount: agents.length,
        finishedCount: agents.filter((agent) => agent.status === 'finished').length,
      };
    })
    .filter((workflow) => workflow.totalCount > 0)
    .sort((a, b) => a.agents[0].createdAt - b.agents[0].createdAt || a.id.localeCompare(b.id));
}
```

Puis, dans `buildSessionNode`, juste avant le `return session;` final (après le bloc `try` du transcript) :

```ts
  const subagentsDir = path.join(projectDir, entry.sessionId, 'subagents');
  session.agents = scanAgentsDir(subagentsDir, now, activeThresholdMs, log);
  session.workflows = scanWorkflows(path.join(subagentsDir, 'workflows'), now, activeThresholdMs, log);
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `npm test`
Expected: PASS (tous les tests).

- [ ] **Step 6: Typecheck puis commit**

Run: `npm run typecheck`
Expected: aucune erreur.

```powershell
git add src/scanner.ts src/__tests__
git commit -m @'
feat: scan des sous-agents et workflows avec description et statut

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 6: Scanner — visibilité des agents terminés (`filterVisibleAgents`)

**Files:**
- Modify: `src/scanner.ts` (ajoute `filterVisibleAgents`)
- Test: `src/__tests__/scanner.test.ts` (nouveau bloc `describe`)

**Interfaces:**
- Consumes: `AgentNode`, `FinishedAgentSettings` de `src/types.ts`.
- Produces: `filterVisibleAgents(agents: AgentNode[], settings: FinishedAgentSettings, now: number): AgentNode[]` — utilisée par `treeProvider.ts` (Task 8) pour appliquer les settings.

- [ ] **Step 1: Ajouter les tests qui échouent** (nouveau bloc à la fin de `src/__tests__/scanner.test.ts`)

```ts
import { filterVisibleAgents } from '../scanner';
// (fusionner avec l'import existant de '../scanner')
// (AgentNode est déjà importé de '../types' depuis la Task 5)

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
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `npm test`
Expected: FAIL — `filterVisibleAgents` n'existe pas.

- [ ] **Step 3: Implémenter dans `src/scanner.ts`**

Ajouter (l'import de types s'élargit à `FinishedAgentSettings`) :

```ts
import type {
  AgentNode,
  FinishedAgentSettings,
  ProjectNode,
  SessionNode,
  SessionRegistryEntry,
  WorkflowNode,
} from './types';
// (remplace l'import de types existant)

export function filterVisibleAgents(
  agents: AgentNode[],
  settings: FinishedAgentSettings,
  now: number,
): AgentNode[] {
  return agents.filter((agent) => {
    if (agent.status === 'active') {
      return true;
    }
    if (settings.mode === 'always') {
      return true;
    }
    if (settings.mode === 'never') {
      return false;
    }
    return now - agent.lastActivity < settings.retentionSeconds * 1000;
  });
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npm test`
Expected: PASS (tous les tests).

- [ ] **Step 5: Typecheck puis commit**

Run: `npm run typecheck`
Expected: aucune erreur.

```powershell
git add src/scanner.ts src/__tests__
git commit -m @'
feat: filtrage configurable des agents termines

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 7: Labels d'affichage (`labels.ts`)

**Files:**
- Create: `src/labels.ts`
- Test: `src/labels.test.ts`

**Interfaces:**
- Consumes: types de `src/types.ts`, `abbreviateModel`/`formatDuration`/`formatRelativeTime` de `src/format.ts`.
- Produces (consommées par `treeProvider.ts` en Task 8) :
  - `sessionDescription(session: SessionNode, now: number): string`
  - `agentLabel(agent: AgentNode): string`
  - `agentDescription(agent: AgentNode, now: number): string`
  - `workflowLabel(workflow: WorkflowNode): string`
  - `workflowDescription(workflow: WorkflowNode): string`

- [ ] **Step 1: Écrire les tests qui échouent (`src/labels.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { agentDescription, agentLabel, sessionDescription, workflowDescription, workflowLabel } from './labels';
import type { AgentNode, SessionNode, WorkflowNode } from './types';

const NOW = 1_800_000_000_000;

function session(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
    pid: 1,
    cwd: 'c:\\dev\\mon-projet',
    name: 'mon-projet-1',
    startedAt: NOW - 1_500_000, // 25 min
    active: true,
    lastActivity: NOW - 5_000,
    model: 'claude-fable-5',
    agents: [],
    workflows: [],
    ...overrides,
  };
}

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

describe('sessionDescription', () => {
  it('session active : modèle et démarrage', () => {
    expect(sessionDescription(session(), NOW)).toBe('fable · démarrée il y a 25 min');
  });

  it('session inactive : modèle et inactivité', () => {
    expect(sessionDescription(session({ active: false, lastActivity: NOW - 2_400_000 }), NOW)).toBe(
      'fable · inactive depuis 40 min',
    );
  });

  it('session sans transcript : repli sur le démarrage', () => {
    expect(sessionDescription(session({ active: false, lastActivity: undefined, model: undefined }), NOW)).toBe(
      'démarrée il y a 25 min',
    );
  });
});

describe('agentLabel', () => {
  it('utilise la description quand elle existe', () => {
    expect(agentLabel(agent())).toBe('Analyse des bugs');
  });

  it("retombe sur l'id sinon", () => {
    expect(agentLabel(agent({ description: undefined }))).toBe('agent-aaa');
  });
});

describe('agentDescription', () => {
  it('agent actif : modèle, statut et durée depuis la dernière activité', () => {
    expect(agentDescription(agent(), NOW)).toBe('opus · actif · 12 s');
  });

  it('agent terminé : modèle et ancienneté', () => {
    expect(agentDescription(agent({ status: 'finished', lastActivity: NOW - 180_000 }), NOW)).toBe(
      'opus · terminé il y a 3 min',
    );
  });

  it('sans modèle : statut seul', () => {
    expect(agentDescription(agent({ model: undefined }), NOW)).toBe('actif · 12 s');
  });
});

describe('workflow', () => {
  const workflow: WorkflowNode = { id: 'wf_test-123', agents: [], totalCount: 3, finishedCount: 2 };

  it('label', () => {
    expect(workflowLabel(workflow)).toBe('Workflow wf_test-123');
  });

  it('description de progression', () => {
    expect(workflowDescription(workflow)).toBe('2/3 terminés');
  });
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module './labels'`.

- [ ] **Step 3: Créer `src/labels.ts`**

```ts
import type { AgentNode, SessionNode, WorkflowNode } from './types';
import { abbreviateModel, formatDuration, formatRelativeTime } from './format';

export function sessionDescription(session: SessionNode, now: number): string {
  const parts: string[] = [];
  if (session.model) {
    parts.push(abbreviateModel(session.model));
  }
  if (!session.active && session.lastActivity !== undefined) {
    parts.push(`inactive depuis ${formatDuration(now - session.lastActivity)}`);
  } else {
    parts.push(`démarrée ${formatRelativeTime(now - session.startedAt)}`);
  }
  return parts.join(' · ');
}

export function agentLabel(agent: AgentNode): string {
  return agent.description ?? agent.id;
}

export function agentDescription(agent: AgentNode, now: number): string {
  const parts: string[] = [];
  if (agent.model) {
    parts.push(abbreviateModel(agent.model));
  }
  if (agent.status === 'active') {
    parts.push(`actif · ${formatDuration(now - agent.lastActivity)}`);
  } else {
    parts.push(`terminé ${formatRelativeTime(now - agent.lastActivity)}`);
  }
  return parts.join(' · ');
}

export function workflowLabel(workflow: WorkflowNode): string {
  return `Workflow ${workflow.id}`;
}

export function workflowDescription(workflow: WorkflowNode): string {
  return `${workflow.finishedCount}/${workflow.totalCount} terminés`;
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npm test`
Expected: PASS (tous les tests).

- [ ] **Step 5: Typecheck puis commit**

Run: `npm run typecheck`
Expected: aucune erreur.

```powershell
git add src/labels.ts src/labels.test.ts
git commit -m @'
feat: libelles francais des sessions, agents et workflows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 8: Couche VSCode (`treeProvider.ts`, `extension.ts`) et test manuel F5

**Files:**
- Create: `src/treeProvider.ts`
- Modify: `src/extension.ts` (remplace le stub)
- Create: `.vscode/launch.json`

**Interfaces:**
- Consumes: `scan`, `filterVisibleAgents` (scanner), fonctions de `labels.ts`, types.
- Produces: `ClaudeAgentsTreeProvider` avec `refresh(projects: ProjectNode[], now: number): void` ; vue `claudeAgentsTree` opérationnelle (polling 2 s, watcher, pause quand invisible).

Pas de tests unitaires ici (couche VSCode fine, décision de la spec) : vérification par typecheck, build et F5.

- [ ] **Step 1: Créer `src/treeProvider.ts`**

```ts
import * as vscode from 'vscode';
import type { AgentNode, FinishedAgentSettings, ProjectNode, SessionNode, WorkflowNode } from './types';
import { filterVisibleAgents } from './scanner';
import { agentDescription, agentLabel, sessionDescription, workflowDescription, workflowLabel } from './labels';

export type TreeNode =
  | { kind: 'project'; project: ProjectNode }
  | { kind: 'session'; session: SessionNode }
  | { kind: 'workflow'; workflow: WorkflowNode; sessionId: string }
  | { kind: 'agent'; agent: AgentNode };

export class ClaudeAgentsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private projects: ProjectNode[] = [];
  private now = Date.now();

  refresh(projects: ProjectNode[], now: number): void {
    this.projects = projects;
    this.now = now;
    this.onDidChangeTreeDataEmitter.fire();
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return this.projects.map((project) => ({ kind: 'project' as const, project }));
    }
    const settings = readFinishedAgentSettings();
    switch (node.kind) {
      case 'project':
        return node.project.sessions.map((session) => ({ kind: 'session' as const, session }));
      case 'session': {
        const agents = filterVisibleAgents(node.session.agents, settings, this.now).map((agent) => ({
          kind: 'agent' as const,
          agent,
        }));
        // Un workflow dont tous les enfants sont masqués est masqué lui aussi.
        const workflows = node.session.workflows
          .filter((workflow) => filterVisibleAgents(workflow.agents, settings, this.now).length > 0)
          .map((workflow) => ({ kind: 'workflow' as const, workflow, sessionId: node.session.sessionId }));
        return [...agents, ...workflows];
      }
      case 'workflow':
        return filterVisibleAgents(node.workflow.agents, settings, this.now).map((agent) => ({
          kind: 'agent' as const,
          agent,
        }));
      case 'agent':
        return [];
    }
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'project': {
        const item = new vscode.TreeItem(node.project.name, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `project:${node.project.cwd.toLowerCase()}`;
        item.iconPath = new vscode.ThemeIcon('folder');
        item.tooltip = node.project.cwd;
        return item;
      }
      case 'session': {
        const session = node.session;
        const item = new vscode.TreeItem(
          session.name,
          session.active ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.id = `session:${session.sessionId}`;
        item.description = sessionDescription(session, this.now);
        item.iconPath = session.active
          ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'))
          : new vscode.ThemeIcon('circle-outline');
        item.tooltip = `${session.cwd}\n${session.sessionId}\nPID ${session.pid}`;
        return item;
      }
      case 'workflow': {
        const workflow = node.workflow;
        const allFinished = workflow.finishedCount === workflow.totalCount;
        const item = new vscode.TreeItem(
          workflowLabel(workflow),
          allFinished ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
        );
        item.id = `workflow:${node.sessionId}:${workflow.id}`;
        item.description = workflowDescription(workflow);
        item.iconPath = new vscode.ThemeIcon('layers');
        return item;
      }
      case 'agent': {
        const agent = node.agent;
        const item = new vscode.TreeItem(agentLabel(agent), vscode.TreeItemCollapsibleState.None);
        item.id = `agent:${agent.filePath}`;
        item.description = agentDescription(agent, this.now);
        item.iconPath =
          agent.status === 'active'
            ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'))
            : new vscode.ThemeIcon('check', new vscode.ThemeColor('descriptionForeground'));
        item.tooltip = [agent.description, agent.model, agent.filePath].filter(Boolean).join('\n');
        return item;
      }
    }
  }
}

function readFinishedAgentSettings(): FinishedAgentSettings {
  const config = vscode.workspace.getConfiguration('claudeAgents');
  return {
    mode: config.get<'always' | 'temporarily' | 'never'>('showFinishedAgents', 'temporarily'),
    retentionSeconds: config.get<number>('finishedAgentRetentionSeconds', 60),
  };
}
```

- [ ] **Step 2: Remplacer `src/extension.ts`**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { scan } from './scanner';
import { ClaudeAgentsTreeProvider } from './treeProvider';

const POLL_INTERVAL_MS = 2000;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Claude Agents');
  const claudeDir = path.join(os.homedir(), '.claude');
  const provider = new ClaudeAgentsTreeProvider();
  const treeView = vscode.window.createTreeView('claudeAgentsTree', { treeDataProvider: provider });

  const runScan = (): void => {
    const now = Date.now();
    try {
      provider.refresh(scan({ claudeDir, now, log: (message) => output.appendLine(message) }), now);
    } catch (error) {
      output.appendLine(`Scan en échec : ${String(error)}`);
    }
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  const startPolling = (): void => {
    if (timer === undefined) {
      runScan();
      timer = setInterval(runScan, POLL_INTERVAL_MS);
    }
  };
  const stopPolling = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  treeView.onDidChangeVisibility((event) => (event.visible ? startPolling() : stopPolling()), undefined, context.subscriptions);
  if (treeView.visible) {
    startPolling();
  } else {
    runScan(); // premier remplissage même si la vue n'est pas encore affichée
  }

  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(path.join(claudeDir, 'sessions'), () => {
      if (treeView.visible) {
        runScan();
      }
    });
  } catch (error) {
    output.appendLine(`Watcher indisponible, polling seul : ${String(error)}`);
  }

  context.subscriptions.push(treeView, output, {
    dispose: () => {
      stopPolling();
      watcher?.close();
    },
  });
}

export function deactivate(): void {}
```

- [ ] **Step 3: Créer `.vscode/launch.json`**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Lancer l'extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"]
    }
  ]
}
```

- [ ] **Step 4: Typecheck, tests et build**

Run: `npm run typecheck; npm test; npm run build`
Expected: aucune erreur, tous les tests passent, `dist/extension.js` régénéré.

- [ ] **Step 5: Test manuel F5** (à faire par Cyril ou en Extension Development Host)

1. Ouvrir le dossier `ClaudeAgents` dans VSCode, appuyer sur F5.
2. Dans la fenêtre Extension Development Host : icône « Claude Agents » visible dans la barre d'activité.
3. La vue liste les projets ayant une session Claude Code en cours (au minimum la session courante de cette conversation).
4. La session courante apparaît ● verte (active) ; les temps se mettent à jour toutes les 2 s.
5. Lancer un sous-agent dans une session Claude → il apparaît sous la session en ● ; une fois terminé, il passe ✓ grisé puis disparaît après ~60 s.
6. Fermer une session Claude (Ctrl+C dans le terminal) → elle disparaît de l'arbre en ≤ 2 s.
7. Panneau Output « Claude Agents » : pas d'erreurs répétées.

Expected: les 7 points sont constatés.

- [ ] **Step 6: Commit**

```powershell
git add src/treeProvider.ts src/extension.ts .vscode/launch.json
git commit -m @'
feat: vue arbre VSCode avec polling 2 s, watcher et pause hors visibilite

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 9: README, packaging vsix et installation

**Files:**
- Modify: `README.md`
- Create: `claude-agents-0.1.0.vsix` (artefact non commité, ignoré par `.gitignore`)

**Interfaces:**
- Consumes: tout le projet.
- Produces: un `.vsix` installable ; README documentant installation, settings et sources de données.

- [ ] **Step 1: Compléter `README.md`**

```markdown
# Claude Agents

Extension VSCode : vue arbre en temps quasi réel des sessions, agents et sous-agents
Claude Code en cours sur la machine (tous projets confondus).

## Fonctionnement

Lecture seule de `~/.claude` :

- `sessions/<pid>.json` — registre des sessions en cours (vérification de vivacité du PID) ;
- `projects/<projet>/<sessionId>.jsonl` — activité (mtime) et modèle de la session ;
- `projects/<projet>/<sessionId>/subagents/**` — sous-agents et workflows.

Statut ● actif si le transcript a été modifié il y a moins de 30 s. Rafraîchissement
toutes les 2 s (en pause quand la vue est masquée).

## Settings

| Setting | Défaut | Effet |
|---------|--------|-------|
| `claudeAgents.showFinishedAgents` | `temporarily` | `always` : agents terminés toujours visibles (grisés) · `temporarily` : masqués après le délai de rétention · `never` : actifs uniquement |
| `claudeAgents.finishedAgentRetentionSeconds` | `60` | Délai avant masquage d'un agent terminé (mode `temporarily`) |

## Développement

```bash
npm install
npm test           # tests unitaires (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # esbuild → dist/extension.js
# F5 dans VSCode → Extension Development Host
```

## Installation

```bash
npm run package    # → claude-agents-<version>.vsix
code --install-extension claude-agents-0.1.0.vsix
```
```

- [ ] **Step 2: Packager**

Run: `npm run package`
Expected: typecheck + tests OK, puis `claude-agents-0.1.0.vsix` créé (vsce peut afficher des warnings sur le repository manquant — acceptables ; si vsce bloque, relancer avec `npx vsce package --allow-missing-repository`).

- [ ] **Step 3: Installer et vérifier**

Run: `code --install-extension claude-agents-0.1.0.vsix`
Expected: `Extension 'claude-agents-0.1.0.vsix' was successfully installed.`

Puis recharger la fenêtre VSCode principale et vérifier que la vue « Claude Agents » affiche les sessions en cours (mêmes points de contrôle qu'en Task 8 Step 5).

- [ ] **Step 4: Commit final**

```powershell
git add README.md
git commit -m @'
docs: README complet avec installation et settings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

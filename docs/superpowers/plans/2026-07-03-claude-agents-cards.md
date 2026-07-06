# Claude Agents — Plan d'implémentation de la vue cards (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'arbre natif par une vue « cards » en webview : contexte (barre), modèle + effort, titres, sous-agents avec jauge circulaire de disparition (60 s), sans interaction.

**Architecture:** Le scanner pur reste le cœur (polling 2 s, caches). Il gagne `contextTokens` (session + agents) via une lecture de queue **unifiée** (modèle + titre + usage en un seul `readChunk` de 64 Ko) et `readEffortLevel`. Une `WebviewView` remplace le `TreeView` : `cardsView.ts` (shell HTML + CSP + postMessage), `src/webview/render.ts` (HTML pur, testé vitest), `src/webview/main.ts` (réception + horloge locale 250 ms). `filterVisibleAgents` migre dans `src/visibility.ts` (pur, sans `fs`) pour être bundlable côté webview. Spec : `docs/superpowers/specs/2026-07-03-claude-agents-cards-design.md`.

**Tech Stack:** TypeScript strict, esbuild (2 bundles : extension cjs/node + webview iife/browser), vitest, vsce. Zéro dépendance runtime.

## Global Constraints

- Textes d'interface en **français** (« Aucune session Claude en cours. », « contexte », « terminé »…).
- Aucune dépendance runtime ; jamais d'écriture dans `~/.claude`.
- Lecture de queue unifiée : `TAIL_READ_BYTES = 64 * 1024`. Tête description : 8 Ko (inchangé). Jamais de lecture complète.
- `contextTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens` du **dernier** bloc `"usage"` de la fenêtre.
- **Limites de contexte (validées via la référence API Claude — ne pas modifier) :** fable/mythos → 1 000 000 ; opus 4.6/4.7/4.8 → 1 000 000 ; sonnet 5 et 4.6 → 1 000 000 ; haiku 4.5 → 200 000 ; tout autre modèle → `undefined` (repli valeur brute sans barre).
- Barre contexte : vert ≤ 60 %, orange 61-85 %, rouge > 85 %.
- Jauge circulaire : rayon 6, se vide linéairement sur `finishedAgentRetentionSeconds` (défaut 60) depuis `lastActivity` ; uniquement en mode `temporarily` ; `always` → ✓ ; `never` → agents terminés absents. Disparition de la ligne à 0.
- La webview ne lit jamais le disque, n'envoie aucun message, aucune interaction. CSP : `default-src 'none'`, style/script via `asWebviewUri` + nonce.
- Tout texte issu des transcripts est échappé HTML (`escapeHtml`).
- `src/webview/*` et `src/visibility.ts`, `src/labels.ts`, `src/format.ts`, `src/types.ts` ne doivent **jamais** importer `fs`, `path`, `os` ni `vscode` (bundle navigateur).
- Un commit par tâche, message français, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Commandes exécutées depuis `c:\Users\cyril\Documents\Developpement\PANDAPROG\ClaudeAgents`.

---

### Task 1: Scanner — lecture de queue unifiée, contextTokens, visibility.ts, effortLevel

**Files:**
- Modify: `src/types.ts` (ajoute `contextTokens?` sur `SessionNode` et `AgentNode`)
- Create: `src/visibility.ts` (reçoit `filterVisibleAgents` déplacé)
- Modify: `src/scanner.ts` (remplace `extractModel`/`extractCustomTitle` par `extractTailMeta`, enrichit `TranscriptMeta`, ajoute `readEffortLevel`, re-exporte `filterVisibleAgents`)
- Modify: `src/__tests__/helpers.ts` (ajoute `assistantUsageLine`, `writeSettings`)
- Test: `src/__tests__/scanner.test.ts` (nouveau bloc `describe`)

**Interfaces:**
- Consumes: `readChunk`, `customTitleCache`, `transcriptMetaCache`, `extractDescription` existants.
- Produces:
  - `interface TailMeta { model?: string; customTitle?: string; contextTokens?: number }` et `extractTailMeta(filePath: string): TailMeta` (exportés).
  - `readEffortLevel(claudeDir: string): string | undefined` (exporté).
  - `SessionNode.contextTokens?: number`, `AgentNode.contextTokens?: number`.
  - `src/visibility.ts` exporte `filterVisibleAgents(agents, settings, now)` (même signature qu'avant) ; `scanner.ts` le re-exporte pour que les imports existants restent valides.
  - Helpers : `assistantUsageLine(model, usage: {input, cacheRead, cacheCreation}): string`, `writeSettings(claudeDir, content: string): void`.

- [ ] **Step 1: Ajouter les helpers dans `src/__tests__/helpers.ts`** (à la fin)

```ts
/** Ligne JSONL assistant portant model + usage (pour contextTokens). */
export function assistantUsageLine(
  model: string,
  usage: { input: number; cacheRead: number; cacheCreation: number },
): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      model,
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: usage.input,
        cache_read_input_tokens: usage.cacheRead,
        cache_creation_input_tokens: usage.cacheCreation,
        output_tokens: 42,
      },
    },
  });
}

/** Écrit ~/.claude/settings.json dans la fixture. */
export function writeSettings(claudeDir: string, content: string): void {
  writeFileSync(join(claudeDir, 'settings.json'), content);
}
```

- [ ] **Step 2: Ajouter `contextTokens` dans `src/types.ts`**

Dans `AgentNode`, après `model?: string;` :

```ts
  contextTokens?: number;
```

Dans `SessionNode`, après `model?: string;` :

```ts
  contextTokens?: number;
```

- [ ] **Step 3: Écrire les tests qui échouent** (nouveau bloc à la fin de `src/__tests__/scanner.test.ts` ; fusionner les imports : `assistantUsageLine`, `writeSettings` depuis `./helpers`, `extractTailMeta`, `readEffortLevel` depuis `../scanner`)

```ts
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

  it('readEffortLevel absorbe absence et corruption', () => {
    const dir = makeClaudeDir();
    expect(readEffortLevel(dir)).toBeUndefined();
    writeSettings(dir, '{pas du json');
    expect(readEffortLevel(dir)).toBeUndefined();
    writeSettings(dir, JSON.stringify({ effortLevel: 42 }));
    expect(readEffortLevel(dir)).toBeUndefined();
  });
});
```

- [ ] **Step 4: Vérifier que les tests échouent**

Run: `npm test`
Expected: FAIL — `extractTailMeta`/`readEffortLevel` n'existent pas.

- [ ] **Step 5: Créer `src/visibility.ts`** (corps identique à l'actuel `filterVisibleAgents` de scanner.ts)

```ts
import type { AgentNode, FinishedAgentSettings } from './types';

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

- [ ] **Step 6: Implémenter dans `src/scanner.ts`**

1. Supprimer la fonction `filterVisibleAgents` et son import de `FinishedAgentSettings` s'il devient inutile ; ajouter en tête de fichier :

```ts
export { filterVisibleAgents } from './visibility';
```

2. Supprimer `MODEL_READ_BYTES`, `TITLE_READ_BYTES`, `extractModel` et `extractCustomTitle`. Ajouter à leur place :

```ts
const TAIL_READ_BYTES = 64 * 1024;

export interface TailMeta {
  model?: string;
  customTitle?: string;
  contextTokens?: number;
}

function lastMatch(
  text: string,
  pattern: RegExp,
  accept: (value: string) => boolean = () => true,
): string | undefined {
  const values = [...text.matchAll(pattern)].map((match) => match[1]).filter(accept);
  return values.length > 0 ? values[values.length - 1] : undefined;
}

/** Contexte courant ≈ somme des champs d'entrée du DERNIER bloc usage de la fenêtre. */
function extractContextTokens(tail: string): number | undefined {
  const usageIndex = tail.lastIndexOf('"usage"');
  if (usageIndex === -1) {
    return undefined;
  }
  const usageWindow = tail.slice(usageIndex, usageIndex + 600);
  const input = /"input_tokens"\s*:\s*(\d+)/.exec(usageWindow);
  if (!input) {
    return undefined;
  }
  const cacheRead = /"cache_read_input_tokens"\s*:\s*(\d+)/.exec(usageWindow);
  const cacheCreation = /"cache_creation_input_tokens"\s*:\s*(\d+)/.exec(usageWindow);
  return Number(input[1]) + Number(cacheRead?.[1] ?? 0) + Number(cacheCreation?.[1] ?? 0);
}

/** Une seule lecture de queue par fichier et par scan : modèle + titre custom + contexte. */
export function extractTailMeta(filePath: string): TailMeta {
  const tail = readChunk(filePath, 'tail', TAIL_READ_BYTES);
  if (tail === undefined) {
    return {};
  }
  const rawTitle = lastMatch(tail, /"customTitle"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g);
  let customTitle: string | undefined;
  if (rawTitle !== undefined) {
    try {
      customTitle = JSON.parse(`"${rawTitle}"`) as string;
    } catch {
      customTitle = rawTitle;
    }
  }
  return {
    model: lastMatch(tail, /"model"\s*:\s*"([^"]+)"/g, (value) => value !== '<synthetic>'),
    customTitle,
    contextTokens: extractContextTokens(tail),
  };
}

/** Effort global de ~/.claude/settings.json (l'effort par session n'est pas persisté). */
export function readEffortLevel(claudeDir: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    const effort = (parsed as { effortLevel?: unknown }).effortLevel;
    return typeof effort === 'string' ? effort : undefined;
  } catch {
    return undefined;
  }
}
```

3. Dans `buildSessionNode`, remplacer le corps du `try` du transcript par :

```ts
    const stat = fs.statSync(transcriptPath);
    session.lastActivity = stat.mtimeMs;
    session.active = now - stat.mtimeMs < activeThresholdMs;
    const meta = extractTailMeta(transcriptPath);
    session.model = meta.model;
    session.contextTokens = meta.contextTokens;
    if (meta.customTitle) {
      customTitleCache.set(entry.sessionId, meta.customTitle);
    }
```

4. Enrichir `TranscriptMeta` et `readTranscriptMeta` :

```ts
interface TranscriptMeta {
  mtimeMs: number;
  description: string | undefined;
  model: string | undefined;
  contextTokens: number | undefined;
}

function readTranscriptMeta(filePath: string, mtimeMs: number): TranscriptMeta {
  const cached = transcriptMetaCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached;
  }
  const tailMeta = extractTailMeta(filePath);
  const meta: TranscriptMeta = {
    mtimeMs,
    description: extractDescription(filePath),
    model: tailMeta.model,
    contextTokens: tailMeta.contextTokens,
  };
  transcriptMetaCache.set(filePath, meta);
  return meta;
}
```

5. Dans `scanAgentsDir`, ajouter `contextTokens: meta.contextTokens,` après `model: meta.model,`.

- [ ] **Step 7: Vérifier que tous les tests passent**

Run: `npm test`
Expected: PASS (61 tests : 55 existants + 6 nouveaux). Les tests existants de modèle/titre passent sans modification (mêmes comportements via `extractTailMeta`).

- [ ] **Step 8: Typecheck puis commit**

Run: `npm run typecheck`
Expected: aucune erreur.

```powershell
git add src/types.ts src/visibility.ts src/scanner.ts src/__tests__
git commit -m @'
feat: lecture de queue unifiee, contexte par session et agent, effort global

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 2: Format — formatTokens et limites de contexte par modèle

**Files:**
- Modify: `src/format.ts`
- Test: `src/format.test.ts` (nouveaux blocs `describe`)

**Interfaces:**
- Consumes: rien.
- Produces (consommées par `render.ts` en Task 3) :
  - `formatTokens(tokens: number): string` — « 483k », « 61k », « 1,2M », « 1M », « 950 ».
  - `contextLimitFor(model: string): number | undefined` — table validée, `undefined` si inconnu.

- [ ] **Step 1: Écrire les tests qui échouent** (à la fin de `src/format.test.ts` ; fusionner l'import : `contextLimitFor`, `formatTokens`)

```ts
describe('formatTokens', () => {
  it('affiche les milliers en k arrondis', () => {
    expect(formatTokens(482_851)).toBe('483k');
    expect(formatTokens(61_000)).toBe('61k');
  });

  it('affiche les millions avec virgule française', () => {
    expect(formatTokens(1_200_000)).toBe('1,2M');
  });

  it('affiche un million rond sans décimale', () => {
    expect(formatTokens(1_000_000)).toBe('1M');
  });

  it('affiche les petites valeurs brutes', () => {
    expect(formatTokens(950)).toBe('950');
  });
});

describe('contextLimitFor', () => {
  it('connaît les modèles 1M', () => {
    expect(contextLimitFor('claude-fable-5')).toBe(1_000_000);
    expect(contextLimitFor('claude-opus-4-8')).toBe(1_000_000);
    expect(contextLimitFor('claude-sonnet-5')).toBe(1_000_000);
    expect(contextLimitFor('claude-sonnet-4-6')).toBe(1_000_000);
  });

  it('connaît haiku 4.5 à 200k', () => {
    expect(contextLimitFor('claude-haiku-4-5-20251001')).toBe(200_000);
  });

  it('retourne undefined pour un modèle inconnu', () => {
    expect(contextLimitFor('claude-opus-4-5-20251101')).toBeUndefined();
    expect(contextLimitFor('gpt-x')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `npm test`
Expected: FAIL — `formatTokens`/`contextLimitFor` n'existent pas.

- [ ] **Step 3: Implémenter dans `src/format.ts`** (à la fin)

```ts
export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return `${tokens}`;
  }
  if (tokens < 1_000_000) {
    return `${Math.round(tokens / 1000)}k`;
  }
  return `${(tokens / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')}M`;
}

/** Fenêtres de contexte validées via la référence API Claude (2026-07). Inconnu → undefined (repli valeur brute). */
const MODEL_CONTEXT_LIMITS: Array<{ pattern: RegExp; limit: number }> = [
  { pattern: /^claude-(fable|mythos)-5/, limit: 1_000_000 },
  { pattern: /^claude-opus-4-(6|7|8)/, limit: 1_000_000 },
  { pattern: /^claude-sonnet-(5|4-6)/, limit: 1_000_000 },
  { pattern: /^claude-haiku-4-5/, limit: 200_000 },
];

export function contextLimitFor(model: string): number | undefined {
  return MODEL_CONTEXT_LIMITS.find(({ pattern }) => pattern.test(model))?.limit;
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck puis commit**

Run: `npm run typecheck`
Expected: aucune erreur.

```powershell
git add src/format.ts src/format.test.ts
git commit -m @'
feat: formatage des tokens et limites de contexte par modele

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 3: Rendu pur des cards (`src/webview/render.ts`)

**Files:**
- Create: `src/webview/render.ts`
- Test: `src/webview/render.test.ts`

**Interfaces:**
- Consumes: types de `../types` ; `filterVisibleAgents` de `../visibility` ; `abbreviateModel`, `contextLimitFor`, `formatTokens` de `../format` ; `agentDescription`, `agentLabel`, `sessionDescription`, `workflowDescription`, `workflowLabel` de `../labels`. **Interdit** : `fs`, `path`, `os`, `vscode` (bundle navigateur).
- Produces (consommées par `main.ts` en Task 4) :
  - `interface RenderOptions { now: number; effortLevel?: string; settings: FinishedAgentSettings }`
  - `renderApp(projects: ProjectNode[], options: RenderOptions): string`
  - `escapeHtml(text: string): string`

- [ ] **Step 1: Écrire les tests qui échouent (`src/webview/render.test.ts`)**

```ts
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

  it("affiche modèle et effort dans la ligne méta", () => {
    const html = renderApp([project([session()])], { now: NOW, effortLevel: 'xhigh', settings: SETTINGS });
    expect(html).toContain('fable · xhigh');
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
    expect(html).toContain('2/3 terminés');
    expect(html).toContain('review:bugs');
  });

  it("affiche démarrage et activité sans dupliquer le modèle", () => {
    const html = renderApp([project([session()])], { now: NOW, effortLevel: 'xhigh', settings: SETTINGS });
    expect(html).toContain('démarrée il y a 25 min · activité 3 s');
    expect(html.match(/fable/g)).toHaveLength(1);
  });

  it("affiche l'inactivité d'une session au repos", () => {
    const html = renderApp([project([session({ active: false, lastActivity: NOW - 2_400_000 })])], {
      now: NOW,
      settings: SETTINGS,
    });
    expect(html).toContain('démarrée il y a 25 min · inactive depuis 40 min');
  });
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module './render'`.

- [ ] **Step 3: Créer `src/webview/render.ts`**

```ts
import type { AgentNode, FinishedAgentSettings, ProjectNode, SessionNode, WorkflowNode } from '../types';
import { filterVisibleAgents } from '../visibility';
import { abbreviateModel, contextLimitFor, formatDuration, formatRelativeTime, formatTokens } from '../format';
import { agentDescription, agentLabel, workflowDescription, workflowLabel } from '../labels';

export interface RenderOptions {
  now: number;
  effortLevel?: string;
  settings: FinishedAgentSettings;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderApp(projects: ProjectNode[], options: RenderOptions): string {
  if (projects.length === 0) {
    return '<p class="empty">Aucune session Claude en cours.</p>';
  }
  return projects.map((project) => renderProject(project, options)).join('');
}

function renderProject(project: ProjectNode, options: RenderOptions): string {
  const cards = project.sessions.map((session) => renderSessionCard(session, project, options)).join('');
  return `<section class="project"><h2 title="${escapeHtml(project.cwd)}">${escapeHtml(project.name)}</h2>${cards}</section>`;
}

function renderSessionCard(session: SessionNode, project: ProjectNode, options: RenderOptions): string {
  const dot = `<span class="dot${session.active ? ' active' : ''}"></span>`;
  const meta = [session.model ? abbreviateModel(session.model) : undefined, options.effortLevel]
    .filter(Boolean)
    .join(' · ');
  return [
    `<article class="card${session.active ? ' active' : ''}">`,
    `<header>${dot}<h3>${escapeHtml(session.name)}</h3></header>`,
    `<div class="meta"><span class="badge">${escapeHtml(project.name)}</span>${escapeHtml(meta)}</div>`,
    renderContext(session),
    `<div class="times">${escapeHtml(sessionTimes(session, options.now))}</div>`,
    renderAgents(session, options),
    '</article>',
  ].join('');
}

function sessionTimes(session: SessionNode, now: number): string {
  const parts = [`démarrée ${formatRelativeTime(now - session.startedAt)}`];
  if (session.lastActivity !== undefined) {
    parts.push(
      session.active
        ? `activité ${formatDuration(now - session.lastActivity)}`
        : `inactive depuis ${formatDuration(now - session.lastActivity)}`,
    );
  }
  return parts.join(' · ');
}

function renderContext(session: SessionNode): string {
  if (session.contextTokens === undefined) {
    return '';
  }
  const limit = session.model ? contextLimitFor(session.model) : undefined;
  if (limit === undefined) {
    return `<div class="ctx"><span class="ctx-label">contexte : ${formatTokens(session.contextTokens)} tokens</span></div>`;
  }
  const pct = Math.min(100, Math.round((session.contextTokens / limit) * 100));
  const level = pct > 85 ? 'crit' : pct > 60 ? 'warn' : 'ok';
  return [
    '<div class="ctx">',
    `<svg class="bar" viewBox="0 0 100 6" preserveAspectRatio="none"><rect class="fill ${level}" x="0" y="0" width="${pct}" height="6" rx="2"/></svg>`,
    `<span class="ctx-label">${formatTokens(session.contextTokens)} / ${formatTokens(limit)}</span>`,
    '</div>',
  ].join('');
}

function renderAgents(session: SessionNode, options: RenderOptions): string {
  const direct = filterVisibleAgents(session.agents, options.settings, options.now)
    .map((agent) => renderAgentLine(agent, options))
    .join('');
  const workflows = session.workflows
    .filter((workflow) => filterVisibleAgents(workflow.agents, options.settings, options.now).length > 0)
    .map((workflow) => renderWorkflow(workflow, options))
    .join('');
  if (!direct && !workflows) {
    return '';
  }
  return `<ul class="agents">${direct}${workflows}</ul>`;
}

function renderWorkflow(workflow: WorkflowNode, options: RenderOptions): string {
  const lines = filterVisibleAgents(workflow.agents, options.settings, options.now)
    .map((agent) => renderAgentLine(agent, options))
    .join('');
  return [
    '<li class="workflow">',
    `<span class="wf-label">${escapeHtml(workflowLabel(workflow))}</span> `,
    `<span class="wf-count">${escapeHtml(workflowDescription(workflow))}</span>`,
    `<ul>${lines}</ul>`,
    '</li>',
  ].join('');
}

function renderAgentLine(agent: AgentNode, options: RenderOptions): string {
  const context = agent.contextTokens !== undefined ? ` · ${formatTokens(agent.contextTokens)}` : '';
  return [
    '<li class="agent">',
    renderAgentIcon(agent, options),
    `<span class="agent-label">${escapeHtml(agentLabel(agent))}</span>`,
    `<span class="agent-desc">${escapeHtml(agentDescription(agent, options.now) + context)}</span>`,
    '</li>',
  ].join('');
}

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 6;

function renderAgentIcon(agent: AgentNode, options: RenderOptions): string {
  if (agent.status === 'active') {
    return '<span class="dot active"></span>';
  }
  if (options.settings.mode !== 'temporarily') {
    return '<span class="check">✓</span>';
  }
  const elapsed = options.now - agent.lastActivity;
  const remaining = Math.max(0, 1 - elapsed / (options.settings.retentionSeconds * 1000));
  const offset = (GAUGE_CIRCUMFERENCE * (1 - remaining)).toFixed(2);
  return [
    '<svg class="gauge" viewBox="0 0 16 16" width="14" height="14">',
    '<circle class="gauge-track" cx="8" cy="8" r="6"/>',
    `<circle class="gauge-fill" cx="8" cy="8" r="6" stroke-dasharray="${GAUGE_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${offset}" transform="rotate(-90 8 8)"/>`,
    '</svg>',
  ].join('');
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npm test`
Expected: PASS. (48 % de 1M pour 482 851 → `width:48%` ; libellé `483k / 1M`.)

- [ ] **Step 5: Typecheck puis commit**

Run: `npm run typecheck`
Expected: aucune erreur.

```powershell
git add src/webview
git commit -m @'
feat: rendu HTML pur des cards avec barre de contexte et jauge circulaire

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 4: Couche webview VSCode (`cardsView.ts`, `main.ts`, CSS, esbuild, manifeste)

**Files:**
- Create: `src/cardsView.ts`
- Create: `src/webview/main.ts`
- Create: `media/cards.css`
- Modify: `esbuild.mjs` (second bundle navigateur)
- Modify: `tsconfig.json` (lib DOM)
- Modify: `package.json` (vue webview, suppression viewsWelcome)
- Modify: `src/extension.ts` (bascule TreeView → webview)
- Delete: `src/treeProvider.ts`

**Interfaces:**
- Consumes: `renderApp`/`RenderOptions` (Task 3), `scan`/`readEffortLevel` (Task 1).
- Produces: `CardsViewProvider` avec `static viewType = 'claudeAgentsCards'`, `resolveWebviewView`, `postState(state: unknown): void`, `get visible(): boolean`, `onDidChangeVisibility: vscode.Event<boolean>`.

Pas de tests unitaires (couche VSCode/DOM, décision de la spec) : vérification par typecheck + suite existante + build + F5 (humain).

- [ ] **Step 1: Ajouter la lib DOM dans `tsconfig.json`**

Remplacer `"lib": ["ES2022"],` par :

```json
    "lib": ["ES2022", "DOM"],
```

- [ ] **Step 2: Remplacer `esbuild.mjs`**

```js
import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const extensionCtx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
});

const webviewCtx = await esbuild.context({
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
});

if (watch) {
  await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
} else {
  await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
  await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
}
```

- [ ] **Step 3: Mettre à jour `package.json`** — remplacer le bloc `views` et supprimer `viewsWelcome` :

```json
    "views": {
      "claude-agents": [
        {
          "type": "webview",
          "id": "claudeAgentsCards",
          "name": "Sessions"
        }
      ]
    },
```

(Le bloc `"viewsWelcome": [...]` est supprimé entièrement — le message vide est rendu par la webview.)

- [ ] **Step 4: Créer `src/cardsView.ts`**

```ts
import * as vscode from 'vscode';

export class CardsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'claudeAgentsCards';

  private view?: vscode.WebviewView;
  private lastState: unknown;
  private readonly visibilityEmitter = new vscode.EventEmitter<boolean>();
  readonly onDidChangeVisibility = this.visibilityEmitter.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview);
    webviewView.onDidChangeVisibility(() => this.visibilityEmitter.fire(webviewView.visible));
    webviewView.onDidDispose(() => {
      this.view = undefined;
      this.visibilityEmitter.fire(false);
    });
    if (this.lastState !== undefined) {
      void webviewView.webview.postMessage(this.lastState);
    }
    this.visibilityEmitter.fire(webviewView.visible);
  }

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  postState(state: unknown): void {
    this.lastState = state;
    void this.view?.webview.postMessage(state);
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'cards.css'));
    const nonce = getNonce();
    return [
      '<!DOCTYPE html>',
      '<html lang="fr">',
      '<head>',
      '<meta charset="UTF-8">',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">`,
      `<link rel="stylesheet" href="${styleUri}">`,
      '</head>',
      '<body>',
      '<div id="root"><p class="empty">Aucune session Claude en cours.</p></div>',
      `<script nonce="${nonce}" src="${scriptUri}"></script>`,
      '</body>',
      '</html>',
    ].join('\n');
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

- [ ] **Step 5: Créer `src/webview/main.ts`**

```ts
import type { FinishedAgentSettings, ProjectNode } from '../types';
import { renderApp } from './render';

interface StateMessage {
  projects: ProjectNode[];
  effortLevel?: string;
  settings: FinishedAgentSettings;
  now: number;
}

const root = document.getElementById('root') as HTMLElement;
let state: StateMessage | undefined;
let clockSkew = 0;
let lastHtml = '';

window.addEventListener('message', (event: MessageEvent<StateMessage>) => {
  state = event.data;
  // L'horloge locale peut différer de celle de l'extension : on aligne.
  clockSkew = Date.now() - state.now;
  render();
});

function render(): void {
  if (!state) {
    return;
  }
  const html = renderApp(state.projects, {
    now: Date.now() - clockSkew,
    effortLevel: state.effortLevel,
    settings: state.settings,
  });
  if (html !== lastHtml) {
    lastHtml = html;
    root.innerHTML = html;
  }
}

// Anime jauges et durées entre deux scans (250 ms = fluide à l'œil, coût négligeable).
setInterval(render, 250);
```

- [ ] **Step 6: Créer `media/cards.css`**

```css
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  padding: 4px 8px;
}

.empty {
  color: var(--vscode-descriptionForeground);
  text-align: center;
  margin-top: 24px;
}

.project > h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vscode-descriptionForeground);
  margin: 12px 0 4px;
}

.card {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-widget-border, transparent);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
}

.card.active {
  border-color: var(--vscode-charts-green, #89d185);
}

.card header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.card h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid var(--vscode-descriptionForeground);
}

.dot.active {
  background: var(--vscode-charts-green, #89d185);
  border-color: var(--vscode-charts-green, #89d185);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  50% { opacity: 0.4; }
}

.meta {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  margin-top: 2px;
}

.badge {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 8px;
  padding: 0 6px;
  margin-right: 6px;
  font-size: 10px;
}

.ctx {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.bar {
  flex: 1;
  display: block;
  height: 5px;
  border-radius: 3px;
  background: var(--vscode-progressBar-background, #333);
  opacity: 0.9;
}

.fill.ok { fill: var(--vscode-charts-green, #89d185); }
.fill.warn { fill: var(--vscode-charts-orange, #d18616); }
.fill.crit { fill: var(--vscode-charts-red, #f14c4c); }

.ctx-label {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}

.times {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-top: 4px;
}

.agents {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  border-top: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
}

.agents li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12px;
}

.agents li.workflow {
  display: block;
}

.workflow > ul {
  list-style: none;
  margin: 0;
  padding-left: 14px;
}

.wf-label { font-weight: 600; }
.wf-count {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
}

.agent-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-desc {
  margin-left: auto;
  flex: none;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
}

.check { color: var(--vscode-descriptionForeground); }

.gauge { flex: none; }
.gauge-track {
  fill: none;
  stroke: var(--vscode-progressBar-background, #333);
  stroke-width: 2.5;
}
.gauge-fill {
  fill: none;
  stroke: var(--vscode-charts-orange, #d18616);
  stroke-width: 2.5;
  stroke-linecap: round;
}
```

- [ ] **Step 7: Remplacer `src/extension.ts`**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { readEffortLevel, scan } from './scanner';
import { CardsViewProvider } from './cardsView';

const POLL_INTERVAL_MS = 2000;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Claude Agents');
  const claudeDir = path.join(os.homedir(), '.claude');
  const provider = new CardsViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CardsViewProvider.viewType, provider),
  );

  const runScan = (): void => {
    const now = Date.now();
    try {
      const config = vscode.workspace.getConfiguration('claudeAgents');
      provider.postState({
        projects: scan({ claudeDir, now, log: (message) => output.appendLine(message) }),
        effortLevel: readEffortLevel(claudeDir),
        settings: {
          mode: config.get<'always' | 'temporarily' | 'never'>('showFinishedAgents', 'temporarily'),
          retentionSeconds: config.get<number>('finishedAgentRetentionSeconds', 60),
        },
        now,
      });
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

  provider.onDidChangeVisibility((visible) => (visible ? startPolling() : stopPolling()), undefined, context.subscriptions);

  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(path.join(claudeDir, 'sessions'), () => {
      if (provider.visible) {
        runScan();
      }
    });
  } catch (error) {
    output.appendLine(`Watcher indisponible, polling seul : ${String(error)}`);
  }

  context.subscriptions.push(output, {
    dispose: () => {
      stopPolling();
      watcher?.close();
    },
  });
}

export function deactivate(): void {}
```

- [ ] **Step 8: Supprimer `src/treeProvider.ts`**

Run: `git rm src/treeProvider.ts`

- [ ] **Step 9: Typecheck, tests, build**

Run: `npm run typecheck; npm test; npm run build`
Expected: aucune erreur ; tous les tests passent ; `dist/extension.js` ET `dist/webview.js` créés.

- [ ] **Step 10: Commit**

```powershell
git add -A
git commit -m @'
feat: vue cards en webview remplacant l arbre natif

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 5: Version 0.2.0, README, packaging et installation

**Files:**
- Modify: `package.json` (version 0.2.0)
- Modify: `README.md`

**Interfaces:**
- Consumes: tout le projet.
- Produces: `claude-agents-0.2.0.vsix` installé.

- [ ] **Step 1: Bumper la version dans `package.json`**

`"version": "0.1.0"` → `"version": "0.2.0"`.

- [ ] **Step 2: Remplacer le contenu de `README.md`**

```markdown
# Claude Agents

Extension VSCode : vue « cards » en temps quasi réel des sessions, agents et
sous-agents Claude Code en cours sur la machine (tous projets confondus).

## Fonctionnement

Lecture seule de `~/.claude` :

- `sessions/<pid>.json` — registre des sessions en cours (vérification de vivacité du PID) ;
- `projects/<projet>/<sessionId>.jsonl` — activité (mtime), modèle, titre custom et
  longueur de contexte (dernier bloc `usage`) ;
- `projects/<projet>/<sessionId>/subagents/**` — sous-agents et workflows ;
- `settings.json` — `effortLevel` global (approximation : l'effort par session n'est
  pas persisté).

Chaque session est une card : statut ● (active si transcript OU un agent actif
< 30 s), titre, modèle + effort, barre de contexte (« 483k / 1M », limites par
modèle, repli valeur brute), agents avec durée et contexte compact. Un agent
terminé affiche une jauge circulaire qui se vide pendant la rétention (60 s par
défaut) puis disparaît. Rafraîchissement toutes les 2 s (en pause quand la vue est
masquée), animations locales à 250 ms. Aucune interaction : pure visualisation.

## Settings

| Setting | Défaut | Effet |
|---------|--------|-------|
| `claudeAgents.showFinishedAgents` | `temporarily` | `always` : agents terminés visibles en ✓ · `temporarily` : jauge puis disparition · `never` : actifs uniquement |
| `claudeAgents.finishedAgentRetentionSeconds` | `60` | Durée de la jauge avant disparition (mode `temporarily`) |

## Développement

```bash
npm install
npm test           # tests unitaires (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # esbuild → dist/extension.js + dist/webview.js
# F5 dans VSCode → Extension Development Host
```

## Installation

```bash
npm run package    # → claude-agents-<version>.vsix
code --install-extension claude-agents-0.2.0.vsix
```
```

- [ ] **Step 3: Packager et installer**

Run: `npm run package`
Expected: typecheck + tests OK, `claude-agents-0.2.0.vsix` créé. Vérifier le contenu : `npx vsce ls` doit lister `media/cards.css` et `dist/webview.js`, et AUCUN chemin `.superpowers/`.

Run: `code --install-extension claude-agents-0.2.0.vsix`
Expected: `was successfully installed`.

- [ ] **Step 4: Commit**

```powershell
git add package.json package-lock.json README.md
git commit -m @'
feat: version 0.2.0 avec vue cards, README a jour

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 6: Vérification manuelle (humain)

Après rechargement de la fenêtre VSCode :

1. L'icône « Claude Agents » ouvre la vue cards (plus d'arbre).
2. Chaque projet a son en-tête, chaque session sa card avec titre custom, ● pulsante si active, `modèle · effort`, barre de contexte colorée avec « xxxk / 1M ».
3. Les agents en cours apparaissent avec durée et contexte compact ; un agent qui se termine passe en jauge circulaire qui se vide en ~60 s puis sa ligne disparaît.
4. Le thème clair/sombre est respecté ; aucune interaction possible ; pas d'erreurs dans Output « Claude Agents ».
```

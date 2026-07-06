# Claude Agents — Vue « cards » en webview (v2)

**Date :** 2026-07-03
**Statut :** validé par Cyril
**Remplace :** la vue arbre native de la v1 (spec `2026-07-03-claude-agents-tree-design.md`, dont les règles de scan restent valables sauf mention contraire).

## Objectif

Remplacer l'arbre natif par une vue « cards » en webview dans la barre latérale :
une card par session avec longueur de contexte, modèle + effort, titre, et les
sous-agents en sous-cards (hiérarchie réelle : session → agents directs + workflows
→ agents). Pure visualisation, aucune interaction. Un agent terminé affiche une
jauge circulaire qui se vide de 100 % à 0 pendant la rétention (60 s par défaut)
puis sa card disparaît.

## Décisions de cadrage (validées)

| Question | Décision |
|----------|----------|
| Emplacement | Webview dans la barre latérale, conteneur « Claude Agents » existant |
| Vue arbre v1 | Remplacée (treeProvider supprimé) |
| Longueur de contexte (session) | Barre de progression + libellé « 482k / 1000k », limites par modèle codées en dur, repli valeur brute si modèle inconnu |
| Longueur de contexte (agent) | Valeur compacte (« 45k »), sans barre |
| Effort | `effortLevel` global lu dans `~/.claude/settings.json` (l'effort par session n'est pas écrit sur disque) — affiché comme approximation assumée |
| Agents terminés | Jauge circulaire SVG 100 % → 0 sur `finishedAgentRetentionSeconds`, puis disparition. Mode `always` → ✓ grisé permanent sans jauge ; `never` → disparition immédiate |
| Interaction | Aucune (pas de clics, pas de boutons) |
| Approche technique | Webview vanilla (HTML/CSS/TS bundlé esbuild), zéro dépendance runtime |

## Architecture

| Unité | Rôle | Dépend de |
|-------|------|-----------|
| `src/scanner.ts` (enrichi) | Ajoute `contextTokens?: number` sur `SessionNode` et `AgentNode`, et `effortLevel?: string` global sur le résultat de scan. Fusionne les lectures de queue (modèle + titre + usage) en **une seule** `readChunk` par fichier et par scan. | `fs`, `path` |
| `src/cardsView.ts` (nouveau) | `WebviewViewProvider` fin : shell HTML avec CSP stricte, URI du bundle webview, `postMessage({model, settings, now})` après chaque scan. | API VSCode, scanner |
| `src/webview/render.ts` (nouveau) | Fonctions **pures** : `renderProjects(projects, options): string` produit le HTML des cards. Échappement HTML systématique des textes issus des transcripts. Testable sous vitest (pas d'accès DOM). | `labels.ts`, `format.ts` |
| `src/webview/main.ts` (nouveau) | Point d'entrée DOM : réception des `postMessage`, injection du HTML, horloge locale (`requestAnimationFrame` ou `setInterval` 250 ms) qui anime jauges et durées entre deux scans. | `render.ts` |
| `src/extension.ts` (modifié) | Enregistre `cardsView` au lieu du `TreeView`. Polling/watcher/pause inchangés (la pause s'appuie sur `WebviewView.onDidChangeVisibility`). | — |
| `src/treeProvider.ts` | **Supprimé.** | — |

`labels.ts` et `format.ts` sont réutilisés tels quels par `render.ts` (mêmes textes
français). esbuild reçoit un second entrypoint : `src/webview/main.ts` →
`dist/webview.js`. Le CSS vit dans `media/cards.css` (variables `--vscode-*` pour le
thème clair/sombre natif).

### Manifeste

- La vue `claudeAgentsTree` (type arbre) devient `claudeAgentsCards` avec
  `"type": "webview"` dans le même conteneur `claude-agents`.
- L'entrée `viewsWelcome` disparaît (le message vide est rendu par la webview).
- Settings inchangés : `claudeAgents.showFinishedAgents`,
  `claudeAgents.finishedAgentRetentionSeconds`.

## Enrichissements du scanner

### Longueur de contexte

- Source : dernière entrée assistant du transcript (session ou agent), champ
  `"usage"`. Formule : `contextTokens = input_tokens + cache_read_input_tokens +
  cache_creation_input_tokens` (approximation du contexte courant, identique à la
  statusline).
- Extraction dans la **même lecture de queue** que le modèle et le titre
  (`readChunk('tail')`, fenêtre portée à 64 Ko pour les trois extractions).
  La dernière occurrence de `"usage"` dans la fenêtre gagne. Champ absent →
  `contextTokens` undefined → pas de barre sur la card.
- Pour les agents : même mécanique, via le cache mtime existant (`TranscriptMeta`
  gagne un champ `contextTokens`).

### Limites de contexte par modèle

Table codée en dur `MODEL_CONTEXT_LIMITS: Record<string, number>` (clé = famille
abrégée : `fable`, `opus`, `sonnet`, `haiku`). **Les valeurs exactes seront
vérifiées via la référence API Claude au moment du plan d'implémentation** (ne pas
les inventer). Modèle inconnu ou absent → pas de barre, valeur brute seule
(« 482k tokens »).

### Effort

- `effortLevel` lu dans `~/.claude/settings.json` (clé `effortLevel`), une fois par
  scan, try/catch → undefined si absent ou illisible.
- Porté par le résultat de scan (nouveau type `ScanResult { projects, effortLevel }`
  ou champ optionnel équivalent) et affiché sur chaque card session à côté du
  modèle : `fable · xhigh`. C'est la valeur **globale** — assumé comme approximation
  (l'effort par session n'est pas persisté sur disque).

## Cards

### Card session (maquette validée)

```
┌─ Gamini > JSON HTML ────────────── ● ┐
│ marketing · fable · xhigh            │
│ contexte ████████░░░░  482k / 1000k  │
│ démarrée il y a 2 j · activité 3 s   │
│ ├ ● Analyse des bugs      12 s · 45k │
│ ├ ◔ Exploration du code   (jauge)    │
│ └ ▸ Workflow wf_e50 (2/3)            │
│    ├ ✓ review:perf          ◔        │
│    └ ● review:bugs        8 s · 32k  │
└──────────────────────────────────────┘
```

- **Groupement :** en-têtes de projet (basename du cwd), projets alphabétiques,
  sessions par démarrage décroissant — tri stable de la v1 conservé.
- **Titre :** titre custom (ou `name` du registre) en gras.
- **Statut :** ● verte avec pulse CSS discret si active (règle v1 : transcript
  < 30 s OU au moins un agent actif), ○ sinon.
- **Ligne méta :** badge projet · modèle abrégé · effort global.
- **Barre contexte :** pourcentage rempli = contextTokens / limite du modèle ;
  couleur verte < 60 %, orange 60-85 %, rouge > 85 % ; libellé « 482k / 1000k »
  (formatTokens : « 482k », « 1,2M »). Sans limite connue : libellé brut sans barre.
- **Ligne temps :** « démarrée il y a X · activité Y » (formats v1).

### Sous-cards agents

- Une ligne par agent direct, puis un sous-groupe par workflow (label
  « Workflow <id> (n/m) ») avec ses agents. Ordre chronologique v1.
- Agent actif : ● verte, description de tâche, durée depuis la dernière écriture,
  contexte compact (« 45k », si disponible).
- Agent terminé (modes `temporarily`) : l'icône devient une **jauge circulaire SVG**
  (anneau, `stroke-dasharray`) qui se vide linéairement de 100 % à 0 sur
  `finishedAgentRetentionSeconds` à partir de `lastActivity`, calculée avec
  l'horloge **locale** de la webview (fluide, indépendante du polling 2 s).
  À 0 → la ligne disparaît (le prochain rendu la retire ; entre deux messages,
  `main.ts` la masque). Un workflow dont toutes les lignes ont disparu est masqué.
- Mode `always` : ✓ grisé permanent, pas de jauge. Mode `never` : les terminés
  n'apparaissent jamais.
- Le compteur de workflow (n/m) compte tous les agents, masqués compris (règle v1).

## Flux de données

1. Extension : scan toutes les 2 s (pause quand la webview est masquée —
   `WebviewView.onDidChangeVisibility` ; scan immédiat à la ré-affichage ; watcher
   `fs.watch` inchangé).
2. Après chaque scan : `webview.postMessage({ projects, effortLevel, settings, now })`
   où `settings` = les deux settings agents terminés (lus côté extension).
3. Webview : `render.ts` régénère le HTML complet (une dizaine de cards — pas de
   diffing nécessaire), `main.ts` l'injecte puis anime localement jauges et durées
   toutes les ~250 ms jusqu'au message suivant.
4. La webview ne lit **jamais** le disque et n'envoie **aucun** message vers
   l'extension (lecture seule, aucune interaction).

## Gestion d'erreurs

- Identique v1 : tout passe par l'Output Channel, aucune popup.
- Aucune session → la webview affiche « Aucune session Claude en cours. »
- `settings.json` illisible → effort simplement omis.
- CSP stricte : `default-src 'none'`, script et style limités aux ressources du
  bundle via `webview.asWebviewUri` + nonce. Aucune ressource externe.
- Tous les textes issus des transcripts (titres, descriptions) sont échappés HTML
  par `render.ts` (fonction `escapeHtml` testée).

## Tests

- **Scanner (vitest, fixtures existantes étendues) :** `contextTokens` extrait du
  dernier `usage` (session et agent), lecture unifiée (modèle + titre + usage dans
  une fenêtre), `effortLevel` lu/absent/illisible, `TranscriptMeta` avec contexte.
- **`render.ts` (vitest) :** HTML produit — titre présent et échappé (`<script>`
  dans un titre ne s'exécute pas), barre au bon pourcentage et bonne couleur,
  valeur brute sans limite connue, jauge présente pour un agent terminé en mode
  `temporarily` et absente en `always`, message vide sans session.
- **Couche VSCode (`cardsView.ts`, `main.ts`) :** fine, non testée unitairement ;
  vérification manuelle F5 puis vsix (statuts, jauges fluides, disparition à 0,
  thème clair/sombre).

## Hors périmètre

- Toute interaction (clic, boutons, filtres).
- Tokens cumulés / coûts (rôle de ClaudeCockpit).
- Effort réel par session (non persisté par Claude Code à ce jour).
- Vue « onglet éditeur » large (v3 possible si la sidebar ne suffit pas).
- Récursivité au-delà de session → agents + workflows → agents (pas d'imbrication
  observée sur disque ; le rendu suit la hiérarchie que fournit le scanner).

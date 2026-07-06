# Claude Agents — Vue arbre des sessions et agents Claude Code dans VSCode

**Date :** 2026-07-03
**Statut :** validé par Cyril
**Projet :** `c:\Users\cyril\Documents\Developpement\PANDAPROG\ClaudeAgents`

## Objectif

Extension VSCode affichant en temps quasi réel, dans une vue arbre native de la barre
d'activité, toutes les sessions Claude Code en cours sur la machine (tous projets
confondus), avec leurs agents et sous-agents. Pure visualisation en v1 : aucun clic,
aucune action.

## Décisions de cadrage (validées)

| Question | Décision |
|----------|----------|
| Portée | Tous les projets de la machine, groupés par projet |
| Infos par nœud | Statut actif/inactif, durée / dernière activité, modèle, description de tâche des agents |
| Contenu | Sous-agents actifs **et** terminés (grisés avec ✓) des sessions en cours |
| Agents terminés | Visibilité configurable : toujours / temporairement (défaut, masqués 60 s après leur dernière activité) / jamais |
| Interaction au clic | Aucune en v1 |
| Fréquence de polling | 2 secondes |
| Approche | Extension autonome (approche A) — lit `~/.claude` directement, sans dépendance à ClaudeCockpit |

## Architecture

Extension VSCode autonome, TypeScript strict, bundlée avec esbuild. Zéro dépendance
runtime (API VSCode + `fs`/`path` de Node uniquement). Contribue un conteneur de vue
dans la barre d'activité (icône « Claude Agents ») avec une vue arbre.

| Module | Rôle | Dépend de |
|--------|------|-----------|
| `src/scanner.ts` | Logique pure : scanne un répertoire racine (par défaut `~/.claude`) et produit le modèle `ProjectNode[] → SessionNode[] → AgentNode[]`. Aucune dépendance à l'API VSCode. | `fs`, `path` |
| `src/treeProvider.ts` | `TreeDataProvider<TreeNode>` fin : traduit le modèle en `TreeItem` (icônes, labels, descriptions, tooltips). | API VSCode, `scanner` |
| `src/extension.ts` | `activate()` : enregistre la vue, le watcher, le timer de polling, l'Output Channel. `deactivate()` : nettoyage. | API VSCode, les deux modules |

Le paramètre « répertoire racine » de `scanner.ts` permet les tests unitaires sur des
fixtures sans toucher au vrai `~/.claude`.

## Sources de données et détection

### Sessions en cours

- Registre : `~/.claude/sessions/<pid>.json`, un fichier par instance Claude Code,
  contenant `{pid, sessionId, cwd, startedAt, version, kind, entrypoint, name, nameSource}`.
- **Vivacité :** `process.kill(pid, 0)` — si exception `ESRCH`, le fichier est périmé
  et la session est ignorée. Les fichiers périmés ne sont **pas** supprimés (on ne
  touche jamais à `~/.claude` en écriture).
- Une session vivante est affichée même si son transcript est introuvable (infos du
  registre seul).

### Transcript et activité d'une session

- Chemin : `~/.claude/projects/<cwd-encodé>/<sessionId>.jsonl`.
- Encodage du chemin : `cwd.replace(/[^a-zA-Z0-9]/g, '-')`. La correspondance du
  répertoire projet est **insensible à la casse** (piège connu : `c--Users-cyril-...`
  vs `C--Users-cyril-...`).
- **Statut :** ● active si `mtime` du transcript < 30 s **ou si au moins un de ses
  agents (directs ou de workflow) est actif** — une session qui délègue n'écrit plus
  dans son propre transcript. Sinon ○ inactive.
- Dernière activité = max(`mtime` du transcript, `mtime` des agents) ; début = `startedAt` du registre.
- **Nom :** dernier titre custom trouvé dans le transcript (lignes `{"type":"custom-title",
  "customTitle":…}`, lecture bornée de 64 Ko en queue, mémorisé par sessionId quand il
  sort de la fenêtre) ; à défaut, `name` du registre.

### Sous-agents

- Agents directs : `<projectDir>/<sessionId>/subagents/agent-<id>.jsonl`.
- Agents de workflow : `<projectDir>/<sessionId>/subagents/workflows/<wfId>/agent-<id>.jsonl`,
  groupés sous un nœud « Workflow <wfId> » avec compteur de progression (n terminés / total).
- **Statut agent :** `mtime` < 30 s → ● actif ; sinon ✓ terminé (grisé,
  `ThemeColor descriptionForeground`).
- Seuls les dossiers `subagents/` des **sessions vivantes** sont scannés (travail borné).

### Extraction modèle et description (lectures bornées)

- **Description de tâche d'un agent :** premiers ~8 Ko du transcript agent ; première
  entrée de type message user = prompt de la tâche (le `content` peut être une chaîne
  ou un tableau de blocs) ; première ligne du texte, tronquée à 60 caractères.
- **Modèle d'une session/agent :** derniers ~16 Ko du fichier, parcourus à rebours à la
  recherche du dernier champ `"model"` d'une entrée assistant. Abréviation à l'affichage
  (`claude-fable-5` → `fable`).
- Jamais de lecture complète d'un transcript (certains dépassent plusieurs Mo).
- Champ manquant ou illisible → info simplement omise du label, pas d'erreur.

### Limite assumée (v1)

Un agent qui réfléchit > 30 s sans écrire dans son transcript apparaît temporairement
« terminé », puis redevient actif à la prochaine écriture. L'heuristique mtime est
acceptée pour la v1.

## Structure de l'arbre

```
📁 ClaudeAgents                                  ← projet (basename du cwd)
   ● claudeagents-63 · fable · démarrée il y a 25 min
      ● Analyse des bugs — actif · 12 s
      ✓ Exploration du code — terminé il y a 40 s
      ▸ Workflow wf_e5062398 (2/3 terminés)
         ✓ review:perf
         ● review:bugs — actif
📁 matchem-dp
   ○ matchem-63 · fable · inactive depuis 40 min
```

- **Niveau 1 — Projet :** basename du `cwd` ; tooltip = chemin complet. Les sessions
  de même `cwd` sont regroupées.
- **Niveau 2 — Session :** label = `name` du registre ; description = modèle +
  temps relatif (démarrage / dernière activité) ; icône ●/○ (ThemeIcon `circle-filled` /
  `circle-outline`, couleur `charts.green` si active).
- **Niveau 3 — Agents et workflows :** label = description de tâche ; description =
  statut + temps relatif. Workflow = nœud repliable avec compteur.
- **Niveau 4 — Agents de workflow :** même rendu que niveau 3.
- **Tri STABLE entre deux scans** (retour d'usage : le réordonnancement à chaque bascule
  d'activité rendait l'arbre sautillant) : projets alphabétiques, sessions par démarrage
  décroissant, agents par ordre chronologique de création. L'activité se lit sur les
  icônes, pas sur la position.
- **Arbre vide :** message d'accueil `viewsWelcome` : « Aucune session Claude en cours ».
- `collapsibleState` **constant** (sessions et workflows toujours `Expanded`) : une valeur
  qui change entre deux refresh fait réinitialiser par VSCode l'état plié/déplié choisi
  par l'utilisateur.

## Configuration (settings VSCode)

| Setting | Type | Défaut | Effet |
|---------|------|--------|-------|
| `claudeAgents.showFinishedAgents` | enum `always` \| `temporarily` \| `never` | `temporarily` | `always` : les agents terminés restent affichés (grisés) tant que la session vit. `temporarily` : ils disparaissent après le délai ci-dessous. `never` : seuls les agents actifs sont affichés. |
| `claudeAgents.finishedAgentRetentionSeconds` | number | `60` | Délai (en secondes depuis la dernière activité de l'agent) avant masquage, utilisé uniquement en mode `temporarily`. |

- Le compteur de progression d'un workflow (« 2/3 terminés ») compte **tous** les agents
  du workflow, y compris ceux masqués par la rétention.
- Un nœud workflow dont tous les enfants sont masqués est masqué lui aussi.
- Les changements de setting sont pris en compte au prochain cycle de polling
  (pas de rechargement nécessaire).

## Rafraîchissement

- **Watcher :** `fs.watch` sur `~/.claude/sessions/` → rafraîchissement immédiat quand
  une session apparaît ou disparaît. En cas d'échec du watcher (rare sous Windows),
  le polling seul suffit.
- **Polling :** timer de **2 s** qui relance le scan complet et émet
  `onDidChangeTreeData` (rafraîchissement global ; l'arbre est petit, pas
  d'optimisation par nœud nécessaire).
- **Pause :** le polling s'arrête quand la vue n'est pas visible
  (`TreeView.onDidChangeVisibility`) et reprend, avec un scan immédiat, quand elle
  redevient visible.

## Gestion d'erreurs

| Cas | Comportement |
|-----|--------------|
| `~/.claude/sessions/` absent ou vide | Arbre vide + message d'accueil, aucune erreur |
| JSON de registre corrompu | Fichier ignoré, ligne dans l'Output Channel « Claude Agents » |
| PID invalide / vérification impossible | Session considérée morte, ignorée |
| Répertoire projet ou transcript introuvable | Session affichée avec les seules infos du registre |
| Erreur de lecture d'un transcript agent | Agent affiché avec un label générique (`agent-<id>`) |

Aucune popup d'erreur : tout passe par l'Output Channel.

## Tests

- **Unitaires (vitest)** sur `scanner.ts` avec des fixtures dans `src/__tests__/fixtures/`
  reproduisant l'arborescence `~/.claude` : session vivante (PID du process de test),
  session morte (PID improbable), agents actifs/terminés (mtimes manipulés), workflow,
  JSON corrompu, transcript manquant.
- **Manuels :** F5 → Extension Development Host avec les vraies sessions de la machine.
- `treeProvider.ts` et `extension.ts` restent fins ; pas de tests d'intégration VSCode en v1.

## Packaging et distribution

- `package.json` : `contributes.viewsContainers.activitybar` + `contributes.views`,
  `activationEvents` implicites (vue), `engines.vscode` récent.
- Scripts : `npm run build` (esbuild), `npm run watch`, `npm test` (vitest),
  `npm run package` (`vsce package` → `.vsix`).
- Installation locale : `code --install-extension claude-agents-<version>.vsix`.
- Pas de publication marketplace en v1.

## Hors périmètre (v1)

- Toute interaction au clic (ouverture de transcript, focus terminal, kill de session).
- Filtre « projet courant seulement ».
- Tokens, coûts, statistiques d'usage (c'est le rôle de ClaudeCockpit).
- Historique des sessions terminées.
- Publication marketplace.

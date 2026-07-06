# Claude Agents

Real-time view of the Claude Code sessions, agents and sub-agents running on your
machine, across all projects. **100% local, read-only access to `~/.claude`.**

![Claude Agents preview](https://raw.githubusercontent.com/PandaProgParis/ClaudeAgents/main/assets/screenshot.png)

## Features

- **All your sessions at a glance** — one card per Claude Code session, grouped by project, refreshed every 2 s.
- **Sub-agent tree** — sub-agents and workflows shown under their session, with parent → child → grandchild indentation reconstructed from filiation.
- **Live activity** — an active agent shows what it is doing: ✎ editing, ⏵ running, 🔍 searching, 📖 reading, 🤖 delegating…
- **Progress checklist** — the session's current task list (✅ done, 🔵 in progress, ⬜ to do) with a `done/total` counter, so you see exactly where a multi-step feature stands.
- **Context & model** — colored model badge (fable, opus, sonnet, haiku) and a context bar “386k / 1M” with a ⚠ alert above 85%.
- **Git branch** and **smart title** (AI-generated session title when you haven't renamed it manually).
- **Waiting for you** — a session blocked on a question turns orange ⏳ with the question text, and is never hidden.
- **Current-project filter** — a button toggles between all projects and just the open workspace.
- **Bilingual** — the UI follows your VS Code language (English / French).

![Per-session task checklist](https://raw.githubusercontent.com/PandaProgParis/ClaudeAgents/main/assets/screenshot2.png)

## Requirements

[Claude Code](https://claude.com/claude-code) installed and used on the machine:
the extension reads its `~/.claude` folder.

## Install

- From VS Code: search for **Claude Agents** in the Extensions tab.
- Or from the command line: `code --install-extension pandaprog.claude-agents`

## Privacy

100% local. The extension reads `~/.claude` **read-only**, never writes anything,
never touches `.credentials.json`, and **sends no data** over the network.

## Settings

| Setting | Default | Effect |
|---------|---------|--------|
| `claudeAgents.showFinishedAgents` | `temporarily` | `always`: finished agents kept with a ✓ · `temporarily`: gauge then disappear · `never`: active only |
| `claudeAgents.finishedAgentRetentionSeconds` | `60` | Gauge duration before a finished agent disappears (`temporarily` mode) |
| `claudeAgents.inactiveSessionRetentionMinutes` | `10` | Minutes of inactivity before a session is hidden (`0` = always show) |

## How it works

Read-only access to `~/.claude`: the live-session registry
(`sessions/<pid>.json`, PID liveness check), the transcripts
(`projects/…/<sessionId>.jsonl` — activity via mtime, model, title, context from
the last `usage` block, git branch, last tool) and the sub-agents
(`…/subagents/**`, filiation reconstructed from the `toolUseId` in the
`meta.json` files). Reads are bounded and cached by mtime: an idle session costs
almost nothing.

## Development

```bash
npm install
npm test           # unit tests (vitest)
npm run build      # esbuild → dist/extension.js + dist/webview.js
npm run package    # → claude-agents-<version>.vsix
# F5 in VS Code → Extension Development Host
```

Contributions welcome on [GitHub](https://github.com/PandaProgParis/ClaudeAgents).

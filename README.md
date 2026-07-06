# Claude Agents

Real-time view of the Claude Code sessions, agents and sub-agents running on your
machine, across all projects. **100% local, read-only access to `~/.claude`.**

> ⭐ **Enjoying Claude Agents?** A [star on GitHub](https://github.com/PandaProgParis/ClaudeAgents) and a
> [review on the Marketplace](https://marketplace.visualstudio.com/items?itemName=pandaprog.claude-agents&ssr=false#review-details)
> help other Claude Code users find it. Bug or idea? [Open an issue](https://github.com/PandaProgParis/ClaudeAgents/issues).

![Claude Agents preview](https://raw.githubusercontent.com/PandaProgParis/ClaudeAgents/main/assets/screenshot.png)

## Features

- **All your sessions at a glance** — one card per Claude Code session, grouped by project, refreshed every 2 s.
- **Sub-agent tree** — sub-agents shown under their session, with parent → child → grandchild indentation reconstructed from filiation.
- **Workflows as a strip of squares** — each workflow appears by name with one square per agent (grey done, blue running, red failed) and a “24/33 ✓ · 3 running” counter; only the running or failed agents are listed underneath, numbered #1, #2… to match their square. Hover a square for its description, model and duration. Click the workflow line to unfold its description and the phases declared by its script, plus a table of all its agents (label, model, context, run time).
- **Live activity** — the session shows whether the model is thinking (💭) or which tool is running (✎ editing, ⏵ running, 🔍 searching, 📖 reading, 🤖 delegating…), and goes quiet the moment the turn ends, unless sub-agents it launched are still running (🤖 delegating). Sub-agents show their current tool too.
- **Background commands** — a dev server or a long build started in the background is listed under its session (the agent's own description of it), with its duration and its local URL as a clickable link, until it finishes. The URL is the one the command itself printed; nothing is guessed.
- **Progress checklist** — the session's current task list (✅ done, 🔵 in progress, ⬜ to do) with a `done/total` counter, so you see exactly where a multi-step feature stands. A fully completed list disappears as soon as you move on to your next prompt.
- **Context & model** — colored model badge (fable, mythos, opus, sonnet, haiku; any other model id is shown verbatim) and a context bar “386k / 1M” with a ⚠ alert above 85%.
- **Git branch** and **smart title** (AI-generated session title when you haven't renamed it manually).
- **Waiting for you** — a session blocked on a question turns orange ⏳ with the question text, and is never hidden. Once the panel has been opened, the activity bar icon shows a badge with the number of sessions waiting for your answer, kept up to date even while the view is hidden.
- **Current-project filter** — a button toggles between all projects and just the open workspace.
- **Bilingual** — the UI follows your VS Code language (English / French).

![Per-session task checklist](https://raw.githubusercontent.com/PandaProgParis/ClaudeAgents/main/assets/screenshot2.png)

## What's new in 0.8.1

- **Main agent status** read from the transcript itself: 💭 thinking, running tool, 🤖 delegating to background sub-agents, or turn over. No more “paused” card during a long think.
- **Background commands** (a dev server, a long build) listed under their session with their duration and the local URL they printed, until they finish.
- **Workflows** under their real name, as a strip of one square per agent; failed agents flagged in red (from the run's `journal.jsonl`), agents numbered to match their square. Click a workflow to unfold its description, the phases its script declares and a table of all its agents.
- **Progress checklist** per session (✅ done, 🔵 in progress, ⬜ to do); a fully completed list disappears as soon as you move on to your next prompt.
- **Activity bar badge** with the number of sessions waiting for your answer, even while the panel is hidden.
- **Models**: Claude Opus 5 and Mythos added with their 1M context window; any unknown model id is shown verbatim instead of being hidden.
- For contributors: `npm run dev` previews the cards live in a browser over your real `~/.claude`, no VS Code reload needed.

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
| `claudeAgents.showFinishedAgents` | `temporarily` | Finished (✓) and failed (✗) agents, and workflows where nothing runs anymore — `always`: kept · `temporarily`: gauge then disappear · `never`: active only |
| `claudeAgents.finishedAgentRetentionSeconds` | `60` | Gauge duration before a finished or failed agent (or a settled workflow) disappears (`temporarily` mode) |
| `claudeAgents.inactiveSessionRetentionMinutes` | `10` | Minutes of inactivity before a session is hidden (`0` = always show) |

## How it works

Read-only access to `~/.claude`: the live-session registry
(`sessions/<pid>.json`, PID liveness check), the transcripts
(`projects/…/<sessionId>.jsonl` — activity via mtime, model, title, context from
the last `usage` block, git branch, last tool, task list from the last
`TodoWrite` call, pending question when an `AskUserQuestion` has no result yet),
the sub-agents (`…/subagents/**`, filiation reconstructed from the `toolUseId`
in the `meta.json` files) and the workflows (`…/subagents/workflows/<runId>/`,
failed agents from the run's `journal.jsonl`, name from the saved workflow
script). Reads are bounded and cached by mtime: an idle session costs almost
nothing. The view refreshes every 2 s while visible (5 s while hidden, for the
badge only) and reacts within a moment when a session starts or ends.

## Development

```bash
npm install
npm test           # unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # esbuild → dist/extension.js + dist/webview.js
npm run dev        # live preview of the cards at http://localhost:5173 — real CSS and
                   # webview script over your real ~/.claude, auto-reload, no VS Code reload
npm run package    # → claude-agents-<version>.vsix
# F5 in VS Code → Extension Development Host
```

Contributions welcome on [GitHub](https://github.com/PandaProgParis/ClaudeAgents).

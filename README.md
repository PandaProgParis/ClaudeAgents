<div align="center">

# <img src="assets/icon.png" alt="Claude Agent Map & Usage icon" width="40" align="center"> Claude Agent Map & Usage

**Every Claude Code session, agent and plan limit - live, in your VS Code sidebar.**

[![Install from the Marketplace](https://img.shields.io/badge/VS%20Code-Install-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=pandaprog.claude-agents)[![GitHub stars](https://img.shields.io/github/stars/PandaProgParis/ClaudeAgents?style=flat&logo=github)](https://github.com/PandaProgParis/ClaudeAgents)![100% local](https://img.shields.io/badge/100%25-local-2ea44f)![License: MIT](https://img.shields.io/badge/License-MIT-blue)

<p align="center">
  <sub><b>Sub-agents</b> - nested delegations, live</sub><br>
  <img src="assets/screen-sub-agents.png" alt="Sub-agent tree: nested delegations with model, duration and tokens">
</p>
<p align="center">
  <sub><b>Plan usage</b> - 5h, weekly...</sub><br>
  <img src="assets/screen-usage_c.png" alt="Collapsed plan usage card: 5h and weekly gauges on one line">
</p>
<p align="center">
  <sub><b>Agent map</b> - every agent, its duration and tokens</sub><br>
  <img src="assets/screen-agents.png" alt="Agent map: every agent of a session with its duration and tokens">
</p>

<p align="center">
  <sub><b>Waiting for you</b> - and your dev servers' live links</sub><br>
  <img src="assets/screen-question.png" alt="Session waiting for an answer, in orange, with live localhost links">
</p>

<p align="center">
  <sub><b>Workflows</b> - one square per agent</sub><br>
  <img src="assets/screen-tasks-claude.png" alt="Workflow strip: one square per agent, done, running or failed">
</p>

<p align="center">
  <sub><b>Plan usage</b> - 5h, weekly, per model</sub><br>
  <img src="assets/screen-usage.png" alt="Plan usage: session, weekly and per-model gauges">
</p>

<p align="center">
  <sub><b>Task list</b> - progress at a glance</sub><br>
  <img src="assets/screen-tasks-superpowers.png" alt="Session task checklist with its done/total counter">
</p>

</div>

## Install

1. Search **Claude Agent Map & Usage** in the Extensions tab, or run `code --install-extension pandaprog.claude-agents`.
2. Click the **Claude Agents** icon in the activity bar.
3. That's it - every running [Claude Code](https://claude.com/claude-code) session shows up.

Nothing to configure. The extension reads `~/.claude` on the same machine, read-only, and sends nothing anywhere.

## What you see

- **Live activity** per session - 💭 thinking, ✎ editing, ⏵ running, 🤖 delegating.
- **Every agent** of the session, finished ones included, with the same duration and tokens as Claude Code.
- **Orange when a session asks you something**, with a badge on the activity bar icon.
- **Context bar and model**, prompt cache ⏱, effort level.
- **Background commands** with their live `localhost` links.
- **Failed agent?** Hover it to read why.

## Plan usage

Your claude.ai limits at the bottom of the view, fed by **[Claude Usage](https://github.com/PandaProgParis/ClaudeUsage)**, a small tray app that reads them for you - no API key.

<p align="center">
  <img src="assets/panel.png" alt="Claude Usage: gauges panel above the Windows tray">
</p>

<p align="center">
  <img src="assets/settings.png" alt="Claude Usage settings: output file" width="300">
</p>

1. Install [Claude Usage](https://github.com/PandaProgParis/ClaudeUsage/releases/latest) and log in to claude.ai.
2. Copy the **Output file** path from its settings.
3. Paste it into `claudeAgents.usageFile`. The gauges appear.

Your limits also sit at the far right of the **status bar**, with a live countdown to each reset: `Session 2% 4:09:21 · Weekly 18% 3d 04h`. A limit turns yellow at 80% and red at 95%. The small `⌄` next to it switches to rings, moves it to the left, hides it, or toggles the card in the view.

## Settings

| Setting | Default | Effect |
|---------|---------|--------|
| `claudeAgents.showFinishedAgents` | `temporarily` | Finished agents: `always` · `temporarily` · `never` |
| `claudeAgents.finishedAgentRetentionSeconds` | `60` | How long they stay in `temporarily` mode |
| `claudeAgents.inactiveSessionRetentionMinutes` | `10` | Hide a session after this inactivity (`0` = never) |
| `claudeAgents.alwaysShowWorkspaceSessions` | `true` | Keep the open workspace's sessions visible |
| `claudeAgents.showUsage` | `true` | Show the plan usage card |
| `claudeAgents.usageFile` | `""` | Path of the JSON file written by Claude Usage |
| `claudeAgents.usageStatusBar` | `text` | Usage in the status bar: `text` · `rings` · `off` |
| `claudeAgents.usageStatusBarSide` | `right` | Status bar side: `right` · `left` |

## What's new in 1.0.0

- **Plan usage in the status bar** - session and weekly limits with a live countdown to the reset, or as rings.
- **Settings gear** in the view title, next to the project filter.
- Usage card arrow now points up when collapsed.

## What's new in 0.9.0

- **Agent map** - click `N agents` for every agent of the session, with exact duration and tokens.
- **Plan usage** - gauges at the bottom of the view, with the new [Claude Usage](https://github.com/PandaProgParis/ClaudeUsage) app.
- **Per-session effort**, **prompt cache ⏱**, and **why an agent failed** on hover.
- Sessions of the open workspace stay visible.

## Privacy

Read-only on `~/.claude`, never touches `.credentials.json`, no network except a TCP check on `127.0.0.1` to tell a live dev server from a dead one.

---

<div align="center">

⭐ Useful? [Star it on GitHub](https://github.com/PandaProgParis/ClaudeAgents) or [leave a review](https://marketplace.visualstudio.com/items?itemName=pandaprog.claude-agents&ssr=false#review-details) · [Report an issue](https://github.com/PandaProgParis/ClaudeAgents/issues)

<sub>Development: `npm install` · `npm test` · `npm run dev` (live preview on your real `~/.claude`) · `npm run package` · MIT</sub>

</div>

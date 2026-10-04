# DuoReview

**Let Claude Code and Codex split a job, review each other's work, and hand you the final call when they disagree.**

[Türkçe](README.tr.md) · MIT · Node ≥ 22.13 · Windows ✔ · macOS/Linux: untested, see [Limitations](#limitations)

![DuoReview](docs/screenshot-en.png)
*Screenshot with demo data.*

DuoReview is an [MCP](https://modelcontextprotocol.io) server plus a small Electron app. It runs the
`claude` and `codex` CLIs side by side in two terminals and gives them one shared task board.

## Why

A single model that writes and then reviews its own code tends to grade its own homework. Models from
different vendors have different blind spots, so here **Claude's work is reviewed by Codex and the other way around**.

- **Captain + worker.** One agent (you choose which) reads your brief and splits it into small tasks. Both agents then work through the board.
- **Cross-review.** Nobody reviews their own task. Only `blocker` / `major` findings can block a task; minor notes do not.
- **You break ties.** After 3 review rounds without agreement the task becomes a *dispute* and the decision is yours: accept, re-review, or send it back with your instruction.
- **File-conflict guard.** Each task lists the files it touches; an agent cannot start a task that overlaps with a partner's unfinished one.
- **Quota aware.** Live 5-hour and weekly usage meters. When a quota is full, the app stops nudging that agent instead of burning tokens.
- **Lean on tokens.** The task spec is sent once per session, replies are small, and effort/model profiles (economy / balanced / powerful) are one click away.
- **Does not touch your global config.** MCP wiring is passed per session (`--mcp-config` for Claude, `-c` overrides for Codex). Board data is stored outside your project, so your repo stays clean.
- **English and Turkish UI, prompts and tool texts** (language menu in the header).

## Quick start

Requirements: Node.js ≥ 22.13, and the `claude` and `codex` CLIs installed and logged in.

```powershell
npm install
npm run app -- --project "C:\path\to\your\project"
```

Then pick the captain, write a brief ("add a login page and its tests"), and press **Start team**.
The app starts both agents in your project folder, wires up the MCP server and sends them the protocol.

Other commands:

| Command | What it does |
|---|---|
| `npm run build` | Compile the MCP server (`tsc`) |
| `npm start` | Run the MCP server alone over stdio (needs `AGENT_ID` and `DUOREVIEW_DIR`) |
| `npm test` | Build and run all tests (no model quota is used) |

### Using the MCP server without the app

Set the same `DUOREVIEW_DIR` for both agents and a different `AGENT_ID` (`claude` / `codex`):

```json
{
  "mcpServers": {
    "duoreview": {
      "command": "node",
      "args": ["/path/to/dist/server.js"],
      "env": { "AGENT_ID": "claude", "DUOREVIEW_DIR": "/path/to/shared-data", "DUOREVIEW_LANG": "en" }
    }
  }
}
```

Tools: `next_action`, `post_tasks`, `assign_task`, `claim_task`, `submit_task`, `review_task`, `status`, `send_prompt`, `read_inbox`.
See [TEAM.md](TEAM.md) for the loop the agents follow.

## How it works

```
Claude Code ─┐                       ┌─ Codex CLI
             ├─ MCP ─ duoreview ───┤
 (terminal)  ┘   SQLite task board   └─ (terminal)
                       ▲
   Electron app: terminals, board, referee (nudges idle agents), usage meters, dispute panel
```

Task states: `TODO → WORKING → REVIEW → DONE`, with `REWORK` (up to 3 rounds) and `DISPUTE`.

## Limitations

- Developed and tested on **Windows**. On macOS/Linux the `claude`/`codex` lookup goes through `PATH`, but that path has not been run on a real Mac or Linux box yet (CI runs the non-Electron tests on Ubuntu). Reports welcome.
- If a CLI is installed somewhere unusual, point to it: `DUOREVIEW_CLAUDE_BIN=/path/to/claude`, `DUOREVIEW_CODEX_BIN=/path/to/codex`.
- Both agents share one working directory (conflicts are prevented with the `touches` check, not git worktrees).
- Exactly two agents: Claude Code and Codex CLI.
- Source-only distribution for now: run it from a clone (`npm install` + `npm run app`). No npm package or packaged installer yet.
- `node:sqlite` is still experimental in Node, so you will see a warning.

## Security

The agents run with **your** user rights in **your** project folder. For Codex, the DuoReview MCP tools are auto-approved
(`default_tools_approval_mode="approve"`); for Claude only the `mcp__duoreview` tools are pre-allowed. Everything else
still goes through each CLI's normal approval prompts, and the referee never presses Enter on an approval question for you.
Credentials stay in the CLIs' own stores (`~/.claude`, `~/.codex`); DuoReview does not read, store or send them (it only reads usage percentages from local Codex session logs for the meters, and never touches the network).
Use it on projects you would be comfortable letting a coding agent edit, and keep commits/pushes manual.

## Roadmap

- Git worktree per agent plus a diff view and merge step
- "Verify command" gate (build/tests must pass before a task can enter review)
- macOS/Linux support
- More agents (Gemini CLI, …)

## License

[MIT](LICENSE)

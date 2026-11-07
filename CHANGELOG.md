# Changelog

## 0.1.0 — unreleased
- Evidence-based review: the server snapshots the working tree when a task is taken and submitted; the reviewer gets the task's own diff plus the files changed outside its `touches`.
- Acceptance criteria per task; the reviewer marks each with evidence and cannot approve with an unmet one.
- `alternative` in `review_task` and the captain's `triage` step: a simpler or faster way proposed in review becomes a task or is rejected with a reason.
- Optional verify command run on `submit_task` (setting in the app); Codex's MCP tool timeout raised for it.
- Fix: a task waiting in review no longer lets a partner start an overlapping task, and `after_all` review does not wait for such a task.
- Fix: dependencies inside one `post_tasks` call (`key`); before, only existing ids worked and splitting the plan skipped the plan approval.
- Fix: `read_inbox` could mark as read a message that arrived between reading and marking. The `status` header is translated. Gemini's global registration is cleaned up after a crash.
- `bench/swebench.mjs`: headless SWE-bench runner (single agent vs team), official evaluation in Docker, comparison report.
- Skills panel: adds a skill folder to the project's `.claude/skills` and `.agents/skills` (Codex and agy read the latter) and lists or removes them. The header wraps instead of pushing "Start team" off narrow screens.
- Shared task board over MCP for Claude Code and Codex: captain/worker roles, cross-review, dispute → user decides.
- Electron app: two terminals, board, referee, usage meters, dispute panel.
- English and Turkish UI, prompts and tool texts.
- Executable lookup via `PATH` plus `DUOREVIEW_CLAUDE_BIN` / `DUOREVIEW_CODEX_BIN` overrides.
- Renderer input validation, sandboxed window.
- Joint kickoff (default): both agents analyse the brief independently, notes stay hidden until both are in, then a discussion; the plan needs the partner's agreement. New tools `post_note`, `discuss`, `open_thread`, `read_thread`, `drop_task`.
- Notes and discussion tab with a side-by-side reader and Markdown export.
- Rules, role and brief are delivered with the first `next_action` reply instead of being typed into the terminal; style rules against filler in code and prose.
- Enter is sent after the terminal echo settles and retried if the agent did not start; Codex startup menus (update, folder trust) count as approval prompts; a bare "approve" on screen no longer does.
- Chained replies: mutating tools return the next step and `next_action` takes the next task itself (four tool calls for a plain task in the measured scenario; kickoff, discussions and rework excluded). `status(id)` returns one task in full.
- Task dependencies (`depends_on` in `post_tasks`); a task cannot be taken while the plan discussion is open; path normalisation in the file-conflict guard.
- Per-agent counters for tool calls and characters sent/received, shown in the header.
- Fix: a message containing approval-prompt wording (e.g. "do you want to") was mistaken for an approval question once echoed, so Enter was never pressed and the message was retried forever.
- Publishable npm package: only the MCP server is shipped (`dist/`); Electron, node-pty and xterm moved to devDependencies.
- Model menus list all models (Codex from `~/.codex/models_cache.json`) with per-model effort levels.
- Gemini through the Antigravity CLI (`agy`) as a third agent. Team menu: Claude + Codex + Gemini or any two; kickoff notes stay hidden until all are in, turns rotate, a discussion closes once everyone but the last proposer agrees, and each task's reviewer is the next agent after its owner. `send_prompt` takes an optional `to`. The app registers the `duoreview` MCP server and the `mcp(duoreview/*)` permission in `agy`'s global settings while Gemini runs and removes them when it stops; `DUOREVIEW_GEMINI_BIN` override.

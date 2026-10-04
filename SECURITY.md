# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private
vulnerability reporting ("Security" tab → "Report a vulnerability") on this repository.
Expect an initial reply within a few days.

## What to know

DuoReview launches the `claude` and `codex` CLIs with **your** user rights in **your** project folder and
coordinates them through a local MCP server and a local SQLite file. It makes no network calls of its own and does not
read or store CLI credentials. See the *Security* section of the [README](README.md) for what is auto-approved.

Hardening already in place: `contextIsolation` + `sandbox` + CSP in the Electron window, allow-list validation of every
value coming from the renderer (`app/validate.js`), parameterized SQL.

## Supported versions

Only the latest release / `main` branch.

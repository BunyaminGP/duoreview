# Contributing

Thanks for helping! The project is small: an MCP server (`src/`, TypeScript) and an Electron app (`app/`, plain JS).

```bash
npm install
npm test        # build + all tests, uses no model quota
npm run app     # run the app
```

- **Node ≥ 22.13** is required (`node:sqlite`).
- **Two languages:** every user-facing string goes into both `app/i18n.js` and `src/i18n.ts`; `test/i18n.test.mjs` fails if the catalogs diverge.
- **Validate renderer input** in `app/validate.js` — never trust values coming from the window.
- Tests that touch the referee or agents use fakes; please keep them quota-free.
- Keep PRs focused and describe the *why*. macOS/Linux reports and fixes are especially welcome (the Windows path is the one that has been exercised so far).

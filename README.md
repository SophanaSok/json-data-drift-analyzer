# JSON Data Drift Analyzer

Browser-first JSON drift and data-quality analysis for baseline vs latest exports.

## Implementation plan

1. Scaffold a strict React + TypeScript + Vite app with Tailwind and test tooling.
2. Build a framework-agnostic analysis engine (records, fields, documents, quality).
3. Run all expensive analysis once in a Web Worker and cache full results in IndexedDB.
4. Render result views (Overview, Records, Field Changes, Data Health) from immutable precomputed indexes.
5. Add fixtures, Vitest, Playwright smoke test, and GitHub Actions deploy workflow.

## Project tree

```text
json-data-drift-analyzer/
├── .github/workflows/deploy.yml
├── e2e/smoke.spec.ts
├── public/
├── src/
│   ├── app/
│   ├── components/
│   ├── db/
│   ├── engine/
│   ├── features/
│   ├── lib/
│   ├── stores/
│   ├── styles/
│   ├── test/fixtures/
│   ├── workers/
│   ├── main.tsx
│   └── vite-env.d.ts
├── index.html
├── LICENSE
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vite.config.ts
```

## Dependencies

- `react`, `react-dom`: SPA UI.
- `typescript`: strict typed core engine and worker protocol.
- `vite`: fast browser-first build tooling.
- `tailwindcss`: dense readable UI styling.
- `zustand`: minimal local UI/view state.
- `@tanstack/react-table`, `@tanstack/react-virtual`: large records table + virtualization.
- `minisearch`: in-browser search index built once in worker.
- `dexie`: IndexedDB persistence for analysis cache/profile data.
- `ajv`: JSON schema validation foundation.
- `vitest`: engine unit tests.
- `@playwright/test`: end-to-end browser smoke test.

## Privacy model

All uploaded JSON is parsed and analyzed in-browser and optionally cached in local IndexedDB only.
No backend, API, authentication, or external file upload is used.

## Local development

```bash
npm install
npm run dev
```

## Validation commands

```bash
npm run test
npm run build
npm run typecheck
npm run lint
npm run test:e2e
```

## GitHub Pages deployment

1. Push to `main`.
2. GitHub Actions runs tests and build.
3. `deploy` job publishes `dist/` to Pages.
4. Ensure repository Pages source is set to GitHub Actions.

## Recommended repository topics

`data-quality`, `json`, `json-diff`, `data-drift`, `json-validation`, `typescript`, `github-pages`

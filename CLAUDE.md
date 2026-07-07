# CLAUDE.md — working notes for AI-assisted development

AppCraft is a deterministic app compiler: agents write a small YAML model
(`app.acm.yaml`), never code; the TypeScript compiler emits complete native
Android (Compose/Material 3/Room) projects.

- Build/verify: `npm ci && npm run build` (check the exit code) and `npm test`.
  Golden/determinism/hygiene gates live in `packages/compiler/test/`.
- The two laws are contribution law — see CONTRIBUTING.md: determinism
  invariants, and the capability card never lies
  (`packages/core/src/capability.ts`).
- Fix templates (`packages/compiler/src/*.ts`), never generated output;
  regenerate golden snapshots in the same PR: `npx vitest run -u`.
- Work on a feature branch; open a PR; a maintainer merges. Never push to
  `main` directly.
- Owner-/machine-specific context, if present, lives in `CLAUDE.local.md`
  (untracked).

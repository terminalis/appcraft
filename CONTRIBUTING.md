# Contributing to AppCraft

Thanks for helping build the deterministic app compiler for the AI era. Two standing rules
outrank any feature request — PRs that violate them will be declined no matter how useful
the feature is.

## The two laws

1. **Determinism invariants.** No LLM (or any other nondeterminism) in the compile path;
   the same model + the same compiler version must produce byte-identical output; no
   placeholders in emitted code; manifest permissions are derived only from model
   capabilities. The test suite defends these invariants — never add exceptions.
2. **The capability card never lies** (`packages/core/src/capability.ts`). A feature moves
   from unsupported to supported only when it actually compiles AND is proven in CI.
   Update the card in the same PR as the capability it describes.

## How changes work

- **Fix templates, never generated output.** If emitted Kotlin/Gradle is wrong, the fix
  belongs in `packages/compiler/src/*.ts`. Regenerate the golden snapshots in the same
  PR: `npx vitest run -u`, then review the snapshot diff like code.
- **Schema changes need migration support.** The compiler accepts model format N and N-1;
  a schema-change PR must keep that true (see [docs/VERSIONING.md](docs/VERSIONING.md)).
- Work on a feature branch; open a PR against `main`. CI must be green: the `toolchain`
  job (build + tests) and the `android` job (generate ×2 + determinism diff + SonarCloud
  zero-bugs gate + `assembleDebug` ×3).

## Dev setup

```bash
npm install
npm run build
npm test
```

Compiler work only needs Node — the golden tests catch most regressions. Building the
generated Android projects locally additionally needs JDK 17+ and Gradle ≥ 8.9 (the
verified toolchain is recorded in [KNOWN_GOOD.md](KNOWN_GOOD.md)).

## Reporting bugs

Include the model (`app.acm.yaml`), the compiler version (`appcraft --version`), and what
the emitted code did wrong. Determinism bugs — same input, different output — are P0.

# Versioning policy

Two version numbers matter. Written down now, before anyone depends on them.

## Compiler version (the npm packages)

`appcraft` and `@appcraft-io/*` follow **semantic versioning in lockstep** — one release
bumps every package to the same version.

- **PATCH** — template and bug fixes. Emitted output may change (usually the point);
  determinism holds *per version*: the same model compiled by the same compiler version
  is always byte-identical.
- **MINOR** — new model capabilities (schema additions) or new CLI/MCP surface, backward
  compatible: every model that compiled on 0.N compiles on 0.(N+1).
- **MAJOR** — reserved. Pre-1.0, breaking changes bump MINOR and are called out loudly
  in release notes.

## Model format version (`appcraft: 0.x` in app.acm.yaml)

The model format versions independently and changes only when the model *language*
changes. Support window: **compiler release N accepts formats N and N-1** — N-1 via
automatic in-memory migration with a warning; older formats are rejected with a
migration hint. (The first format bump ships the migration tooling with it.)

## What determinism means across versions

Byte-identical output is guaranteed for a (model, compiler version) pair — not across
compiler upgrades. Recompiling after an upgrade may change the emitted project; the
model diff plus the compiler version bump is your complete audit trail.

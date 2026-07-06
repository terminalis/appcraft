# Driving AppCraft as an AI Agent

AppCraft is built agent-first: you (the agent) write and edit the **model** — never Kotlin. The deterministic compiler produces the entire native Android app. This page is the etiquette and the loop.

## Setup

```bash
claude mcp add appcraft -- npx -y @appcraft-io/mcp-server
```

Or for any MCP client:

```jsonc
{
  "mcpServers": {
    "appcraft": { "command": "npx", "args": ["-y", "@appcraft-io/mcp-server"] }
  }
}
```

(From a source checkout instead: `npm install && npm run build`, then
`"command": "node", "args": ["<repo>/packages/mcp-server/dist/main.js"]`.)

## The loop

```
get_schema ──► create_app ──► edit_model / rewrite YAML ──► validate ──► compile ──► preview / Android Studio
                    ▲                                          │
                    └────────────── fix errors ◄───────────────┘
```

1. **`get_schema` first, always.** It returns the JSON Schema *and the capability card*. The card is the truth about what the compiler can build. **Never promise a user a feature the card lists as unsupported** — say what is and isn't expressible, and offer the in-archetype alternative. The expressiveness cliff is handled by honesty, not improvisation.
2. **`create_app`** gives you a valid starter model. Shape it either by rewriting the YAML wholesale (fine — it's small) or with `edit_model` RFC-6902 patches (`/data/entities/0/attributes/-` style paths). Note: patches re-serialize the YAML and drop comments.
3. **`validate` after every change.** `errors.spec` are schema/semantic problems — fix them mechanically; every error carries a path and usually a hint. `errors.compile` are spec-valid features compiler 0.1 doesn't emit yet (crud, cloud, ml) — redesign around them.
4. **`compile`** writes a complete Gradle project (Kotlin, Jetpack Compose, Material 3, Room, corrected MVC/VIPER clean architecture, zero placeholders). The user opens it in Android Studio or runs `gradle assembleDebug`.
5. **`preview`** renders an instant self-contained HTML mockup when no Android toolchain is around.

## Model-writing guidance

- **Small is correct.** A real app is 40–80 lines of YAML. If your model balloons, you're fighting the archetype — stop and check the capability card.
- The archetype is **data + flows (+ charts + custom formulas)**: trackers, logs, field tools, calculators, clinical companions. Games, feeds, and media editing are out of scope *by design* — tell the user so.
- Expressions (invariants, custom-flow steps) allow arithmetic/comparison/boolean operators over declared identifiers and enum literals only. **No method calls.** For real logic, use a `custom:` Kotlin block and `- call:` it from a flow — that Kotlin is preserved verbatim across regeneration.
- Every entity needs exactly one `type: id` attribute (auto-generated UUID at save; never shown in forms). `derived: true` attributes are outputs, not inputs. `date`/`datetime` fields auto-fill with "now" in 0.1 forms.
- **The model is the artifact.** When a user asks for a change, produce the smallest possible model diff and recompile — never hand-edit generated code (it's regenerated wholesale). Diff, not drift.

## Worked change request

> *"Add a fasting flag to readings and sort history oldest-first."*

```json
[
  { "op": "add", "path": "/data/entities/0/attributes/-",
    "value": { "name": "fasting", "type": "bool" } },
  { "op": "replace", "path": "/flows/1/sort/order", "value": "asc" }
]
```

`edit_model` → `validate` (clean) → `compile`. Two lines of model change; the entire app — Room schema, form, card, facade — regenerates consistently.

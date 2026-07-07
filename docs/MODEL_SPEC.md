# The AppCraft Model (`app.acm.yaml`) — Spec Draft v0

*Status: draft for phase 1. The JSON Schema in `schema/appcraft.schema.json` will be the normative definition; this document explains the design.*

## Design principles

1. **Small and diffable.** A real app is a few hundred lines. Every change a user asks for should be a small, human-reviewable diff.
2. **Agent-writable.** Plain YAML validated by a published JSON Schema — the two formats every LLM already writes fluently. No custom parser, no DSL to learn.
3. **Validated, then guaranteed.** `validate` returns machine-precise, agent-repairable errors. Anything that validates, compiles; anything that compiles carries the compiler's guarantees (complete buildable project, clean architecture, permissions derived from capabilities, lint-clean output).
4. **A spine with sockets, not a cage.** The model covers the archetype (data + flows + on-device ML); `custom:` blocks are first-class, typed escape hatches preserved verbatim across regeneration. The capability card (served by `get_schema`) tells agents what the model *cannot* express before they promise it.
5. **Versioned and migratable.** `appcraft: 0.x` at the top; the toolchain ships model migrations, so a model written today recompiles next year.

## Document structure

```yaml
appcraft: 0.1               # model format version (required)

app:                        # identity (required)
  name: GlucoLog
  package: io.appcraft.glucolog

theme:                      # design tokens (optional; excellent defaults)
  seedColor: "#2E7D32"      # Material 3 dynamic scheme derived from seed
  darkMode: system          # system | always | never

data:                       # entities → Room storage, typed domain layer
  entities:
    - name: GlucoseReading
      storage: device       # device | cloud | memory   (paper: persistent/cloud stereotypes)
      attributes:
        - { name: id,        type: id }                 # (paper: identity)
        - { name: mmol,      type: decimal }
        - { name: takenAt,   type: datetime }
        - { name: note,      type: text,  optional: true }
        - { name: mealPhoto, type: image, optional: true }
      invariants:
        - "mmol > 0"        # compile-time-placed validation (presentation tier)

flows:                      # use cases → screens' behavior (paper: usecase + stereotypes)
  - name: logReading
    kind: create            # create | list | crud | search | custom
    entity: GlucoseReading
  - name: history
    kind: list
    entity: GlucoseReading
    sort: { by: takenAt, order: desc }
  - name: findByDay
    kind: search
    entity: GlucoseReading
    by: takenAt

ui:                         # optional — screens are derived from flows when omitted
  screens:
    - name: WeeklyChart
      components:
        - kind: chart
          type: line
          entity: GlucoseReading
          x: takenAt
          y: mmol
          window: 7d

ml: []                      # on-device inference blocks (spec'd below; compiler phase 2)

custom: []                  # typed Kotlin escape hatches (spec'd below)
```

### `data:` — entities

- `type`: `id | text | int | decimal | bool | date | datetime | image | enum(<Name>)`, plus `list<...>`.
- `storage`: `device` → Room/SQLite; `cloud` → Firebase (phase 2); `memory` → no persistence. Replaces the paper's `persistent` / `cloud` stereotypes.
- `derived: true` marks an attribute computed by a flow or an `ml:` block (the paper's `derived`), rendered read-only in UI.
- `enums:` sibling of `entities:` — `{ name: Gender, values: [male, female] }`.
- `invariants` are expressions over attributes; the compiler places validation in the presentation tier (fixing the paper's §VI-B self-admitted Clean Architecture violation of validating in entity beans).

### `flows:` — behavior

- `kind: create | list | crud | search` generate complete, styled screens + logic (the paper's stereotype library, modernized — one navigation destination per flow with Material 3 navigation, *not* the paper's tab-per-usecase layout).
- `kind: custom` carries `steps:` — a small statement list (assignments, if/else, for-each, arithmetic/logical expressions over entities — the paper's Activity/OCL subset) for logic like BMI/BMR calculators.
- Every flow compiles into the corrected MVC/VIPER structure: Screen → ViewController → ModelFacade → gateway *interfaces* (dependency inversion at gateways — the paper's other admitted violation, fixed).

### `ui:` — screens (optional)

Screens are **derived from flows by default** — the model stays small and the design system does the work. Explicit `ui.screens` entries add or override: component kinds `list, detail, form, chart, image, text, button, progress`, each bindable to entities/attributes/flows (the paper's `bind` block, now implicit by name or explicit via `binds:`).

### `ml:` — on-device inference (compiler support in phase 2)

```yaml
ml:
  - name: classifyDiabetes
    kind: classify
    entity: Diabetes
    model: { file: diabetes.tflite, type: numData }   # numData | image | sensorData
    inputs:
      - "(pregnancies - 0) / (17 - 0)"                # normalization, as trained
      - "(glucose - 0) / (199 - 0)"
      # ...
    outputs: [positive, negative]
    writeTo: outcome                                  # derived attribute receiving the result
```

Direct modernization of the paper's `machineLearning:` block (§III-A): `numData` (feature-vector classifiers), `image` (camera/gallery → 224×224×3 preprocessing generated), `sensorData` (windowed accelerometer vectors). The compiler guarantees inference paths make no network calls.

### `custom:` — escape hatches

```yaml
custom:
  - name: summarize
    inputs:  [{ name: body, type: text }]
    output: text
    kotlin: |
      // Verbatim Kotlin, injected at a compiler-designated extension
      // point (the CustomBlocks object) and preserved byte-for-byte
      // across regeneration.
      val words = body.trim().split(Regex("\\s+")).size
      return body.lineSequence().first().take(80) + " ($words words)"
```

Callable from custom flows as a step (`- call: summarize` with `args:` expressions and an optional `assignTo:` local). This is the survival lesson of MDD history: the model is a spine with sockets, not a cage.

---

## Worked example: the paper's Diabetes app, then and now

The paper's Appendix C specification (verbatim structure, §Appendix C-B):

```
package diabeats {
  class Diabeats {
    stereotype persistent;
    attribute id identity : String;
    attribute pregnancies: int;      attribute glucose: int;
    attribute bloodPressure: int;    attribute skinThickness: int;
    attribute insulin: int;          attribute bmi: double;
    attribute pedigree: double;      attribute age: int;
    attribute outcome derived: String;
  }
  usecase createDiabeats (id: String, pregnancies: int, ... ): Diabeats {
    stereotype create;  stereotype entity = Diabeats;
  }
  usecase listDiabeats: Sequence(Diabeats) {
    stereotype list;    stereotype entity = Diabeats;
  }
  usecase classifyDiabeats (dia: Diabeats): String {
    stereotype classify; stereotype entity = Diabeats;
    machineLearning:
      modelName: diabeats
      type: numData
      input: (ref dia.pregnancies-0)/(17-0), (ref dia.glucose-0)/(199-0),
             (ref dia.bloodPressure-0)/(122-0), (ref dia.skinThickness-0)/(99-0),
             (ref dia.insulin-0)/(846-0), (ref dia.bmi-0)/(67.1-0),
             (ref dia.pedigree-0.078)/(2.42-.078), (ref dia.age-21)/(81-21)
      output: positive, negative;
  }
}
```

The same app as an AppCraft v0 model — nothing lost, and note what's *gone*: the parameter lists duplicating every attribute, the entity stereotypes restating the obvious, the bespoke syntax:

```yaml
appcraft: 0.1
app: { name: Diabetes Companion, package: io.appcraft.diabetes }

data:
  entities:
    - name: Diabetes
      storage: device
      attributes:
        - { name: id,            type: id }
        - { name: pregnancies,   type: int }
        - { name: glucose,       type: int }
        - { name: bloodPressure, type: int }
        - { name: skinThickness, type: int }
        - { name: insulin,       type: int }
        - { name: bmi,           type: decimal }
        - { name: pedigree,      type: decimal }
        - { name: age,           type: int }
        - { name: outcome,       type: text, derived: true }

flows:
  - { name: addRecord,   kind: create, entity: Diabetes }
  - { name: records,     kind: list,   entity: Diabetes }

ml:
  - name: classify
    kind: classify
    entity: Diabetes
    model: { file: diabetes.tflite, type: numData }
    inputs:
      - "(pregnancies - 0) / (17 - 0)"
      - "(glucose - 0) / (199 - 0)"
      - "(bloodPressure - 0) / (122 - 0)"
      - "(skinThickness - 0) / (99 - 0)"
      - "(insulin - 0) / (846 - 0)"
      - "(bmi - 0) / (67.1 - 0)"
      - "(pedigree - 0.078) / (2.42 - 0.078)"
      - "(age - 21) / (81 - 21)"
    outputs: [positive, negative]
    writeTo: outcome
```

### Mapping table (paper DSL → v0)

| Paper concept | v0 model |
|---|---|
| `package` | `app.package` |
| `class` + `stereotype persistent/cloud` | `data.entities[]` + `storage: device/cloud` |
| `attribute … identity` | `type: id` |
| `attribute … derived` | `derived: true` |
| `enumeration` | `data.enums[]` |
| `invariant` | `entities[].invariants[]` (validation compiled into presentation tier) |
| `usecase` + `stereotype create/list/CRUD/searchBy` | `flows[].kind: create/list/crud/search` |
| `usecase` activities (OCL-ish statements) | `flows[].kind: custom` + `steps:` |
| `machineLearning:` block | `ml[]` block |
| `screen` / `bind` blocks | `ui.screens[]` (derived by default; explicit binds optional) |
| *(no equivalent)* | `theme:` design tokens |
| *(no equivalent — the paper required manual coding outside the DSL)* | `custom:` typed Kotlin blocks |

## What the compiler guarantees (v0 targets)

- **Complete buildable Gradle project** — `settings.gradle.kts` through sources; no copy-into-IDE steps (removes the paper's §III-E manual process).
- **Deterministic**: same model + same compiler version → identical output. No LLM in the compile path.
- **Architecture**: corrected generalized MVC/VIPER (dependency-inverted gateways; presentation-tier validation) per Clean Architecture.
- **Permissions manifest derived from model capabilities** (e.g., `image` attribute → camera/photo picker permissions; nothing else).
- **Lint-clean output**, enforced by golden-file + lint gates in the compiler's own CI.

## Out of scope for v0

`cloud` storage backends, auth, `ml:` execution (spec'd, compiled in phase 2), iOS target, push notifications, maps, background jobs. The capability card enumerates these so agents can tell users the truth.

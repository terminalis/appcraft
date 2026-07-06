# AppCraft roadmap (features)

AppCraft ships behind the capability card (`npx appcraft schema --card`): a feature is
listed as supported only when it compiles and is proven in CI against a real Android
toolchain. This roadmap is intent, not promise — **the card is the truth**.

| Version | Planned |
|---|---|
| 0.1.x | Hardening from real-toolchain builds; no schema changes |
| 0.2 | `crud` flow kind (list → detail → edit → delete), datetime editing, model migration tooling |
| 0.3 | `storage: cloud`, `auth:` primitive |
| 0.4 | `ml:` blocks compiled (numData + image, TFLite) |
| 0.5 | iOS / SwiftUI target (alpha) |

Tracked build-output hardening (accepted SonarCloud findings, fix planned): dependency
lockfiles for emitted projects (S8569) and R8-minified release builds (S7204) — both need
careful work to not break user builds, and land with the Gradle-wrapper emission.

Standing invariants that outrank any roadmap item: no LLM in the compile path; same model
+ same compiler version → byte-identical output; no placeholders in emitted code;
permissions derived only from model capabilities. See [CONTRIBUTING.md](CONTRIBUTING.md).

# KNOWN_GOOD — first real-toolchain verification

The record of the first time AppCraft-generated projects met a real Kotlin compiler and ran
on a device. All three example models compiled **without a single template fix** and passed
their golden paths on an emulator on 2026-07-05.

## Toolchain

| Component | Version |
|---|---|
| Compiler (`@appcraft-io/compiler`) | 0.1.0 |
| Node.js | 26.0.0 |
| OS | Windows 11 Pro 10.0.26200 |
| JDK | OpenJDK 21.0.10 (Android Studio JBR) |
| Gradle | 8.10.2 |
| Android Gradle Plugin | 8.7.3 (pinned by compiler) |
| Kotlin | 2.0.21 (pinned) |
| KSP | 2.0.21-1.0.25 (pinned) |
| Compose BOM | 2024.10.00 (pinned) |
| Room | 2.6.1 (pinned) |
| compileSdk / targetSdk / minSdk | 35 / 35 / 26 (pinned) |
| SDK platform | android-35 r02 |
| Build-tools | 34.0.0 (auto-provisioned by AGP) |
| Emulator | 36.6.11.0, WHPX acceleration |
| Device image | `system-images;android-35;google_apis;x86_64`, Pixel 7 profile (`hw.keyboard=yes`) |

Environment: no `local.properties`; SDK located via `ANDROID_HOME`. `JAVA_HOME` pointed at the
Android Studio JBR. Plain `gradle assembleDebug` (no wrapper is emitted in 0.1).

## Build results

| Example | Result | First build | Notes |
|---|---|---|---|
| HealthCalc | ✅ `BUILD SUCCESSFUL` | 6m 05s | no Room; pure Compose |
| GlucoLog | ✅ `BUILD SUCCESSFUL` | 6m 32s | Room + KSP + Coil all resolved and compiled |
| FieldNotes | ✅ `BUILD SUCCESSFUL` | 1m 29s (warm) | verbatim `custom:` Kotlin block compiled |

**Zero compile errors across all three.** Every version pin in `gradle/libs.versions.toml`
resolved against Google/Maven Central. Determinism spot-check: regenerating each model after
the builds produced **byte-identical** emitted files (only Gradle's `.kotlin/`/`.gradle/`/`build/`
side-effect dirs differ).

Compiler warnings observed (allowed; errors are not):

- `Modifier.menuAnchor()` deprecated in Material3 1.3 — all three apps (`Fields.kt`).
- `Icons.Outlined.ShowChart` deprecated in favor of `Icons.AutoMirrored.Outlined.ShowChart` — GlucoLog `Nav.kt`.
- `Condition is always 'true'` — redundant smart-cast null guard in generated invariant `when` chain (GlucoLog `LogReadingScreen.kt`).

## Golden paths (emulator, driven via adb/uiautomator)

**HealthCalc** — ✅ all steps
- BMI(height 1.8, weight 80) → **24.69** shown — matches the paper's formula.
- calorieCount(walking, male, 30) → **75.00** shown — matches the paper's formula.

**GlucoLog** — ✅ all steps
- Log reading (5.4 mmol, fasting, note, meal photo via permissionless photo picker) → Saved.
- History lists the reading with the photo rendered.
- Find By Day `2026-07-05` matches.
- Weekly Chart draws the line after 2+ readings (Canvas, grid + points + stroke).
- `am force-stop` + relaunch → all readings intact (Room persistence).

**FieldNotes** — ✅ all steps
- Save with empty title → blocked by the `title != ''` invariant (Save disabled, nothing persisted).
- Valid note saves; Notes list shows all attributes; Find Note matches on title.
- Analyze Text on a 5-word body → `"Grid ran dry before noon (5 words)"` — the verbatim
  `custom:` Kotlin block executed on device.

Screenshots: [docs/assets/](docs/assets/) (`healthcalc-*`, `glucolog-*`, `fieldnotes-*`).

## v0.1 behavior notes (by design, roadmapped)

- `datetime` fields are stamped once per form instance and are not editable (chip display only).
  Two readings saved from the same form instance share a timestamp, which renders as a vertical
  segment on the chart. Datetime editing ships in 0.2 (see roadmap version map).
- No Gradle wrapper is emitted; builds need a local Gradle ≥ 8.9 (or Android Studio). Wrapper
  emission is a launch-packaging candidate for 0.1.x.

## Reproducing the harness

- AVD must have `hw.keyboard = yes` (avdmanager default is `no`); with the soft IME active,
  `adb shell input text` can wedge and stop delivering keystrokes system-wide until reboot.
  Belt-and-braces: `settings put secure show_ime_with_hard_keyboard 0`.
- Screenshots must be captured from a POSIX shell (`adb exec-out screencap -p > f.png`);
  Windows PowerShell 5.1 corrupts binary stdout.
- Photo-picker step: place an image in `/sdcard/Pictures`, then
  `content call --uri content://media/none --method scan_volume --arg external_primary`
  (the legacy `MEDIA_SCANNER_SCAN_FILE` broadcast no longer indexes on API 35).

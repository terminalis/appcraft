import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";
import { flagshipModel } from "./project.test.js";

const BASE = "app/src/main/java/io/appcraft/glucolog";

describe("UI layer", () => {
  const files = compile(flagshipModel()).files;

  test("one screen per flow plus the chart screen", () => {
    expect(files.has(`${BASE}/ui/screens/LogReadingScreen.kt`)).toBe(true);
    expect(files.has(`${BASE}/ui/screens/HistoryScreen.kt`)).toBe(true);
    expect(files.has(`${BASE}/ui/screens/FindByDayScreen.kt`)).toBe(true);
    expect(files.has(`${BASE}/ui/screens/WeeklyChartScreen.kt`)).toBe(true);
  });

  test("invariant enforced in the presentation tier, not the domain", () => {
    const form = files.get(`${BASE}/ui/screens/LogReadingScreen.kt`)!;
    expect(form).toContain('!(mmolValue > 0) -> "Must satisfy: mmol > 0"');
    const domainModel = files.get(`${BASE}/domain/model/GlucoseReading.kt`)!;
    expect(domainModel).not.toContain("mmol > 0");
  });

  test("create form: id/derived/datetime excluded from inputs, auto-supplied on save", () => {
    const form = files.get(`${BASE}/ui/screens/LogReadingScreen.kt`)!;
    expect(form).toContain("id = java.util.UUID.randomUUID().toString()");
    expect(form).toContain("takenAt = takenAt");
    expect(form).toContain("val takenAt = rememberSaveable { System.currentTimeMillis() }");
    expect(form).not.toContain('var id by');
    expect(form).toContain("enabled = formValid");
    expect(form).toContain("note = note.trim().ifBlank { null }");
  });

  test("enum field renders a dropdown with the declared values' enum", () => {
    const form = files.get(`${BASE}/ui/screens/LogReadingScreen.kt`)!;
    expect(form).toContain("options = ReadingContext.entries");
    expect(form).toContain("mutableStateOf(ReadingContext.fasting)");
  });

  test("chart screen windows and renders via the canvas LineChart", () => {
    const chart = files.get(`${BASE}/ui/screens/WeeklyChartScreen.kt`)!;
    expect(chart).toContain("7L * 24 * 60 * 60 * 1000");
    expect(chart).toContain("LineChart(");
    expect(chart).toContain("observeGlucoseReading()");
    expect(files.get(`${BASE}/ui/components/Chart.kt`)).toContain("fun LineChart(");
  });

  test("navigation lists all four destinations and MainActivity wires the graph", () => {
    const nav = files.get(`${BASE}/ui/Nav.kt`)!;
    for (const route of ["logReading", "history", "findByDay", "weeklyChart"]) {
      expect(nav).toContain(`"${route}"`);
    }
    const main = files.get(`${BASE}/MainActivity.kt`)!;
    expect(main).toContain("AppGraph.init(applicationContext)");
    expect(main).toContain('startDestination = "logReading"');
    expect(main).toContain("GlucoLogTheme {");
  });

  test("theme derives colors from the seed", () => {
    const color = files.get(`${BASE}/ui/theme/Color.kt`)!;
    expect(color).toContain("Color(0xFF2E7D32)");
    expect(color).toContain("darkColorScheme");
  });
});

describe("golden gates", () => {
  const result = compile(flagshipModel());

  test("file list snapshot (flagship)", () => {
    expect([...result.files.keys()].sort()).toMatchSnapshot();
  });

  test("key file content snapshots", () => {
    for (const p of [
      "app/src/main/java/io/appcraft/glucolog/MainActivity.kt",
      "app/src/main/java/io/appcraft/glucolog/ui/screens/LogReadingScreen.kt",
      "app/src/main/java/io/appcraft/glucolog/domain/ModelFacade.kt",
      "gradle/libs.versions.toml",
    ]) {
      expect(result.files.get(p), p).toMatchSnapshot(p);
    }
  });

  test("determinism: two compiles are identical", () => {
    const again = compile(flagshipModel());
    expect(Object.fromEntries(again.files)).toEqual(Object.fromEntries(result.files));
  });

  test("output hygiene: no placeholders anywhere", () => {
    for (const [path, content] of result.files) {
      expect(content, path).not.toMatch(/\bTODO\b|TODO_|\bFIXME\b|\bPLACEHOLDER\b|lorem ipsum/i);
    }
  });

  test("every kotlin file declares the right package prefix", () => {
    for (const [path, content] of result.files) {
      if (!path.endsWith(".kt")) continue;
      expect(content.startsWith("package io.appcraft.glucolog"), path).toBe(true);
    }
  });
});

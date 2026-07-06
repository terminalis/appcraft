import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadModel, validateForCompile, validateModel } from "@appcraft-io/core";
import { compile } from "../src/index.js";

const EXAMPLES = ["diabetes-tracker", "health-calculators", "field-notes"];

function examplePath(name: string): string {
  return fileURLToPath(new URL(`../../../examples/${name}/app.acm.yaml`, import.meta.url));
}

describe.each(EXAMPLES)("example: %s", (name) => {
  const yaml = readFileSync(examplePath(name), "utf8");

  test("spec-validates and compile-validates clean", () => {
    const { doc, errors } = loadModel(yaml);
    expect(errors).toEqual([]);
    expect(validateModel(doc).errors).toEqual([]);
    expect(validateForCompile(doc).errors).toEqual([]);
  });

  test("compiles to a complete project with clean output", () => {
    const { doc } = loadModel(yaml);
    const { model } = validateForCompile(doc);
    const { files, warnings } = compile(model!);
    expect(warnings).toEqual([]);
    expect(files.size).toBeGreaterThan(18);
    for (const [path, content] of files) {
      expect(content, path).not.toMatch(/\bTODO\b|TODO_|\bFIXME\b|\bPLACEHOLDER\b|lorem ipsum/i);
      expect(content.length, path).toBeGreaterThan(0);
    }
  });
});

test("field-notes: verbatim custom block survives into CustomBlocks.kt", () => {
  const { doc } = loadModel(readFileSync(examplePath("field-notes"), "utf8"));
  const { model } = validateForCompile(doc);
  const { files } = compile(model!);
  const blocks = files.get("app/src/main/java/io/appcraft/fieldnotes/custom/CustomBlocks.kt")!;
  expect(blocks).toContain("fun summarize(body: String): String {");
  expect(blocks).toContain('return "$firstLine ($words words)"');
  const facade = files.get("app/src/main/java/io/appcraft/fieldnotes/domain/ModelFacade.kt")!;
  expect(facade).toContain("var summary = CustomBlocks.summarize(body)");
});

test("health-calculators: no-entity app still gets AppGraph and screens", () => {
  const { doc } = loadModel(readFileSync(examplePath("health-calculators"), "utf8"));
  const { model } = validateForCompile(doc);
  const { files } = compile(model!);
  expect(files.has("app/src/main/java/io/appcraft/healthcalc/AppGraph.kt")).toBe(true);
  expect(files.has("app/src/main/java/io/appcraft/healthcalc/ui/screens/ComputeBmiScreen.kt")).toBe(true);
  const main = files.get("app/src/main/java/io/appcraft/healthcalc/MainActivity.kt")!;
  expect(main).toContain('composable("calorieCount") { CalorieCountScreen() }');
});

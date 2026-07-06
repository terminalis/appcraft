import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runGenerate, runPreview, runValidate } from "../src/commands.js";

const flagship = fileURLToPath(
  new URL("../../../examples/diabetes-tracker/app.acm.yaml", import.meta.url),
);

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "appcraft-cli-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("appcraft CLI commands", () => {
  test("validate: flagship exits 0", async () => {
    expect(await runValidate(flagship)).toBe(0);
  });

  test("validate: broken model exits 1", async () => {
    const bad = join(dir, "bad.acm.yaml");
    await writeFile(bad, "appcraft: 0.1\napp: { name: X }\n", "utf8");
    expect(await runValidate(bad)).toBe(1);
  });

  test("validate: missing file exits 1", async () => {
    expect(await runValidate(join(dir, "nope.acm.yaml"))).toBe(1);
  });

  test("generate: writes a complete project", async () => {
    const out = join(dir, "gen");
    expect(await runGenerate(flagship, out)).toBe(0);
    expect(existsSync(join(out, "settings.gradle.kts"))).toBe(true);
    expect(
      existsSync(join(out, "app/src/main/java/io/appcraft/glucolog/MainActivity.kt")),
    ).toBe(true);
  });

  test("preview: writes self-contained HTML", async () => {
    const out = join(dir, "preview.html");
    expect(await runPreview(flagship, out)).toBe(0);
    const html = await readFile(out, "utf8");
    expect(html).toContain("GlucoLog");
    expect(html).not.toMatch(/https?:\/\//);
  });
});

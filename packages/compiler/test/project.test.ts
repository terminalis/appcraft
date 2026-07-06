import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadModel, validateForCompile } from "@appcraft-io/core";
import { compile, writeProject } from "../src/index.js";

const flagshipPath = fileURLToPath(
  new URL("../../../examples/diabetes-tracker/app.acm.yaml", import.meta.url),
);

export function flagshipModel() {
  const { doc } = loadModel(readFileSync(flagshipPath, "utf8"));
  const { model, errors } = validateForCompile(doc);
  expect(errors).toEqual([]);
  return model!;
}

describe("project scaffold", () => {
  const result = compile(flagshipModel());

  test("emits the gradle scaffold files", () => {
    for (const p of [
      "settings.gradle.kts",
      "build.gradle.kts",
      "gradle.properties",
      "gradle/libs.versions.toml",
      "app/build.gradle.kts",
      "app/proguard-rules.pro",
      "app/src/main/AndroidManifest.xml",
      "app/src/main/res/values/strings.xml",
      "app/src/main/res/values/themes.xml",
      "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
      "app/src/main/res/drawable/ic_launcher_foreground.xml",
    ]) {
      expect(result.files.has(p), `missing ${p}`).toBe(true);
    }
  });

  test("manifest derives permissions from capabilities — none for flagship", () => {
    const manifest = result.files.get("app/src/main/AndroidManifest.xml")!;
    expect(manifest).not.toContain("<uses-permission");
    expect(manifest).toContain('android:name=".MainActivity"');
  });

  test("secure defaults: no backup/D2D of on-device data, no cleartext traffic", () => {
    const manifest = result.files.get("app/src/main/AndroidManifest.xml")!;
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    const rules = result.files.get("app/src/main/res/xml/data_extraction_rules.xml")!;
    expect(rules).toContain("<cloud-backup>");
    expect(rules).toContain("<device-transfer>");
    expect(rules).toContain('<exclude domain="database" path="." />');
  });

  test("libs.versions.toml pins the toolchain", () => {
    const toml = result.files.get("gradle/libs.versions.toml")!;
    expect(toml).toContain('agp = "8.7.3"');
    expect(toml).toContain('kotlin = "2.0.21"');
    expect(toml).toContain('composeBom = "2024.10.00"');
  });

  test("room + ksp only when a device-storage entity exists", () => {
    const appGradle = result.files.get("app/build.gradle.kts")!;
    expect(appGradle).toContain("libs.androidx.room.runtime");
    expect(appGradle).toContain("ksp(libs.androidx.room.compiler)");
    expect(appGradle).toContain("libs.coil.compose"); // mealPhoto: image
    expect(appGradle).toContain(`namespace = "io.appcraft.glucolog"`);
  });

  test("icon background uses the theme seed color", () => {
    expect(result.files.get("app/src/main/res/values/colors.xml")).toContain("#2E7D32");
  });

  test("all paths use forward slashes", () => {
    for (const p of result.files.keys()) {
      expect(p).not.toContain("\\");
    }
  });

  test("writeProject round-trips to disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "appcraft-test-"));
    try {
      const written = await writeProject(result, dir);
      expect(written.length).toBe(result.files.size);
      const settings = await readFile(join(dir, "settings.gradle.kts"), "utf8");
      expect(settings).toContain('rootProject.name = "GlucoLog"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

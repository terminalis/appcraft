import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  appcraftSchema,
  capabilityCard,
  loadModel,
  validateForCompile,
  validateModel,
  type ModelError,
} from "@appcraft-io/core";
import { compile, safeName, writeProject } from "@appcraft-io/compiler";
import { renderPreviewHtml } from "@appcraft-io/preview";

function printErrors(errors: ModelError[]): void {
  for (const e of errors) {
    console.error(`  ✖ ${e.path} — ${e.message}`);
    if (e.hint) console.error(`      hint: ${e.hint}`);
  }
}

async function loadValidated(
  file: string,
  forCompile: boolean,
): Promise<{ model?: import("@appcraft-io/core").AppModel; code: number }> {
  if (!existsSync(file)) {
    console.error(`✖ No such file: ${file}`);
    return { code: 1 };
  }
  const yaml = await readFile(file, "utf8");
  const { doc, errors: loadErrors } = loadModel(yaml);
  if (loadErrors.length > 0) {
    printErrors(loadErrors);
    return { code: 1 };
  }
  const { model, errors } = forCompile ? validateForCompile(doc) : validateModel(doc);
  if (errors.length > 0) {
    console.error(`${errors.length} problem(s) in ${file}:`);
    printErrors(errors);
    return { code: 1 };
  }
  return { model: model!, code: 0 };
}

export async function runValidate(file: string): Promise<number> {
  const { model, code } = await loadValidated(file, false);
  if (code !== 0) return code;
  console.log(`✓ ${file} is a valid AppCraft ${model!.appcraft} model (app: ${model!.app.name})`);
  const compileCheck = validateForCompile(model);
  if (compileCheck.errors.length > 0) {
    console.log(`  Note: valid spec, but compiler 0.1 cannot build it yet:`);
    printErrors(compileCheck.errors);
  }
  return 0;
}

function hasJava(): boolean {
  try {
    return spawnSync("java", ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export async function runGenerate(file: string, outDir?: string): Promise<number> {
  const { model, code } = await loadValidated(file, true);
  if (code !== 0) return code;
  const out = resolve(outDir ?? `${safeName(model!.app.name).toLowerCase()}-android`);
  const result = compile(model!);
  const written = await writeProject(result, out);
  console.log(`✓ Generated ${written.length} files → ${out}`);
  for (const w of result.warnings) console.log(`  ! ${w}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Open ${out} in Android Studio (recommended), or`);
  console.log(`  2. cd ${out} && gradle assembleDebug`);
  if (!hasJava()) {
    console.log("");
    console.log("  Note: no JDK detected on this machine. Building the app requires");
    console.log("  JDK 17 and the Android SDK — both ship with Android Studio:");
    console.log("  install it from developer.android.com/studio, open the project,");
    console.log("  and press Run. The generated code itself is complete.");
  }
  return 0;
}

export async function runPreview(file: string, outPath?: string): Promise<number> {
  const { model, code } = await loadValidated(file, false);
  if (code !== 0) return code;
  const html = renderPreviewHtml(model!);
  const out = resolve(outPath ?? "appcraft-preview.html");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html, "utf8");
  console.log(`✓ Preview written → ${out}`);
  return 0;
}

export function runSchema(card: boolean): number {
  if (card) {
    console.log(JSON.stringify(capabilityCard(), null, 2));
  } else {
    console.log(JSON.stringify(appcraftSchema(), null, 2));
  }
  return 0;
}

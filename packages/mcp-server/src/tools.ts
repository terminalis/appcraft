import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import jsonpatch, { type Operation } from "fast-json-patch";
// fast-json-patch is CJS; only the default import is reliable under Node ESM.
const { applyPatch } = jsonpatch;
import { stringify } from "yaml";
import {
  appcraftSchema,
  capabilityCard,
  loadModel,
  validateForCompile,
  validateModel,
  type ModelError,
} from "@appcraft-io/core";
import { compile, writeProject } from "@appcraft-io/compiler";
import { renderPreviewHtml } from "@appcraft-io/preview";

/**
 * Pure tool handlers for the AppCraft MCP server. The agent owns the
 * validate-repair loop; these handlers return machine-precise errors and
 * never guess. No LLM anywhere below this line.
 */

export const WORKFLOW = [
  "1. get_schema — read the model schema AND the capability card; never promise a feature the card lists as unsupported.",
  "2. create_app — get a valid starter model, then shape it with edit_model (JSON-patch) or by writing the YAML yourself.",
  "3. validate — after every change; fix errors until clean (errors.spec = schema/semantics, errors.compile = features compiler 0.1 cannot build yet).",
  "4. compile — emit the complete Android project to outDir.",
  "5. preview — instant HTML mockup, no toolchain needed.",
] as const;

export function getSchema() {
  return {
    formatVersion: "0.1",
    workflow: WORKFLOW,
    capabilityCard: capabilityCard(),
    schema: appcraftSchema(),
  };
}

function examplesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "examples");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("examples/ directory not found");
}

export function listExamples(): { name: string; description: string; modelYaml: string }[] {
  const dir = examplesDir();
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "app.acm.yaml")))
    .map((d) => {
      const modelYaml = readFileSync(join(dir, d.name, "app.acm.yaml"), "utf8");
      const description = modelYaml
        .split("\n")
        .filter((l) => l.startsWith("#"))
        .map((l) => l.replace(/^#\s?/, ""))
        .join(" ")
        .trim();
      return { name: d.name, description, modelYaml };
    });
}

export function createApp(name: string, pkg: string): { modelYaml?: string; errors: ModelError[] } {
  const errors: ModelError[] = [];
  if (!name || name.length > 50) {
    errors.push({ path: "app.name", message: "Name must be 1-50 characters." });
  }
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(pkg)) {
    errors.push({
      path: "app.package",
      message: `"${pkg}" is not a valid package (e.g. io.example.myapp).`,
    });
  }
  if (errors.length > 0) return { errors };
  const modelYaml = `# ${name} — AppCraft model. This file IS the app: edit it (or JSON-patch it
# via edit_model), validate, recompile. Diff, not drift.
appcraft: 0.1

app:
  name: ${name}
  package: ${pkg}

theme:
  seedColor: "#3F51B5"
  darkMode: system

data:
  entities:
    - name: Item
      storage: device
      attributes:
        - { name: id, type: id }
        - { name: title, type: text }
        - { name: createdAt, type: datetime }

flows:
  - { name: addItem, kind: create, entity: Item }
  - { name: items, kind: list, entity: Item, sort: { by: createdAt, order: desc } }
`;
  return { modelYaml, errors: [] };
}

export interface ValidateResult {
  valid: boolean;
  compileReady: boolean;
  errors: { spec: ModelError[]; compile: ModelError[] };
}

export function validateYaml(modelYaml: string): ValidateResult {
  const { doc, errors: loadErrors } = loadModel(modelYaml);
  if (loadErrors.length > 0) {
    return { valid: false, compileReady: false, errors: { spec: loadErrors, compile: [] } };
  }
  const spec = validateModel(doc);
  if (spec.errors.length > 0) {
    return { valid: false, compileReady: false, errors: { spec: spec.errors, compile: [] } };
  }
  const comp = validateForCompile(doc);
  return {
    valid: true,
    compileReady: comp.errors.length === 0,
    errors: { spec: [], compile: comp.errors },
  };
}

export function editModel(
  modelYaml: string,
  patch: Operation[],
): { modelYaml?: string; validation?: ValidateResult; errors: ModelError[] } {
  const { doc, errors: loadErrors } = loadModel(modelYaml);
  if (loadErrors.length > 0) return { errors: loadErrors };
  let patched: unknown;
  try {
    patched = applyPatch(structuredClone(doc), patch, true, false).newDocument;
  } catch (e) {
    return {
      errors: [
        {
          path: "$patch",
          message: `Patch failed: ${e instanceof Error ? e.message : String(e)}`,
          hint: "RFC-6902 operations against the parsed YAML document, e.g. {op:'add', path:'/data/entities/0/attributes/-', value:{name:'note', type:'text', optional:true}}.",
        },
      ],
    };
  }
  const out = stringify(patched, { lineWidth: 100 });
  return { modelYaml: out, validation: validateYaml(out), errors: [] };
}

export async function compileYaml(
  modelYaml: string,
  outDir: string,
): Promise<{ outDir?: string; fileCount?: number; files?: string[]; errors: ModelError[] }> {
  const { doc, errors: loadErrors } = loadModel(modelYaml);
  if (loadErrors.length > 0) return { errors: loadErrors };
  const { model, errors } = validateForCompile(doc);
  if (errors.length > 0 || !model) return { errors };
  const result = compile(model);
  const out = resolve(outDir);
  const files = await writeProject(result, out);
  return { outDir: out, fileCount: files.length, files, errors: [] };
}

export async function previewYaml(
  modelYaml: string,
  outPath?: string,
): Promise<{ html?: string; outPath?: string; errors: ModelError[] }> {
  const { doc, errors: loadErrors } = loadModel(modelYaml);
  if (loadErrors.length > 0) return { errors: loadErrors };
  const { model, errors } = validateModel(doc);
  if (errors.length > 0 || !model) return { errors };
  const html = renderPreviewHtml(model);
  if (outPath) {
    const out = resolve(outPath);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, html, "utf8");
    return { outPath: out, errors: [] };
  }
  return { html, errors: [] };
}

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  compileYaml,
  createApp,
  editModel,
  getSchema,
  listExamples,
  validateYaml,
} from "../src/tools.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "appcraft-mcp-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("MCP tool handlers", () => {
  test("get_schema returns schema + capability card + workflow", () => {
    const s = getSchema();
    expect(s.schema.title).toContain("AppCraft");
    expect(s.capabilityCard.unsupported.length).toBeGreaterThan(0);
    expect(s.workflow[0]).toContain("get_schema");
  });

  test("list_examples finds all three shipped examples", () => {
    const names = listExamples().map((e) => e.name).sort();
    expect(names).toEqual(["diabetes-tracker", "field-notes", "health-calculators"]);
    for (const e of listExamples()) {
      expect(validateYaml(e.modelYaml).valid).toBe(true);
    }
  });

  test("create_app starter model validates clean and is compile-ready", () => {
    const { modelYaml, errors } = createApp("TaskLog", "io.example.tasklog");
    expect(errors).toEqual([]);
    const v = validateYaml(modelYaml!);
    expect(v.valid).toBe(true);
    expect(v.compileReady).toBe(true);
  });

  test("create_app rejects a bad package", () => {
    const { errors } = createApp("X", "NotAPackage");
    expect(errors.some((e) => e.path === "app.package")).toBe(true);
  });

  test("edit_model: add-attribute patch round-trips and validates", () => {
    const { modelYaml } = createApp("TaskLog", "io.example.tasklog");
    const result = editModel(modelYaml!, [
      {
        op: "add",
        path: "/data/entities/0/attributes/-",
        value: { name: "note", type: "text", optional: true },
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.modelYaml).toContain("note");
    expect(result.validation?.valid).toBe(true);
  });

  test("edit_model: broken patch returns a repairable error", () => {
    const { modelYaml } = createApp("TaskLog", "io.example.tasklog");
    const result = editModel(modelYaml!, [
      { op: "add", path: "/data/entities/99/attributes/-", value: { name: "x", type: "text" } },
    ]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].path).toBe("$patch");
  });

  test("validate splits spec errors from compile-support errors", () => {
    const crud = `
appcraft: 0.1
app: { name: X, package: io.example.x }
data:
  entities:
    - name: Note
      storage: device
      attributes: [{ name: id, type: id }, { name: body, type: text }]
flows:
  - { name: addNote, kind: create, entity: Note }
  - { name: manageNotes, kind: crud, entity: Note }
`;
    const v = validateYaml(crud);
    expect(v.valid).toBe(true);
    expect(v.compileReady).toBe(false);
    expect(v.errors.compile.some((e) => e.message.includes("crud"))).toBe(true);
  });

  test("compile writes a complete project", async () => {
    const { modelYaml } = createApp("TaskLog", "io.example.tasklog");
    const out = join(dir, "tasklog");
    const result = await compileYaml(modelYaml!, out);
    expect(result.errors).toEqual([]);
    expect(result.fileCount!).toBeGreaterThan(18);
    expect(existsSync(join(out, "app/src/main/java/io/example/tasklog/MainActivity.kt"))).toBe(
      true,
    );
  });
});

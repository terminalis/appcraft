import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  capabilityCard,
  loadModel,
  validateForCompile,
  validateModel,
} from "../src/index.js";

const flagshipPath = fileURLToPath(
  new URL("../../../examples/diabetes-tracker/app.acm.yaml", import.meta.url),
);

function load(yaml: string) {
  const { doc, errors } = loadModel(yaml);
  expect(errors).toEqual([]);
  return doc;
}

const MINIMAL = `
appcraft: 0.1
app: { name: Mini, package: io.example.mini }
data:
  entities:
    - name: Note
      storage: device
      attributes:
        - { name: id, type: id }
        - { name: body, type: text }
flows:
  - { name: addNote, kind: create, entity: Note }
`;

describe("validateModel", () => {
  test("flagship example validates", () => {
    const doc = load(readFileSync(flagshipPath, "utf8"));
    const { model, errors } = validateModel(doc);
    expect(errors).toEqual([]);
    expect(model?.app.name).toBe("GlucoLog");
  });

  test("minimal model validates", () => {
    const { errors } = validateModel(load(MINIMAL));
    expect(errors).toEqual([]);
  });

  test("missing app.package → error at app", () => {
    const { errors } = validateModel(load("appcraft: 0.1\napp: { name: X }\n"));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].path).toContain("app");
    expect(errors[0].message).toMatch(/package/);
  });

  test("duplicate entity names rejected", () => {
    const yaml = `
appcraft: 0.1
app: { name: X, package: io.example.x }
data:
  entities:
    - name: Note
      storage: device
      attributes: [{ name: id, type: id }]
    - name: Note
      storage: device
      attributes: [{ name: id, type: id }]
`;
    const { errors } = validateModel(load(yaml));
    expect(errors.some((e) => e.message.includes('Duplicate type name "Note"'))).toBe(true);
  });

  test("flow referencing unknown entity rejected with hint", () => {
    const yaml = `
appcraft: 0.1
app: { name: X, package: io.example.x }
flows:
  - { name: addThing, kind: create, entity: Thing }
`;
    const { errors } = validateModel(load(yaml));
    const err = errors.find((e) => e.path === "flows[0].entity");
    expect(err?.message).toContain('Unknown entity "Thing"');
  });

  test("enum(Unknown) rejected", () => {
    const yaml = `
appcraft: 0.1
app: { name: X, package: io.example.x }
data:
  entities:
    - name: Note
      storage: device
      attributes:
        - { name: id, type: id }
        - { name: mood, type: enum(Mood) }
`;
    const { errors } = validateModel(load(yaml));
    expect(errors.some((e) => e.message.includes('Unknown enum "Mood"'))).toBe(true);
  });

  test("entity must have exactly one id attribute", () => {
    const yaml = `
appcraft: 0.1
app: { name: X, package: io.example.x }
data:
  entities:
    - name: Note
      storage: device
      attributes: [{ name: body, type: text }]
`;
    const { errors } = validateModel(load(yaml));
    expect(errors.some((e) => e.message.includes('exactly one attribute of type "id"'))).toBe(
      true,
    );
  });

  test("unknown top-level key rejected by schema", () => {
    const { errors } = validateModel(
      load('appcraft: 0.1\napp: { name: X, package: io.example.x }\nbanana: true\n'),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].hint).toContain("banana");
  });

  test("chart y-axis must be numeric", () => {
    const yaml = `
appcraft: 0.1
app: { name: X, package: io.example.x }
data:
  entities:
    - name: Note
      storage: device
      attributes:
        - { name: id, type: id }
        - { name: body, type: text }
        - { name: at, type: datetime }
ui:
  screens:
    - name: Chart
      components:
        - { kind: chart, type: line, entity: Note, x: at, y: body }
`;
    const { errors } = validateModel(load(yaml));
    expect(errors.some((e) => e.path === "ui.screens[0].components[0].y")).toBe(true);
  });
});

describe("validateForCompile", () => {
  test("crud flow: spec-valid but compile-unsupported", () => {
    const yaml = `
appcraft: 0.1
app: { name: X, package: io.example.x }
data:
  entities:
    - name: Note
      storage: device
      attributes: [{ name: id, type: id }, { name: body, type: text }]
flows:
  - { name: manageNotes, kind: crud, entity: Note }
`;
    const doc = load(yaml);
    expect(validateModel(doc).errors).toEqual([]);
    const { errors } = validateForCompile(doc);
    expect(errors.some((e) => e.path === "flows[0].kind" && e.message.includes("crud"))).toBe(
      true,
    );
  });

  test("flagship passes compile validation", () => {
    const doc = load(readFileSync(flagshipPath, "utf8"));
    expect(validateForCompile(doc).errors).toEqual([]);
  });
});

describe("capabilityCard", () => {
  test("lists ml as unsupported, planned phase 2", () => {
    const card = capabilityCard();
    const ml = card.unsupported.find((u) => u.feature.startsWith("ml blocks"));
    expect(ml?.planned).toContain("phase 2");
    expect(card.supported.flowKinds.join()).toContain("create");
  });
});

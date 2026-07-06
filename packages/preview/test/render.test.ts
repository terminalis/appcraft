import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadModel, validateModel } from "@appcraft-io/core";
import { renderPreviewHtml } from "../src/index.js";

function flagship() {
  const path = fileURLToPath(
    new URL("../../../examples/diabetes-tracker/app.acm.yaml", import.meta.url),
  );
  const { doc } = loadModel(readFileSync(path, "utf8"));
  const { model } = validateModel(doc);
  return model!;
}

describe("renderPreviewHtml", () => {
  const html = renderPreviewHtml(flagship());

  test("contains every screen title", () => {
    for (const title of ["Log Reading", "History", "Find By Day", "Weekly Chart"]) {
      expect(html).toContain(title);
    }
  });

  test("uses the seed color", () => {
    expect(html).toContain("#2E7D32");
  });

  test("fully self-contained: no external requests", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<script");
  });

  test("deterministic", () => {
    expect(renderPreviewHtml(flagship())).toBe(html);
  });

  test("form mock reflects the model's fields", () => {
    expect(html).toContain("Mmol");
    expect(html).toContain("Pick Meal Photo");
    expect(html).toContain("fasting");
  });
});

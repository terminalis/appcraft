import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The canonical schema at <repo>/schema/ is duplicated into the published
// @appcraft-io/core package (files: ["dist", "schema"]) so schemaPath()'s
// walk-up resolves outside the monorepo too. The copies must never drift.
describe("published schema copy", () => {
  it("packages/core/schema mirrors the canonical <repo>/schema byte-for-byte", () => {
    const root = fileURLToPath(
      new URL("../../../schema/appcraft.schema.json", import.meta.url),
    );
    const packaged = fileURLToPath(
      new URL("../schema/appcraft.schema.json", import.meta.url),
    );
    expect(readFileSync(packaged, "utf8")).toBe(readFileSync(root, "utf8"));
  });
});

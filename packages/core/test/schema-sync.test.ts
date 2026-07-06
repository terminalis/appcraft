import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The canonical schema at <repo>/schema/ is duplicated into the published
// @appcraft-io/core package (files: ["dist", "schema"]) so schemaPath()'s
// walk-up resolves outside the monorepo too. The copies must never drift.
// EOL is normalized: on Windows working trees the two files can legitimately
// differ in CRLF/LF depending on checkout history, and JSON parsing is
// EOL-agnostic — this gate is about content drift.
const normalize = (s: string) => s.replace(/\r\n/g, "\n");

describe("published schema copy", () => {
  it("packages/core/schema mirrors the canonical <repo>/schema", () => {
    const root = fileURLToPath(
      new URL("../../../schema/appcraft.schema.json", import.meta.url),
    );
    const packaged = fileURLToPath(
      new URL("../schema/appcraft.schema.json", import.meta.url),
    );
    expect(normalize(readFileSync(packaged, "utf8"))).toBe(
      normalize(readFileSync(root, "utf8")),
    );
  });
});

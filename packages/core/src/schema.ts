import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The canonical JSON Schema lives at <repo>/schema/appcraft.schema.json —
 * a single copy, published for humans and agents alike. At runtime we locate
 * it by walking up from this module (works from both src/ under vitest and
 * dist/ under node). APPCRAFT_SCHEMA_PATH overrides for exotic layouts.
 */
export function schemaPath(): string {
  const override = process.env.APPCRAFT_SCHEMA_PATH;
  if (override && existsSync(override)) return override;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "schema", "appcraft.schema.json");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(
    "appcraft.schema.json not found; set APPCRAFT_SCHEMA_PATH to its location.",
  );
}

let cached: Record<string, unknown> | undefined;

export function appcraftSchema(): Record<string, unknown> {
  if (!cached) {
    cached = JSON.parse(readFileSync(schemaPath(), "utf8")) as Record<string, unknown>;
  }
  return cached;
}

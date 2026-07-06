import { parse } from "yaml";
import type { ModelError } from "./types.js";

/**
 * Parses model YAML into a plain document. Does not validate — pair with
 * validateModel(). Normalizes `appcraft: 0.1` (YAML number) to the string
 * form the schema expects.
 */
export function loadModel(yamlText: string): { doc?: unknown; errors: ModelError[] } {
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch (e) {
    return {
      errors: [
        {
          path: "$",
          message: `YAML parse error: ${e instanceof Error ? e.message : String(e)}`,
          hint: "The model must be a single valid YAML document.",
        },
      ],
    };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return {
      errors: [
        { path: "$", message: "Model must be a YAML mapping (an object at the top level)." },
      ],
    };
  }
  const record = doc as Record<string, unknown>;
  if (typeof record.appcraft === "number") {
    record.appcraft = String(record.appcraft);
  }
  return { doc, errors: [] };
}

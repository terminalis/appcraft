import type { AppModel } from "@appcraft-io/core";
import { emitData } from "./data.js";
import { emitDomain } from "./domain.js";
import { emitFacade } from "./facade.js";
import { emitProject } from "./project.js";
import { emitTheme } from "./theme.js";
import { emitUi } from "./ui.js";
import { usesOf } from "./uses.js";

export interface CompileResult {
  files: Map<string, string>;
  warnings: string[];
}

/**
 * The deterministic compile path: AppModel in, complete buildable Gradle
 * project out. Pure — no I/O, no randomness, no timestamps, and no LLM.
 * Callers must run validateForCompile() first; compile() assumes a valid model.
 */
export function compile(model: AppModel): CompileResult {
  const files = new Map<string, string>();
  const warnings: string[] = [];
  const uses = usesOf(model);

  emitProject(model, uses, files);
  emitDomain(model, files);
  emitData(model, files);
  emitFacade(model, files);
  emitTheme(model, files);
  emitUi(model, uses, files);

  return { files, warnings };
}

export { writeProject } from "./write.js";
export { PINS } from "./project.js";
export { pascal, camel, packagePath, screenName, safeName } from "./naming.js";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CompileResult } from "./index.js";

/** Writes a compiled project to disk. Returns the sorted list of written paths. */
export async function writeProject(result: CompileResult, outDir: string): Promise<string[]> {
  const written: string[] = [];
  for (const [rel, content] of [...result.files.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const abs = join(outDir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    written.push(rel);
  }
  return written;
}

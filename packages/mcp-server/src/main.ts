#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  compileYaml,
  createApp,
  editModel,
  getSchema,
  listExamples,
  previewYaml,
  validateYaml,
} from "./tools.js";

/**
 * The AppCraft MCP server: how AI agents build native Android apps without
 * writing Kotlin. Agents write the MODEL (app.acm.yaml); the deterministic
 * compiler does the rest. Three reliable tool calls beat 20,000 lines of
 * freehand codegen.
 */

const server = new McpServer({ name: "appcraft", version: "0.1.0" });

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

server.tool(
  "get_schema",
  "START HERE. Returns the AppCraft model JSON Schema, the capability card (what the compiler CAN and CANNOT build — never promise unsupported features to users), and the recommended tool workflow.",
  {},
  async () => json(getSchema()),
);

server.tool(
  "list_examples",
  "Complete example models (a health tracker with chart, custom-formula calculators, an escape-hatch showcase). Read one before writing your first model.",
  {},
  async () => json(listExamples()),
);

server.tool(
  "create_app",
  "Returns a minimal valid starter model (one entity, create+list flows) for the given app name and Android package. Shape it from there with edit_model or by rewriting the YAML.",
  {
    name: z.string().describe("Display name, e.g. 'GlucoLog' (1-50 chars)"),
    package: z.string().describe("Android package, e.g. 'io.example.glucolog'"),
  },
  async ({ name, package: pkg }) => json(createApp(name, pkg)),
);

server.tool(
  "validate",
  "Validate a model. errors.spec = schema/semantic problems (fix these). errors.compile = spec-valid features compiler 0.1 cannot build yet (redesign around them; see capability card). Run after EVERY edit.",
  { modelYaml: z.string().describe("Full app.acm.yaml content") },
  async ({ modelYaml }) => json(validateYaml(modelYaml)),
);

server.tool(
  "edit_model",
  "Apply an RFC-6902 JSON patch to the model (paths address the parsed YAML, e.g. /data/entities/0/attributes/-). Returns the updated YAML plus its validation result. Note: YAML comments are not preserved; for comment-heavy models, rewrite the YAML directly instead.",
  {
    modelYaml: z.string().describe("Current app.acm.yaml content"),
    patch: z
      .array(z.record(z.unknown()))
      .describe("RFC-6902 operations: [{op, path, value?, from?}, ...]"),
  },
  async ({ modelYaml, patch }) => json(editModel(modelYaml, patch as never)),
);

server.tool(
  "compile",
  "Deterministically compile a valid model into a COMPLETE Jetpack Compose / Material 3 Gradle project at outDir (clean architecture, Room storage, zero placeholders). Open in Android Studio or run 'gradle assembleDebug' to get the APK.",
  {
    modelYaml: z.string().describe("Full app.acm.yaml content"),
    outDir: z.string().describe("Directory to write the Android project into"),
  },
  async ({ modelYaml, outDir }) => json(await compileYaml(modelYaml, outDir)),
);

server.tool(
  "preview",
  "Instant deterministic HTML mockup of the model (no Android toolchain needed). Provide outPath to write the file, or omit it to get the HTML back.",
  {
    modelYaml: z.string().describe("Full app.acm.yaml content"),
    outPath: z.string().optional().describe("Optional path for the .html file"),
  },
  async ({ modelYaml, outPath }) => json(await previewYaml(modelYaml, outPath)),
);

const transport = new StdioServerTransport();
await server.connect(transport);

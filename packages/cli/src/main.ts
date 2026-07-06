#!/usr/bin/env node
import { Command } from "commander";
import { runGenerate, runPreview, runSchema, runValidate } from "./commands.js";

const program = new Command();

program
  .name("appcraft")
  .description(
    "The deterministic app compiler: validate an app.acm.yaml model, generate a complete native Android project, or render an instant preview.",
  )
  .version("0.1.0");

program
  .command("validate")
  .argument("<model>", "path to app.acm.yaml")
  .description("validate a model against the AppCraft schema and semantics")
  .action(async (model: string) => {
    process.exitCode = await runValidate(model);
  });

program
  .command("generate")
  .argument("<model>", "path to app.acm.yaml")
  .option("-o, --out <dir>", "output directory (default: <appname>-android)")
  .description("compile the model into a complete Jetpack Compose Gradle project")
  .action(async (model: string, opts: { out?: string }) => {
    process.exitCode = await runGenerate(model, opts.out);
  });

program
  .command("preview")
  .argument("<model>", "path to app.acm.yaml")
  .option("-o, --out <file>", "output HTML file", "appcraft-preview.html")
  .description("render an instant self-contained HTML mockup of the model")
  .action(async (model: string, opts: { out?: string }) => {
    process.exitCode = await runPreview(model, opts.out);
  });

program
  .command("schema")
  .option("--card", "print the capability card instead of the JSON Schema")
  .description("print the model JSON Schema (or the capability card)")
  .action((opts: { card?: boolean }) => {
    process.exitCode = runSchema(opts.card ?? false);
  });

program.parseAsync(process.argv);

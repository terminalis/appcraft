import type { AppModel, Attribute, Entity, Flow, Step } from "@appcraft-io/core";
import {
  exprToKotlin,
  kotlinTypeOf,
  parseAssignment,
  parseType,
  symsForFlow,
  type SymbolTable,
} from "@appcraft-io/core";
import { camel, packagePath } from "./naming.js";

/**
 * Business tier: the ModelFacade (the paper's use-case interactor, §III-D),
 * corrected to depend only on gateway interfaces. Custom flows are transpiled
 * from the validated expression mini-language — deterministic, whitelisted,
 * no arbitrary code in the compile path.
 */

function zeroValue(kotlinType: string, model: AppModel): string {
  switch (kotlinType) {
    case "Double":
      return "0.0";
    case "Int":
      return "0";
    case "Long":
      return "0L";
    case "String":
      return '""';
    case "Boolean":
      return "false";
  }
  const enumDef = (model.data?.enums ?? []).find((e) => e.name === kotlinType);
  if (enumDef) return `${kotlinType}.${enumDef.values[0]}`;
  return "TODO_unsupported"; // unreachable: validated returns are scalar or enum
}

/** Entities whose gateways a flow needs. */
export function flowEntity(model: AppModel, flow: Flow): Entity | undefined {
  return (model.data?.entities ?? []).find((e) => e.name === flow.entity);
}

export function searchMatcher(attr: Attribute): string {
  const q = "query.trim()";
  const ref = `it.${attr.name}`;
  const parsed = parseType(attr.type);
  if (parsed?.kind === "enum") {
    return attr.optional || attr.derived
      ? `${ref}?.name.equals(${q}, ignoreCase = true) == true`
      : `${ref}.name.equals(${q}, ignoreCase = true)`;
  }
  switch (attr.type) {
    case "text":
    case "id":
    case "image":
      return attr.optional || attr.derived
        ? `${ref}?.contains(${q}, ignoreCase = true) == true`
        : `${ref}.contains(${q}, ignoreCase = true)`;
    case "int":
    case "decimal":
      return `${ref}.toString() == ${q}`;
    case "date":
    case "datetime":
      return `java.time.Instant.ofEpochMilli(${ref}).atZone(java.time.ZoneId.systemDefault()).toLocalDate().toString().startsWith(${q})`;
    case "bool":
      return `${ref}.toString().equals(${q}, ignoreCase = true)`;
    default:
      return "true";
  }
}

function paramKotlinType(model: AppModel, type: string): string {
  return kotlinTypeOf(type);
}

interface StepEmit {
  lines: string[];
}

function emitSteps(
  model: AppModel,
  flow: Flow,
  steps: Step[],
  syms: SymbolTable,
  locals: Set<string>,
  indent: string,
  out: StepEmit,
): void {
  const enums = model.data?.enums ?? [];
  for (const step of steps) {
    if (typeof step === "string") {
      const a = parseAssignment(step, syms, enums);
      const rhs = exprToKotlin(a.exprSrc, syms, enums);
      if (a.target === "result") {
        out.lines.push(`${indent}result = ${rhs}`);
      } else if (locals.has(a.target) || syms[a.target]) {
        out.lines.push(`${indent}${a.target} = ${rhs}`);
      } else {
        locals.add(a.target);
        syms[a.target] = {
          kotlinType:
            a.type === "number"
              ? "Double"
              : a.type === "string"
                ? "String"
                : a.type === "boolean"
                  ? "Boolean"
                  : a.type,
          enumName: enums.some((e) => e.name === a.type) ? a.type : undefined,
        };
        out.lines.push(`${indent}var ${a.target} = ${rhs}`);
      }
    } else if ("if" in step) {
      const cond = exprToKotlin(step.if, syms, enums);
      out.lines.push(`${indent}if (${cond}) {`);
      emitSteps(model, flow, step.then, syms, locals, indent + "    ", out);
      if (step.else) {
        out.lines.push(`${indent}} else {`);
        emitSteps(model, flow, step.else, syms, locals, indent + "    ", out);
      }
      out.lines.push(`${indent}}`);
    } else if ("call" in step) {
      const args = (step.call ? (step.args ?? []) : []).map((arg) =>
        exprToKotlin(arg, syms, enums),
      );
      const call = `CustomBlocks.${step.call}(${args.join(", ")})`;
      if (step.assignTo) {
        const block = (model.custom ?? []).find((b) => b.name === step.call);
        if (locals.has(step.assignTo) || syms[step.assignTo]) {
          out.lines.push(`${indent}${step.assignTo} = ${call}`);
        } else {
          locals.add(step.assignTo);
          syms[step.assignTo] = { kotlinType: kotlinTypeOf(block?.output ?? "text") };
          out.lines.push(`${indent}var ${step.assignTo} = ${call}`);
        }
      } else {
        out.lines.push(`${indent}${call}`);
      }
    }
  }
}

export function customFlowMethod(model: AppModel, flow: Flow): string {
  const params = (flow.params ?? [])
    .map((p) => `${p.name}: ${paramKotlinType(model, p.type)}`)
    .join(", ");
  const retType = flow.returns ? kotlinTypeOf(flow.returns) : "Unit";
  const syms = symsForFlow(model, flow);
  const locals = new Set<string>();
  const out: StepEmit = { lines: [] };
  emitSteps(model, flow, flow.steps ?? [], syms, locals, "        ", out);
  const header = `    // flow: ${flow.name} (custom)`;
  if (flow.returns) {
    return `${header}
    fun ${flow.name}(${params}): ${retType} {
        var result: ${retType} = ${zeroValue(retType, model)}
${out.lines.join("\n")}
        return result
    }`;
  }
  return `${header}
    fun ${flow.name}(${params}) {
${out.lines.join("\n")}
    }`;
}

/** Entities the facade needs gateways for (all declared entities, stable order). */
export function facadeEntities(model: AppModel): Entity[] {
  return model.data?.entities ?? [];
}

export function facadeFile(model: AppModel): string {
  const pkg = model.app.package;
  const entities = facadeEntities(model);
  const flows = model.flows ?? [];
  const chartEntities = [
    ...new Set(
      (model.ui?.screens ?? []).flatMap((s) => (s.components ?? []).map((c) => c.entity)),
    ),
  ];
  const usesCustomBlocks = flows.some(
    (f) =>
      f.kind === "custom" &&
      (f.steps ?? []).some((s) => typeof s === "object" && "call" in s),
  );
  const needsFlowImports =
    flows.some((f) => f.kind === "list" || f.kind === "search") || chartEntities.length > 0;

  const methods: string[] = [];
  for (const flow of flows) {
    const entity = flowEntity(model, flow);
    const gw = entity ? `${camel(entity.name)}Gateway` : "";
    switch (flow.kind) {
      case "create":
        methods.push(`    // flow: ${flow.name} (create ${entity!.name})
    suspend fun ${flow.name}(item: ${entity!.name}) = ${gw}.upsert(item)`);
        break;
      case "list": {
        const sort = flow.sort
          ? `.map { list -> list.sorted${flow.sort.order === "desc" ? "ByDescending" : "By"} { it.${flow.sort.by} } }`
          : "";
        methods.push(`    // flow: ${flow.name} (list ${entity!.name}${flow.sort ? `, by ${flow.sort.by} ${flow.sort.order}` : ""})
    fun ${flow.name}(): Flow<List<${entity!.name}>> = ${gw}.observeAll()${sort}`);
        break;
      }
      case "search": {
        const attr = entity!.attributes.find((a) => a.name === flow.by)!;
        methods.push(`    // flow: ${flow.name} (search ${entity!.name} by ${flow.by}; in-memory filter — v0.1 simplification for device-local data)
    fun ${flow.name}(query: String): Flow<List<${entity!.name}>> =
        ${gw}.observeAll().map { list -> list.filter { ${searchMatcher(attr)} } }`);
        break;
      }
      case "custom":
        methods.push(customFlowMethod(model, flow));
        break;
      default:
        break; // crud is rejected by validateForCompile
    }
  }
  for (const entityName of chartEntities) {
    methods.push(`    // chart data source
    fun observe${entityName}(): Flow<List<${entityName}>> = ${camel(entityName)}Gateway.observeAll()`);
  }

  const ctor = entities
    .map((e) => `    private val ${camel(e.name)}Gateway: ${e.name}Gateway,`)
    .join("\n");
  const gwImports = entities
    .map((e) => `import ${pkg}.domain.gateway.${e.name}Gateway`)
    .join("\n");

  return `package ${pkg}.domain

${gwImports}${entities.length > 0 || (model.data?.enums ?? []).length > 0 ? `\nimport ${pkg}.domain.model.*` : ""}${usesCustomBlocks ? `\nimport ${pkg}.custom.CustomBlocks` : ""}${needsFlowImports ? "\nimport kotlinx.coroutines.flow.Flow\nimport kotlinx.coroutines.flow.map" : ""}

/**
 * The use-case interactor facade. Depends exclusively on gateway interfaces
 * (dependency rule: source dependencies point inward). One method per flow.
 */
class ModelFacade(
${ctor}
) {
${methods.join("\n\n")}
}
`;
}

export function customBlocksFile(model: AppModel): string | undefined {
  const blocks = model.custom ?? [];
  if (blocks.length === 0) return undefined;
  const pkg = model.app.package;
  const fns = blocks.map((b) => {
    const params = (b.inputs ?? [])
      .map((p) => `${p.name}: ${kotlinTypeOf(p.type)}`)
      .join(", ");
    const ret = b.output ? `: ${kotlinTypeOf(b.output)}` : "";
    const body = b.kotlin
      .trimEnd()
      .split("\n")
      .map((l) => `        ${l}`)
      .join("\n");
    return `    fun ${b.name}(${params})${ret} {
${body}
    }`;
  });
  return `package ${pkg}.custom

import ${pkg}.domain.model.*

/**
 * Custom blocks: user-authored Kotlin, preserved VERBATIM across regeneration.
 * This is the model's escape hatch — a spine with sockets, not a cage.
 */
object CustomBlocks {
${fns.join("\n\n")}
}
`;
}

export function emitFacade(model: AppModel, files: Map<string, string>): void {
  const base = `app/src/main/java/${packagePath(model.app.package)}`;
  files.set(`${base}/domain/ModelFacade.kt`, facadeFile(model));
  const blocks = customBlocksFile(model);
  if (blocks) files.set(`${base}/custom/CustomBlocks.kt`, blocks);
}

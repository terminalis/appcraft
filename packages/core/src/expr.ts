import type { AppModel, EnumDef, Flow, ModelError, Step } from "./types.js";
import { parseType } from "./types.js";

/**
 * The AppCraft expression mini-language: arithmetic, comparison, and boolean
 * operators over declared identifiers, numeric literals, single-quoted string
 * literals, and enum literals. NO method calls, NO arbitrary Kotlin. Every
 * identifier must resolve against the symbol table — this whitelist is the
 * injection guard that keeps compiled output trustworthy.
 */

export interface SymInfo {
  /** Kotlin type this identifier has in generated code (Int, Double, String, Boolean, Long, enum or entity name). */
  kotlinType: string;
  /** Set when the identifier is enum-typed; enables bare enum-literal resolution. */
  enumName?: string;
}

export type SymbolTable = Record<string, SymInfo>;

// ---------------------------------------------------------------------------
// Tokenizer

type Tok =
  | { kind: "num"; text: string }
  | { kind: "str"; text: string }
  | { kind: "ident"; text: string }
  | { kind: "op"; text: string }
  | { kind: "lparen" }
  | { kind: "rparen" };

const OPS = ["||", "&&", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%", "!"];

function tokenize(src: string): { toks?: Tok[]; error?: string } {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      toks.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      toks.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) return { error: "Unterminated string literal." };
      toks.push({ kind: "str", text: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      toks.push({ kind: "num", text: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*/.exec(src.slice(i))!;
      toks.push({ kind: "ident", text: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      toks.push({ kind: "op", text: op });
      i += op.length;
      continue;
    }
    return { error: `Illegal character "${c}" — the expression language allows only arithmetic/comparison/boolean operators, numbers, 'strings', and declared identifiers.` };
  }
  return { toks };
}

// ---------------------------------------------------------------------------
// Parser (recursive descent) producing Kotlin text + inferred type.

interface Ctx {
  toks: Tok[];
  pos: number;
  syms: SymbolTable;
  enums: EnumDef[];
  errors: string[];
}

interface Val {
  kotlin: string;
  /** "number" | "string" | "boolean" | enum name | entity/other kotlin type | "unknown" */
  type: string;
  /** Set when this value is a bare identifier that did not resolve — it may
   *  still resolve as an enum literal against the other operand. */
  pendingIdent?: string;
  /** Set when this value is a string literal (may resolve to an enum literal). */
  stringLiteral?: string;
}

function peek(ctx: Ctx): Tok | undefined {
  return ctx.toks[ctx.pos];
}

function takeOp(ctx: Ctx, ...ops: string[]): string | undefined {
  const t = peek(ctx);
  if (t?.kind === "op" && ops.includes(t.text)) {
    ctx.pos++;
    return t.text;
  }
  return undefined;
}

function enumOf(ctx: Ctx, name: string): EnumDef | undefined {
  return ctx.enums.find((e) => e.name === name);
}

/** Try to resolve a pending bare ident / string literal as a literal of the given enum. */
function resolveEnumLiteral(ctx: Ctx, v: Val, enumName: string): Val | undefined {
  const def = enumOf(ctx, enumName);
  if (!def) return undefined;
  const literal = v.pendingIdent ?? v.stringLiteral;
  if (literal !== undefined && def.values.includes(literal)) {
    return { kotlin: `${enumName}.${literal}`, type: enumName };
  }
  return undefined;
}

function settle(ctx: Ctx, v: Val): Val {
  if (v.pendingIdent) {
    ctx.errors.push(
      `Unknown identifier "${v.pendingIdent}" — only declared attributes, params, locals, and enum literals may be referenced.`,
    );
    return { kotlin: v.kotlin, type: "unknown" };
  }
  return v;
}

function primary(ctx: Ctx): Val {
  const t = peek(ctx);
  if (!t) {
    ctx.errors.push("Unexpected end of expression.");
    return { kotlin: "", type: "unknown" };
  }
  if (t.kind === "num") {
    ctx.pos++;
    return { kotlin: t.text, type: "number" };
  }
  if (t.kind === "str") {
    ctx.pos++;
    return { kotlin: `"${t.text.replace(/"/g, '\\"')}"`, type: "string", stringLiteral: t.text };
  }
  if (t.kind === "lparen") {
    ctx.pos++;
    const inner = orExpr(ctx);
    if (peek(ctx)?.kind === "rparen") ctx.pos++;
    else ctx.errors.push("Missing closing parenthesis.");
    return { ...inner, kotlin: `(${inner.kotlin})` };
  }
  if (t.kind === "ident") {
    ctx.pos++;
    if (peek(ctx)?.kind === "lparen") {
      ctx.errors.push(`Method calls are not allowed in expressions ("${t.text}(...)"). Use a custom block instead.`);
      return { kotlin: t.text, type: "unknown" };
    }
    const sym = ctx.syms[t.text];
    if (sym) {
      return { kotlin: t.text, type: symType(sym) };
    }
    return { kotlin: t.text, type: "unknown", pendingIdent: t.text };
  }
  ctx.errors.push(`Unexpected token "${"text" in t ? t.text : t.kind}".`);
  ctx.pos++;
  return { kotlin: "", type: "unknown" };
}

function symType(sym: SymInfo): string {
  if (sym.enumName) return sym.enumName;
  if (["Int", "Double", "Long"].includes(sym.kotlinType)) return "number";
  if (sym.kotlinType === "String") return "string";
  if (sym.kotlinType === "Boolean") return "boolean";
  return sym.kotlinType;
}

function unary(ctx: Ctx): Val {
  const op = takeOp(ctx, "!", "-");
  if (op) {
    const v = settle(ctx, unary(ctx));
    return { kotlin: `${op}${v.kotlin}`, type: op === "!" ? "boolean" : "number" };
  }
  return primary(ctx);
}

function binaryChain(
  ctx: Ctx,
  next: (ctx: Ctx) => Val,
  ops: string[],
  resultType: (op: string, l: Val, r: Val) => string,
  allowEnumResolution = false,
): Val {
  let left = next(ctx);
  let op = takeOp(ctx, ...ops);
  while (op) {
    let right = next(ctx);
    if (allowEnumResolution) {
      // enum == literal / literal == enum
      const leftEnum = enumOf(ctx, left.type) ? left.type : undefined;
      const rightEnum = enumOf(ctx, right.type) ? right.type : undefined;
      if (leftEnum && (right.pendingIdent || right.stringLiteral)) {
        right = resolveEnumLiteral(ctx, right, leftEnum) ?? right;
      } else if (rightEnum && (left.pendingIdent || left.stringLiteral)) {
        left = resolveEnumLiteral(ctx, left, rightEnum) ?? left;
      }
    }
    left = settle(ctx, left);
    right = settle(ctx, right);
    left = { kotlin: `${left.kotlin} ${op} ${right.kotlin}`, type: resultType(op, left, right) };
    op = takeOp(ctx, ...ops);
  }
  return left;
}

function multiplicative(ctx: Ctx): Val {
  return binaryChain(ctx, unary, ["*", "/", "%"], () => "number");
}
function additive(ctx: Ctx): Val {
  return binaryChain(ctx, multiplicative, ["+", "-"], (_op, l) =>
    l.type === "string" ? "string" : "number",
  );
}
function comparison(ctx: Ctx): Val {
  return binaryChain(ctx, additive, ["<", "<=", ">", ">="], () => "boolean");
}
function equality(ctx: Ctx): Val {
  return binaryChain(ctx, comparison, ["==", "!="], () => "boolean", true);
}
function andExpr(ctx: Ctx): Val {
  return binaryChain(ctx, equality, ["&&"], () => "boolean");
}
function orExpr(ctx: Ctx): Val {
  return binaryChain(ctx, andExpr, ["||"], () => "boolean");
}

function analyze(
  src: string,
  syms: SymbolTable,
  enums: EnumDef[],
): { kotlin: string; type: string; errors: string[] } {
  const { toks, error } = tokenize(src);
  if (!toks) return { kotlin: "", type: "unknown", errors: [error!] };
  if (toks.length === 0) return { kotlin: "", type: "unknown", errors: ["Empty expression."] };
  const ctx: Ctx = { toks, pos: 0, syms, enums, errors: [] };
  let v = orExpr(ctx);
  v = settle(ctx, v);
  if (ctx.pos < toks.length && ctx.errors.length === 0) {
    const t = toks[ctx.pos];
    ctx.errors.push(`Unexpected trailing input at "${"text" in t ? t.text : t.kind}".`);
  }
  return { kotlin: v.kotlin, type: v.type, errors: ctx.errors };
}

// ---------------------------------------------------------------------------
// Public API

export function checkExpr(src: string, syms: SymbolTable, enums: EnumDef[]): ModelError[] {
  return analyze(src, syms, enums).errors.map((message) => ({
    path: "",
    message: `In "${src}": ${message}`,
  }));
}

export function exprToKotlin(src: string, syms: SymbolTable, enums: EnumDef[]): string {
  const { kotlin, errors } = analyze(src, syms, enums);
  if (errors.length > 0) {
    throw new Error(`Invalid expression "${src}": ${errors.join(" ")}`);
  }
  return kotlin;
}

export function exprType(src: string, syms: SymbolTable, enums: EnumDef[]): string {
  return analyze(src, syms, enums).type;
}

// ---------------------------------------------------------------------------
// Assignment statements: "target = <expr>" (first assignment declares a local;
// "result = <expr>" sets the flow's return value).

export interface AssignmentInfo {
  target: string;
  exprSrc: string;
  errors: ModelError[];
  /** Inferred abstract type of the RHS: number|string|boolean|<Enum>|unknown */
  type: string;
}

export function parseAssignment(src: string, syms: SymbolTable, enums: EnumDef[]): AssignmentInfo {
  // Find the first "=" that is not part of ==, !=, <=, >=.
  let idx = -1;
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "=") continue;
    const prev = src[i - 1];
    const next = src[i + 1];
    if (next === "=" || prev === "=" || prev === "!" || prev === "<" || prev === ">") {
      if (next === "=") i++; // skip the second char of ==/!=/<=/>=
      continue;
    }
    idx = i;
    break;
  }
  if (idx < 0) {
    return {
      target: "",
      exprSrc: src,
      type: "unknown",
      errors: [{ path: "", message: `Step "${src}" must be an assignment: "<name> = <expression>".` }],
    };
  }
  const target = src.slice(0, idx).trim();
  const exprSrc = src.slice(idx + 1).trim();
  const errors: ModelError[] = [];
  if (!/^[a-z][A-Za-z0-9_]*$/.test(target)) {
    errors.push({
      path: "",
      message: `Assignment target "${target}" must be a simple lowercase identifier (a param, a new local, or "result").`,
    });
  }
  const a = analyze(exprSrc, syms, enums);
  errors.push(...a.errors.map((message) => ({ path: "", message: `In "${src}": ${message}` })));
  return { target, exprSrc, type: a.type, errors };
}

// ---------------------------------------------------------------------------
// Whole-model expression validation (wired into validateModel).

export function kotlinTypeOf(attrType: string): string {
  const parsed = parseType(attrType);
  if (!parsed) return "unknown";
  switch (parsed.kind) {
    case "scalar":
      switch (parsed.scalar) {
        case "id":
        case "text":
        case "image":
          return "String";
        case "int":
          return "Int";
        case "decimal":
          return "Double";
        case "bool":
          return "Boolean";
        case "date":
        case "datetime":
          return "Long";
      }
      break;
    case "enum":
      return parsed.enum;
    case "entity":
      return parsed.entity;
    case "list":
      return `List<${parsed.of}>`;
  }
  return "unknown";
}

export function symsForEntity(model: AppModel, entityName: string, prefix = ""): SymbolTable {
  const entity = (model.data?.entities ?? []).find((e) => e.name === entityName);
  const syms: SymbolTable = {};
  for (const a of entity?.attributes ?? []) {
    const kotlinType = kotlinTypeOf(a.type);
    const parsed = parseType(a.type);
    syms[`${prefix}${a.name}`] = {
      kotlinType,
      enumName: parsed?.kind === "enum" ? parsed.enum : undefined,
    };
  }
  return syms;
}

export function symsForFlow(model: AppModel, flow: Flow): SymbolTable {
  const syms: SymbolTable = {};
  for (const p of flow.params ?? []) {
    const parsed = parseType(p.type);
    if (!parsed) continue;
    if (parsed.kind === "entity") {
      syms[p.name] = { kotlinType: parsed.entity };
      Object.assign(syms, symsForEntity(model, parsed.entity, `${p.name}.`));
    } else {
      syms[p.name] = {
        kotlinType: kotlinTypeOf(p.type),
        enumName: parsed.kind === "enum" ? parsed.enum : undefined,
      };
    }
  }
  return syms;
}

function validateSteps(
  model: AppModel,
  flow: Flow,
  steps: Step[],
  syms: SymbolTable,
  pathPrefix: string,
  errors: ModelError[],
): void {
  const enums = model.data?.enums ?? [];
  const blocks = model.custom ?? [];
  steps.forEach((step, i) => {
    const path = `${pathPrefix}[${i}]`;
    if (typeof step === "string") {
      const a = parseAssignment(step, syms, enums);
      errors.push(...a.errors.map((e) => ({ ...e, path })));
      if (a.errors.length === 0) {
        if (a.target === "result") {
          if (!flow.returns) {
            errors.push({
              path,
              message: `Flow "${flow.name}" assigns "result" but declares no "returns" type.`,
            });
          }
        } else if (!syms[a.target]) {
          // first assignment declares a local
          syms[a.target] = {
            kotlinType:
              a.type === "number" ? "Double" : a.type === "string" ? "String" : a.type === "boolean" ? "Boolean" : a.type,
            enumName: enums.some((e) => e.name === a.type) ? a.type : undefined,
          };
        }
      }
    } else if ("if" in step) {
      errors.push(
        ...checkExpr(step.if, syms, enums).map((e) => ({ ...e, path: `${path}.if` })),
      );
      validateSteps(model, flow, step.then, syms, `${path}.then`, errors);
      if (step.else) validateSteps(model, flow, step.else, syms, `${path}.else`, errors);
    } else if ("call" in step) {
      const block = blocks.find((b) => b.name === step.call);
      const args = step.args ?? [];
      if (block) {
        const expected = (block.inputs ?? []).length;
        if (args.length !== expected) {
          errors.push({
            path: `${path}.args`,
            message: `Custom block "${block.name}" expects ${expected} argument(s), got ${args.length}.`,
          });
        }
        if (step.assignTo && !block.output) {
          errors.push({
            path: `${path}.assignTo`,
            message: `Custom block "${block.name}" has no output to assign.`,
          });
        }
      }
      args.forEach((arg, j) => {
        errors.push(
          ...checkExpr(arg, syms, enums).map((e) => ({ ...e, path: `${path}.args[${j}]` })),
        );
      });
      if (step.assignTo && block?.output && !syms[step.assignTo]) {
        syms[step.assignTo] = { kotlinType: kotlinTypeOf(block.output) };
      }
    }
  });
}

/** Expression-level validation across the whole model. */
export function modelExpressionErrors(model: AppModel): ModelError[] {
  const errors: ModelError[] = [];
  const enums = model.data?.enums ?? [];

  (model.data?.entities ?? []).forEach((entity, i) => {
    const syms = symsForEntity(model, entity.name);
    (entity.invariants ?? []).forEach((inv, j) => {
      const invErrors = checkExpr(inv, syms, enums);
      errors.push(
        ...invErrors.map((e) => ({ ...e, path: `data.entities[${i}].invariants[${j}]` })),
      );
      if (invErrors.length === 0 && exprType(inv, syms, enums) !== "boolean") {
        errors.push({
          path: `data.entities[${i}].invariants[${j}]`,
          message: `Invariant "${inv}" must be a boolean expression.`,
        });
      }
    });
  });

  (model.flows ?? []).forEach((flow, i) => {
    if (flow.kind !== "custom" || !flow.steps) return;
    const syms = symsForFlow(model, flow);
    validateSteps(model, flow, flow.steps, syms, `flows[${i}].steps`, errors);
  });

  return errors;
}

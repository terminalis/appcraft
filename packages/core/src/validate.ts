import { Ajv, type ErrorObject } from "ajv";
import type { AppModel, Entity, EnumDef, ModelError } from "./types.js";
import { parseType } from "./types.js";
import { appcraftSchema } from "./schema.js";

function prettyPath(instancePath: string): string {
  if (instancePath === "") return "$";
  return instancePath
    .split("/")
    .filter(Boolean)
    .map((seg) => (/^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`))
    .join("")
    .replace(/^\./, "");
}

function ajvErrorToModelError(e: ErrorObject): ModelError {
  const path = prettyPath(e.instancePath);
  let hint: string | undefined;
  if (e.keyword === "additionalProperties") {
    hint = `Unknown key "${(e.params as { additionalProperty: string }).additionalProperty}". Check spelling against the schema (get_schema / appcraft schema).`;
  } else if (e.keyword === "pattern" && path.endsWith(".type")) {
    hint = "Attribute types: id|text|int|decimal|bool|date|datetime|image|enum(Name).";
  } else if (e.keyword === "enum") {
    hint = `Allowed values: ${JSON.stringify((e.params as { allowedValues?: unknown[] }).allowedValues)}`;
  }
  return { path, message: e.message ?? e.keyword, hint };
}

export interface ValidationResult {
  model?: AppModel;
  errors: ModelError[];
}

import { modelExpressionErrors } from "./expr.js";

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiled: ReturnType<typeof ajv.compile> | undefined;

function schemaValidate(doc: unknown): ModelError[] {
  compiled ??= ajv.compile(appcraftSchema());
  if (compiled(doc)) return [];
  // oneOf noise: keep the most specific errors (deepest instancePath) first,
  // drop pure oneOf umbrella entries when a concrete cause exists.
  const raw = (compiled.errors ?? []) as ErrorObject[];
  const concrete = raw.filter((e) => e.keyword !== "oneOf");
  const chosen = concrete.length > 0 ? concrete : raw;
  const seen = new Set<string>();
  const out: ModelError[] = [];
  for (const e of chosen) {
    const me = ajvErrorToModelError(e);
    const key = `${me.path}|${me.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(me);
    }
  }
  return out;
}

const KOTLIN_KEYWORDS = new Set([
  "as", "break", "class", "continue", "do", "else", "false", "for", "fun", "if",
  "in", "interface", "is", "null", "object", "package", "return", "super", "this",
  "throw", "true", "try", "typealias", "typeof", "val", "var", "when", "while",
  "it", "result", "query", "item",
]);

function semanticValidate(model: AppModel): ModelError[] {
  const errors: ModelError[] = [];

  // Kotlin keyword / generated-identifier collisions.
  const checkName = (name: string, path: string) => {
    if (KOTLIN_KEYWORDS.has(name)) {
      errors.push({
        path,
        message: `"${name}" collides with a Kotlin keyword or a generated identifier — pick another name.`,
      });
    }
  };
  (model.data?.entities ?? []).forEach((e, i) =>
    e.attributes.forEach((a, j) => checkName(a.name, `data.entities[${i}].attributes[${j}].name`)),
  );
  (model.flows ?? []).forEach((f, i) => {
    checkName(f.name, `flows[${i}].name`);
    (f.params ?? []).forEach((p, j) => checkName(p.name, `flows[${i}].params[${j}].name`));
  });
  (model.custom ?? []).forEach((b, i) => {
    checkName(b.name, `custom[${i}].name`);
    (b.inputs ?? []).forEach((p, j) => checkName(p.name, `custom[${i}].inputs[${j}].name`));
  });
  const entities = model.data?.entities ?? [];
  const enums = model.data?.enums ?? [];
  const flows = model.flows ?? [];
  const screens = model.ui?.screens ?? [];
  const mlBlocks = model.ml ?? [];
  const customBlocks = model.custom ?? [];

  // -- Unique names ---------------------------------------------------------
  const typeNames = new Map<string, string>(); // name -> where
  entities.forEach((e, i) => {
    if (typeNames.has(e.name)) {
      errors.push({
        path: `data.entities[${i}].name`,
        message: `Duplicate type name "${e.name}" (already used by ${typeNames.get(e.name)}).`,
      });
    } else typeNames.set(e.name, `entity data.entities[${i}]`);
  });
  enums.forEach((e, i) => {
    if (typeNames.has(e.name)) {
      errors.push({
        path: `data.enums[${i}].name`,
        message: `Duplicate type name "${e.name}" (already used by ${typeNames.get(e.name)}).`,
      });
    } else typeNames.set(e.name, `enum data.enums[${i}]`);
  });
  const uniqueBy = (
    items: { name: string }[],
    pathPrefix: string,
    what: string,
  ) => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (seen.has(item.name)) {
        errors.push({
          path: `${pathPrefix}[${i}].name`,
          message: `Duplicate ${what} name "${item.name}".`,
        });
      }
      seen.add(item.name);
    });
  };
  uniqueBy(flows, "flows", "flow");
  uniqueBy(screens, "ui.screens", "screen");
  uniqueBy(mlBlocks, "ml", "ml block");
  uniqueBy(customBlocks, "custom", "custom block");

  const entityByName = new Map(entities.map((e) => [e.name, e]));
  const enumByName = new Map(enums.map((e) => [e.name, e]));
  const flowByName = new Map(flows.map((f) => [f.name, f]));
  const blockByName = new Map(customBlocks.map((b) => [b.name, b]));

  const attrOf = (entity: Entity, attr: string) =>
    entity.attributes.find((a) => a.name === attr);

  // -- Entities -------------------------------------------------------------
  entities.forEach((entity, i) => {
    const ids = entity.attributes.filter((a) => a.type === "id");
    if (ids.length !== 1) {
      errors.push({
        path: `data.entities[${i}].attributes`,
        message: `Entity "${entity.name}" must have exactly one attribute of type "id" (found ${ids.length}).`,
      });
    }
    entity.attributes.forEach((a, j) => {
      const parsed = parseType(a.type);
      if (parsed?.kind === "enum" && !enumByName.has(parsed.enum)) {
        errors.push({
          path: `data.entities[${i}].attributes[${j}].type`,
          message: `Unknown enum "${parsed.enum}" — declare it under data.enums.`,
        });
      }
      if (parsed?.kind === "entity" || parsed?.kind === "list") {
        errors.push({
          path: `data.entities[${i}].attributes[${j}].type`,
          message: `Attribute "${a.name}": entity-typed attributes are not supported in 0.1; use an id-valued text attribute to reference other entities.`,
        });
      }
    });
    const attrNames = new Set<string>();
    entity.attributes.forEach((a, j) => {
      if (attrNames.has(a.name)) {
        errors.push({
          path: `data.entities[${i}].attributes[${j}].name`,
          message: `Duplicate attribute name "${a.name}" in entity "${entity.name}".`,
        });
      }
      attrNames.add(a.name);
    });
  });

  // -- Flows ----------------------------------------------------------------
  flows.forEach((flow, i) => {
    const needsEntity = ["create", "list", "search", "crud"].includes(flow.kind);
    if (needsEntity) {
      if (!flow.entity) {
        errors.push({
          path: `flows[${i}]`,
          message: `Flow "${flow.name}" of kind "${flow.kind}" requires an "entity".`,
        });
      } else if (!entityByName.has(flow.entity)) {
        errors.push({
          path: `flows[${i}].entity`,
          message: `Unknown entity "${flow.entity}".`,
          hint: `Declared entities: ${entities.map((e) => e.name).join(", ") || "(none)"}.`,
        });
      }
    }
    const entity = flow.entity ? entityByName.get(flow.entity) : undefined;
    if (flow.sort && entity) {
      const sortAttr = attrOf(entity, flow.sort.by);
      if (!sortAttr) {
        errors.push({
          path: `flows[${i}].sort.by`,
          message: `"${flow.sort.by}" is not an attribute of "${entity.name}".`,
        });
      } else if (sortAttr.optional || sortAttr.derived) {
        errors.push({
          path: `flows[${i}].sort.by`,
          message: `Sort attribute "${flow.sort.by}" must not be optional or derived.`,
        });
      }
    }
    if (flow.kind === "search") {
      if (!flow.by) {
        errors.push({
          path: `flows[${i}]`,
          message: `Search flow "${flow.name}" requires "by" (the attribute to search).`,
        });
      } else if (entity && !attrOf(entity, flow.by)) {
        errors.push({
          path: `flows[${i}].by`,
          message: `"${flow.by}" is not an attribute of "${entity.name}".`,
        });
      }
    }
    if (flow.kind === "custom") {
      if (!flow.steps || flow.steps.length === 0) {
        errors.push({
          path: `flows[${i}]`,
          message: `Custom flow "${flow.name}" requires at least one step.`,
        });
      }
      (flow.params ?? []).forEach((p, j) => {
        const parsed = parseType(p.type);
        if (!parsed) {
          errors.push({
            path: `flows[${i}].params[${j}].type`,
            message: `Unknown param type "${p.type}".`,
          });
        } else if (parsed.kind === "enum" && !enumByName.has(parsed.enum)) {
          errors.push({
            path: `flows[${i}].params[${j}].type`,
            message: `Unknown enum "${parsed.enum}".`,
          });
        } else if (parsed.kind === "entity" && !entityByName.has(parsed.entity)) {
          errors.push({
            path: `flows[${i}].params[${j}].type`,
            message: `Unknown entity "${parsed.entity}".`,
          });
        } else if (parsed.kind === "list" && !entityByName.has(parsed.of)) {
          errors.push({
            path: `flows[${i}].params[${j}].type`,
            message: `Unknown entity "${parsed.of}" in list type.`,
          });
        }
      });
      // call-steps must reference declared custom blocks (checked shallowly here;
      // expression contents are checked by the expression validator).
      const walkCalls = (steps: typeof flow.steps, path: string) => {
        (steps ?? []).forEach((s, j) => {
          if (typeof s === "object" && "call" in s && !blockByName.has(s.call)) {
            errors.push({
              path: `${path}[${j}].call`,
              message: `Unknown custom block "${s.call}".`,
              hint: `Declared blocks: ${customBlocks.map((b) => b.name).join(", ") || "(none)"}.`,
            });
          }
          if (typeof s === "object" && "if" in s) {
            walkCalls(s.then, `${path}[${j}].then`);
            if (s.else) walkCalls(s.else, `${path}[${j}].else`);
          }
        });
      };
      walkCalls(flow.steps, `flows[${i}].steps`);
    }
  });

  // -- Screens ----------------------------------------------------------------
  screens.forEach((screen, i) => {
    if (!screen.flow && (!screen.components || screen.components.length === 0)) {
      errors.push({
        path: `ui.screens[${i}]`,
        message: `Screen "${screen.name}" needs a "flow" or at least one component.`,
      });
    }
    if (screen.flow && !flowByName.has(screen.flow)) {
      errors.push({
        path: `ui.screens[${i}].flow`,
        message: `Unknown flow "${screen.flow}".`,
      });
    }
    (screen.components ?? []).forEach((c, j) => {
      const entity = entityByName.get(c.entity);
      if (!entity) {
        errors.push({
          path: `ui.screens[${i}].components[${j}].entity`,
          message: `Unknown entity "${c.entity}".`,
        });
        return;
      }
      for (const axis of ["x", "y"] as const) {
        const attr = attrOf(entity, c[axis]);
        if (!attr) {
          errors.push({
            path: `ui.screens[${i}].components[${j}].${axis}`,
            message: `"${c[axis]}" is not an attribute of "${entity.name}".`,
          });
        } else if (axis === "y" && !["int", "decimal"].includes(attr.type)) {
          errors.push({
            path: `ui.screens[${i}].components[${j}].y`,
            message: `Chart y-axis "${attr.name}" must be numeric (int|decimal), got "${attr.type}".`,
          });
        } else if (axis === "x" && !["date", "datetime", "int", "decimal"].includes(attr.type)) {
          errors.push({
            path: `ui.screens[${i}].components[${j}].x`,
            message: `Chart x-axis "${attr.name}" must be date|datetime|int|decimal, got "${attr.type}".`,
          });
        }
      }
    });
  });

  // -- ML blocks --------------------------------------------------------------
  mlBlocks.forEach((ml, i) => {
    const entity = entityByName.get(ml.entity);
    if (!entity) {
      errors.push({ path: `ml[${i}].entity`, message: `Unknown entity "${ml.entity}".` });
      return;
    }
    if (ml.writeTo) {
      const attr = attrOf(entity, ml.writeTo);
      if (!attr) {
        errors.push({
          path: `ml[${i}].writeTo`,
          message: `"${ml.writeTo}" is not an attribute of "${entity.name}".`,
        });
      } else if (!attr.derived) {
        errors.push({
          path: `ml[${i}].writeTo`,
          message: `"${ml.writeTo}" must be marked "derived: true" to receive ML output.`,
        });
      }
    }
  });

  return errors;
}

/**
 * Spec validation: is this a well-formed AppCraft 0.1 model?
 * Accepts features the 0.1 compiler does not implement yet (crud, cloud, ml).
 */
export function validateModel(doc: unknown): ValidationResult {
  const schemaErrors = schemaValidate(doc);
  if (schemaErrors.length > 0) return { errors: schemaErrors };
  const model = doc as AppModel;
  const errors = semanticValidate(model);
  // Only run expression-level checks when structural references resolve —
  // they assume entities/params exist.
  if (errors.length === 0) errors.push(...modelExpressionErrors(model));
  return { model, errors };
}

/**
 * Compile validation: everything validateModel checks, plus rejection of
 * features the 0.1 compiler does not emit. The error hints point agents at
 * the capability card so they can tell users the truth.
 */
export function validateForCompile(doc: unknown): ValidationResult {
  const base = validateModel(doc);
  if (!base.model) return base;
  const errors = [...base.errors];
  const model = base.model;
  (model.flows ?? []).forEach((f, i) => {
    if (f.kind === "crud") {
      errors.push({
        path: `flows[${i}].kind`,
        message: `Flow kind "crud" is not supported by compiler 0.1 — use separate create/list flows.`,
        hint: "See capabilityCard.unsupported.",
      });
    }
  });
  (model.data?.entities ?? []).forEach((e, i) => {
    if (e.storage === "cloud") {
      errors.push({
        path: `data.entities[${i}].storage`,
        message: `storage "cloud" is not supported by compiler 0.1 — use "device".`,
        hint: "See capabilityCard.unsupported.",
      });
    }
  });
  if ((model.ml ?? []).length > 0) {
    errors.push({
      path: "ml",
      message: "ml blocks are not supported by compiler 0.1 (planned: phase 2).",
      hint: "See capabilityCard.unsupported.",
    });
  }
  // The app must render at least one screen: a screen-producing flow
  // (create/list/search, or custom with only scalar/enum params) or a
  // component screen.
  const producesScreen = (model.flows ?? []).some(
    (f) =>
      ["create", "list", "search"].includes(f.kind) ||
      (f.kind === "custom" &&
        (f.params ?? []).every((p) => {
          const parsed = parseType(p.type);
          return (
            (parsed?.kind === "scalar" && parsed.scalar !== "image") ||
            parsed?.kind === "enum"
          );
        })),
  );
  const hasComponentScreen = (model.ui?.screens ?? []).some(
    (s) => (s.components ?? []).length > 0,
  );
  if (!producesScreen && !hasComponentScreen) {
    errors.push({
      path: "$",
      message:
        "Model produces no screens — add at least one create/list/search flow, a custom flow with scalar params, or a component screen.",
    });
  }
  return { model, errors };
}

export function findEnum(model: AppModel, name: string): EnumDef | undefined {
  return (model.data?.enums ?? []).find((e) => e.name === name);
}

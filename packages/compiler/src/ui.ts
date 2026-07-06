import type { AppModel, Attribute, Entity, Flow, Param, Screen } from "@appcraft-io/core";
import { exprToKotlin, kotlinTypeOf, parseType, symsForEntity } from "@appcraft-io/core";
import { camel, packagePath, pascal, safeName, screenName } from "./naming.js";
import type { Uses } from "./uses.js";

/**
 * Presentation tier: Compose/Material 3 screens, navigation, shared field
 * components, and the chart canvas. Entity invariants are enforced HERE —
 * validation belongs to the presentation tier, not the entity beans (fixes
 * the paper's second admitted Clean Architecture violation, §VI-B).
 */

export function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Field machinery shared by create-forms and custom-flow forms.

type FieldKind = "numberText" | "text" | "bool" | "enum" | "image" | "datetime";

interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  optional: boolean;
  numeric?: "Int" | "Double";
  enumName?: string;
  dateOnly?: boolean;
}

function fieldForAttr(a: Attribute): FieldSpec | undefined {
  if (a.type === "id" || a.derived) return undefined;
  return fieldFor(a.name, a.type, a.optional ?? false);
}

function fieldFor(name: string, type: string, optional: boolean): FieldSpec | undefined {
  const label = humanize(name);
  const parsed = parseType(type);
  if (parsed?.kind === "enum") {
    return { name, label, kind: "enum", optional, enumName: parsed.enum };
  }
  switch (type) {
    case "int":
      return { name, label, kind: "numberText", optional, numeric: "Int" };
    case "decimal":
      return { name, label, kind: "numberText", optional, numeric: "Double" };
    case "text":
      return { name, label, kind: "text", optional };
    case "bool":
      return { name, label, kind: "bool", optional };
    case "image":
      return { name, label, kind: "image", optional };
    case "date":
      return { name, label, kind: "datetime", optional, dateOnly: true };
    case "datetime":
      return { name, label, kind: "datetime", optional };
    default:
      return undefined;
  }
}

function stateLines(f: FieldSpec, model: AppModel): string[] {
  switch (f.kind) {
    case "numberText":
      return [
        `var ${f.name} by rememberSaveable { mutableStateOf("") }`,
        `val ${f.name}Value = ${f.name}.to${f.numeric}OrNull()`,
      ];
    case "text":
      return [`var ${f.name} by rememberSaveable { mutableStateOf("") }`];
    case "bool":
      return [`var ${f.name} by rememberSaveable { mutableStateOf(false) }`];
    case "enum": {
      const first = (model.data?.enums ?? []).find((e) => e.name === f.enumName)!.values[0];
      return [`var ${f.name} by rememberSaveable { mutableStateOf(${f.enumName}.${first}) }`];
    }
    case "image":
      return [`var ${f.name} by rememberSaveable { mutableStateOf<String?>(null) }`];
    case "datetime":
      return [`val ${f.name} = rememberSaveable { System.currentTimeMillis() }`];
  }
}

/** Renames numeric attr idents to their parsed `<name>Value` locals in translated Kotlin. */
function renameNumeric(kotlin: string, numericNames: string[]): string {
  let out = kotlin;
  for (const n of numericNames) {
    out = out.replace(new RegExp(`\\b${n}\\b`, "g"), `${n}Value`);
  }
  return out;
}

function identsIn(src: string): string[] {
  return src.match(/[a-zA-Z_][A-Za-z0-9_]*/g) ?? [];
}

interface InvariantPlan {
  /** invariant kotlin (numeric idents renamed), attached field or form-level */
  kotlin: string;
  source: string;
  attachTo?: string; // field name when single-field
  guards: string[]; // `xValue != null` guards
  skipped?: boolean;
}

function planInvariants(model: AppModel, entity: Entity, fields: FieldSpec[]): InvariantPlan[] {
  const enums = model.data?.enums ?? [];
  const fieldByName = new Map(fields.map((f) => [f.name, f]));
  return (entity.invariants ?? []).map((inv) => {
    const attrNames = new Set(entity.attributes.map((a) => a.name));
    const refs = [...new Set(identsIn(inv).filter((i) => attrNames.has(i)))];
    const enforceable = refs.every((r) => {
      const f = fieldByName.get(r);
      return f && ["numberText", "text", "bool", "enum"].includes(f.kind) && !f.optional;
    });
    if (!enforceable) {
      return { kotlin: "", source: inv, guards: [], skipped: true };
    }
    const syms = symsForEntity(model, entity.name);
    const kotlin = renameNumeric(
      exprToKotlin(inv, syms, enums),
      refs.filter((r) => fieldByName.get(r)!.kind === "numberText"),
    );
    const numericRefs = refs.filter((r) => fieldByName.get(r)!.kind === "numberText");
    return {
      kotlin,
      source: inv,
      guards: numericRefs.map((r) => `${r}Value != null`),
      attachTo: refs.length === 1 ? refs[0] : undefined,
    };
  });
}

function errorLines(f: FieldSpec, invariants: InvariantPlan[]): string[] {
  const own = invariants.filter((p) => !p.skipped && p.attachTo === f.name);
  switch (f.kind) {
    case "numberText": {
      const branches: string[] = [];
      if (!f.optional) branches.push(`${f.name}.isBlank() -> "Required"`);
      branches.push(
        f.optional
          ? `${f.name}.isNotBlank() && ${f.name}Value == null -> "Enter a number"`
          : `${f.name}Value == null -> "Enter a number"`,
      );
      for (const p of own) {
        branches.push(`${p.guards.join(" && ")}${p.guards.length ? " && " : ""}!(${p.kotlin}) -> "Must satisfy: ${p.source}"`);
      }
      return [
        `val ${f.name}Error = when {`,
        ...branches.map((b) => `    ${b}`),
        `    else -> null`,
        `}`,
      ];
    }
    case "text": {
      const branches: string[] = [];
      if (!f.optional) branches.push(`${f.name}.isBlank() -> "Required"`);
      for (const p of own) branches.push(`!(${p.kotlin}) -> "Must satisfy: ${p.source}"`);
      if (branches.length === 0) return [];
      return [
        `val ${f.name}Error = when {`,
        ...branches.map((b) => `    ${b}`),
        `    else -> null`,
        `}`,
      ];
    }
    case "image":
      return f.optional ? [] : [`val ${f.name}Error = if (${f.name} == null) "Pick an image" else null`];
    default:
      return [];
  }
}

function hasErrorVal(f: FieldSpec, invariants: InvariantPlan[]): boolean {
  return errorLines(f, invariants).length > 0;
}

function validConditions(fields: FieldSpec[], invariants: InvariantPlan[]): string[] {
  const conds: string[] = [];
  for (const f of fields) {
    if (hasErrorVal(f, invariants)) conds.push(`${f.name}Error == null`);
    if (f.kind === "numberText" && !f.optional) conds.push(`${f.name}Value != null`);
    if (f.kind === "text" && !f.optional) conds.push(`${f.name}.isNotBlank()`);
    if (f.kind === "image" && !f.optional) conds.push(`${f.name} != null`);
  }
  const formLevel = invariants.filter((p) => !p.skipped && !p.attachTo);
  if (formLevel.length > 0) conds.push("formError == null");
  return conds;
}

function formLevelErrorLines(invariants: InvariantPlan[]): string[] {
  const formLevel = invariants.filter((p) => !p.skipped && !p.attachTo);
  if (formLevel.length === 0) return [];
  const branches = formLevel.map(
    (p) =>
      `${p.guards.join(" && ")}${p.guards.length ? " && " : ""}!(${p.kotlin}) -> "Must satisfy: ${p.source}"`,
  );
  return [`val formError = when {`, ...branches.map((b) => `    ${b}`), `    else -> null`, `}`];
}

function fieldComposable(f: FieldSpec, invariants: InvariantPlan[], saved: boolean): string {
  const reset = saved ? "; saved = false" : "";
  switch (f.kind) {
    case "numberText":
      return `LabeledTextField(
    value = ${f.name},
    onValueChange = { ${f.name} = it${reset} },
    label = "${f.label}",
    error = if (${f.name}.isBlank()) null else ${f.name}Error,
    keyboardType = KeyboardType.${f.numeric === "Int" ? "Number" : "Decimal"},
)`;
    case "text":
      return `LabeledTextField(
    value = ${f.name},
    onValueChange = { ${f.name} = it${reset} },
    label = "${f.label}",
)`;
    case "bool":
      return `BoolField(label = "${f.label}", value = ${f.name}, onValueChange = { ${f.name} = it${reset} })`;
    case "enum":
      return `EnumDropdown(
    label = "${f.label}",
    options = ${f.enumName}.entries,
    selected = ${f.name},
    onSelected = { ${f.name} = it${reset} },
    optionLabel = { it.name },
)`;
    case "image":
      return `ImagePickerField(label = "${f.label}", uri = ${f.name}, onPicked = { ${f.name} = it${reset} }${f.optional ? "" : `, error = ${f.name}Error`})`;
    case "datetime":
      return `DateTimeChip(label = "${f.label}", millis = ${f.name}${f.dateOnly ? ", dateOnly = true" : ""})`;
  }
}

function constructionArg(a: Attribute, fields: Map<string, FieldSpec>): string {
  if (a.type === "id") return `${a.name} = java.util.UUID.randomUUID().toString()`;
  const f = fields.get(a.name);
  if (!f) return ""; // derived — omitted, defaults to null
  switch (f.kind) {
    case "numberText":
      return f.optional
        ? `${a.name} = if (${a.name}.isBlank()) null else ${a.name}Value`
        : `${a.name} = ${a.name}Value!!`;
    case "text":
      return f.optional ? `${a.name} = ${a.name}.trim().ifBlank { null }` : `${a.name} = ${a.name}.trim()`;
    case "image":
      return f.optional ? `${a.name} = ${a.name}` : `${a.name} = ${a.name}!!`;
    default:
      return `${a.name} = ${a.name}`;
  }
}

const SCREEN_IMPORTS = (pkg: string, extra: string[] = []) =>
  `import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import ${pkg}.AppGraph
import ${pkg}.domain.model.*
import ${pkg}.ui.components.*
${extra.join("\n")}`.trimEnd();

// ---------------------------------------------------------------------------
// Screens

export function createScreenFile(model: AppModel, flow: Flow): string {
  const pkg = model.app.package;
  const entity = (model.data?.entities ?? []).find((e) => e.name === flow.entity)!;
  const fields = entity.attributes.map(fieldForAttr).filter((f): f is FieldSpec => !!f);
  const fieldMap = new Map(fields.map((f) => [f.name, f]));
  const invariants = planInvariants(model, entity, fields);
  const name = screenName(flow.name);
  const title = humanize(flow.name);

  const state = fields.flatMap((f) => stateLines(f, model));
  const errors = [
    ...fields.flatMap((f) => errorLines(f, invariants)),
    ...formLevelErrorLines(invariants),
  ];
  const skippedNotes = invariants
    .filter((p) => p.skipped)
    .map((p) => `    // Invariant "${p.source}" is enforced by the model but not editable in this form (v0.1).`);
  const conds = validConditions(fields, invariants);
  const valid = conds.length > 0 ? conds.join(" && ") : "true";
  const args = entity.attributes.map((a) => constructionArg(a, fieldMap)).filter(Boolean);
  const formLevel = invariants.some((p) => !p.skipped && !p.attachTo);

  return `package ${pkg}.ui.screens

${SCREEN_IMPORTS(pkg, ["import kotlinx.coroutines.launch"])}

@Composable
fun ${name}() {
    val facade = AppGraph.modelFacade
    val scope = rememberCoroutineScope()
${skippedNotes.length > 0 ? skippedNotes.join("\n") + "\n" : ""}${state.map((l) => `    ${l}`).join("\n")}
    var saved by remember { mutableStateOf(false) }
${errors.length > 0 ? errors.map((l) => `    ${l}`).join("\n") + "\n" : ""}    val formValid = ${valid}

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("${title}", style = MaterialTheme.typography.headlineSmall)
${fields
  .map((f) => `        ${fieldComposable(f, invariants, true).split("\n").join("\n        ")}`)
  .join("\n")}
${formLevel ? `        if (formError != null) {\n            Text(formError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)\n        }\n` : ""}        Button(
            onClick = {
                scope.launch {
                    facade.${flow.name}(
                        ${entity.name}(
${args.map((a) => `                            ${a},`).join("\n")}
                        ),
                    )
                    saved = true
                }
            },
            enabled = formValid,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Save")
        }
        if (saved) {
            Text("Saved", color = MaterialTheme.colorScheme.primary)
        }
    }
}
`;
}

export function listScreenFile(model: AppModel, flow: Flow): string {
  const pkg = model.app.package;
  const entity = flow.entity!;
  const name = screenName(flow.name);
  const title = humanize(flow.name);
  return `package ${pkg}.ui.screens

${SCREEN_IMPORTS(pkg)}

@Composable
fun ${name}() {
    val items by AppGraph.modelFacade.${flow.name}().collectAsState(initial = emptyList())
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item {
            Text("${title}", style = MaterialTheme.typography.headlineSmall)
        }
        if (items.isEmpty()) {
            item {
                Text("Nothing here yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        items(items) { item ->
            ${entity}Card(item)
        }
    }
}
`;
}

export function searchScreenFile(model: AppModel, flow: Flow): string {
  const pkg = model.app.package;
  const entity = (model.data?.entities ?? []).find((e) => e.name === flow.entity)!;
  const attr = entity.attributes.find((a) => a.name === flow.by)!;
  const name = screenName(flow.name);
  const title = humanize(flow.name);
  const searchLabel =
    attr.type === "date" || attr.type === "datetime"
      ? "Search by day (yyyy-mm-dd)"
      : `Search ${humanize(attr.name)}`;
  return `package ${pkg}.ui.screens

${SCREEN_IMPORTS(pkg)}

@Composable
fun ${name}() {
    var query by rememberSaveable { mutableStateOf("") }
    val resultsFlow = remember(query) { AppGraph.modelFacade.${flow.name}(query) }
    val results by resultsFlow.collectAsState(initial = emptyList())
    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Text(
            "${title}",
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(vertical = 16.dp),
        )
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("${searchLabel}") },
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        LazyColumn(
            contentPadding = PaddingValues(vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            if (query.isBlank()) {
                item {
                    Text("Type to search.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else if (results.isEmpty()) {
                item {
                    Text("No matches.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                items(results) { item ->
                    ${entity.name}Card(item)
                }
            }
        }
    }
}
`;
}

function resultRender(returns: string, model: AppModel): string {
  const kt = kotlinTypeOf(returns);
  switch (kt) {
    case "Double":
      return `String.format(java.util.Locale.US, "%.2f", r)`;
    case "Int":
    case "Long":
      return "r.toString()";
    case "String":
      return "r";
    case "Boolean":
      return `if (r) "Yes" else "No"`;
    default:
      return (model.data?.enums ?? []).some((e) => e.name === kt) ? "r.name" : "r.toString()";
  }
}

export function customScreenFile(model: AppModel, flow: Flow): string {
  const pkg = model.app.package;
  const name = screenName(flow.name);
  const title = humanize(flow.name);
  const fields = (flow.params ?? [])
    .map((p: Param) => fieldFor(p.name, p.type, false))
    .filter((f): f is FieldSpec => !!f);
  const invariants: InvariantPlan[] = [];
  const state = fields.flatMap((f) => stateLines(f, model));
  const errors = fields.flatMap((f) => errorLines(f, invariants));
  const conds = validConditions(fields, invariants);
  const valid = conds.length > 0 ? conds.join(" && ") : "true";
  const retType = flow.returns ? kotlinTypeOf(flow.returns) : undefined;
  const callArgs = (flow.params ?? [])
    .map((p) => {
      const f = fields.find((x) => x.name === p.name)!;
      return f.kind === "numberText" ? `${p.name}Value!!` : f.kind === "text" ? `${p.name}.trim()` : p.name;
    })
    .join(", ");

  const resultState = retType
    ? `    var result by remember { mutableStateOf<${retType}?>(null) }\n`
    : "";
  const onClick = retType
    ? `result = AppGraph.modelFacade.${flow.name}(${callArgs})`
    : `AppGraph.modelFacade.${flow.name}(${callArgs})`;
  const resultCard = retType
    ? `        result?.let { r ->
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Result", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(${resultRender(flow.returns!, model)}, style = MaterialTheme.typography.headlineMedium)
                }
            }
        }
`
    : "";

  return `package ${pkg}.ui.screens

${SCREEN_IMPORTS(pkg)}

@Composable
fun ${name}() {
${resultState}${state.map((l) => `    ${l}`).join("\n")}
${errors.length > 0 ? errors.map((l) => `    ${l}`).join("\n") + "\n" : ""}    val formValid = ${valid}

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("${title}", style = MaterialTheme.typography.headlineSmall)
${fields
  .map((f) => `        ${fieldComposable(f, invariants, false).split("\n").join("\n        ")}`)
  .join("\n")}
        Button(
            onClick = { ${onClick} },
            enabled = formValid,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("${title}")
        }
${resultCard}    }
}
`;
}

export function chartScreenFile(model: AppModel, screen: Screen): string {
  const pkg = model.app.package;
  const c = (screen.components ?? [])[0];
  const name = `${pascal(screen.name)}Screen`;
  const title = humanize(screen.name);
  const days = c.window ? parseInt(c.window, 10) : undefined;
  const entity = (model.data?.entities ?? []).find((e) => e.name === c.entity)!;
  const xAttr = entity.attributes.find((a) => a.name === c.x)!;
  const cutoff = days
    ? `    val cutoff = System.currentTimeMillis() - ${days}L * 24 * 60 * 60 * 1000
    val points = all.filter { it.${c.x} >= cutoff }.sortedBy { it.${c.x} }`
    : `    val points = all.sortedBy { it.${c.x} }`;
  const chart = c.type === "line" ? "LineChart" : "BarChart";
  const chartArgs =
    c.type === "line"
      ? `points = points.map { it.${c.x}.toFloat() to it.${c.y}.toFloat() }`
      : `values = points.map { it.${c.y}.toFloat() }`;
  void xAttr;
  return `package ${pkg}.ui.screens

${SCREEN_IMPORTS(pkg)}

@Composable
fun ${name}() {
    val all by AppGraph.modelFacade.observe${c.entity}().collectAsState(initial = emptyList())
${cutoff}
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("${title}", style = MaterialTheme.typography.headlineSmall)
        if (points.size < 2) {
            Text(
                "Add at least two entries to see the chart.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                ${chart}(
                    ${chartArgs},
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(240.dp)
                        .padding(16.dp),
                )
            }
        }
    }
}
`;
}

// ---------------------------------------------------------------------------
// Cards

function cardValueLines(entity: Entity): string[] {
  const lines: string[] = [];
  const imageAttrs = entity.attributes.filter((a) => a.type === "image");
  const rest = entity.attributes.filter((a) => a.type !== "image" && a.type !== "id");
  const headline = rest.find((a) => !a.derived && a.type !== "date" && a.type !== "datetime");

  for (const a of imageAttrs) {
    const inner = `AsyncImage(
                model = it,
                contentDescription = "${humanize(a.name)}",
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(160.dp)
                    .clip(RoundedCornerShape(12.dp)),
            )`;
    lines.push(
      a.optional || a.derived
        ? `item.${a.name}?.let {\n            ${inner}\n            }`
        : `item.${a.name}.let {\n            ${inner}\n            }`,
    );
  }

  const render = (a: Attribute, ref: string): string => {
    const parsed = parseType(a.type);
    if (parsed?.kind === "enum") return `${ref}.name`;
    switch (a.type) {
      case "bool":
        return `if (${ref}) "Yes" else "No"`;
      case "date":
        return `formatDate(${ref})`;
      case "datetime":
        return `formatDateTime(${ref})`;
      case "int":
      case "decimal":
        return `${ref}.toString()`;
      default:
        return ref;
    }
  };

  if (headline) {
    lines.push(`Text("${humanize(headline.name)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)`);
    lines.push(`Text(${render(headline, `item.${headline.name}`)}, style = MaterialTheme.typography.titleLarge)`);
  }
  for (const a of rest) {
    if (a === headline) continue;
    if (a.optional || a.derived) {
      lines.push(
        `item.${a.name}?.let { Text("${humanize(a.name)}: " + ${render(a, "it")}, style = MaterialTheme.typography.bodyMedium) }`,
      );
    } else if (a.type === "datetime" || a.type === "date") {
      lines.push(
        `Text(${render(a, `item.${a.name}`)}, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)`,
      );
    } else {
      lines.push(
        `Text("${humanize(a.name)}: " + ${render(a, `item.${a.name}`)}, style = MaterialTheme.typography.bodyMedium)`,
      );
    }
  }
  return lines;
}

export function cardFile(model: AppModel, entity: Entity): string {
  const pkg = model.app.package;
  const hasImage = entity.attributes.some((a) => a.type === "image");
  const imageImports = hasImage
    ? `\nimport androidx.compose.ui.draw.clip\nimport androidx.compose.ui.layout.ContentScale\nimport androidx.compose.foundation.shape.RoundedCornerShape\nimport coil.compose.AsyncImage`
    : "";
  return `package ${pkg}.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp${imageImports}
import ${pkg}.domain.model.${entity.name}

@Composable
fun ${entity.name}Card(item: ${entity.name}, modifier: Modifier = Modifier) {
    ElevatedCard(modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            ${cardValueLines(entity).join("\n            ")}
        }
    }
}
`;
}

// ---------------------------------------------------------------------------
// Shared components

function fieldsFile(model: AppModel): string {
  const pkg = model.app.package;
  return `package ${pkg}.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType

@Composable
fun LabeledTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    error: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        isError = error != null,
        supportingText = { if (error != null) Text(error) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        modifier = modifier.fillMaxWidth(),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> EnumDropdown(
    label: String,
    options: List<T>,
    selected: T,
    onSelected: (T) -> Unit,
    optionLabel: (T) -> String,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = optionLabel(selected),
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = modifier.menuAnchor().fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(optionLabel(option)) },
                    onClick = {
                        onSelected(option)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
fun BoolField(
    label: String,
    value: Boolean,
    onValueChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Switch(checked = value, onCheckedChange = onValueChange)
    }
}

@Composable
fun DateTimeChip(
    label: String,
    millis: Long,
    modifier: Modifier = Modifier,
    dateOnly: Boolean = false,
) {
    AssistChip(
        onClick = {},
        label = { Text(label + ": " + if (dateOnly) formatDate(millis) else formatDateTime(millis)) },
        modifier = modifier,
    )
}
`;
}

function formatFile(model: AppModel): string {
  return `package ${model.app.package}.ui.components

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val dateTimeFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

fun formatDateTime(millis: Long): String =
    Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).toLocalDateTime().format(dateTimeFormat)

fun formatDate(millis: Long): String =
    Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).toLocalDate().toString()
`;
}

function imagePickerFile(model: AppModel): string {
  const pkg = model.app.package;
  return `package ${pkg}.ui.components

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

@Composable
fun ImagePickerField(
    label: String,
    uri: String?,
    onPicked: (String?) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
) {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { picked ->
        if (picked != null) {
            try {
                context.contentResolver.takePersistableUriPermission(
                    picked,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            } catch (_: SecurityException) {
                // Persistable grant unavailable; the in-session grant still applies.
            }
            onPicked(picked.toString())
        }
    }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (uri != null) {
            AsyncImage(
                model = uri,
                contentDescription = label,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(180.dp)
                    .clip(RoundedCornerShape(12.dp)),
            )
        }
        OutlinedButton(onClick = {
            launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }) {
            Text(if (uri == null) "Pick $label" else "Change $label")
        }
        if (error != null) {
            Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }
}
`;
}

function chartComponentFile(model: AppModel): string {
  return `package ${model.app.package}.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke

@Composable
fun LineChart(points: List<Pair<Float, Float>>, modifier: Modifier = Modifier) {
    val color = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    Canvas(modifier = modifier) {
        if (points.size < 2) return@Canvas
        val minX = points.minOf { it.first }
        val maxX = points.maxOf { it.first }
        val minY = points.minOf { it.second }
        val maxY = points.maxOf { it.second }
        val spanX = (maxX - minX).takeIf { it > 0f } ?: 1f
        val spanY = (maxY - minY).takeIf { it > 0f } ?: 1f
        fun px(p: Pair<Float, Float>) = Offset(
            (p.first - minX) / spanX * size.width,
            size.height - (p.second - minY) / spanY * size.height,
        )
        for (i in 1..3) {
            val y = size.height * i / 4f
            drawLine(grid, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
        }
        val path = Path()
        points.forEachIndexed { i, p ->
            val o = px(p)
            if (i == 0) path.moveTo(o.x, o.y) else path.lineTo(o.x, o.y)
        }
        drawPath(path, color, style = Stroke(width = 6f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        points.forEach { drawCircle(color, radius = 8f, center = px(it)) }
    }
}

@Composable
fun BarChart(values: List<Float>, modifier: Modifier = Modifier) {
    val color = MaterialTheme.colorScheme.primary
    Canvas(modifier = modifier) {
        if (values.isEmpty()) return@Canvas
        val maxV = values.max().takeIf { it > 0f } ?: 1f
        val slot = size.width / values.size
        val barWidth = slot * 0.6f
        values.forEachIndexed { i, v ->
            val h = v / maxV * size.height
            drawRoundRect(
                color,
                topLeft = Offset(i * slot + (slot - barWidth) / 2f, size.height - h),
                size = androidx.compose.ui.geometry.Size(barWidth, h),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(8f, 8f),
            )
        }
    }
}
`;
}

// ---------------------------------------------------------------------------
// Navigation + MainActivity

export interface Dest {
  route: string;
  label: string;
  icon: string;
  screen: string;
}

export function flowHasScreen(flow: Flow): boolean {
  if (["create", "list", "search"].includes(flow.kind)) return true;
  if (flow.kind !== "custom") return false;
  return (flow.params ?? []).every((p) => {
    const parsed = parseType(p.type);
    return (parsed?.kind === "scalar" && parsed.scalar !== "image") || parsed?.kind === "enum";
  });
}

const FLOW_ICONS: Record<string, string> = {
  create: "Icons.Outlined.AddCircle",
  list: "Icons.AutoMirrored.Outlined.List",
  search: "Icons.Outlined.Search",
  custom: "Icons.Outlined.Calculate",
};

export function destinations(model: AppModel): Dest[] {
  const dests: Dest[] = [];
  for (const flow of model.flows ?? []) {
    if (flow.kind === "crud" || !flowHasScreen(flow)) continue;
    dests.push({
      route: flow.name,
      label: humanize(flow.name),
      icon: FLOW_ICONS[flow.kind],
      screen: screenName(flow.name),
    });
  }
  for (const screen of model.ui?.screens ?? []) {
    if ((screen.components ?? []).length === 0) continue;
    dests.push({
      route: camel(screen.name),
      label: humanize(screen.name),
      icon: "Icons.Outlined.ShowChart",
      screen: `${pascal(screen.name)}Screen`,
    });
  }
  return dests;
}

function navFile(model: AppModel, dests: Dest[]): string {
  const pkg = model.app.package;
  const needsAutoMirrored = dests.some((d) => d.icon.includes("AutoMirrored"));
  return `package ${pkg}.ui

import androidx.compose.material.icons.Icons${needsAutoMirrored ? "\nimport androidx.compose.material.icons.automirrored.outlined.List" : ""}
import androidx.compose.material.icons.outlined.*
import androidx.compose.ui.graphics.vector.ImageVector

data class Dest(val route: String, val label: String, val icon: ImageVector)

val destinations = listOf(
${dests.map((d) => `    Dest("${d.route}", "${d.label}", ${d.icon}),`).join("\n")}
)
`;
}

function mainActivityFile(model: AppModel, dests: Dest[]): string {
  const pkg = model.app.package;
  const app = safeName(model.app.name);
  const bottomBar =
    dests.length > 1
      ? `
        bottomBar = {
            NavigationBar {
                val backStack by navController.currentBackStackEntryAsState()
                val currentRoute = backStack?.destination?.route
                destinations.forEach { dest ->
                    NavigationBarItem(
                        selected = currentRoute == dest.route,
                        onClick = {
                            navController.navigate(dest.route) {
                                launchSingleTop = true
                                restoreState = true
                                popUpTo(navController.graph.startDestinationId) { saveState = true }
                            }
                        },
                        icon = { Icon(dest.icon, contentDescription = dest.label) },
                        label = { Text(dest.label) },
                    )
                }
            }
        },
    `
      : "";
  return `package ${pkg}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import ${pkg}.ui.destinations
import ${pkg}.ui.screens.*
import ${pkg}.ui.theme.${app}Theme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        AppGraph.init(applicationContext)
        setContent {
            ${app}Theme {
                AppRoot()
            }
        }
    }
}

@Composable
private fun AppRoot() {
    val navController = rememberNavController()
    Scaffold(${bottomBar}) { padding ->
        NavHost(
            navController = navController,
            startDestination = "${dests[0].route}",
            modifier = Modifier.padding(padding),
        ) {
${dests.map((d) => `            composable("${d.route}") { ${d.screen}() }`).join("\n")}
        }
    }
}
`;
}

// ---------------------------------------------------------------------------

export function emitUi(model: AppModel, uses: Uses, files: Map<string, string>): void {
  const pkg = model.app.package;
  const base = `app/src/main/java/${packagePath(pkg)}`;

  files.set(`${base}/ui/components/Fields.kt`, fieldsFile(model));
  files.set(`${base}/ui/components/Format.kt`, formatFile(model));
  if (uses.image) files.set(`${base}/ui/components/ImagePickerField.kt`, imagePickerFile(model));
  if (uses.chart) files.set(`${base}/ui/components/Chart.kt`, chartComponentFile(model));

  // Cards for entities displayed by list/search flows.
  const displayedEntities = new Set(
    (model.flows ?? [])
      .filter((f) => (f.kind === "list" || f.kind === "search") && f.entity)
      .map((f) => f.entity!),
  );
  for (const entityName of displayedEntities) {
    const entity = (model.data?.entities ?? []).find((e) => e.name === entityName)!;
    files.set(`${base}/ui/components/${entity.name}Card.kt`, cardFile(model, entity));
  }

  for (const flow of model.flows ?? []) {
    if (!flowHasScreen(flow) || flow.kind === "crud") continue;
    const file = `${base}/ui/screens/${screenName(flow.name)}.kt`;
    if (flow.kind === "create") files.set(file, createScreenFile(model, flow));
    else if (flow.kind === "list") files.set(file, listScreenFile(model, flow));
    else if (flow.kind === "search") files.set(file, searchScreenFile(model, flow));
    else files.set(file, customScreenFile(model, flow));
  }

  for (const screen of model.ui?.screens ?? []) {
    if ((screen.components ?? []).length === 0) continue;
    files.set(`${base}/ui/screens/${pascal(screen.name)}Screen.kt`, chartScreenFile(model, screen));
  }

  const dests = destinations(model);
  files.set(`${base}/ui/Nav.kt`, navFile(model, dests));
  files.set(`${base}/MainActivity.kt`, mainActivityFile(model, dests));
}

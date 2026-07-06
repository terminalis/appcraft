export interface AppModel {
  appcraft: string;
  app: { name: string; package: string };
  theme?: { seedColor?: string; darkMode?: "system" | "always" | "never" };
  data?: { entities?: Entity[]; enums?: EnumDef[] };
  flows?: Flow[];
  ui?: { screens?: Screen[] };
  ml?: MlBlock[];
  custom?: CustomBlock[];
}

export interface Entity {
  name: string;
  storage: "device" | "cloud" | "memory";
  attributes: Attribute[];
  invariants?: string[];
}

export interface Attribute {
  name: string;
  type: string;
  optional?: boolean;
  derived?: boolean;
}

export interface EnumDef {
  name: string;
  values: string[];
}

export type FlowKind = "create" | "list" | "crud" | "search" | "custom";

export interface Flow {
  name: string;
  kind: FlowKind;
  entity?: string;
  sort?: { by: string; order: "asc" | "desc" };
  by?: string;
  params?: Param[];
  returns?: string;
  steps?: Step[];
}

export interface Param {
  name: string;
  type: string;
}

export type Step =
  | string
  | { if: string; then: Step[]; else?: Step[] }
  | { call: string; args?: string[]; assignTo?: string };

export interface Screen {
  name: string;
  flow?: string;
  components?: ChartComponent[];
}

export interface ChartComponent {
  kind: "chart";
  type: "line" | "bar";
  entity: string;
  x: string;
  y: string;
  window?: string;
}

export interface MlBlock {
  name: string;
  kind: "classify";
  entity: string;
  model: { file: string; type: "numData" | "image" | "sensorData" };
  inputs?: string[];
  outputs: string[];
  writeTo?: string;
}

export interface CustomBlock {
  name: string;
  inputs?: Param[];
  output?: string;
  kotlin: string;
}

export interface ModelError {
  path: string;
  message: string;
  hint?: string;
}

export const SCALAR_TYPES = [
  "id",
  "text",
  "int",
  "decimal",
  "bool",
  "date",
  "datetime",
  "image",
] as const;

export type ScalarType = (typeof SCALAR_TYPES)[number];

/** Parses an attribute/param type string. Returns null when unrecognized. */
export function parseType(
  t: string,
):
  | { kind: "scalar"; scalar: ScalarType }
  | { kind: "enum"; enum: string }
  | { kind: "entity"; entity: string }
  | { kind: "list"; of: string }
  | null {
  if ((SCALAR_TYPES as readonly string[]).includes(t)) {
    return { kind: "scalar", scalar: t as ScalarType };
  }
  const enumMatch = /^enum\(([A-Z][A-Za-z0-9]*)\)$/.exec(t);
  if (enumMatch) return { kind: "enum", enum: enumMatch[1] };
  const listMatch = /^list<([A-Z][A-Za-z0-9]*)>$/.exec(t);
  if (listMatch) return { kind: "list", of: listMatch[1] };
  if (/^[A-Z][A-Za-z0-9]*$/.test(t)) return { kind: "entity", entity: t };
  return null;
}

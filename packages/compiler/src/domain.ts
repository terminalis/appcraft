import type { AppModel, Attribute, Entity } from "@appcraft-io/core";
import { kotlinTypeOf } from "@appcraft-io/core";
import { packagePath } from "./naming.js";

/**
 * Domain tier: immutable entity data classes, enum classes, and gateway
 * INTERFACES. Nothing in this tier references storage — the dependency rule
 * points inward, and the paper's admitted dependency-inversion violation
 * (facade calling the database directly) is fixed by these interfaces.
 */

export function attrKotlinType(a: Attribute): string {
  const base = kotlinTypeOf(a.type);
  return a.optional || a.derived ? `${base}?` : base;
}

export function entityFile(model: AppModel, entity: Entity): string {
  const pkg = model.app.package;
  const fields = entity.attributes
    .map((a) => {
      const suffix = a.optional || a.derived ? " = null" : "";
      return `    val ${a.name}: ${attrKotlinType(a)}${suffix},`;
    })
    .join("\n");
  return `package ${pkg}.domain.model

data class ${entity.name}(
${fields}
)
`;
}

export function enumFile(model: AppModel, name: string, values: string[]): string {
  return `package ${model.app.package}.domain.model

enum class ${name} {
${values.map((v) => `    ${v},`).join("\n")}
}
`;
}

export function gatewayFile(model: AppModel, entity: Entity): string {
  const pkg = model.app.package;
  const idAttr = entity.attributes.find((a) => a.type === "id")!;
  return `package ${pkg}.domain.gateway

import ${pkg}.domain.model.${entity.name}
import kotlinx.coroutines.flow.Flow

/**
 * Gateway interface for ${entity.name}. The business tier depends on this
 * abstraction only; storage implementations live in the data tier.
 */
interface ${entity.name}Gateway {
    fun observeAll(): Flow<List<${entity.name}>>
    suspend fun upsert(item: ${entity.name})
    suspend fun delete(${idAttr.name}: String)
}
`;
}

export function emitDomain(model: AppModel, files: Map<string, string>): void {
  const base = `app/src/main/java/${packagePath(model.app.package)}`;
  for (const e of model.data?.enums ?? []) {
    files.set(`${base}/domain/model/${e.name}.kt`, enumFile(model, e.name, e.values));
  }
  for (const entity of model.data?.entities ?? []) {
    files.set(`${base}/domain/model/${entity.name}.kt`, entityFile(model, entity));
    files.set(`${base}/domain/gateway/${entity.name}Gateway.kt`, gatewayFile(model, entity));
  }
}

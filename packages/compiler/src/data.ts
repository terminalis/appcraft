import type { AppModel, Attribute, Entity } from "@appcraft-io/core";
import { kotlinTypeOf, parseType } from "@appcraft-io/core";
import { camel, packagePath, snake } from "./naming.js";

/**
 * Data tier: Room persistence for storage:device, in-memory stores for
 * storage:memory, gateway implementations, and the manual DI graph. This tier
 * implements the domain's gateway interfaces (Dependency Inversion at the
 * gateway boundary — Clean Architecture, corrected per the paper's §VI-B).
 */

function isEnumAttr(a: Attribute): boolean {
  return parseType(a.type)?.kind === "enum";
}

function columnType(a: Attribute): string {
  const base = isEnumAttr(a) ? "String" : kotlinTypeOf(a.type);
  return a.optional || a.derived ? `${base}?` : base;
}

function toDomainField(a: Attribute): string {
  if (!isEnumAttr(a)) return `        ${a.name} = ${a.name},`;
  const enumName = kotlinTypeOf(a.type);
  return a.optional || a.derived
    ? `        ${a.name} = ${a.name}?.let { ${enumName}.valueOf(it) },`
    : `        ${a.name} = ${enumName}.valueOf(${a.name}),`;
}

function fromDomainField(a: Attribute): string {
  if (!isEnumAttr(a)) return `            ${a.name} = d.${a.name},`;
  return a.optional || a.derived
    ? `            ${a.name} = d.${a.name}?.name,`
    : `            ${a.name} = d.${a.name}.name,`;
}

export function roomEntityFile(model: AppModel, entity: Entity): string {
  const pkg = model.app.package;
  const enumImports = [
    ...new Set(entity.attributes.filter(isEnumAttr).map((a) => kotlinTypeOf(a.type))),
  ]
    .map((e) => `\nimport ${pkg}.domain.model.${e}`)
    .join("");
  const idAttr = entity.attributes.find((a) => a.type === "id")!;
  const fields = entity.attributes
    .map((a) => {
      const pk = a.name === idAttr.name ? "@PrimaryKey " : "";
      return `    ${pk}val ${a.name}: ${columnType(a)},`;
    })
    .join("\n");
  return `package ${pkg}.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey
import ${pkg}.domain.model.${entity.name}${enumImports}

@Entity(tableName = "${snake(entity.name)}")
data class ${entity.name}RoomEntity(
${fields}
) {
    fun toDomain() = ${entity.name}(
${entity.attributes.map(toDomainField).join("\n")}
    )

    companion object {
        fun fromDomain(d: ${entity.name}) = ${entity.name}RoomEntity(
${entity.attributes.map(fromDomainField).join("\n")}
        )
    }
}
`;
}

export function daoFile(model: AppModel, entity: Entity): string {
  const pkg = model.app.package;
  const idAttr = entity.attributes.find((a) => a.type === "id")!;
  return `package ${pkg}.data.db

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface ${entity.name}Dao {
    @Query("SELECT * FROM ${snake(entity.name)}")
    fun observeAll(): Flow<List<${entity.name}RoomEntity>>

    @Upsert
    suspend fun upsert(item: ${entity.name}RoomEntity)

    @Query("DELETE FROM ${snake(entity.name)} WHERE ${idAttr.name} = :${idAttr.name}")
    suspend fun delete(${idAttr.name}: String)
}
`;
}

export function databaseFile(model: AppModel, roomEntities: Entity[]): string {
  const pkg = model.app.package;
  return `package ${pkg}.data.db

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [${roomEntities.map((e) => `${e.name}RoomEntity::class`).join(", ")}],
    version = 1,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
${roomEntities.map((e) => `    abstract fun ${camel(e.name)}Dao(): ${e.name}Dao`).join("\n")}
}
`;
}

export function gatewayImplFile(model: AppModel, entity: Entity): string {
  const pkg = model.app.package;
  const idAttr = entity.attributes.find((a) => a.type === "id")!;
  return `package ${pkg}.data

import ${pkg}.data.db.${entity.name}Dao
import ${pkg}.data.db.${entity.name}RoomEntity
import ${pkg}.domain.gateway.${entity.name}Gateway
import ${pkg}.domain.model.${entity.name}
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class ${entity.name}GatewayImpl(private val dao: ${entity.name}Dao) : ${entity.name}Gateway {
    override fun observeAll(): Flow<List<${entity.name}>> =
        dao.observeAll().map { list -> list.map { it.toDomain() } }

    override suspend fun upsert(item: ${entity.name}) =
        dao.upsert(${entity.name}RoomEntity.fromDomain(item))

    override suspend fun delete(${idAttr.name}: String) = dao.delete(${idAttr.name})
}
`;
}

export function memoryGatewayFile(model: AppModel, entity: Entity): string {
  const pkg = model.app.package;
  const idAttr = entity.attributes.find((a) => a.type === "id")!;
  return `package ${pkg}.data

import ${pkg}.domain.gateway.${entity.name}Gateway
import ${pkg}.domain.model.${entity.name}
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

class ${entity.name}MemoryGateway : ${entity.name}Gateway {
    private val state = MutableStateFlow<List<${entity.name}>>(emptyList())

    override fun observeAll(): Flow<List<${entity.name}>> = state

    override suspend fun upsert(item: ${entity.name}) {
        state.value = state.value.filterNot { it.${idAttr.name} == item.${idAttr.name} } + item
    }

    override suspend fun delete(${idAttr.name}: String) {
        state.value = state.value.filterNot { it.${idAttr.name} == ${idAttr.name} }
    }
}
`;
}

export function appGraphFile(model: AppModel, storedEntities: Entity[]): string {
  const pkg = model.app.package;
  const roomEntities = storedEntities.filter((e) => e.storage === "device");
  const hasRoom = roomEntities.length > 0;
  const gatewayProps = storedEntities
    .map((e) => {
      const impl =
        e.storage === "device"
          ? `${e.name}GatewayImpl(db.${camel(e.name)}Dao())`
          : `${e.name}MemoryGateway()`;
      return `    val ${camel(e.name)}Gateway: ${e.name}Gateway by lazy {
        ${impl}
    }`;
    })
    .join("\n\n");
  const implImports = storedEntities
    .map((e) =>
      e.storage === "device"
        ? `import ${pkg}.data.${e.name}GatewayImpl`
        : `import ${pkg}.data.${e.name}MemoryGateway`,
    )
    .join("\n");
  const gwImports = storedEntities
    .map((e) => `import ${pkg}.domain.gateway.${e.name}Gateway`)
    .join("\n");

  return `package ${pkg}

import android.content.Context${hasRoom ? "\nimport androidx.room.Room" : ""}
${implImports}${hasRoom ? `\nimport ${pkg}.data.db.AppDatabase` : ""}
import ${pkg}.domain.ModelFacade
${gwImports}

/**
 * Manual dependency graph. Gateways are exposed as their domain interfaces —
 * source-code dependencies point inward (Clean Architecture dependency rule).
 */
object AppGraph {
${hasRoom ? "    private lateinit var db: AppDatabase\n" : ""}
    fun init(context: Context) {
${
  hasRoom
    ? `        db = Room.databaseBuilder(context, AppDatabase::class.java, "app.db").build()`
    : "        // No persistent storage in this model."
}
    }

${gatewayProps}

    val modelFacade: ModelFacade by lazy {
        ModelFacade(${storedEntities.map((e) => `${camel(e.name)}Gateway`).join(", ")})
    }
}
`;
}

export function emitData(model: AppModel, files: Map<string, string>): void {
  const base = `app/src/main/java/${packagePath(model.app.package)}`;
  const entities = model.data?.entities ?? [];
  const roomEntities = entities.filter((e) => e.storage === "device");
  const memoryEntities = entities.filter((e) => e.storage === "memory");

  for (const e of roomEntities) {
    files.set(`${base}/data/db/${e.name}RoomEntity.kt`, roomEntityFile(model, e));
    files.set(`${base}/data/db/${e.name}Dao.kt`, daoFile(model, e));
    files.set(`${base}/data/${e.name}GatewayImpl.kt`, gatewayImplFile(model, e));
  }
  if (roomEntities.length > 0) {
    files.set(`${base}/data/db/AppDatabase.kt`, databaseFile(model, roomEntities));
  }
  for (const e of memoryEntities) {
    files.set(`${base}/data/${e.name}MemoryGateway.kt`, memoryGatewayFile(model, e));
  }
  // Always emitted: the UI tier resolves ModelFacade through AppGraph.
  files.set(`${base}/AppGraph.kt`, appGraphFile(model, entities));
}

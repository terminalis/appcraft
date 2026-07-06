import { describe, expect, test } from "vitest";
import { loadModel, validateForCompile, type AppModel } from "@appcraft-io/core";
import { compile } from "../src/index.js";
import { flagshipModel } from "./project.test.js";

const BASE = "app/src/main/java/io/appcraft/glucolog";

function modelOf(yaml: string): AppModel {
  const { doc, errors } = loadModel(yaml);
  expect(errors).toEqual([]);
  const v = validateForCompile(doc);
  expect(v.errors).toEqual([]);
  return v.model!;
}

describe("domain layer", () => {
  const files = compile(flagshipModel()).files;

  test("entity data class with nullable optional/derived fields", () => {
    const src = files.get(`${BASE}/domain/model/GlucoseReading.kt`)!;
    expect(src).toContain("data class GlucoseReading(");
    expect(src).toContain("val mmol: Double,");
    expect(src).toContain("val note: String? = null,");
    expect(src).toContain("val context: ReadingContext,");
    // domain model carries NO validation — invariants live in the presentation tier
    expect(src).not.toContain("require(");
    expect(src).not.toContain("mmol > 0");
  });

  test("enum class emitted", () => {
    const src = files.get(`${BASE}/domain/model/ReadingContext.kt`)!;
    expect(src).toContain("enum class ReadingContext {");
    expect(src).toContain("beforeMeal,");
  });

  test("gateway is an interface in the domain tier", () => {
    const src = files.get(`${BASE}/domain/gateway/GlucoseReadingGateway.kt`)!;
    expect(src).toContain("interface GlucoseReadingGateway {");
    expect(src).toContain("fun observeAll(): Flow<List<GlucoseReading>>");
    expect(src).not.toContain("Room");
  });
});

describe("data layer", () => {
  const files = compile(flagshipModel()).files;

  test("room entity stores enums as strings and maps to domain", () => {
    const src = files.get(`${BASE}/data/db/GlucoseReadingRoomEntity.kt`)!;
    expect(src).toContain('@Entity(tableName = "glucose_reading")');
    expect(src).toContain("val context: String,");
    expect(src).toContain("ReadingContext.valueOf(context)");
    expect(src).toContain("@PrimaryKey val id: String,");
  });

  test("gateway impl implements the domain interface", () => {
    const src = files.get(`${BASE}/data/GlucoseReadingGatewayImpl.kt`)!;
    expect(src).toContain(") : GlucoseReadingGateway {");
    expect(src).toContain("dao.observeAll().map { list -> list.map { it.toDomain() } }");
  });

  test("AppGraph exposes gateways as interfaces and wires the facade", () => {
    const src = files.get(`${BASE}/AppGraph.kt`)!;
    expect(src).toContain("val glucoseReadingGateway: GlucoseReadingGateway by lazy");
    expect(src).toContain("ModelFacade(glucoseReadingGateway)");
    expect(src).toContain('Room.databaseBuilder(context, AppDatabase::class.java, "app.db")');
  });
});

describe("ModelFacade", () => {
  const files = compile(flagshipModel()).files;
  const facade = files.get(`${BASE}/domain/ModelFacade.kt`)!;

  test("depends on gateway interfaces, never on the data tier", () => {
    expect(facade).toContain("import io.appcraft.glucolog.domain.gateway.GlucoseReadingGateway");
    expect(facade).not.toContain("import io.appcraft.glucolog.data.");
  });

  test("create/list/search flows become facade methods", () => {
    expect(facade).toContain("suspend fun logReading(item: GlucoseReading) = glucoseReadingGateway.upsert(item)");
    expect(facade).toContain("fun history(): Flow<List<GlucoseReading>> = glucoseReadingGateway.observeAll().map { list -> list.sortedByDescending { it.takenAt } }");
    expect(facade).toContain("fun findByDay(query: String): Flow<List<GlucoseReading>>");
  });

  test("chart entities get an observe method", () => {
    expect(facade).toContain("fun observeGlucoseReading(): Flow<List<GlucoseReading>> = glucoseReadingGateway.observeAll()");
  });
});

describe("custom flows (paper's BMI/calorie formulas)", () => {
  const yaml = `
appcraft: 0.1
app: { name: HealthCalc, package: io.appcraft.healthcalc }
data:
  enums:
    - { name: Gender, values: [male, female] }
    - { name: Exercise, values: [walking, jogging, running, swimming, weights] }
flows:
  - name: computeBmi
    kind: custom
    params: [{ name: height, type: decimal }, { name: weight, type: decimal }]
    returns: decimal
    steps:
      - "result = weight / (height * height)"
  - name: calorieCount
    kind: custom
    params:
      - { name: exercise, type: enum(Exercise) }
      - { name: gender, type: enum(Gender) }
      - { name: times, type: decimal }
    returns: decimal
    steps:
      - "factor = 250.0"
      - if: "exercise == walking"
        then: ["factor = 100.0"]
      - if: "exercise == running"
        then: ["factor = 300.0"]
      - if: "exercise == jogging"
        then: ["factor = 200.0"]
      - if: "gender == male"
        then: ["result = factor * (times / 60.0) * 1.5"]
        else: ["result = factor * (times / 60.0)"]
`;
  const files = compile(modelOf(yaml)).files;
  const facade = files.get("app/src/main/java/io/appcraft/healthcalc/domain/ModelFacade.kt")!;

  test("transpiles params, locals, if/else, and enum literals to Kotlin", () => {
    expect(facade).toContain("fun computeBmi(height: Double, weight: Double): Double {");
    expect(facade).toContain("result = weight / (height * height)");
    expect(facade).toContain("var factor = 250.0");
    expect(facade).toContain("if (exercise == Exercise.walking) {");
    expect(facade).toContain("if (gender == Gender.male) {");
    expect(facade).toContain("result = factor * (times / 60.0) * 1.5");
    expect(facade).toContain("return result");
  });

  test("no gateways needed — facade constructor is empty", () => {
    expect(facade).toContain("class ModelFacade(\n\n)");
  });
});

describe("custom blocks", () => {
  const yaml = `
appcraft: 0.1
app: { name: Blocky, package: io.example.blocky }
data:
  entities:
    - name: Note
      storage: device
      attributes: [{ name: id, type: id }, { name: body, type: text }]
custom:
  - name: shout
    inputs: [{ name: body, type: text }]
    output: text
    kotlin: |
      return body.uppercase() + "!"
flows:
  - name: makeLoud
    kind: custom
    params: [{ name: body, type: text }]
    returns: text
    steps:
      - call: shout
        args: ["body"]
        assignTo: loud
      - "result = loud"
`;
  const files = compile(modelOf(yaml)).files;

  test("verbatim kotlin preserved inside CustomBlocks object", () => {
    const src = files.get("app/src/main/java/io/example/blocky/custom/CustomBlocks.kt")!;
    expect(src).toContain("object CustomBlocks {");
    expect(src).toContain("fun shout(body: String): String {");
    expect(src).toContain('return body.uppercase() + "!"');
  });

  test("call steps dispatch to CustomBlocks", () => {
    const facade = files.get("app/src/main/java/io/example/blocky/domain/ModelFacade.kt")!;
    expect(facade).toContain("var loud = CustomBlocks.shout(body)");
    expect(facade).toContain("import io.example.blocky.custom.CustomBlocks");
  });
});

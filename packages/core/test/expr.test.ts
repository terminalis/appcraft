import { describe, expect, test } from "vitest";
import {
  checkExpr,
  exprToKotlin,
  exprType,
  parseAssignment,
  type SymbolTable,
} from "../src/index.js";
import type { EnumDef } from "../src/index.js";

const enums: EnumDef[] = [
  { name: "Gender", values: ["male", "female"] },
  { name: "Exercise", values: ["walking", "jogging", "running", "swimming", "weights"] },
];

const syms: SymbolTable = {
  mmol: { kotlinType: "Double" },
  weight: { kotlinType: "Double" },
  height: { kotlinType: "Double" },
  age: { kotlinType: "Double" },
  times: { kotlinType: "Double" },
  gender: { kotlinType: "Gender", enumName: "Gender" },
  exercise: { kotlinType: "Exercise", enumName: "Exercise" },
  "user.bmr": { kotlinType: "Double" },
  note: { kotlinType: "String" },
};

describe("checkExpr / exprToKotlin", () => {
  test("simple comparison", () => {
    expect(checkExpr("mmol > 0", syms, enums)).toEqual([]);
    expect(exprToKotlin("mmol > 0", syms, enums)).toBe("mmol > 0");
    expect(exprType("mmol > 0", syms, enums)).toBe("boolean");
  });

  test("enum compared to string literal resolves to enum literal", () => {
    expect(exprToKotlin("gender == 'male'", syms, enums)).toBe("gender == Gender.male");
  });

  test("enum compared to bare identifier resolves to enum literal", () => {
    expect(exprToKotlin("exercise == walking", syms, enums)).toBe(
      "exercise == Exercise.walking",
    );
  });

  test("bare identifier that is not an enum literal is rejected", () => {
    const errors = checkExpr("exercise == sprinting", syms, enums);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("sprinting");
  });

  test("arithmetic with parens", () => {
    expect(exprToKotlin("66.5 + 13*weight - 6.76*age", syms, enums)).toBe(
      "66.5 + 13 * weight - 6.76 * age",
    );
    expect(exprToKotlin("weight/(height*height)", syms, enums)).toBe(
      "weight / (height * height)",
    );
  });

  test("dotted identifier via symbol table", () => {
    expect(exprToKotlin("user.bmr * 1.375", syms, enums)).toBe("user.bmr * 1.375");
  });

  test("method calls rejected", () => {
    const errors = checkExpr("System.exit(0)", syms, enums);
    expect(errors.some((e) => e.message.includes("Method calls are not allowed"))).toBe(true);
  });

  test("unknown identifier rejected", () => {
    const errors = checkExpr("bogus + 1", syms, enums);
    expect(errors.some((e) => e.message.includes('Unknown identifier "bogus"'))).toBe(true);
  });

  test("illegal characters rejected", () => {
    expect(checkExpr("a; b", syms, enums).length).toBeGreaterThan(0);
    expect(checkExpr("x = { }", syms, enums).length).toBeGreaterThan(0);
    expect(checkExpr("`rm -rf`", syms, enums).length).toBeGreaterThan(0);
  });

  test("boolean combinators", () => {
    expect(exprToKotlin("mmol > 0 && mmol < 30 || gender == 'female'", syms, enums)).toBe(
      'mmol > 0 && mmol < 30 || gender == Gender.female',
    );
  });

  test("string literal emits double-quoted Kotlin", () => {
    expect(exprToKotlin("note == 'hello'", syms, enums)).toBe('note == "hello"');
  });
});

describe("parseAssignment", () => {
  test("local declaration inferred as number", () => {
    const a = parseAssignment("factor = 100.0", syms, enums);
    expect(a.errors).toEqual([]);
    expect(a.target).toBe("factor");
    expect(a.type).toBe("number");
  });

  test("comparison operators are not mistaken for assignment", () => {
    const a = parseAssignment("result = times / 60.0", syms, enums);
    expect(a.target).toBe("result");
  });

  test("missing '=' is an error", () => {
    const a = parseAssignment("mmol > 0", syms, enums);
    expect(a.errors.length).toBeGreaterThan(0);
  });
});

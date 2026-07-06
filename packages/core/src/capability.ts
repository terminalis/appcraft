/**
 * The machine-readable truth about what AppCraft can and cannot express or
 * compile today. Agents MUST consult this before promising features to users
 * — the expressiveness cliff is handled by honesty, not improvisation.
 */
export interface CapabilityCard {
  formatVersion: string;
  compilerVersion: string;
  compilerTarget: string;
  supported: {
    attributeTypes: string[];
    storage: string[];
    flowKinds: string[];
    uiComponents: string[];
    theme: string[];
    customKotlinBlocks: boolean;
    expressionLanguage: string;
  };
  unsupported: { feature: string; status: string; planned: string }[];
  limits: { maxEntities: number; maxFlows: number; maxScreens: number };
}

export function capabilityCard(): CapabilityCard {
  return {
    formatVersion: "0.1",
    compilerVersion: "0.1.2",
    compilerTarget: "android (Kotlin, Jetpack Compose, Material 3, Room)",
    supported: {
      attributeTypes: [
        "id",
        "text",
        "int",
        "decimal",
        "bool",
        "date",
        "datetime",
        "image",
        "enum(Name)",
      ],
      storage: ["device (Room/SQLite)", "memory"],
      flowKinds: ["create", "list", "search", "custom (params + steps)"],
      uiComponents: ["screens derived from flows", "chart (line|bar, windowed)"],
      theme: ["seedColor", "darkMode"],
      customKotlinBlocks: true,
      expressionLanguage:
        "arithmetic, comparison, and boolean operators over declared attributes/params/locals and enum literals; no method calls, no arbitrary Kotlin",
    },
    unsupported: [
      { feature: "flow kind 'crud'", status: "validated, not compiled", planned: "0.2" },
      { feature: "storage 'cloud' (Firebase)", status: "validated, not compiled", planned: "0.2" },
      {
        feature: "ml blocks (TFLite numData/image/sensorData)",
        status: "validated, not compiled",
        planned: "phase 2",
      },
      { feature: "iOS / SwiftUI target", status: "not started", planned: "phase 2" },
      { feature: "auth", status: "not started", planned: "phase 2" },
      {
        feature: "push notifications, maps, background jobs",
        status: "not started",
        planned: "phase 2+",
      },
      {
        feature: "datetime editing in create forms (value defaults to now)",
        status: "v0.1 simplification",
        planned: "0.2",
      },
      {
        feature: "games, social feeds, media editing, arbitrary custom UI",
        status: "out of archetype — will not be supported",
        planned: "never (by design)",
      },
    ],
    limits: { maxEntities: 20, maxFlows: 30, maxScreens: 30 },
  };
}

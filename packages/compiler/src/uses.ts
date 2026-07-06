import type { AppModel } from "@appcraft-io/core";
import { parseType } from "@appcraft-io/core";

/** Capabilities actually used by the model — drives dependencies and permissions. */
export interface Uses {
  room: boolean;
  image: boolean;
  chart: boolean;
  enums: boolean;
}

export function usesOf(model: AppModel): Uses {
  const entities = model.data?.entities ?? [];
  const attrs = entities.flatMap((e) => e.attributes);
  return {
    room: entities.some((e) => e.storage === "device"),
    image: attrs.some((a) => a.type === "image"),
    chart: (model.ui?.screens ?? []).some((s) => (s.components ?? []).length > 0),
    enums: attrs.some((a) => parseType(a.type)?.kind === "enum"),
  };
}

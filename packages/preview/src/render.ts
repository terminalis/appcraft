import type { AppModel, Attribute, EnumDef, Flow, Param } from "@appcraft-io/core";
import { parseType } from "@appcraft-io/core";

/**
 * Tier-1 preview: a deterministic, fully self-contained HTML mockup rendered
 * straight from the model in milliseconds — no toolchain, no network, no
 * randomness. Tier 2 (the real APK) comes from `appcraft generate` + Gradle.
 */

function humanize(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface PreviewScreen {
  name: string;
  title: string;
  body: string;
}

function inputMock(label: string, hint: string): string {
  return `<div class="field"><div class="field-label">${esc(label)}</div><div class="field-hint">${esc(hint)}</div></div>`;
}

function fieldMock(model: AppModel, name: string, type: string): string {
  const label = humanize(name);
  const parsed = parseType(type);
  if (parsed?.kind === "enum") {
    const e = (model.data?.enums ?? []).find((x: EnumDef) => x.name === parsed.enum);
    return `<div class="field select"><div class="field-label">${esc(label)}</div><div class="field-hint">${esc(
      e?.values[0] ?? "",
    )}</div><div class="chev">&#9662;</div></div>`;
  }
  switch (type) {
    case "int":
    case "decimal":
      return inputMock(label, "0");
    case "text":
      return inputMock(label, "");
    case "bool":
      return `<div class="row"><span>${esc(label)}</span><span class="toggle"></span></div>`;
    case "image":
      return `<div class="imgpick">Pick ${esc(label)}</div>`;
    case "date":
    case "datetime":
      return `<span class="chip">${esc(label)}: today</span>`;
    default:
      return inputMock(label, "");
  }
}

function formFields(model: AppModel, attrs: Attribute[]): string {
  return attrs
    .filter((a) => a.type !== "id" && !a.derived)
    .map((a) => fieldMock(model, a.name, a.type))
    .join("\n");
}

function cardMock(model: AppModel, entityName: string, n: number): string {
  const entity = (model.data?.entities ?? []).find((e) => e.name === entityName);
  const attrs = (entity?.attributes ?? []).filter((a) => a.type !== "id" && a.type !== "image");
  const lines = attrs
    .slice(0, 3)
    .map(
      (a, i) =>
        `<div class="${i === 0 ? "card-title" : "card-line"}">${esc(humanize(a.name))}: <span>${
          a.type === "int" || a.type === "decimal" ? (n * 3 + i).toString() : "&#8212;"
        }</span></div>`,
    )
    .join("");
  const img = (entity?.attributes ?? []).some((a) => a.type === "image")
    ? `<div class="card-img"></div>`
    : "";
  return `<div class="card">${img}${lines}</div>`;
}

const CHART_POINTS = [18, 34, 26, 48, 40, 62, 55];

function chartSvg(): string {
  const w = 280;
  const h = 140;
  const step = w / (CHART_POINTS.length - 1);
  const max = 70;
  const pts = CHART_POINTS.map((v, i) => `${Math.round(i * step)},${Math.round(h - (v / max) * h)}`).join(" ");
  const dots = CHART_POINTS.map(
    (v, i) =>
      `<circle cx="${Math.round(i * step)}" cy="${Math.round(h - (v / max) * h)}" r="4" fill="var(--seed)"/>`,
  ).join("");
  return `<svg viewBox="-6 -6 ${w + 12} ${h + 12}" class="chart"><polyline points="${pts}" fill="none" stroke="var(--seed)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg>`;
}

function screensOf(model: AppModel): PreviewScreen[] {
  const screens: PreviewScreen[] = [];
  for (const flow of model.flows ?? []) {
    const entity = (model.data?.entities ?? []).find((e) => e.name === flow.entity);
    const title = humanize(flow.name);
    if (flow.kind === "create" && entity) {
      screens.push({
        name: flow.name,
        title,
        body: `${formFields(model, entity.attributes)}<div class="btn">Save</div>`,
      });
    } else if (flow.kind === "list" && entity) {
      screens.push({
        name: flow.name,
        title,
        body: [1, 2, 3].map((n) => cardMock(model, entity.name, n)).join("\n"),
      });
    } else if (flow.kind === "search" && entity) {
      screens.push({
        name: flow.name,
        title,
        body: `${inputMock(`Search ${humanize(flow.by ?? "")}`, "&#128269;")}\n${cardMock(model, entity.name, 1)}`,
      });
    } else if (flow.kind === "custom") {
      const scalarParams = (flow.params ?? []).filter((p: Param) => {
        const parsed = parseType(p.type);
        return (parsed?.kind === "scalar" && parsed.scalar !== "image") || parsed?.kind === "enum";
      });
      if (scalarParams.length !== (flow.params ?? []).length) continue;
      const fields = scalarParams.map((p) => fieldMock(model, p.name, p.type)).join("\n");
      const result = flow.returns
        ? `<div class="result"><div class="result-label">Result</div><div class="result-value">&#8212;</div></div>`
        : "";
      screens.push({ name: flow.name, title, body: `${fields}<div class="btn">${esc(title)}</div>${result}` });
    }
  }
  for (const screen of model.ui?.screens ?? []) {
    if ((screen.components ?? []).length === 0) continue;
    screens.push({ name: screen.name, title: humanize(screen.name), body: chartSvg() });
  }
  return screens;
}

export function renderPreviewHtml(model: AppModel): string {
  const seed = model.theme?.seedColor ?? "#3F51B5";
  const screens = screensOf(model);
  const navLabels = screens.map((s) => `<span>${esc(s.title)}</span>`).join("");
  const frames = screens
    .map(
      (s) => `
  <div class="phone">
    <div class="notch"></div>
    <div class="screen">
      <div class="apptitle">${esc(s.title)}</div>
      <div class="content">
${s.body}
      </div>
      <div class="nav">${navLabels}</div>
    </div>
  </div>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.app.name)} — AppCraft preview</title>
<style>
:root { --seed: ${seed}; }
* { box-sizing: border-box; margin: 0; }
body { font-family: system-ui, sans-serif; background: #16141a; color: #e8e3ec; padding: 32px; }
h1 { font-size: 20px; font-weight: 600; }
h1 span { color: var(--seed); filter: brightness(1.6); }
p.sub { color: #9a94a3; font-size: 13px; margin: 6px 0 28px; }
.frames { display: flex; flex-wrap: wrap; gap: 28px; }
.phone { width: 300px; border-radius: 34px; background: #000; padding: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.5); }
.notch { width: 90px; height: 8px; background: #222; border-radius: 6px; margin: 4px auto 6px; }
.screen { background: #fdfcff; color: #1b1b1f; border-radius: 26px; height: 600px; display: flex; flex-direction: column; overflow: hidden; }
.apptitle { font-size: 17px; font-weight: 600; padding: 18px 18px 8px; }
.content { flex: 1; overflow: hidden; padding: 8px 16px; display: flex; flex-direction: column; gap: 10px; }
.field { border: 1px solid #c6c0cc; border-radius: 6px; padding: 8px 12px; position: relative; }
.field-label { font-size: 10px; color: var(--seed); font-weight: 600; }
.field-hint { font-size: 14px; color: #9a94a3; min-height: 18px; }
.select .chev { position: absolute; right: 12px; top: 16px; color: #6b6572; }
.row { display: flex; justify-content: space-between; align-items: center; padding: 6px 2px; font-size: 14px; }
.toggle { width: 40px; height: 22px; border-radius: 12px; background: #c6c0cc; display: inline-block; position: relative; }
.toggle::after { content: ""; position: absolute; left: 3px; top: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; }
.imgpick { border: 2px dashed #c6c0cc; border-radius: 10px; padding: 22px; text-align: center; color: #6b6572; font-size: 13px; }
.chip { align-self: flex-start; border: 1px solid #c6c0cc; border-radius: 8px; padding: 5px 10px; font-size: 12px; color: #454049; }
.btn { background: var(--seed); color: #fff; text-align: center; border-radius: 20px; padding: 11px; font-size: 14px; font-weight: 600; margin-top: 6px; }
.card { border-radius: 12px; background: #f3f1f6; padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.card-img { height: 64px; border-radius: 8px; background: linear-gradient(120deg, #d8d2e0, #efeaf4); margin-bottom: 8px; }
.card-title { font-size: 15px; font-weight: 600; }
.card-line { font-size: 12px; color: #6b6572; margin-top: 2px; }
.card-title span, .card-line span { font-weight: 400; }
.result { border-radius: 12px; background: #f3f1f6; padding: 12px 14px; }
.result-label { font-size: 11px; color: #6b6572; }
.result-value { font-size: 22px; font-weight: 600; }
.chart { width: 100%; margin-top: 12px; }
.nav { display: flex; justify-content: space-around; background: #f3f1f6; padding: 12px 4px; font-size: 9px; color: #454049; }
</style>
</head>
<body>
<h1><span>&#9679;</span> ${esc(model.app.name)} <small style="color:#9a94a3;font-weight:400">· AppCraft model preview</small></h1>
<p class="sub">Deterministic mockup rendered from app.acm.yaml — the compiled app is the real thing; this is the shape of it.</p>
<div class="frames">
${frames}
</div>
</body>
</html>
`;
}

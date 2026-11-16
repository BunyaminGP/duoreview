import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const layout = require("../app/layout.js");

const {
  MIN_PANE_PX,
  MIN_SIDE_PX,
  MAX_SIDE_PX,
  DEFAULT_SIDE_PX,
  MIN_FONT,
  MAX_FONT,
  DEFAULT_FONT,
  clampSide,
  clampFont,
  clampComposer,
  normalizeRatios,
  equalRatios,
  ratiosToPx,
  pxToRatios,
  resizePair,
  normalizeUi,
  createResizeFilter,
} = layout;

test("1. Yan panel (260-600px), yazı boyutu (9-24) ve composer (%50) sınır kırpma", () => {
  assert.equal(MIN_PANE_PX, 240);
  assert.equal(MIN_SIDE_PX, 260);
  assert.equal(MAX_SIDE_PX, 600);
  assert.equal(clampSide(100), 260);
  assert.equal(clampSide(800), 600);
  assert.equal(clampSide(420), 420);
  assert.equal(clampSide(NaN), DEFAULT_SIDE_PX);

  assert.equal(MIN_FONT, 9);
  assert.equal(MAX_FONT, 24);
  assert.equal(clampFont(5), 9);
  assert.equal(clampFont(30), 24);
  assert.equal(clampFont(15), 15);
  assert.equal(clampFont(undefined), DEFAULT_FONT);

  assert.equal(clampComposer(20, 600), 40);
  assert.equal(clampComposer(400, 600), 300);
  assert.equal(clampComposer(180, 600), 180);
});

test("2. 2 ve 3 kişilik takımda oranların toplamı 1 ve eşit dağıtım", () => {
  const two = normalizeRatios({ claude: 2, codex: 6, gemini: 5 }, ["claude", "codex"]);
  assert.ok(Math.abs(two.claude + two.codex - 1) < 1e-9);
  assert.ok(Math.abs(two.claude - 0.25) < 1e-9);
  assert.ok(Math.abs(two.codex - 0.75) < 1e-9);

  const three = normalizeRatios({ claude: 1, codex: 2, gemini: 1 }, ["claude", "codex", "gemini"]);
  assert.ok(Math.abs(three.claude + three.codex + three.gemini - 1) < 1e-9);
  assert.ok(Math.abs(three.codex - 0.5) < 1e-9);

  const eq3 = equalRatios(["claude", "codex", "gemini"]);
  assert.ok(Math.abs(eq3.claude + eq3.codex + eq3.gemini - 1) < 1e-9);
  assert.ok(Math.abs(eq3.claude - 1 / 3) < 1e-9);

  const eq2 = equalRatios(["claude", "gemini"], eq3);
  assert.ok(Math.abs(eq2.claude + eq2.gemini - 1) < 1e-9);
  assert.equal(eq2.claude, 0.5);
  assert.equal(eq2.gemini, 0.5);
});

test("3. Oran ↔ px dönüşümü ve 240px alt sınır koruması", () => {
  const members = ["claude", "codex", "gemini"];
  const totalPx = 1200;
  const px = ratiosToPx({ claude: 0.05, codex: 0.75, gemini: 0.2 }, members, totalPx);

  assert.ok(px.claude >= 240);
  assert.ok(px.gemini >= 240);
  assert.ok(px.codex >= 240);
  assert.ok(Math.abs(px.claude + px.codex + px.gemini - totalPx) < 1e-6);

  const back = pxToRatios(px, members);
  assert.ok(Math.abs(back.claude + back.codex + back.gemini - 1) < 1e-9);
  assert.ok(Math.abs(back.claude - 240 / 1200) < 1e-6);

  const dragged = resizePair(
    { claude: 1 / 3, codex: 1 / 3, gemini: 1 / 3 },
    members,
    "claude",
    "codex",
    -300,
    1200
  );
  const draggedPx = ratiosToPx(dragged, members, 1200);
  assert.equal(Math.round(draggedPx.claude), 240);
  assert.equal(Math.round(draggedPx.codex), 560);
  assert.equal(Math.round(draggedPx.gemini), 400);
});

test("4. UI durum normalleştirme ve PTY resize değişim filtresi", () => {
  const ui = normalizeUi({
    cols: { claude: 0.6, codex: 0.4 },
    side: 700,
    font: { claude: 4, codex: 18, gemini: 99 },
    composer: { claude: 90 },
    max: "codex",
    advanced: true,
  });
  assert.equal(ui.side, 600);
  assert.equal(ui.font.claude, 9);
  assert.equal(ui.font.codex, 18);
  assert.equal(ui.font.gemini, 24);
  assert.equal(ui.max, "codex");
  assert.equal(ui.advanced, true);

  const calls = [];
  const filter = createResizeFilter((agent, cols, rows) => calls.push([agent, cols, rows]));
  assert.equal(filter.send("claude", 100, 30), true);
  assert.equal(filter.send("claude", 100, 30), false);
  assert.equal(filter.send("claude", 102, 30), true);
  assert.equal(filter.send("claude", 0, 30), false);
  filter.reset("claude");
  assert.equal(filter.send("claude", 102, 30), true);
  assert.deepEqual(calls, [
    ["claude", 100, 30],
    ["claude", 102, 30],
    ["claude", 102, 30],
  ]);
});

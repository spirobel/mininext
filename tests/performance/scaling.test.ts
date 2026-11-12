// big lists: the work per change does not grow with the list,
// and the work over the whole list grows linearly, not quadratically.
// runs in jsdom and in chrome (tests/chrome/).
//   bun test ./tests/performance/scaling.test.ts
import { expect, test } from "bun:test";
import "../dom-setup";
import { testDataFor } from "../testdata";
const testData = testDataFor(import.meta.path);
const { html, makeNewMini } = await import("../../mininext/browser");

// jsdom's own insert and remove get slower with the number of siblings (quadratic, measured
// without mininext). so in jsdom only the idle frame (mininext's own work) is timed, on
// smaller lists. chrome times all of it.
const IN_BUN = typeof Bun !== "undefined"; // bun + jsdom. in chrome there is no Bun
const SIZES = IN_BUN ? [250, 500, 1000] : [1000, 2000, 4000];
const [S1, , S4] = SIZES as [number, number, number];

function listPage(n: number) {
  const s = { items: Array.from({ length: n }, (_, i) => i) };
  const container = document.createElement("div");
  document.body.append(container);
  const cac = { cache: new Map(), cursor: "t" };
  const frame = () => {
    const mini = makeNewMini(cac);
    html`<ul>${s.items.map((i) => html`<li data-i="${i}">${i}</li>`)}</ul>`.resolve(mini).render(container, cac);
  };
  return { s, container, frame, cac };
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
const time = (fn: () => void) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

test("sc01 append to a long list: the same writes for every length", () => {
  const td = testData("sc01-append");
  const per: Record<number, string[]> = {};
  for (const n of SIZES) {
    const p = listPage(n);
    p.frame();
    const observer = new MutationObserver(() => {});
    observer.observe(p.container, { subtree: true, childList: true, attributes: true, characterData: true });
    p.s.items.push(n);
    p.frame();
    per[n] = observer.takeRecords().map((r) => `${r.type} +${r.addedNodes.length} -${r.removedNodes.length}`);
    observer.disconnect();
    p.container.remove();
  }
  td.dump("writes.json", JSON.stringify(per, null, 2));
  expect(per[S1]!.length).toBeGreaterThan(0);
  for (const n of SIZES) expect(per[n]).toEqual(per[S1]!);
});

// 4x the items may take about 4x the time. 8x is the limit: quadratic work would be 16x.
test("sc02 first render, idle frame and trim to 0 grow linearly", () => {
  const td = testData("sc02-linear");
  listPage(S1).frame(); // warm up the jit
  const ms: Record<string, Record<number, number>> = { render: {}, idle: {}, trim: {} };
  for (const n of SIZES) {
    const render: number[] = [];
    const idle: number[] = [];
    const trim: number[] = [];
    for (let run = 0; run < 5; run++) {
      const p = listPage(n);
      render.push(time(p.frame));
      for (let k = 0; k < 3; k++) idle.push(time(p.frame));
      p.s.items = [];
      trim.push(time(p.frame));
      expect(p.cac.cache.size).toBe(2); // only the <ul> template and the empty list are left
      p.container.remove();
    }
    ms.render![n] = median(render);
    ms.idle![n] = median(idle);
    ms.trim![n] = median(trim);
  }
  const ratios = Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, v[S4]! / v[S1]!]));
  td.dump("ms.json", JSON.stringify({ inBun: IN_BUN, ms, ratios }, null, 2));
  for (const [k, r] of Object.entries(ratios)) {
    if (IN_BUN && k !== "idle") continue;
    if (r >= 8) throw new Error(`${k}: 4x items took ${r.toFixed(1)}x the time (${JSON.stringify(ms[k])})`);
  }
  expect(Object.keys(ratios).length).toBe(3);
});

// a quadratic step with a small constant (a search per item with a callback) can hide
// at 4000 items. 8000 -> 32000 shows it: linear is about 5x here, the quadratic part 16x.
// chrome only: jsdom's own dom is quadratic.
if (!IN_BUN)
  test("sc03 chrome: an idle frame on 32000 items costs about 4x one on 8000", () => {
    const td = testData("sc03-idle-big");
    const idle: Record<number, number> = {};
    for (const n of [8000, 32000]) {
      const p = listPage(n);
      p.frame();
      const runs: number[] = [];
      for (let k = 0; k < 9; k++) runs.push(time(p.frame));
      idle[n] = median(runs);
      p.container.remove();
    }
    const ratio = idle[32000]! / idle[8000]!;
    td.dump("ms.json", JSON.stringify({ idle, ratio }, null, 2));
    if (ratio >= 8) throw new Error(`idle: 4x items took ${ratio.toFixed(1)}x the time (${JSON.stringify(idle)})`);
    expect(ratio).toBeGreaterThan(0);
  });


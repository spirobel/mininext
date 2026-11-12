// randomized stress test (jsdom). the workload is in stress-model.ts,
// the cdp browser test runs the same one. run alone: bun test ./tests/functional/stress.test.ts
import { expect, test } from "bun:test";
import "../dom-setup";
import { testDataFor } from "../testdata";
const testData = testDataFor(import.meta.path);
const { makeNewMini } = await import("../../mininext/browser");
const { createModel, nodeCount } = await import("../stress-model");

for (const start of [1234567, 42, 987654321])
  test(`s01 seed ${start}: 3000 random frames, dom equals a fresh render, no orphans, back to baseline`, () => {
    const td = testData(`stress-s01-${start}`);
    const model = createModel(start);
    const container = document.createElement("div");
    document.body.append(container);
    const cac = { cache: new Map<string, any>(), cursor: "t" };
    const frame = () => {
      const mini = makeNewMini(cac);
      model.app().resolve(mini).render(container, cac);
    };
    frame();
    const baseline = { cache: cac.cache.size, nodes: nodeCount(container) };
    const checks: string[] = [];
    let maxTags = 0; // the nested lists really got used
    for (let i = 1; i <= 3000; i++) {
      model.mutate();
      frame();
      model.interact(container);
      if (i % 100 === 0) {
        frame(); // render what interact() changed, then compare
        const r = model.check(container, cac.cache, "t");
        checks.push(`${i}: cache=${r.cache} nodes=${r.nodes} items=${r.items} tags=${r.tags} orphans=${r.orphans.length}`);
        maxTags = Math.max(maxTags, r.tags);
        if (!r.same || r.orphans.length) {
          td.dump("stressed.html", r.a);
          td.dump("fresh.html", r.b);
          td.dump("orphans.json", JSON.stringify(r.orphans));
          td.dump("checks.txt", checks.join("\n"));
          throw new Error(`frame ${i}: ${!r.same ? "dom differs from a fresh render" : `${r.orphans.length} orphan cache entries`}`);
        }
      }
    }
    model.reset();
    frame();
    frame();
    const end = { cache: cac.cache.size, nodes: nodeCount(container) };
    checks.push(`baseline ${JSON.stringify(baseline)} end ${JSON.stringify(end)}`);
    td.dump("checks.txt", checks.join("\n"));
    expect(end).toEqual(baseline);
    expect(maxTags).toBeGreaterThan(10);
  });

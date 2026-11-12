// leak tests without a dom. run alone: bun test ./tests/performance/leak.test.ts
import { expect, test } from "bun:test";
import { heapStats } from "bun:jsc";
import { testDataFor } from "../testdata";
import { html } from "../../mininext/mininext";

const testData = testDataFor(import.meta.path);
const heap = () => {
  Bun.gc(true);
  return heapStats().heapSize;
};

test("l01 lists of many different lengths do not stay in memory", () => {
  const { dump } = testData("l01-list-lengths");
  const warm = html`<ul>${[1, 2].map((i) => html`<li>${i}</li>`)}</ul>`.renderBackend();
  const before = heap();
  for (let n = 1; n <= 3000; n++) html`<ul>${Array.from({ length: n }, (_, i) => i)}</ul>`.renderBackend();
  const growth = heap() - before;
  dump("heap.json", JSON.stringify({ before, growth, warm: warm.length }));
  expect(growth).toBeLessThan(10 * 1024 * 1024);
});

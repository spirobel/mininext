// the stress page for the cdp test. it uses renderRoot (the real rAF loop)
// and the same random workload as the jsdom stress test.
import { renderRoot } from "../../mininext/browser";
import { createModel } from "../stress-model";

const container = document.getElementById("root")!;
const model = createModel(Number(new URLSearchParams(location.search).get("seed") ?? 1));
const cac = { cache: new Map<string, any>(), cursor: "root" };
let running = false;
let frames = 0;

renderRoot({
  container,
  cac,
  component: () => {
    frames++;
    if (running) model.mutate();
    return model.app();
  },
});
// registered after renderRoot, so it runs after the render in each frame
requestAnimationFrame(function interact() {
  if (running) model.interact(container);
  requestAnimationFrame(interact);
});
const nextFrames = (n: number) =>
  new Promise<void>((done) => {
    const step = () => (--n <= 0 ? done() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

(window as any).__stress = {
  get frames() {
    return frames;
  },
  start() {
    running = true;
  },
  async stop() {
    running = false;
    model.reset();
    await nextFrames(5);
  },
  // pause, let the dom catch up with the state, compare with a fresh render, go on
  async check() {
    const was = running;
    running = false;
    await nextFrames(2);
    const r = model.check(container, cac.cache, "root");
    running = was;
    return { same: r.same, orphans: r.orphans.length, cache: r.cache, nodes: r.nodes, items: r.items, a: r.same ? "" : r.a.slice(0, 3000), b: r.same ? "" : r.b.slice(0, 3000) };
  },
};

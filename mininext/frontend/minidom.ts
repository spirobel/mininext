import type { CacheAndCursor, CacheObject } from "./minicache";
import { makeNewMini, type Mini, type MiniHtmlString } from "../mininext";

export type RootOptions = {
  component: (mini: Mini) => MiniHtmlString;
  container: HTMLElement;
  cac?: CacheAndCursor;
};
let roots: RootOptions[] = [];
export function renderRoot(options: RootOptions) {
  roots.push(options);
  startRafLoop();
}
let rafRunning = false;
function startRafLoop() {
  if (rafRunning) return;
  rafRunning = true;
  function loop() {
    for (const root of roots) {
      let { component, cac } = root;
      if (!cac) {
        cac = {
          cache: new Map<string, CacheObject>(),
          cursor: crypto.randomUUID(),
        };
      }
      const mini = makeNewMini(cac);
      const evaluated = component(mini);
      const resolved = evaluated.resolve(mini);
      root.cac = resolved.render(root.container, cac);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

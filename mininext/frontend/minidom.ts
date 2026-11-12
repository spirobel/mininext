import type { CacheAndCursor, CacheObject } from "../minicache";
import { makeNewMini, type Mini, type MiniHtmlString } from "../core";

export type RootOptions = {
  component: (mini: Mini) => MiniHtmlString;
  container: HTMLElement;
  cac?: CacheAndCursor;
};
let roots: RootOptions[] = [];
let rootCount = 0;
export function renderRoot(options: RootOptions) {
  // hmr runs the entry again: swap the component, keep the cache (state)
  const old = roots.find((root) => root.container === options.container);
  if (old) old.component = options.component;
  else roots.push(options);
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
          cursor: `r${rootCount++}`,
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

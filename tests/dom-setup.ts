// jsdom is a dev dependency. JSDOM_PATH can point at another copy.
const JSDOM_PATH = process.env.JSDOM_PATH ?? "jsdom";
const { JSDOM, VirtualConsole } = await import(JSDOM_PATH);
// the fuzz tests put random text into <style>. a browser ignores bad css,
// jsdom prints a stack trace for each one. drop only that message.
const virtualConsole = new VirtualConsole();
virtualConsole.sendTo(console, { omitJSDOMErrors: true });
virtualConsole.on("jsdomError", (error: Error) => {
  if (!error.message.includes("Could not parse CSS stylesheet")) console.error(error);
});
export const dom = new JSDOM("<!doctype html><html><body></body></html>", { virtualConsole });
const w = dom.window;
for (const k of [
  "window",
  "document",
  "Node",
  "NodeFilter",
  "Element",
  "HTMLElement",
  "Comment",
  "Text",
  "DocumentFragment",
  "HTMLTemplateElement",
  "HTMLSelectElement",
  "HTMLInputElement",
  "Event",
  "MouseEvent",
  "MutationObserver",
]) {
  (globalThis as any)[k] = w[k];
}

// manual animation frames, so tests control each frame
let rafQueue: FrameRequestCallback[] = [];
(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
  rafQueue.push(cb);
  return rafQueue.length;
};
export function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb(0);
  }
}

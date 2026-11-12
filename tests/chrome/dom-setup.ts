// browser version of tests/dom-setup.ts: the dom is real, only the frames are manual
let rafQueue: FrameRequestCallback[] = [];
window.requestAnimationFrame = (cb: FrameRequestCallback) => {
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

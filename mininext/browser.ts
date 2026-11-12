// the frontend entry. it never imports backend code, so a browser bundle stays small
// and ships no server code. package.json points browser bundles of "@spirobel/mininext" here.
import { renderers } from "./core";
import { resolve } from "./frontend/miniresolve";

renderers.frontend = resolve;

export * from "./core";
export { renderRoot } from "./frontend/minidom";
export { createRouter, type Params } from "./frontend/minirouter";

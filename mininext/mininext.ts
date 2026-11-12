// the full entry for the server (and tests): the frontend entry plus the backend.
// browser bundles of "@spirobel/mininext" get browser.ts instead (package.json "browser" condition).
import { renderers } from "./core";
import { resolve } from "./backend/miniresolve";
import { build, newBackendMini, renderBackend } from "./backend/html";

renderers.backend = { resolve, build, render: renderBackend, newMini: newBackendMini };

export * from "./browser";
export { crawl, type MiniArtifact } from "./backend/static";

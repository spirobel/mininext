// injection tests for the backend render (strings, no dom).
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { testDataFor } from "../testdata";
import { html } from "../../mininext/mininext";

const testData = testDataFor(import.meta.path);
// what a browser would see: every tag and attribute name in the output
function shape(out: string) {
  const found: string[] = [];
  new HTMLRewriter()
    .on("*", { element: (el) => void found.push([el.tagName, ...[...el.attributes].map(([k]) => k)].join(" ")) })
    .transform(out);
  return found;
}

const PAYLOADS = [
  `<script>alert(1)</script>`,
  `"><img src=x onerror=alert(1)>`,
  `'><img src=x onerror=alert(1)>`,
  `" onmouseover="alert(1)`,
  `a onmouseover=alert(1)`,
  `</style><img src=x onerror=alert(1)>`,
  `</script><img src=x onerror=alert(1)>`,
  `</textarea><img src=x onerror=alert(1)>`,
  `--><img src=x onerror=alert(1)>`,
];

test("x01 text, attributes and raw text never gain tags or attributes", () => {
  const td = testData("x01-backend-shape");
  for (const p of PAYLOADS) {
    const out = html`<div title="${p}" class='${p}' id=${p}><p>${p}</p><style>.a{content:"${p}"}</style><script>let s = "${p}";</script><textarea>${p}</textarea></div>`.renderBackend();
    td.dump("last.html", out);
    expect(shape(out)).toEqual(["div title class id", "p", "style", "script", "textarea"]);
  }
});

test("x02 the same through skeleton.fill()", async () => {
  const td = testData("x02-fill");
  const skeleton = await html`<html><body><main>${null}</main><p title="${null}">x</p></body></html>`.build(undefined, td.dir);
  for (const p of PAYLOADS) {
    const out = await new Response(skeleton.fill(p, p)).text();
    td.dump("last.html", out);
    expect(shape(out)).toEqual(["html", "body", "main", "p title"]);
    const out2 = await new Response(skeleton.fill(html`<b>${p}</b>`, p)).text();
    expect(shape(out2)).toEqual(["html", "body", "main", "b", "p title"]);
  }
});

test("x03 a value can not add an attribute, a tag name or sit in a comment", () => {
  const td = testData("x03-bare");
  expect(() => html`<div ${"onload=alert(1)"}>x</div>`.renderBackend()).toThrow("attribute value");
  expect(() => html`<div data-${"x onload=alert(1)"}="1">x</div>`.renderBackend()).toThrow("attribute value");
  expect(() => html`<${"script"}>alert(1)</script>`.renderBackend()).toThrow("attribute value");
  expect(() => html`<!-- ${"--><script>alert(1)</script>"} -->`.renderBackend()).toThrow("attribute value");
  td.dump("ok.txt", "all threw");
});

test("x04 on* and srcdoc take no strings", () => {
  const td = testData("x04-on-string");
  expect(() => html`<button onclick="${"alert(1)"}">x</button>`.renderBackend()).toThrow("onclick");
  // the payment-links pattern: escapeHTML makes ' into &#x27;, the browser decodes it back before the js runs
  expect(() => html`<button onclick="editWallet('${"');alert(1);('"}')">x</button>`.renderBackend()).toThrow("onclick");
  expect(() => html`<iframe srcdoc="${"<script>alert(1)</script>"}"></iframe>`.renderBackend()).toThrow("srcdoc");
  // a handler function on the backend is dropped, nothing runs
  const out = html`<button onclick=${() => 1} class="b">x</button>`.renderBackend();
  td.dump("out.html", out);
  expect(out).toBe(`<button class="b">x</button>`);
});

test("x05 url attributes refuse javascript:, vbscript: and non-image data:", () => {
  const td = testData("x05-url");
  const bad = ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "vbscript:x", "data:text/html,<script>alert(1)</script>"];
  for (const url of bad) {
    expect(() => html`<a href="${url}">x</a>`.renderBackend()).toThrow("url");
    expect(() => html`<img src=${url} />`.renderBackend()).toThrow("url");
  }
  expect(() => html`<a href="${"java"}${"script:alert(1)"}">x</a>`.renderBackend()).toThrow("url");
  const out = html`<a href="${"/docs?a=1&b=2"}">x</a><img src="${"data:image/png;base64,AA"}" />`.renderBackend();
  td.dump("out.html", out);
  expect(out).toBe(`<a href="/docs?a=1&amp;b=2">x</a><img src="data:image/png;base64,AA" />`);
});

test("x06 plain objects can not pretend to be templates", () => {
  const td = testData("x06-duck");
  const evil = JSON.parse(`{"resolve":1,"stringLiterals":["<img src=x onerror=alert(1)>"],"values":[]}`);
  expect(() => html`<p>${evil}</p>`.renderBackend()).toThrow("object");
  expect(() => html`<p title="${evil}">x</p>`.renderBackend()).toThrow("object");
  const list = JSON.parse(`["<b>a</b>", "<img src=x onerror=alert(1)>"]`);
  const out = html`<p>${list}</p>`.renderBackend();
  td.dump("out.html", out);
  expect(shape(out)).toEqual(["p"]);
});

test("x07 a skeleton value that looks like a placeholder token is refused", async () => {
  const td = testData("x07-token");
  await expect(html`<p>${"__mini_null_0__"}</p><b>${null}</b>`.build(undefined, td.dir)).rejects.toThrow("placeholder");
});

test("x08 fill() checks values that go into attribute placeholders", async () => {
  const td = testData("x08-fill-attr");
  const skeleton = await html`<html><body><a href="${null}">x</a><p onclick="${null}">y</p><main>${null}</main></body></html>`.build(undefined, td.dir);
  expect(() => skeleton.fill("javascript:alert(1)", undefined, "ok")).toThrow("url");
  expect(() => skeleton.fill("/ok", "alert(1)", "ok")).toThrow("onclick");
  expect(() => skeleton.fill(html`<b>x</b>`, undefined, "ok")).toThrow("attribute");
  const out = await new Response(skeleton.fill("/docs?a=1&b=2", undefined, html`<b>${"<i>"}</b>`)).text();
  td.dump("out.html", out);
  expect(out).toContain(`<a href="/docs?a=1&amp;b=2">`);
  expect(out).toContain(`<main><b>&lt;i&gt;</b></main>`);
});

// ---- frontend bundles never contain backend code ----
// strings that only exist in mininext/backend/*. they survive minifying.
const BACKEND_MARKERS = ["mini_artifact/1", "__mini_null_", "__mininext/", "HTMLRewriter", "CryptoHasher", "mininext: fill() can only put"];
const LIB = `${import.meta.dir}/../../mininext`;
const markersIn = (js: string) => BACKEND_MARKERS.filter((m) => js.includes(m));
async function browserBundle(entry: string) {
  const r = await Bun.build({ entrypoints: [entry], target: "browser", minify: true });
  if (!r.success) throw new Error(r.logs.join("\n"));
  return (await Promise.all(r.outputs.map((o) => o.text()))).join("\n");
}

test("x09 the browser entry never imports a backend file (import graph)", () => {
  const td = testData("x09-import-graph");
  const scan = new Bun.Transpiler({ loader: "ts" });
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const imp of scan.scanImports(readFileSync(file, "utf8"))) {
      if (imp.path.startsWith(".")) walk(resolve(dirname(file), imp.path.endsWith(".ts") ? imp.path : `${imp.path}.ts`));
      else seen.add(`external:${imp.path}`);
    }
  };
  walk(`${LIB}/browser.ts`);
  const files = [...seen].map((f) => f.replace(`${LIB}/`, ""));
  td.dump("graph.txt", files.join("\n"));
  expect(files.filter((f) => f.startsWith("backend/") || f.startsWith("external:"))).toEqual([]);
});

test("x10 a frontend bundle from the browser entry has no backend code", async () => {
  const td = testData("x10-browser-bundle");
  writeFileSync(`${td.dir}/front.ts`, `import { html, renderRoot } from ${JSON.stringify(`${LIB}/browser.ts`)};\nrenderRoot({ container: document.body, component: () => html\`<p>\${1}</p>\` });\n`);
  writeFileSync(`${td.dir}/full.ts`, `import { html, renderRoot } from ${JSON.stringify(`${LIB}/mininext.ts`)};\nrenderRoot({ container: document.body, component: () => html\`<p>\${1}</p>\` });\n`);
  const front = await browserBundle(`${td.dir}/front.ts`);
  const full = await browserBundle(`${td.dir}/full.ts`);
  td.dump("front.js", front);
  td.dump("sizes.json", JSON.stringify({ front: front.length, full: full.length, fullMarkers: markersIn(full) }));
  expect(markersIn(full).length).toBeGreaterThan(0); // control: the markers do find backend code
  expect(markersIn(front)).toEqual([]);
});

test("x11 the package resolves to the browser entry when bundled for the browser", async () => {
  const td = testData("x11-package");
  const pkg = `${td.dir}/node_modules/@spirobel/mininext`;
  mkdirSync(pkg, { recursive: true });
  // build the package like npm publish would: tsc into dist, plus package.json
  const tsc = Bun.spawnSync([`${import.meta.dir}/../../node_modules/.bin/tsc`, "-p", `${import.meta.dir}/../../tsconfig.json`, "--outDir", `${pkg}/dist`]);
  expect(tsc.exitCode).toBe(0);
  writeFileSync(`${pkg}/package.json`, readFileSync(`${import.meta.dir}/../../package.json`, "utf8"));
  // a real app has its own package.json. without it, this folder (inside the mininext repo)
  // would resolve "@spirobel/mininext" to the repo itself (package self-reference).
  writeFileSync(`${td.dir}/package.json`, JSON.stringify({ name: "x11-app", type: "module" }));
  writeFileSync(`${td.dir}/front.ts`, `import { html, renderRoot } from "@spirobel/mininext";\nrenderRoot({ container: document.body, component: () => html\`<p>\${1}</p>\` });\n`);
  writeFileSync(`${td.dir}/index.ts`, `import { html } from "@spirobel/mininext";\nexport const page = html\`<p>\${null}</p>\`.build;\n`);
  const front = await browserBundle(`${td.dir}/front.ts`);
  const server = await Bun.build({ entrypoints: [`${td.dir}/index.ts`], target: "bun" });
  const serverJs = (await Promise.all(server.outputs.map((o) => o.text()))).join("\n");
  td.dump("front.js", front);
  expect(markersIn(serverJs).length).toBeGreaterThan(0); // the server still gets the backend
  expect(markersIn(front)).toEqual([]);
  // bun's dev server (bun --hot) resolves the package for the browser too
  const dev = await html`<!doctype html><html><head><script type="module" src="./front.ts"></script></head><body></body></html>`.build(undefined, td.dir);
  const srv = Bun.serve({ port: 0, routes: { ...dev.static_routes, "/": () => new Response(dev.fill()) } });
  try {
    const loaderRoute = Object.keys(dev.static_routes).find((r) => r.endsWith(".js"))!;
    const loader = await (await fetch(new URL(loaderRoute, srv.url))).text();
    const devJs = await (await fetch(new URL(loader.match(/\/_bun\/client\/[^"\\]+\.js/)![0], srv.url))).text();
    td.dump("dev.js", devJs);
    expect(devJs).toContain("renderRoot"); // it really bundled the package
    expect(markersIn(devJs)).toEqual([]);
  } finally {
    srv.stop(true);
  }
});

test("x12 skeleton.build(): the js a browser gets (production and dev) has no backend code", async () => {
  const td = testData("x12-served-js");
  writeFileSync(`${td.dir}/front.ts`, `import { html, renderRoot } from ${JSON.stringify(`${LIB}/browser.ts`)};\nrenderRoot({ container: document.body, component: () => html\`<p>\${1}</p>\` });\n`);
  const page = () => html`<!doctype html><html><head><script type="module" src="./front.ts"></script></head><body>${null}</body></html>`;
  // production
  const prev = Bun.env.NODE_ENV;
  Bun.env.NODE_ENV = "production";
  const prod = await page().build(undefined, td.dir);
  Bun.env.NODE_ENV = prev;
  const prodJs = (await Promise.all(Object.entries(prod.static_routes).filter(([r]) => r.endsWith(".js")).map(([, res]) => (res as Response).clone().text()))).join("\n");
  td.dump("prod.js", prodJs);
  expect(prodJs.length).toBeGreaterThan(0);
  expect(markersIn(prodJs)).toEqual([]);
  // dev: what bun's dev server sends for the page
  const dev = await page().build(undefined, td.dir);
  const server = Bun.serve({ port: 0, routes: { ...dev.static_routes, "/": () => new Response(dev.fill("x")) } });
  try {
    const loaderRoute = Object.keys(dev.static_routes).find((r) => r.endsWith(".js"))!;
    const loader = await (await fetch(new URL(loaderRoute, server.url))).text();
    const client = loader.match(/\/_bun\/client\/[^"\\]+\.js/)![0];
    const devJs = await (await fetch(new URL(client, server.url))).text();
    td.dump("dev.js", devJs);
    expect(markersIn(devJs)).toEqual([]);
  } finally {
    server.stop(true);
  }
});

// ---- app server code: the browser only gets what the frontend imports ----
function shopApp(dir: string) {
  writeFileSync(`${dir}/package.json`, JSON.stringify({ name: "shop", type: "module" }));
  writeFileSync(`${dir}/db.ts`, `import { Database } from "bun:sqlite";\nexport const DB_PASSWORD = "app-db-password-x13";\nexport const open = () => new Database(":memory:");\n`);
  writeFileSync(`${dir}/config.ts`, `export const STRIPE_KEY = "app-stripe-key-x13";\nexport const shopName = "x13 shop";\n`);
  writeFileSync(`${dir}/index.ts`, `import { open, DB_PASSWORD } from "./db";\nimport { STRIPE_KEY } from "./config";\nexport { open, DB_PASSWORD, STRIPE_KEY };\n`);
  writeFileSync(`${dir}/frontend.ts`, `import { html, renderRoot } from ${JSON.stringify(`${LIB}/browser.ts`)};\nimport { shopName } from "./config";\nrenderRoot({ container: document.body, component: () => html\`<h1>\${shopName}</h1>\` });\n`);
}
const APP_SECRETS = ["app-db-password-x13", "app-stripe-key-x13", "bun:sqlite"];

test("x13 app files the frontend does not import never reach the browser (prod and dev)", async () => {
  const td = testData("x13-app-server-code");
  shopApp(td.dir);
  const page = () => html`<!doctype html><html><head><script type="module" src="./frontend.ts"></script></head><body></body></html>`;
  const prev = Bun.env.NODE_ENV;
  Bun.env.NODE_ENV = "production";
  const prod = await page().build(undefined, td.dir);
  Bun.env.NODE_ENV = prev;
  const prodJs = (await Promise.all(Object.entries(prod.static_routes).filter(([r]) => r.endsWith(".js")).map(([, res]) => (res as Response).clone().text()))).join("\n");
  td.dump("prod.js", prodJs);
  expect(prodJs).toContain("x13 shop"); // control: the frontend and its config import are in the bundle
  // production: nothing from db.ts or index.ts, and the unused STRIPE_KEY export of config.ts is removed
  expect(APP_SECRETS.filter((s) => prodJs.includes(s))).toEqual([]);
  const dev = await page().build(undefined, td.dir);
  const server = Bun.serve({ port: 0, routes: { ...dev.static_routes, "/": () => new Response(dev.fill()) } });
  try {
    const loaderRoute = Object.keys(dev.static_routes).find((r) => r.endsWith(".js"))!;
    const loader = await (await fetch(new URL(loaderRoute, server.url))).text();
    const devJs = await (await fetch(new URL(loader.match(/\/_bun\/client\/[^"\\]+\.js/)![0], server.url))).text();
    td.dump("dev.js", devJs);
    expect(devJs).toContain("x13 shop");
    // dev: nothing from db.ts or index.ts (the frontend does not import them)
    expect(["app-db-password-x13", "bun:sqlite"].filter((s) => devJs.includes(s))).toEqual([]);
    // dev sends an imported file whole (no tree shaking): config.ts comes with its STRIPE_KEY.
    // so: keep secrets in files the frontend does not import.
    expect(devJs).toContain("app-stripe-key-x13");
  } finally {
    server.stop(true);
  }
});

test("x14 a frontend that imports server code with bun builtins does not build", async () => {
  const td = testData("x14-frontend-imports-db");
  shopApp(td.dir);
  writeFileSync(`${td.dir}/bad-frontend.ts`, `import { open } from "./db";\nconsole.log(open);\n`);
  const r = await Bun.build({ entrypoints: [`${td.dir}/bad-frontend.ts`], target: "browser", throw: false });
  td.dump("logs.txt", r.logs.map(String).join("\n"));
  expect(r.success).toBe(false);
  expect(r.logs.map(String).join("\n")).toContain("bun:sqlite");
});

// ---- the component model does not change by accident ----
// a tripwire, not a behavior test. it fails on every change to core.ts, also a comment.
// same value as: sha256sum mininext/core.ts
const CORE_SHA256 = "f0105cf461ebe44d6d871bd2f9ab7964753cf6c7e9f4555e64f6184e75582db2";

test("x15 core.ts, the component model, did not change", () => {
  const sha256 = new Bun.CryptoHasher("sha256").update(readFileSync(`${LIB}/core.ts`, "utf8").replaceAll("\r\n", "\n")).digest("hex");
  if (sha256 === CORE_SHA256) return;
  throw new Error(`mininext/core.ts changed.

core.ts is the component model. it is in every browser bundle, so a change here changes what all apps ship.

1. think first: must this change be in core.ts? code for the server or for dev mode belongs in mininext/backend/.
2. if the change is necessary, put the new hash into CORE_SHA256 in tests/quality_assurance/backend.test.ts:

   ${sha256}
`);
});

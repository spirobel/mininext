import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { html } from "../../mininext/mininext";
import { testDataFor } from "../testdata";
const testData = testDataFor(import.meta.path);

// real Bun.serve on port 0. bun only watches files inside cwd, so test-data must be inside the repo.
function app(name: string) {
  const { dir } = testData(name);
  mkdirSync(`${dir}/nested`, { recursive: true });
  writeFileSync(`${dir}/nested/front.ts`, `document.body.dataset.v = "A";`);
  writeFileSync(`${dir}/nested/style.css`, `body { color: red }`);
  return dir;
}
const page = () => html`<!doctype html>
  <html>
    <head>
      <link rel="stylesheet" href="./nested/style.css" />
      <script type="module" src="./nested/front.ts"></script>
    </head>
    <body><p>${null}</p></body>
  </html>`;

test("h01 dev fill serves our html with a stable loader, no polling", async () => {
  const dir = app("h01-hmr-dev");
  const skeleton = await page().build(undefined, dir);
  const server = Bun.serve({ port: 0, routes: { ...skeleton.static_routes, "/": () => new Response(skeleton.fill("hi")) } });
  try {
    const body = await (await fetch(new URL("/", server.url))).text();
    writeFileSync(`${dir}/served.html`, body);
    expect(body).toContain("<p>hi</p>");
    expect(body).not.toContain("./nested/front.ts");
    expect(body).not.toContain("setInterval");
    expect(body).toMatch(/<script src="\/__mininext\/\d+\.js"><\/script>/);
  } finally {
    server.stop(true);
  }
});

test("h02 loader returns the current hashed bun urls, also after an edit", async () => {
  const dir = app("h02-hmr-loader");
  const skeleton = await page().build(undefined, dir);
  const server = Bun.serve({ port: 0, routes: { ...skeleton.static_routes, "/": () => new Response(skeleton.fill("hi")) } });
  try {
    const body = await (await fetch(new URL("/", server.url))).text();
    const loaderUrl = body.match(/src="(\/__mininext\/\d+\.js)"/)![1]!;
    const loader1 = await (await fetch(new URL(loaderUrl, server.url))).text();
    writeFileSync(`${dir}/loader1.js`, loader1);
    expect(loader1).toContain("/_bun/client/");
    expect(loader1).toContain("/_bun/asset/");
    const client1 = loader1.match(/\/_bun\/client\/[^"]+\.js/)![0];
    expect((await fetch(new URL(client1, server.url))).status).toBe(200);
    writeFileSync(`${dir}/nested/front.ts`, `document.body.dataset.v = "B";`);
    await Bun.sleep(300);
    const loader2 = await (await fetch(new URL(loaderUrl, server.url))).text();
    writeFileSync(`${dir}/loader2.js`, loader2);
    const client2 = loader2.match(/\/_bun\/client\/[^"]+\.js/)![0];
    expect(client2).not.toBe(client1);
    expect(await (await fetch(new URL(client2, server.url))).text()).toContain('"B"');
  } finally {
    server.stop(true);
  }
});

test("h03 production build still bundles and fills", async () => {
  const dir = app("h03-prod");
  const prev = Bun.env.NODE_ENV;
  Bun.env.NODE_ENV = "production";
  try {
    const skeleton = await page().build(undefined, dir);
    const body = await new Response(skeleton.fill("hi")).text();
    writeFileSync(`${dir}/served.html`, body);
    expect(body).toContain("<p>hi</p>");
    expect(body).not.toContain("__mininext");
    expect(Object.keys(skeleton.static_routes).some((r) => r.endsWith(".js"))).toBe(true);
  } finally {
    Bun.env.NODE_ENV = prev;
  }
});

test("h04 dev build makes each local module script hot-accept by itself", async () => {
  const { dir } = testData("h04-auto-accept");
  mkdirSync(`${dir}/nested`, { recursive: true });
  writeFileSync(`${dir}/nested/front.ts`, `document.body.dataset.v = "A";`);
  writeFileSync(`${dir}/plain.ts`, `document.body.dataset.p = "1";`);
  const skeleton = await html`<!doctype html><html><head>
    <script type="module" src="./nested/front.ts"></script>
    <script type="module" src="plain.ts"></script>
    <script src="https://example.com/x.js"></script>
  </head><body></body></html>`.build(undefined, dir);
  const route = Object.keys(skeleton.static_routes).find((r) => /^\/__mininext\/\d+$/.test(r))!;
  const id = route.split("/").pop();
  const page = await Bun.file(`${dir}/.mininext-${id}.html`).text();
  const entry0 = await Bun.file(`${dir}/.mininext-${id}-0.ts`).text();
  const entry1 = await Bun.file(`${dir}/.mininext-${id}-1.ts`).text();
  writeFileSync(`${dir}/dev-page.html`, page);
  expect(page).toContain(`src="./.mininext-${id}-0.ts"`);
  expect(page).toContain(`src="./.mininext-${id}-1.ts"`);
  expect(page).toContain(`src="https://example.com/x.js"`);
  expect(entry0).toBe(`import "./nested/front.ts";\nimport.meta.hot.accept();\n`);
  expect(entry1).toBe(`import "./plain.ts";\nimport.meta.hot.accept();\n`);
  const server = Bun.serve({ port: 0, routes: { ...skeleton.static_routes, "/": () => new Response(skeleton.fill()) } });
  try {
    const loader = await (await fetch(new URL(`${route}.js`, server.url))).text();
    writeFileSync(`${dir}/loader.js`, loader);
    const client = loader.match(/\/_bun\/client\/[^"\\]+\.js/)![0];
    const js = await (await fetch(new URL(client, server.url))).text();
    expect(js).toContain('"A"');
    expect(js).toContain('"1"');
  } finally {
    server.stop(true);
  }
});

test("h05 websockets work next to skeleton routes, in production and dev", async () => {
  const { dir } = testData("h05-websocket");
  writeFileSync(`${dir}/front.ts`, `document.body.dataset.ok = "1";`);
  const results: Record<string, string> = {};
  for (const mode of ["production", "development"]) {
    const prev = Bun.env.NODE_ENV;
    Bun.env.NODE_ENV = mode;
    const skeleton = await html`<!doctype html><html><head><script type="module" src="./front.ts"></script></head><body>${null}</body></html>`.build(undefined, dir);
    Bun.env.NODE_ENV = prev;
    // the usual pattern: keep the server, upgrade /ws in fetch
    const server = Bun.serve({
      port: 0,
      routes: { ...skeleton.static_routes, "/": () => new Response(skeleton.fill("page")) },
      fetch(req, srv) {
        if (new URL(req.url).pathname === "/ws" && srv.upgrade(req)) return;
        return new Response("not found", { status: 404 });
      },
      websocket: { message: (ws, msg) => void ws.send(`echo:${msg}`) },
    });
    try {
      const page = await (await fetch(new URL("/", server.url))).text();
      const ws = new WebSocket(new URL("/ws", server.url.href.replace("http", "ws")));
      const reply = await new Promise<string>((ok, fail) => {
        ws.onopen = () => ws.send("hi");
        ws.onmessage = (e) => ok(String(e.data));
        ws.onerror = () => fail(new Error(`websocket failed in ${mode}`));
        setTimeout(() => fail(new Error(`no reply in ${mode}`)), 3000);
      });
      ws.close();
      results[mode] = `${reply} | page ok: ${page.includes("page")}`;
    } finally {
      server.stop(true);
    }
  }
  writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2));
  expect(results).toEqual({ production: "echo:hi | page ok: true", development: "echo:hi | page ok: true" });
});

test("h06 a local favicon works in production and dev, with no dead icon link", async () => {
  const { dir } = testData("h06-favicon");
  mkdirSync(`${dir}/nested`, { recursive: true });
  writeFileSync(`${dir}/nested/icon.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`);
  writeFileSync(`${dir}/nested/front.ts`, `document.body.dataset.ok = "1";`);
  const results: Record<string, { icons: string[]; local: boolean }> = {};
  for (const mode of ["production", "development"]) {
    const prev = Bun.env.NODE_ENV;
    Bun.env.NODE_ENV = mode;
    const skeleton = await html`<!doctype html><html><head><link rel="icon" type="image/svg+xml" href="./nested/icon.svg" /><script type="module" src="./nested/front.ts"></script></head><body>${null}</body></html>`.build(undefined, dir);
    Bun.env.NODE_ENV = prev;
    const server = Bun.serve({ port: 0, routes: { ...skeleton.static_routes, "/": () => new Response(skeleton.fill("page")) } });
    try {
      const body = await (await fetch(new URL("/", server.url))).text();
      // in dev the loader script writes the bundled tags into the page
      const loaderSrc = body.match(/<script src="(\/__mininext\/\d+\.js)">/)?.[1];
      const loader = loaderSrc ? await (await fetch(new URL(loaderSrc, server.url))).text() : "";
      const seen = body + JSON.parse(loader.match(/^document\.write\((.*)\);$/)?.[1] ?? '""');
      const hrefs = [...seen.matchAll(/<link [^>]*rel="icon"[^>]*href="([^"]+)"/g)].map((m) => m[1]!);
      const icons = await Promise.all(
        hrefs.map(async (h) => {
          const r = await fetch(new URL(h, server.url));
          return `${h.startsWith("./") ? h : "bundled"} ${r.status} ${r.headers.get("content-type")?.split(";")[0]}`;
        }),
      );
      writeFileSync(`${dir}/${mode}.html`, seen);
      results[mode] = { icons, local: body.includes("./nested/icon.svg") };
    } finally {
      server.stop(true);
    }
  }
  writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2));
  expect(results).toEqual({
    production: { icons: ["bundled 200 image/svg+xml"], local: false },
    development: { icons: ["bundled 200 image/svg+xml"], local: false },
  });
});

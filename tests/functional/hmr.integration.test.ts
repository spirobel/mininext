import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
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
  // nothing is written next to the skeleton
  expect(readdirSync(dir).sort()).toEqual(["nested", "plain.ts"]);
  const route = Object.keys(skeleton.static_routes).find((r) => /^\/__mininext\/\d+$/.test(r))!;
  const id = route.split("/").pop();
  // the dev files: .mininext/<pid>/ in the working folder, named after the file that calls build()
  const dev = `${process.cwd()}/.mininext/${process.pid}`;
  const name = `hmr.integration.test-${id}`;
  const page = await Bun.file(`${dev}/${name}.html`).text();
  const entry0 = await Bun.file(`${dev}/${name}-0.ts`).text();
  const entry1 = await Bun.file(`${dev}/${name}-1.ts`).text();
  writeFileSync(`${dir}/dev-page.html`, page);
  expect(page).toContain(`src="./${name}-0.ts"`);
  expect(page).toContain(`src="./${name}-1.ts"`);
  expect(page).toContain(`src="https://example.com/x.js"`);
  const up = relative(dev, dir);
  expect(entry0).toBe(`import "${up}/nested/front.ts";\nimport.meta.hot.accept();\n`);
  expect(entry1).toBe(`import "${up}/plain.ts";\nimport.meta.hot.accept();\n`);
  // the folder ignores itself in git
  expect(await Bun.file(`${process.cwd()}/.mininext/.gitignore`).text()).toBe("*\n");
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

// dev servers in their own bun process, started in the test folder like "bun --hot index.ts" in a project
const lib = `${import.meta.dir}/../../mininext`;
const startBun = (dir: string, ...args: string[]) => Bun.spawn([process.execPath, ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
async function waitFor(what: string, check: () => unknown, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await Bun.sleep(25);
  }
  throw new Error(`timeout: ${what}`);
}
async function portOf(dir: string, name: string) {
  await waitFor(`port of ${name}`, () => existsSync(`${dir}/port-${name}.txt`));
  return readFileSync(`${dir}/port-${name}.txt`, "utf8");
}
const saveLog = async (dir: string, name: string, proc: ReturnType<typeof startBun>) =>
  writeFileSync(`${dir}/${name}.log`, (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text()));
// the folders of the dev servers in a working folder
const devFolders = (dir: string) => readdirSync(`${dir}/.mininext`).filter((n) => n !== ".gitignore").sort();
// a server with the pages /one and /two. order: the order it builds them in
function pagesServer(dir: string, name: string, order: string[]) {
  writeFileSync(`${dir}/one.ts`, `document.body.dataset.page = "ONE";`);
  writeFileSync(`${dir}/two.ts`, `document.body.dataset.page = "TWO";`);
  writeFileSync(
    `${dir}/${name}.ts`,
    `import { html } from ${JSON.stringify(`${lib}/mininext.ts`)};
const pages: Record<string, any> = {};
for (const p of ${JSON.stringify(order)})
  pages[p] = await html\`<!doctype html><html><head><script type="module" src="\${"./" + p + ".ts"}"></script></head><body>\${null}</body></html>\`.build();
const server = Bun.serve({ port: 0, routes: { ...pages.one.static_routes, ...pages.two.static_routes,
  "/one": () => new Response(pages.one.fill("x")), "/two": () => new Response(pages.two.fill("x")) } });
await Bun.write("port-${name}.txt", String(server.port));
`,
  );
}
// which page script does a page of a server load
async function scriptOf(port: string, path: string) {
  const body = await (await fetch(`http://localhost:${port}${path}`)).text();
  const loader = await (await fetch(`http://localhost:${port}${body.match(/src="(\/__mininext\/\d+\.js)"/)![1]}`)).text();
  const js = await (await fetch(`http://localhost:${port}${loader.match(/\/_bun\/client\/[^"\\]+\.js/)![0]}`)).text();
  return [js.includes('"ONE"') && "ONE", js.includes('"TWO"') && "TWO"].filter(Boolean).join("+");
}

test("h07 two dev servers in one working folder serve their own pages", async () => {
  const { dir } = testData("h07-two-servers");
  writeFileSync(`${dir}/package.json`, JSON.stringify({ name: "h07-app", type: "module" }));
  // page 0 of server a is page 1 of server b
  pagesServer(dir, "a", ["one", "two"]);
  pagesServer(dir, "b", ["two", "one"]);
  const a = startBun(dir, "--hot", "a.ts");
  const b = startBun(dir, "--hot", "b.ts");
  try {
    const [portA, portB] = [await portOf(dir, "a"), await portOf(dir, "b")];
    const loads = {
      "a /one": await scriptOf(portA, "/one"),
      "a /two": await scriptOf(portA, "/two"),
      "b /one": await scriptOf(portB, "/one"),
      "b /two": await scriptOf(portB, "/two"),
    };
    writeFileSync(`${dir}/loads.json`, JSON.stringify(loads, null, 2));
    expect(loads).toEqual({ "a /one": "ONE", "a /two": "TWO", "b /one": "ONE", "b /two": "TWO" });
    expect(devFolders(dir)).toEqual([String(a.pid), String(b.pid)].sort());
    expect(readdirSync(`${dir}/.mininext/${a.pid}`).sort()).toEqual(["a-0-0.ts", "a-0.html", "a-1-0.ts", "a-1.html"]);
  } finally {
    a.kill();
    b.kill();
    await saveLog(dir, "a", a);
    await saveLog(dir, "b", b);
  }
}, 30_000);

test("h08 the next start removes the folder of a crashed server, a clean exit removes its own", async () => {
  const { dir } = testData("h08-cleanup");
  writeFileSync(`${dir}/package.json`, JSON.stringify({ name: "h08-app", type: "module" }));
  pagesServer(dir, "a", ["one", "two"]);
  pagesServer(dir, "b", ["one", "two"]);
  // builds a page and ends
  writeFileSync(
    `${dir}/once.ts`,
    `import { html } from ${JSON.stringify(`${lib}/mininext.ts`)};
await html\`<!doctype html><html><head><script type="module" src="./one.ts"></script></head><body></body></html>\`.build();
await Bun.write("once-folders.json", JSON.stringify(require("node:fs").readdirSync(".mininext").filter((n) => n !== ".gitignore").sort()));
`,
  );
  const a = startBun(dir, "--hot", "a.ts");
  let b: ReturnType<typeof startBun> | undefined;
  try {
    await portOf(dir, "a");
    expect(devFolders(dir)).toEqual([String(a.pid)]);
    // a crash: no cleanup can run
    a.kill(9);
    await a.exited;
    expect(devFolders(dir)).toEqual([String(a.pid)]);
    b = startBun(dir, "--hot", "b.ts");
    const portB = await portOf(dir, "b");
    expect(devFolders(dir)).toEqual([String(b.pid)]);
    // a process that ends by itself: it has a folder while it runs, and none after
    const once = startBun(dir, "once.ts");
    await once.exited;
    await saveLog(dir, "once", once);
    expect(JSON.parse(readFileSync(`${dir}/once-folders.json`, "utf8"))).toEqual([String(b.pid), String(once.pid)].sort());
    expect(devFolders(dir)).toEqual([String(b.pid)]);
    // the server that still runs is not touched
    expect(await scriptOf(portB, "/two")).toBe("TWO");
  } finally {
    a.kill();
    b?.kill();
    await saveLog(dir, "a", a);
    if (b) await saveLog(dir, "b", b);
  }
}, 30_000);

test("h09 a hot reload keeps the dev folder and does not write the entry file again", async () => {
  const { dir } = testData("h09-hot-reload-files");
  writeFileSync(`${dir}/package.json`, JSON.stringify({ name: "h09-app", type: "module" }));
  writeFileSync(`${dir}/front.ts`, `document.body.dataset.v = "A";`);
  const server = (h1: string) => `import { html } from ${JSON.stringify(`${lib}/mininext.ts`)};
const page = await html\`<!doctype html><html><head><script type="module" src="./front.ts"></script></head><body><h1>${h1}</h1>\${null}</body></html>\`.build();
const server = Bun.serve({ port: 0, routes: { ...page.static_routes, "/": () => new Response(page.fill("x")) } });
await Bun.write("port-index.txt", String(server.port));
`;
  writeFileSync(`${dir}/index.ts`, server("v0"));
  const bun = startBun(dir, "--hot", "index.ts");
  try {
    await portOf(dir, "index");
    const dev = `${dir}/.mininext/${bun.pid}`;
    const pageFile = `${dev}/index-0.html`;
    const entryFile = `${dev}/index-0-0.ts`;
    expect(readFileSync(pageFile, "utf8")).toContain("<h1>v0</h1>");
    expect(readFileSync(entryFile, "utf8")).toBe(`import "../../front.ts";\nimport.meta.hot.accept();\n`);
    const before = statSync(entryFile);
    // a backend edit: bun --hot runs index.ts again, build() writes the page again
    await Bun.sleep(50);
    writeFileSync(`${dir}/index.ts`, server("v1"));
    await waitFor("the page file after the backend edit", () => readFileSync(pageFile, "utf8").includes("<h1>v1</h1>"));
    const after = statSync(entryFile);
    writeFileSync(`${dir}/entry-stat.json`, JSON.stringify({ before: { ino: before.ino, mtimeMs: before.mtimeMs }, after: { ino: after.ino, mtimeMs: after.mtimeMs } }, null, 2));
    expect({ ino: after.ino, mtimeMs: after.mtimeMs }).toEqual({ ino: before.ino, mtimeMs: before.mtimeMs });
    expect(devFolders(dir)).toEqual([String(bun.pid)]);
    expect(readdirSync(dev).sort()).toEqual(["index-0-0.ts", "index-0.html"]);
  } finally {
    bun.kill();
    await saveLog(dir, "bun", bun);
  }
}, 30_000);

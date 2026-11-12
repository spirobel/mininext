import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { testDataFor } from "../testdata";
import * as mininext from "../../mininext/mininext";
const { html } = mininext;
const testData = testDataFor(import.meta.path);

test("s01 crawl writes every linked page and asset", async () => {
  const { dir } = testData("s01-static");
  mkdirSync(`${dir}/app/nested`, { recursive: true });
  writeFileSync(`${dir}/app/nested/front.ts`, `document.body.dataset.ok = "1";`);
  writeFileSync(`${dir}/app/nested/style.css`, `body { color: red }`);
  const prev = Bun.env.NODE_ENV;
  Bun.env.NODE_ENV = "production";
  const skeleton = await html`<!doctype html><html><head>
      <link rel="stylesheet" href="./nested/style.css" />
      <script type="module" src="./nested/front.ts"></script>
    </head><body>${null}</body></html>`.build(undefined, `${dir}/app`);
  Bun.env.NODE_ENV = prev;
  const server = Bun.serve({
    port: 0,
    routes: {
      ...skeleton.static_routes,
      "/": () => new Response(skeleton.fill(html`<a href="/docs">docs</a> <a href="https://example.com">x</a> <a href="/missing">m</a>`)),
      "/docs": () => new Response(skeleton.fill(html`<a href="/">home</a><a href="/docs#top">top</a>`)),
    },
  });
  try {
    await (mininext as any).crawl(server.url, `${dir}/dist`);
  } finally {
    server.stop(true);
  }
  const files = readdirSync(`${dir}/dist`, { recursive: true }).map(String).sort();
  writeFileSync(`${dir}/files.txt`, files.join("\n"));
  expect(files).toContain("index.html");
  expect(files).toContain("docs/index.html");
  expect(files.some((f) => f.endsWith(".js"))).toBe(true);
  expect(files.some((f) => f.endsWith(".css"))).toBe(true);
  expect(existsSync(`${dir}/dist/missing`)).toBe(false);
  const index = readFileSync(`${dir}/dist/index.html`, "utf8");
  expect(index).toMatch(/src="\/chunk-[^"]+\.js"/);
});

test("s02 crawl writes a mini_artifact manifest", async () => {
  const { dir } = testData("s02-manifest");
  const server = Bun.serve({
    port: 0,
    routes: {
      "/": () => new Response(`<a href="/docs">d</a><img src="/logo.svg">`, { headers: { "content-type": "text/html" } }),
      "/docs": () => new Response(`<a href="/">home</a>`, { headers: { "content-type": "text/html" } }),
      "/logo.svg": () => new Response(`<svg xmlns="http://www.w3.org/2000/svg"/>`, { headers: { "content-type": "image/svg+xml" } }),
    },
  });
  const sha = (data: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
  try {
    const a = await (mininext as any).crawl(server.url, `${dir}/a`, { version: "1.2.3" });
    const b = await (mininext as any).crawl(server.url, `${dir}/b`, { version: "1.2.3" });
    const c = await (mininext as any).crawl(server.url, `${dir}/c`, { version: "1.2.4" });
    const manifest = JSON.parse(readFileSync(`${dir}/a/mini_artifact.json`, "utf8"));
    expect(manifest).toEqual(a);
    expect(manifest.schema).toBe("mini_artifact/1");
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.files.map((f: any) => f.path)).toEqual(["docs/index.html", "index.html", "logo.svg"]);
    for (const f of manifest.files) expect(f.sha256).toBe(sha(readFileSync(`${dir}/a/${f.path}`)));
    // combined: sha256 of "<schema>\n<version>\n" + "<sha256>  <path>\n" per file
    const lines = manifest.files.map((f: any) => `${f.sha256}  ${f.path}\n`).join("");
    expect(manifest.sha256).toBe(sha(`mini_artifact/1\n1.2.3\n${lines}`));
    expect(b.sha256).toBe(a.sha256);
    expect(c.sha256).not.toBe(a.sha256);
    expect(c.files).toEqual(a.files);
  } finally {
    server.stop(true);
  }
});

test("s03 same skeleton builds to the same html (no random placeholders)", async () => {
  const { dir } = testData("s03-deterministic");
  const make = () => html`<html><body><p>${null}</p><b>${null}</b></body></html>`;
  const a = await make().build(undefined, dir);
  const b = await make().build(undefined, dir);
  writeFileSync(`${dir}/a.html`, a._rendered_skeleton.result);
  writeFileSync(`${dir}/b.html`, b._rendered_skeleton.result);
  expect(a._rendered_skeleton.result).toBe(b._rendered_skeleton.result);
});

test("s04 production: pages without js get no script tag and no empty js chunk", async () => {
  const { dir, dump } = testData("s04-no-empty-chunks");
  mkdirSync(`${dir}/app`, { recursive: true });
  writeFileSync(`${dir}/app/style.css`, `body { color: red }`);
  writeFileSync(`${dir}/app/front.ts`, `document.title = "js";`);
  const prev = Bun.env.NODE_ENV;
  Bun.env.NODE_ENV = "production";
  const build = async (head: string) => {
    const lits = Object.assign([`<!doctype html><html><head><title>x</title>${head}</head><body><h1>`, `</h1></body></html>`], { raw: [] }) as unknown as TemplateStringsArray;
    const sk = await html(lits, null).build(undefined, `${dir}/app`);
    const page = await new Response(sk.fill("hi")).text();
    const js = await Promise.all(Object.entries(sk.static_routes).filter(([r]) => r.endsWith(".js")).map(async ([r, res]) => [r, (await (res as Response).clone().text()).length] as const));
    const css = Object.keys(sk.static_routes).filter((r) => r.endsWith(".css"));
    return { page, js, css };
  };
  try {
    const none = await build("");
    const cssOnly = await build(`<link rel="stylesheet" href="./style.css">`);
    const withJs = await build(`<link rel="stylesheet" href="./style.css"><script type="module" src="./front.ts"></script>`);
    // only the empty chunk's own tag goes: inline and external scripts stay
    const inline = await build(`<script type="module">document.title = "inline";</script>`);
    const external = await build(`<script src="https://example.com/lib.js"></script>`);
    dump("pages.json", JSON.stringify({ none, cssOnly, withJs, inline, external }, null, 2));
    expect(inline.page).toContain(`<script type="module">document.title = "inline";</script>`);
    expect(inline.js).toEqual([]);
    expect(external.page).toContain(`<script src="https://example.com/lib.js"></script>`);
    expect(external.js).toEqual([]);
    expect(none.page).not.toContain("<script");
    expect(none.js).toEqual([]);
    expect(cssOnly.page).not.toContain("<script");
    expect(cssOnly.js).toEqual([]);
    expect(cssOnly.page).toMatch(/<link rel="stylesheet"[^>]*href="\/chunk-[^"]+\.css"/);
    expect(cssOnly.css.length).toBe(1);
    expect(withJs.page).toMatch(/<script type="module"[^>]*src="\/chunk-[^"]+\.js"/);
    expect(withJs.js.length).toBe(1);
    expect(withJs.js[0]![1]).toBeGreaterThan(0);
  } finally {
    Bun.env.NODE_ENV = prev;
  }
});

test("s05 crawl with a base path rewrites absolute links (github pages: /repo/)", async () => {
  const { dir, dump } = testData("s05-base");
  const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });
  const server = Bun.serve({
    port: 0,
    routes: {
      "/": () => html(`<link rel="stylesheet" href="/s.css"><a href="/docs">d</a><a href="docs/x">rel</a><a href="#top">t</a><a href="https://example.com/a">x</a><img src="/logo.svg">`),
      "/docs": () => html(`<a href="/">home</a>`),
      "/docs/x": () => html(`x`),
      "/s.css": () => new Response(`body{background:url(/bg.png)} i{background:url("/bg.png")} b{background:url(rel.png)}`, { headers: { "content-type": "text/css" } }),
      "/bg.png": () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
      "/rel.png": () => new Response(new Uint8Array([4]), { headers: { "content-type": "image/png" } }),
      "/logo.svg": () => new Response(`<svg xmlns="http://www.w3.org/2000/svg"/>`, { headers: { "content-type": "image/svg+xml" } }),
    },
  });
  try {
    await (mininext as any).crawl(server.url, `${dir}/plain`);
    await (mininext as any).crawl(server.url, `${dir}/based`, { base: "/repo/" });
  } finally {
    server.stop(true);
  }
  const files = (d: string) => readdirSync(d, { recursive: true }).map(String).filter((f) => !f.endsWith(".json")).sort();
  const index = readFileSync(`${dir}/based/index.html`, "utf8");
  const css = readFileSync(`${dir}/based/s.css`, "utf8");
  dump("based.html", index);
  dump("based.css", css);
  expect(files(`${dir}/based`)).toEqual(files(`${dir}/plain`));
  expect(index).toContain(`href="/repo/s.css"`);
  expect(index).toContain(`href="/repo/docs"`);
  expect(index).toContain(`src="/repo/logo.svg"`);
  expect(index).toContain(`href="docs/x"`);
  expect(index).toContain(`href="#top"`);
  expect(index).toContain(`href="https://example.com/a"`);
  expect(readFileSync(`${dir}/based/docs/index.html`, "utf8")).toContain(`href="/repo/"`);
  expect(css).toBe(`body{background:url(/repo/bg.png)} i{background:url("/repo/bg.png")} b{background:url(rel.png)}`);
  // without base nothing changes
  expect(readFileSync(`${dir}/plain/index.html`, "utf8")).toContain(`href="/docs"`);
});

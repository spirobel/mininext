// the jsdom suites, run again in real chrome. jsdom is a copy of the dom,
// so a test can pass there and still fail in a browser.
// the same test files are bundled for the browser. bun:test, ./dom-setup and ./testdata
// are swapped for the small versions next to this file. run alone:
//   bun test ./tests/chrome/dom.integration.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { openChrome } from "../cdp";
import { testDataFor } from "../testdata";
const testData = testDataFor(import.meta.path);

const SHIMS: Record<string, string> = {
  "bun:test": `${import.meta.dir}/bun-test.ts`,
  "../dom-setup": `${import.meta.dir}/dom-setup.ts`,
  "../testdata": `${import.meta.dir}/testdata.ts`,
};

// file -> number of tests in it, so a test that never ran is a failure
const FILES = { "functional/noderefs": 18, "quality_assurance/frontend": 8, "functional/stress": 3, "performance/writes": 10, "performance/scaling": 3 };
// scaling measures time. a busy machine (a ci runner) makes it fail, so it runs only
// in "test:perf" (PERF=1), alone on a quiet machine. test:browser runs the rest.
const TIMING = ["performance/scaling"];
const selected = Object.entries(FILES).filter(([file]) => TIMING.includes(file) === !!process.env.PERF);

for (const [file, count] of selected)
  test(
    `c01 ${file}.test.ts passes in chrome`,
    async () => {
      const { dir, dump } = testData(`c01-${file.replace("/", "-")}`);
      // the entry imports the test file, then runs what it registered
      writeFileSync(
        `${dir}/entry.ts`,
        `import { run } from ${JSON.stringify(SHIMS["bun:test"])};
import { dumps } from ${JSON.stringify(SHIMS["../testdata"])};
await import(${JSON.stringify(`${import.meta.dir}/../${file}.test.ts`)});
(window as any).__done = { results: await run(), dumps };
`,
      );
      const build = await Bun.build({
        entrypoints: [`${dir}/entry.ts`],
        target: "browser",
        // dev mode, like bun test: the twitch check (noderefs 14) only runs in dev
        define: { "process.env.NODE_ENV": '"development"' },
        plugins: [{ name: "chrome-shims", setup: (b) => void b.onResolve({ filter: /^(bun:test|\.\.\/dom-setup|\.\.\/testdata)$/ }, (a) => ({ path: SHIMS[a.path]! })) }],
      });
      expect(build.logs.filter((l) => l.level === "error").map(String)).toEqual([]);
      const js = await build.outputs[0]!.text();
      dump("bundle.js", js);
      expect(js).not.toContain("jsdom");
      const server = Bun.serve({
        port: 0,
        routes: {
          "/": new Response(`<!doctype html><html><head><title>${file}</title><script type="module" src="/t.js"></script></head><body></body></html>`, { headers: { "content-type": "text/html" } }),
          "/t.js": new Response(js, { headers: { "content-type": "text/javascript" } }),
          "/favicon.ico": new Response(null, { status: 204 }),
        },
      });
      const { cdp, close } = await openChrome(dir);
      try {
        await cdp.send("Page.navigate", { url: server.url.href });
        await cdp.waitFor("!!window.__done", `${file} tests finish`, 60_000);
        const { results, dumps } = await cdp.eval("window.__done");
        for (const d of dumps) {
          mkdirSync(`${dir}/${d.test}`, { recursive: true });
          writeFileSync(`${dir}/${d.test}/${d.file}`, d.text);
        }
        dump("results.json", JSON.stringify(results, null, 2));
        // f06 puts "/docs" and "mailto:a@b.c" in <img src> to check they are allowed.
        // chrome tries to load them as images (jsdom does not). only those two loads may fail.
        const expected = file === "quality_assurance/frontend" ? [new URL("/docs", server.url).href, "mailto:a@b.c"] : [];
        const errors = cdp.errors().filter((e) => !(e.params.entry?.source === "network" && expected.includes(e.params.entry.url)));
        dump("errors.json", JSON.stringify(errors, null, 2));
        expect(results.filter((r: any) => !r.ok).map((r: any) => `${r.name}: ${r.error}`)).toEqual([]);
        expect(results.length).toBe(count);
        expect(errors.map((e) => JSON.stringify(e.params).slice(0, 300))).toEqual([]);
      } finally {
        await close();
        server.stop(true);
      }
    },
    90_000,
  );

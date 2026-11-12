// real browser tests over the chrome devtools protocol (cdp), see tests/cdp.ts.
// bun --hot edits in chrome. run alone:
//   bun test ./tests/functional/hmr.browser.integration.test.ts
// CHROME=/path/to/chrome picks the browser.
import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { html } from "../../mininext/mininext";
import { CDP, openChrome } from "../cdp";
import { testDataFor } from "../testdata";
const testData = testDataFor(import.meta.path);

// the user's bug: under bun --hot, editing index.ts reruns build(). any runtime error fails this.
test(
  "b02 bun --hot in chrome: index.ts and frontend.ts edits, no runtime errors",
  async () => {
    const { dir } = testData("b02-hot-edits");
    const lib = `${import.meta.dir}/../../mininext`;
    // a token only this test knows: a page from another server can never pass a check
    const title = `b02 ${crypto.randomUUID().slice(0, 8)}`;
    writeFileSync(`${dir}/package.json`, JSON.stringify({ name: "b02-app", type: "module" }));
    const server = (h1: string) => `import { html } from ${JSON.stringify(`${lib}/mininext.ts`)};
const page = await html\`<!doctype html><html><head><title>${title}</title>
  <script type="module" src="./frontend.ts"></script></head>
  <body><h1>${h1} \${null}</h1><div id="app"></div></body></html>\`.build();
const server = Bun.serve({ port: 0, routes: { ...page.static_routes, "/": () => new Response(page.fill("x")),
  "/favicon.ico": () => new Response(null, { status: 204 }) } });
// port 0: the os picks a free port, the test reads it here
await Bun.write("port.txt", String(server.port));
`;
    const frontend = (label: string) => `import { renderRoot } from ${JSON.stringify(`${lib}/browser.ts`)};
renderRoot({ container: document.getElementById("app")!, component: (mini) => {
  const clicks = mini.state("clicks", 0);
  return mini.html\`<button onclick=\${() => clicks.value++}>${label} \${clicks.value}</button>\`;
} });
`;
    writeFileSync(`${dir}/index.ts`, server("v0"));
    writeFileSync(`${dir}/frontend.ts`, frontend("f0"));
    const bun = Bun.spawn([process.execPath, "--hot", "index.ts"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    let chrome: Awaited<ReturnType<typeof openChrome>> | undefined;
    let port = "";
    const steps: string[] = [];
    try {
      chrome = await openChrome(dir);
      for (let i = 0; i < 100 && !existsSync(`${dir}/port.txt`); i++) await Bun.sleep(50);
      port = readFileSync(`${dir}/port.txt`, "utf8");
      const cdp: CDP = chrome.cdp;
      const waitFor = (expr: string) => cdp.waitFor(`document.title === ${JSON.stringify(title)} && (${expr})`, expr);
      for (let i = 0; i < 50; i++) {
        await Bun.sleep(100);
        if ((await fetch(`http://localhost:${port}/`).catch(() => null))?.ok) break;
      }
      await cdp.send("Page.navigate", { url: `http://localhost:${port}/` });
      await waitFor(`document.querySelector("button")?.textContent === "f0 0"`);
      for (let v = 1; v <= 3; v++) {
        writeFileSync(`${dir}/index.ts`, server(`v${v}`));
        await waitFor(`document.querySelector("h1")?.textContent.startsWith("v${v}") && !!document.querySelector("button")`);
        steps.push(`server edit ${v}: h1 ok`);
        await Bun.sleep(300);
        writeFileSync(`${dir}/frontend.ts`, frontend(`f${v}`));
        await waitFor(`document.querySelector("button")?.textContent.startsWith("f${v}")`);
        steps.push(`frontend edit ${v}: button ok`);
        await Bun.sleep(300);
      }
    } finally {
      const errors = chrome?.cdp.errors() ?? [];
      writeFileSync(`${dir}/steps.txt`, steps.join("\n"));
      writeFileSync(`${dir}/errors.json`, JSON.stringify(errors, null, 2));
      await chrome?.close();
      bun.kill();
      const bunLog = (await new Response(bun.stdout).text()) + (await new Response(bun.stderr).text());
      writeFileSync(`${dir}/bun.log`, bunLog);
      // the server of this test must run without errors (a port in use shows here)
      expect(bunLog.split("\n").filter((l) => l.startsWith("error:"))).toEqual([]);
      expect(errors.map((e) => JSON.stringify(e.params).slice(0, 300))).toEqual([]);
    }
  },
  60_000,
);

// what a developer does all day under bun --hot. every backend edit must reload the page
// (the server's html changed), every frontend edit must hot-swap (no reload, state kept).
test(
  "b03 bun --hot in chrome: handler edit reloads with new html, frontend edit hot-swaps with state",
  async () => {
    const { dir } = testData("b03-hot-reload-kinds");
    const lib = `${import.meta.dir}/../../mininext`;
    // a token only this test knows: a page from another server can never pass a check
    const title = `b03 ${crypto.randomUUID().slice(0, 8)}`;
    writeFileSync(`${dir}/package.json`, JSON.stringify({ name: "b03-app", type: "module" }));
    const server = (h1: string, greeting: string) => `import { html } from ${JSON.stringify(`${lib}/mininext.ts`)};
const page = await html\`<!doctype html><html><head><title>${title}</title>
  <script type="module" src="./frontend.ts"></script></head>
  <body><h1>${h1} \${null}</h1><div id="app"></div></body></html>\`.build();
const server = Bun.serve({ port: 0, routes: { ...page.static_routes, "/": () => new Response(page.fill("${greeting}")),
  "/favicon.ico": () => new Response(null, { status: 204 }) } });
// port 0: the os picks a free port, the test reads it here
await Bun.write("port.txt", String(server.port));
`;
    const frontend = (label: string) => `import { renderRoot } from ${JSON.stringify(`${lib}/browser.ts`)};
renderRoot({ container: document.getElementById("app")!, component: (mini) => {
  const clicks = mini.state("clicks", 0);
  return mini.html\`<button onclick=\${() => clicks.value++}>${label} \${clicks.value}</button>\`;
} });
`;
    writeFileSync(`${dir}/index.ts`, server("skel0", "greet0"));
    writeFileSync(`${dir}/frontend.ts`, frontend("f0"));
    const bun = Bun.spawn([process.execPath, "--hot", "index.ts"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    let chrome: Awaited<ReturnType<typeof openChrome>> | undefined;
    let port = "";
    const steps: string[] = [];
    try {
      chrome = await openChrome(dir);
      for (let i = 0; i < 100 && !existsSync(`${dir}/port.txt`); i++) await Bun.sleep(50);
      port = readFileSync(`${dir}/port.txt`, "utf8");
      const cdp: CDP = chrome.cdp;
      const waitFor = (expr: string, what: string) => cdp.waitFor(`document.title === ${JSON.stringify(title)} && (${expr})`, what);
      const served = async () => {
        const text = await (await fetch(`http://localhost:${port}/`)).text();
        return text.includes(`<title>${title}</title>`) ? text.match(/<h1>[^<]*<\/h1>/)?.[0] : "not our server";
      };
      for (let i = 0; i < 50; i++) {
        await Bun.sleep(100);
        if ((await fetch(`http://localhost:${port}/`).catch(() => null))?.ok) break;
      }
      await cdp.send("Page.navigate", { url: `http://localhost:${port}/` });
      await waitFor(`document.querySelector("h1")?.textContent === "skel0 greet0" && document.querySelector("button")?.textContent === "f0 0"`, "first load");
      const mark = () => cdp.eval(`window.__sameDocument = true`);
      const sameDocument = () => cdp.eval(`window.__sameDocument === true`);

      // 1. route handler edit (fill text): the html response changes and the page reloads with it
      await mark();
      writeFileSync(`${dir}/index.ts`, server("skel0", "greet1"));
      for (let i = 0; i < 80 && (await served()) !== "<h1>skel0 greet1</h1>"; i++) await Bun.sleep(50);
      expect(await served()).toBe("<h1>skel0 greet1</h1>");
      await waitFor(`document.querySelector("h1")?.textContent === "skel0 greet1"`, "handler edit shows in the browser");
      expect(await sameDocument()).toBe(false); // it was a reload
      steps.push("1 handler edit: response + page updated");

      // 2. skeleton edit: same
      writeFileSync(`${dir}/index.ts`, server("skel1", "greet1"));
      await waitFor(`document.querySelector("h1")?.textContent === "skel1 greet1"`, "skeleton edit shows in the browser");
      steps.push("2 skeleton edit: page updated");

      // 3. frontend edit: hot swap, same document, state kept
      await waitFor(`!!document.querySelector("button")`, "button after reload");
      await cdp.eval(`document.querySelector("button").click(); document.querySelector("button").click();`);
      await waitFor(`document.querySelector("button")?.textContent === "f0 2"`, "two clicks counted");
      await mark();
      writeFileSync(`${dir}/frontend.ts`, frontend("f1"));
      await waitFor(`document.querySelector("button")?.textContent === "f1 2"`, "frontend edit hot-swapped with state");
      expect(await sameDocument()).toBe(true); // no reload
      steps.push("3 frontend edit: hot swap, state kept");
    } finally {
      const errors = chrome?.cdp.errors() ?? [];
      writeFileSync(`${dir}/steps.txt`, steps.join("\n"));
      writeFileSync(`${dir}/errors.json`, JSON.stringify(errors, null, 2));
      await chrome?.close();
      bun.kill();
      const bunLog = (await new Response(bun.stdout).text()) + (await new Response(bun.stderr).text());
      writeFileSync(`${dir}/bun.log`, bunLog);
      // the server of this test must run without errors (a port in use shows here)
      expect(bunLog.split("\n").filter((l) => l.startsWith("error:"))).toEqual([]);
      expect(errors.map((e) => JSON.stringify(e.params).slice(0, 300))).toEqual([]);
    }
    expect(steps.length).toBe(3);
  },
  60_000,
);

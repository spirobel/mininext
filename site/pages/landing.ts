import { html } from "../../mininext/mininext";
import { highlight } from "../highlight";
import { linesOfCode, trusted, version } from "../info";

export const header = (sub = "") => html`<table>
  <tr class="h">
    <td>
      <a class="logo" href="/">mini<span style="opacity:.7">next</span></a>
      <h1><a href="/">mininext Version ${version}</a></h1>
      ${sub}
    </td>
  </tr>
</table>`;

export const footer = () => html`<hr />
  <footer>
    <a href="/">home</a> &middot; <a href="/docs">docs</a> &middot;
    <a href="https://github.com/spirobel/mininext">github</a> &middot;
    <a href="https://github.com/spirobel/mininext/blob/master/examples/counter.ts">counter demo</a>
    <p>this page is a mininext app. the static copy was made with <code>crawl()</code>.</p>
  </footer>`;

const code = (src: string, lang = "ts") => html`<pre>${trusted(highlight(src, lang))}</pre>`;

const row = (directive: string, value: string, note = "") =>
  html`<tr><td class="e">${directive}</td><td class="v">${value}${note ? html` <i>(${note})</i>` : ""}</td></tr>`;

const indexPhp = `<?php
$name = $_GET["name"] ?? "world";
?>
<h1>hello <?= htmlspecialchars($name) ?></h1>`;

const indexTs = `Bun.serve({ routes: { "/": (req) => {
  const name = new URL(req.url)
    .searchParams.get("name") ?? "world";
  return new Response(page.fill(
    html\`<h1>hello \${name}</h1>\`));
}}});`;

const component = `// a component is a function that returns html.
// it gets the request from mini, nobody passes it down.
const greeting = (mini: Mini) => {
  const req = mini.state<Request>("req", null);
  return mini.html\`<p>from \${req.headers.get("host")}</p>\`;
};

// the async stuff happens in the route handler.
// templates are always sync.
async function route(req: Request) {
  const user = await db.user(req);
  const mini = page.mini();
  mini.state("req", req);
  return new Response(mini.fill(
    html\`<h1>\${user.name}</h1>\${greeting}\`));
}`;

const frontend = `let count = 0;

// this runs every frame. count is just a variable.
const app = () => html\`
  <button onclick=\${() => count++}>
    clicked \${count} times
  </button>\`;

renderRoot({ component: app, container });`;

const hydrateBackend = `// plain data, encoded as base64.
// base64 has no quotes or brackets,
// so it can't break out of the attribute.
const data = { user: "alice", count: 3 };
const b64 = Buffer.from(JSON.stringify(data))
  .toString("base64");

html\`<div id="app" data-hydrate="\${b64}"></div>\``;

const hydrateFrontend = `// decode it again. data is just data:
// no components, no code, no wire format.
const el = document.getElementById("app")!;
const bytes = Uint8Array.from(
  atob(el.dataset.hydrate!), (c) => c.charCodeAt(0));
const data = JSON.parse(
  new TextDecoder().decode(bytes));`;

// no timestamps: the static export must give the same mini_artifact hash each time
const hydration = { version, linesOfCode };

const install = "bun add @spirobel/mininext";
const start = `${install}\nbun --hot index.ts`;

const minimal = `// bun --hot index.ts
import { html } from "@spirobel/mininext";

const page = await html\`<!DOCTYPE html>
  <html><body>\${null}</body></html>\`.build();

Bun.serve({ port: 3000, routes: { "/": (req) => {
  const name = new URL(req.url)
    .searchParams.get("name") ?? "world";
  return new Response(page.fill(
    html\`<h1>hello \${name}</h1>\`));
}}});`;

export const landing = () => html`${header("index.php won. Now fresh in TypeScript.")}
  <h2>The other timeline</h2>
  <table>
    <tr><td class="v">
      <p>In 2005 you wrote <code>index.php</code>. You saved it. You pressed F5. It worked.
      The markup, the data and the logic were in one file, and anybody could read it.</p>
      <p>Then the web went another way. Build pipelines. Client components and server components.
      <code>"use client"</code>, <code>"use server"</code>. Hydration that serializes your component tree into a wire format.
      A framework that nobody on the team fully understands.</p>
      <p><b>mininext is the timeline where index.php won and got types.</b>
      Bun runs TypeScript directly. <code>html\`\`</code> is the template language.
      The whole library is ${linesOfCode} lines. You can read all of it in an afternoon.</p>
      <p>Like index.php, your server code stays on the server: the browser only gets the files your frontend imports.</p>
    </td></tr>
  </table>

  <div class="side">
    <div><div class="label">index.php (2005)</div>${code(indexPhp, "php")}</div>
    <div><div class="label">index.ts (mininext)</div>${code(indexTs)}</div>
  </div>

  <h2>Server components, since 1995</h2>
  <table>
    <tr><td class="v">
      <p>React Server Components run on the server, read the database right inside the component,
      and send the result to the browser. That is what PHP did in 1995.
      The difference is everything they added on top to get there.</p>
    </td></tr>
  </table>
  <table>
    <tr class="h"><th></th><th>PHP (2005)</th><th>RSC (2025)</th></tr>
    <tr><td class="e">renders on the server</td><td class="v">yes</td><td class="v">yes</td></tr>
    <tr><td class="e">database query in the template</td><td class="v">yes</td><td class="v">yes, in an async component</td></tr>
    <tr><td class="e">needs a bundler</td><td class="v">no</td><td class="v">yes</td></tr>
    <tr><td class="e">what goes over the wire</td><td class="v">html</td><td class="v">the RSC payload (Flight protocol)</td></tr>
    <tr><td class="e">directives at the top of files</td><td class="v">no</td><td class="v"><code>"use client"</code>, <code>"use server"</code></td></tr>
    <tr><td class="e">remote code execution through the wire format</td><td class="v">no wire format</td><td class="v">CVE-2025-55182</td></tr>
    <tr><td class="e">you can read all of it</td><td class="v">yes</td><td class="v">no</td></tr>
  </table>

  <h2>Try it in <span id="year">${new Date().getFullYear()}</span></h2>
  <script>document.getElementById("year").textContent = new Date().getFullYear();</script>
  <div class="try">
    <div class="install">
      <code>${install}</code>
      <button type="button" data-copy="${install}">copy</button>
    </div>
    <div class="label">index.ts</div>
    ${code(minimal)}
  </div>

  <h2>Configuration</h2>
  <table>
    <tr class="h"><th>Directive</th><th>Value</th></tr>
    ${row("server_api", "Bun.serve()")}
    ${row("templates", "html`` tagged template strings", "plain html, values get escaped")}
    ${row("function_coloring", "Off", "templates are sync, await in the route handler")}
    ${row("props_drilling", "Off", "mini.state() gets request data to any component")}
    ${row("virtual_dom", "Off")}
    ${row("hooks", "Off")}
    ${row("use_client / use_server", "Off")}
    ${row("frontend_render", "immediate mode", "requestAnimationFrame loop, like dear imgui")}
    ${row("dom_updates", "only nodes whose value changed")}
    ${row("background_tabs", "throttled by the browser")}
    ${row("hydration", "data in the first response, base64")}
    ${row("hot_reload", "bun --hot")}
    ${row("static_export", "crawl()", "fetches every route and writes the files")}
    ${row("runtime_dependencies", "0")}
    ${row("lines_of_code", String(linesOfCode), "counted when this page started")}
  </table>

  <h2>backend</h2>
  <table>
    <tr><td class="v">
      <p>in most backend frameworks the request and whatever you loaded from the database get threaded through
      the business logic and then through every view. after a while everything is coupled to the shape of your data.</p>
      <p>mininext resolves templates at the very end. you can put functions into a template, those functions
      return more html, and they grab the request from <code>mini</code> instead of getting it passed down.
      that keeps views, logic and data apart. do your awaits in the route handler. templates are always sync,
      so you never end up with half your components async and the other half not.</p>
    </td></tr>
  </table>
  ${code(component)}

  <h2>frontend</h2>
  <table>
    <tr><td class="v">
      <p>i got tired of annotating every state change the way react and the others want you to.
      the mininext frontend is immediate mode, like dear imgui: your component runs every frame in a
      requestAnimationFrame loop and just reads plain variables. when the tab is in the background the browser
      slows that loop down on its own, so it costs nothing while nobody is looking.</p>
      <p>it only touches the dom nodes whose value actually changed. that is what react's virtual dom is for,
      but here you don't tell it when state changed: every frame it compares each value with the last one and
      writes only the difference. the box on the right is running that way right now.</p>
    </td></tr>
  </table>
  <div class="side">
    <div><div class="label">frontend.ts</div>${code(frontend)}</div>
    <div>
      <div class="label">live (this page, running now)</div>
      <div id="live" data-hydrate="${Buffer.from(JSON.stringify(hydration)).toString("base64")}">
        <table><tr><td class="v">loading the frontend…</td></tr></table>
      </div>
    </div>
  </div>

  <h2>security</h2>
  <table>
    <tr><td class="v">
      <p>react server components send a component tree over their own wire format, and in december 2025 a bug
      in that format let anyone run code on the server (CVE-2025-55182). svelte ssr had a related problem:
      <code>JSON.stringify()</code> output went straight into the html and could break out of it
      (<a href="https://www.sentinelone.com/vulnerability-database/cve-2026-27902/">CVE-2026-27902</a>).
      the more machinery sits between your code and the html, the more room there is for bugs like that.</p>
      <p>mininext doesn't serialize components at all. if the browser needs data, it goes into the first
      response as base64 in an attribute and the frontend decodes it. templates only take html, sync functions
      and plain values.</p>
    </td></tr>
  </table>
  <div class="side">
    <div><div class="label">backend: put data in the page</div>${code(hydrateBackend)}</div>
    <div><div class="label">frontend: read it back</div>${code(hydrateFrontend)}</div>
  </div>

  <h2>try it</h2>
  <div class="copyable">
    ${code(start, "sh")}
    <button type="button" data-copy="${start}">copy</button>
  </div>
  <p class="credit">the <a href="/docs">docs</a> have getting started, architecture, patterns and the api reference.</p>
  ${footer()}`;

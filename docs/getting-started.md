# Getting Started with Mininext

Mininext is a web framework that brings the immediate mode GUI paradigm to the web.
It automatically throttles rendering when the tab isn't visible, via the browser requestAnimationFrame throttling.

## install

```bash
mkdir my-app
cd my-app
bun init
bun add @spirobel/mininext
```

## project structure

```
my-app/
├── index.ts
├── frontend.ts
├── package.json
```

## server

Create `index.ts`:

```typescript
import { html } from "@spirobel/mininext";

const skeleton = await html`<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>My App</title>
    </head>
    <body data-hydrate="${null}">
      <div id="root"></div>
      <script type="module" src="./frontend.ts"></script>
    </body>
  </html>`.build();

function makeRoutes() {
  return {
    "/": { GET: homeRoute },
  };
}

async function homeRoute(req: Request) {
  const data = { message: "Hello", timestamp: new Date().toISOString() };
  const hydrate = Buffer.from(JSON.stringify(data)).toString("base64");
  return new Response(skeleton.fill(hydrate));
}

Bun.serve({ port: 3000, routes: makeRoutes() });
```

## frontend

Create `frontend.ts`:

```typescript
import { html, renderRoot } from "@spirobel/mininext";

function getHydratedData() {
  const b64 = document.body.dataset.hydrate;
  if (!b64) throw new Error("No data");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}

const container = document.getElementById("root");
const data = getHydratedData();

renderRoot({
  component: () =>
    html`<div>
      <h1>${data.message}</h1>
      <p>${data.timestamp}</p>
    </div>`,
  container,
});
```

## Run

```bash
bun run --hot index.ts
```

Visit `http://localhost:3000`.

### create Reusable Components

```typescript
// components/card.ts
export function Card({ title, children }: { title: string; children: any }) {
  return html`<div class="card">
    <h2>${title}</h2>
    <div class="card-content">${children}</div>
  </div>`;
}
```

## Hot Reload in Development

Run the server with `bun --hot index.ts`. Nothing else to set up.

- frontend files: bun's own dev server bundles them and does hot module reload.
  a code change is swapped in without a page reload, and `renderRoot` keeps the state of the root. you write no hmr code: in dev, `build()` gives each local `<script type="module">` a small entry file that accepts hot updates.
- backend files: `bun --hot` runs the server again and swaps the routes. pages that use a changed skeleton reload.
- start bun from your project folder. the dev files go to `.mininext/` in the folder bun starts in.
- `.mininext/<pid>/` holds what bun's dev server bundles, because it needs real files: one `<file>-<n>.html` for each page, named after the file that calls `build()`, and one small `.ts` entry for each module script. the folder ignores itself in git and is safe to delete.

## Static Site

There is no second build system. Start your normal server in production mode and crawl it.
`crawl()` fetches every page, follows each same-origin `href` and `src`, and writes the files.

```typescript
// export.ts. run with: bun export.ts
process.env.NODE_ENV = "production";
const { crawl } = await import("@spirobel/mininext");
const { makeRoutes } = await import("./routes");

const server = Bun.serve({ port: 0, routes: makeRoutes() });
const artifact = await crawl(server.url, "./dist", { version: "1.0.0" });
server.stop();
```

`/docs` becomes `dist/docs/index.html`, so any static host can serve it. Pages that no link points to can be added: `crawl(url, dir, { paths: ["/", "/404"] })`.

`crawl()` also writes `dist/mini_artifact.json`, the manifest of this artifact:

```json
{
  "schema": "mini_artifact/1",
  "version": "1.0.0",
  "sha256": "<one hash for the whole artifact>",
  "files": [{ "path": "index.html", "sha256": "<hash of the file>" }]
}
```

The files are sorted by path. The combined `sha256` is the sha256 of `mini_artifact/1\n<version>\n` followed by one `<sha256>  <path>\n` line per file. Those lines are `sha256sum` format, so you can check an artifact without mininext:

```bash
cd dist && jq -r '.files[] | "\(.sha256)  \(.path)"' mini_artifact.json | sha256sum -c
```

## Resources

- [GitHub Repository](https://github.com/spirobel/mininext)
- [API Reference](./api-reference.md)
- [Architecture Guide](./architecture.md)
- [Usage Patterns](./patterns.md)

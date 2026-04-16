# Getting Started with Mininext

Mininext is a web framework that brings the immediate mode GUI paradigm to the web.
It automatically throttles rendering when the tab isn't visible, via the browser requestAnimationFrame throttling.

## Install

```bash
mkdir my-app
cd my-app
bun init
bun add @spirobel/mininext
```

## Project Structure

```
my-app/
├── server.ts
├── frontend.ts
├── package.json
```

## Server

Create `server.ts`:

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
  const hydrate = btoa(JSON.stringify(data));
  return new Response(skeleton.fill(hydrate));
}

Bun.serve({ port: 3000, routes: makeRoutes() });
```

## Frontend

Create `frontend.ts`:

```typescript
import { html, renderRoot } from "@spirobel/mininext";

function getHydratedData() {
  const b64 = document.body.dataset.hydrate;
  if (!b64) throw new Error("No data");
  return JSON.parse(atob(b64));
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
bun run --hot server.ts
```

Visit `http://localhost:3000`.

### Create Reusable Components

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

Mininext supports hot reload for development:

```typescript
// In server.ts
globalThis.minireload = () => {
  server.reload({
    routes: makeRoutes(),
    port: 3000,
  });
};
```

Then run with `bun run --hot server.ts` to automatically reload on file changes.

## Troubleshooting

**Issue**: Module not found errors

- **Solution**: Make sure your frontend script src path matches: `<script type="module" src="./frontend.ts"></script>`

and is not nested like:

`<script type="module" src="./nested/frontend.js"></script>`

that is a current limitation of bun build() with in memory files.

## Resources

- [GitHub Repository](https://github.com/spirobel/mininext)
- [API Reference](./api-reference.md)
- [Architecture Guide](./architecture.md)
- [Usage Patterns](./patterns.md)

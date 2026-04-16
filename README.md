# mininext

## mininext Architecture

Mininext is a web framework that brings the immediate mode GUI paradigm to the web.
It automatically throttles rendering when the tab isn't visible, via the browser requestAnimationFrame throttling.

read the [architecture document](./docs/architecture.md) for more details

## Getting Started

```typescript
import { html } from "../mininext/mininext";

// ── static skeleton html ────────────────────────────────────────────────
const skeleton = await html`<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Counter</title>
      <style>
        body {
          font-family: sans-serif;
          text-align: center;
          padding: 50px;
        }
        h1 {
          font-size: 4rem;
        }
        button {
          font-size: 1.5rem;
          padding: 15px 30px;
        }
      </style>
    </head>
    <body>
      <h1>Counter demo</h1>
      <div id="count">${null}</div>

      <form method="POST" action="/">
        <button type="submit">+1</button>
      </form>

      <p>(form submit full page reload, zero JS on frontend)</p>
    </body>
  </html>`.build();

let globalCounter = 0;

// ── request handler ─────────────────────────────────────────────────────
function fetch(req: Request) {
  // increment only on POST (form submit)
  if (req.method === "POST") {
    globalCounter++;
    return Response.redirect("/", 303);
  }

  return new Response(
    skeleton.fill(html`<div id="count">${globalCounter}</div>`),
  );
}

// ── server ──────────────────────────────────────────────────────────────
const server = Bun.serve({
  routes: skeleton.static_routes,
  fetch,
});

// hmr support
globalThis.minireload = () => {
  server.reload({
    routes: skeleton.static_routes,
    fetch,
  });
};

console.log("Counter server running at http://localhost:3000");
```

for a frontend counter example consult the [counter demo repo](https://github.com/spirobel/counter)

## install commands

To install

```bash
bun add @spirobel/mininext
```

syntax highlighting:

[mininext vs code extension](https://marketplace.visualstudio.com/items?itemName=spirobel.mini-next-vs-code)

github:

[mininext github repo](https://github.com/spirobel/mininext)

quickstart:

```bash
bun create spirobel/counter yournewproject
```

if you don't have bun installed, run first:

```bash
curl -fsSL https://bun.sh/install | bash # for macOS, Linux, and WSL
```

To install dependencies:

```bash
bun install
```

dev:

```bash
bun run --hot counter.ts
```

production:

```bash
NODE_ENV=production bun run counter.ts
```

## Tutorial

If you understand these 3 basic concepts you can build your own webapp with mininext:

1. html + css
2. templating
3. you can use data inside of your html templates

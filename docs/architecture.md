# Mininext Architecture

Mininext is a web framework that brings the immediate mode GUI paradigm to the web.
It automatically throttles rendering when the tab isn't visible, via the browser requestAnimationFrame throttling.

## Immediate Mode GUI

Mininext re-renders everything every frame using a `requestAnimationFrame` loop. This is a similar approach as Dear Imgui.

When you call `renderRoot()`, it starts a loop:

```typescript
function renderLoop() {
  const template = component(mini); // your code runs every frame
  template.resolve(mini).render(container); // writes only the values that changed
  requestAnimationFrame(renderLoop);
}
```

The first frame parses each template once and keeps references to its nodes. Later frames write a changed value straight to its node (`Text.nodeValue`, `setAttribute`, a property). A frame with no change writes nothing to the DOM, so the browser has no layout or style work to do.

The browser throttles `requestAnimationFrame` when the tab isn't visible:

- Active tab: 60 FPS
- Background tab: ~1 FPS
- No CPU / GPU waste when the user isn't looking

## No Caching, No Memoization

Because everything re-renders every frame, you don't need:

- `useMemo`
- `useCallback`
- `React.memo`
- Dependency arrays
- Reconciliation algorithms

Components are functions that return HTML. They run every frame.

## Hydration

Hydration means embedding data in the initial HTML response.

Server side:

```typescript
import { html } from "@spirobel/mininext";

const skeleton = await html`<!DOCTYPE html>
  <html>
    <head>
      <title>Mininext App</title>
    </head>
    <body data-hydrate="${null}">
      <div id="root"></div>
      <script type="module" src="./frontend.ts"></script>
    </body>
  </html>`.build();

const data = { count: 42, name: "Zoë" };
const hydrate = Buffer.from(JSON.stringify(data)).toString("base64"); // utf-8 safe
const html = skeleton.fill(hydrate);
```

Client side:

```typescript
const bytes = Uint8Array.from(atob(document.body.dataset.hydrate!), (c) => c.charCodeAt(0));
const data = JSON.parse(new TextDecoder().decode(bytes));
```

This drastically reduces render time compared to naive client-side rendering. Achieves same or better performance than React Server Components / SSR, while minimizing attack surface & complexity.

Sidenote: instead of embedding JSON directly it should be base64 encoded.
Study this [svelte ssr cve](https://www.sentinelone.com/vulnerability-database/cve-2026-27902/) to understand why `JSON.stringify()` output directly embedded in HTML is a bad idea.

Mininext only allows HTML, synchronous functions that return HTML, and primitive data types to be embedded in HTML. It will prevent you from making this mistake.

## Template System

The `html` template literal creates HTML with embedded expressions:

```typescript
const name = "World";
const greeting = html`<h1>Hello, ${name}!</h1>`;
```

Expressions are HTML-escaped. Functions in templates run every render:

```typescript
html`<div>${() => Date.now()}</div>`; // Updates every frame
```

## Quality Assurance

Server code and browser code are separate entry points, so server code, yours or ours, only reaches the browser when your frontend imports its file: keep secrets in files the frontend does not import.

### Values

Only the literal parts of a template are html. Every `${value}` is data, and these rules hold on the backend and the frontend:

- **Text** is escaped (backend) or written with `Text.nodeValue` (frontend). It never becomes markup.
- **Attribute values** are escaped and quoted (backend) or set with `setAttribute` (frontend). A value can not close the quotes or add an attribute.
- **A value must be an attribute value** inside a tag: `<div ${x}>`, `<${tag}>` and values in html comments throw an error.
- **`on*` attributes take a function**: `onclick=${() => go(id)}`. A string throws, because the browser would run it as code. On the backend the handler is left out. `srcdoc` takes no values.
- **url attributes** (`href`, `src`, `action`, `formaction`, ...) refuse `javascript:`, `vbscript:` and `data:` urls (`data:image/` is allowed). Browsers ignore spaces and control characters in the scheme, so those are removed before the check.
- **Plain objects are refused.** Only `html```` makes templates (they carry a symbol that json can not have). Arrays become lists, and their items follow the same rules.
- **`fill()`** checks values that go into an attribute placeholder like `href="${null}"` with the same rules.
- `<style>`, `<textarea>` and `<title>` values stay text.

The tests for these rules are in `tests/quality_assurance/frontend.test.ts` and `tests/quality_assurance/backend.test.ts`.

## State Management

State is just variables:

```typescript
let count = 0;

function Counter() {
  return html`<button onclick="${() => count++}">${count}</button>`;
}

renderRoot({ component: Counter, container });
```

No hooks, no context, no providers.

## Comparison with React

| Aspect      | React                        | Mininext       |
| ----------- | ---------------------------- | -------------- |
| Rendering   | Virtual DOM + reconciliation | Immediate mode |
| State       | Hooks, context               | Variables      |
| Performance | Memoization                  | RAF throttling |

## Example

```typescript
import { html, renderRoot } from "@spirobel/mininext";

let count = 0;

function App() {
  return html`
    <div>
      <h1>Counter: ${count}</h1>
      <button onclick="${() => count++}">Increment</button>
    </div>
  `;
}

renderRoot({ component: App, container: document.getElementById("root") });
```

The `App` function runs every frame. When `count` changes, the next frame shows it.

## Routing

### Client-Side Router

Mininext provides a simple hash-based router:

```typescript
const router = createRouter({
  "/": homeComponent,
  "/users/:id": userComponent,
});
```

**How it works:**

1. `router.component` runs in every frame of the `renderRoot` loop. It reads `window.location.hash`. There is no `hashchange` listener.
2. It drops a `?query` after the path, and matches the path against the routes.
3. It calls the handler of the matched route with the decoded params.
4. If no route matches, it renders nothing and warns one time for that path. The loop keeps running.

### Route Pattern Matching

```typescript
// Pattern: /users/:id
// URL: #/users/123
// Result: { id: "123" }

// Pattern: /posts/:postId/comments/:commentId
// URL: #/posts/42/comments/99
// Result: { postId: "42", commentId: "99" }
```

**Matching algorithm:**

1. The routes are sorted one time, like in the Bun router: static segments before `:params`, and `/*` routes last (a longer prefix first). The order of the keys in the object does not matter.
2. For each segment of the path:
   - If the route segment starts with `:`, capture it as a param (percent decoded, so `#/users/John%20Doe` gives `"John Doe"`)
   - Otherwise, it must match exactly
3. Return the params of the first route that matches. A `/*` route also gives `params["*"]`, the rest of the path.
4. `link()` and `navigate()` percent encode the params, so every value comes back the same.

### Why Hash-Based?

- **No server configuration needed**: Works with static hosting
- **Simple**: No complex URL parsing
- **Browser history**: Back/forward buttons work
- **Plays well with backend Multi Page App Routing** (based on standard Bun router)

**Trade-off:** URLs look like `example.com/#/path` instead of `example.com/path`

## Backend Routing

For Backend routing we rely on the standard Bun router (`Bun.serve`). We use it with html skeletons that have `${null}` placeholders. These placeholders are dynamically filled in on each request.

### Skeletons

A skeleton is an HTML template built once at startup. `${null}` creates a placeholder that gets filled per-request.

```typescript
// examples/counter.ts
const skeleton = await html`<!DOCTYPE html>
  <html>
    <body>
      <main>${null}</main>
    </body>
  </html>`.build();
```

`build()` resolves the template, renders it to a string, and runs `Bun.build()` to bundle the frontend entry point. The result is a `Skeleton` object (`mininext/backend/html.ts`):

```typescript
type Skeleton = {
  static_routes: BunStaticRoutes; // Bun static route responses
  fill: (...args: MiniValue[]) => Blob; // Fill placeholders
  mini: () => Mini; // Create a Mini with .fill() bound to it
};
```

### `.fill()` Simple Case

`skeleton.fill()` replaces each `${null}` placeholder with the corresponding argument:

```typescript
// examples/counter.ts
return new Response(
  skeleton.fill(html`<div id="count">${globalCounter}</div>`),
);
```

`curryFill()` in `mininext/backend/html.ts` fills the placeholders. At build time each `${null}` becomes a numbered token (`__mini_null_0__`, ...), so the same skeleton always builds to the same html. `fill()` splits the html at the tokens once and puts the escaped or rendered values in between.

### `.mini()` State Without Props Drilling

`skeleton.mini()` returns a `Mini` instance with `.fill()` bound to it. You can attach data to `mini` via `mini.state()`, then access it in any component without passing it through the tree.

```typescript
// examples/request-state.ts
function path(mini: Mini) {
  const req = mini.state<Request | null>("req", null).value; // access it
  return mini.html`<p>you asked for ${req ? new URL(req.url).pathname : "?"}</p>`;
}

function fetch(req: Request) {
  const mini = skeleton.mini();
  mini.state("req", req); // attach the request
  return new Response(mini.fill((mini: Mini) => mini.html`<h1>hello</h1>${path}`));
}
```

### How This Solves Props Drilling

HTML is a tree. In React, passing data from a route handler down to a leaf component means threading props through every intermediate component. This is brittle, adding a prop means changing every function signature in the chain.

Mininext sidesteps this. `mini.state()` stores data in a cache keyed by name. Any component in the tree can read it via `mini.state("name", defaultValue)`. No props, no context, no drilling.

The (per request) cache lives in `CacheAndCursor` (`mininext/minicache.ts`). On the backend, `state()` always uses the `"global"` cursor, so all components share the same state scope.

### No Function Coloring in the Backend

Bun route handlers are async: you can `await` database queries, fetch calls, etc. Do all async business logic in the route handler, then pass the data to the template. `html` template strings and components are synchronous. Every component is just a function that returns HTML: `(mini: Mini) => MiniHtmlString`. No async / sync function coloring.

### Rerender in the Frontend

In the frontend we reresolve the whole page every time. (rerender / replace DOM elements only if the specific html snippets / values change, otherwise the DOM is not touched). No function coloring is needed in the frontend, as well. It can access the data as it changes, according to the immediate mode GUI paradigm.

The expensive work is the DOM repainting, not reevalution of component logic. (no problem doing it 60 times a second, reduced to very low FPS when the tab isn't visible)

### Route Setup

```typescript
// examples/counter.ts
const server = Bun.serve({
  routes: skeleton.static_routes, // static assets from build
  fetch, // dynamic route handler
});
```

`skeleton.static_routes` comes from `createStaticRoutes()` in `mininext/backend/html.ts` it maps each `Bun.build()` output to a static response. The `fetch` function handles dynamic routes. Normal bun routes can be used as well. Like so:

```typescript
export function makeRoutes() {
  const routes = {
    ...dashboardSkeleton.static_routes,
    ...loginSkeleton.static_routes,
    "/login": {
      GET: adminLoginGet,
      POST: adminLoginPost,
    },
    "/dashboard": {
      GET: dashBoardRoute,
    },
    "/editPaymentLink": {
      POST: editPaymentLinkRoute,
    },
    "/deletePaymentLink": {
      POST: deletePaymentLinkRoute,
    },
    "/editWallet": {
      POST: editWalletRoute,
    },
    "/deleteWallet": {
      POST: deleteWalletRoute,
    },
  };
  return routes;
}
```

As long as the static_routes object of the skeleton is added to the `routes` option to `Bun.serve()`, the static assets compiled in the skeleton are served.

## See Also

- [Getting Started](./getting-started.md) - Quick start guide
- [API Reference](./api-reference.md) - Complete API documentation
- [Patterns](./patterns.md) - Real-world usage patterns

# Mininext Architecture

Mininext is a web framework that brings the immediate mode GUI paradigm to the web.
It automatically throttles rendering when the tab isn't visible, via the browser requestAnimationFrame throttling.

## Immediate Mode GUI

Mininext re-renders everything every frame using a `requestAnimationFrame` loop. This is a similar approach as Dear Imgui.

When you call `renderRoot()`, it starts a loop:

```typescript
function renderLoop() {
  const html = component();
  container.innerHTML = html;
  requestAnimationFrame(renderLoop);
}
```

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
const data = { count: 42 };
const hydrate = btoa(JSON.stringify(data));
const html = skeleton.fill(hydrate);
```

Client side:

```typescript
const b64 = document.body.dataset.hydrate;
const data = JSON.parse(atob(b64));
```

This drastically reduces render time compared to naive client-side rendering. Achieves same or better performance than React Server Components / SSR. Drastically reduces attack surface + complexity.

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

1. Listens to `hashchange` events
2. Matches current hash against route patterns
3. Extracts parameters from URL
4. Sets `router.component` to matched route's output
5. Re-renders the root container

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

1. Split route pattern into segments
2. For each segment:
   - If starts with `:`, capture as parameter
   - Otherwise, must match exactly
3. Return params object if all segments match

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
// tests/counter.ts
const skeleton = await html`<!DOCTYPE html>
  <html>
    <body>
      <div id="count">${null}</div>
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
// tests/counter.ts
return new Response(
  skeleton.fill(html`<div id="count">${globalCounter}</div>`),
);
```

`curryFill()` in `mininext/backend/html.ts` does string replacement. Each `${null}` gets a UUID at build time (`renderBackend()`). `fill()` replaces those UUIDs with rendered content.

### `.mini()` State Without Props Drilling

`skeleton.mini()` returns a `Mini` instance with `.fill()` bound to it. You can attach data to `mini` via `mini.state()`, then access it in any component without passing it through the tree.

```typescript
// tests/newdawn.ts
function fetch(req: Request) {
  const mini = skeleton.mini();
  mini.state("test", req); // attach the request
  return new Response(
    mini.fill((mini: Mini) => {
      const bla = mini.state("test", null); // access it
      return mini.html`<h1>hello 2</h1>`;
    }),
  );
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
// tests/counter.ts
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

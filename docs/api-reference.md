# Mininext API Reference

This document provides a complete API reference for Mininext. For conceptual understanding, see [Architecture](./architecture.md) and [Getting Started](./getting-started.md).

## Core Functions

### `html` — Template Literal

Creates a `MiniHtmlString` from a template literal with embedded expressions.

**File:** [`mininext/mininext.ts`](../mininext/mininext.ts)

```typescript
export function html(
  stringLiterals: TemplateStringsArray,
  ...values: MiniValue[]
): MiniHtmlString;
```

**Usage:**

```typescript
const name = "World";
const greeting = html`<h1>Hello, ${name}!</h1>`;
```

**Details:**

- Expressions are HTML-escaped
- Functions in templates run every render (immediate mode)
- Returns a `MiniHtmlString` with `.resolve()`, `.build()`, and `.renderBackend()` methods

**Source:**

```typescript
// mininext/mininext.ts
export function html(
  stringLiterals: TemplateStringsArray,
  ...values: MiniValue[]
): MiniHtmlString {
  return constructMiniHtmlString(stringLiterals, values);
}
```

---

### `renderRoot` — Start Rendering

Starts the immediate mode render loop in the browser.

**File:** [`mininext/frontend/minidom.ts`](../mininext/frontend/minidom.ts)

```typescript
export function renderRoot(options: {
  component: () => MiniHtmlString;
  container: HTMLElement;
});
```

**Usage:**

```typescript
const container = document.getElementById("root");
renderRoot({
  component: () => html`<div>Hello</div>`,
  container,
});
```

**Details:**

- Starts a `requestAnimationFrame` loop
- Re-renders the component every frame
- Browser throttles automatically when tab is not visible
- Only updates DOM if HTML changed (diffing at string level)

---

### `createRouter` — Client-Side Router

Creates a hash-based router for client-side navigation.

**File:** [`mininext/frontend/minirouter.ts`](../mininext/frontend/minirouter.ts)

```typescript
export function createRouter(routes: Record<string, MiniComponent>): Router;
```

**Usage:**

```typescript
const router = createRouter({
  "/": () => html`<h1>Home</h1>`,
  "/users/:id": (mini) => html`<h1>User ${mini.state("id")}</h1>`,
});
```

**Details:**

- Listens to `hashchange` events
- Matches URL hash against route patterns
- Extracts parameters from `:param` segments
- Sets `router.component` to matched route's output

**Source:**

```typescript
// mininext/frontend/minirouter.ts
export function createRouter(routes: Record<string, MiniComponent>): Router {
  const router = {
    component: () => html`<div>404</div>`,
    params: {} as Params,
  };
  // ... route matching logic
}
```

---

## Backend Functions

### `.build()` — Build Skeleton

Compiles an HTML template into a `Skeleton` object with static routes and fill methods.

**File:** [`mininext/backend/html.ts`](../mininext/backend/html.ts)

```typescript
export type MiniHtmlString = {
  build(
    mini?: Mini,
    root?: string,
    config?: Bun.BuildConfig,
  ): Promise<Skeleton>;
};
```

**Usage:**

```typescript
const skeleton = await html`<!DOCTYPE html>
  <html>
    <body>
      <div id="root">${null}</div>
    </body>
  </html>`.build();
```

**Details:**

- `${null}` creates placeholders for dynamic content
- Runs `Bun.build()` to bundle frontend entry point
- Returns a `Skeleton` with `.fill()`, `.mini()`, and `static_routes`

**Source:**

```typescript
// mininext/mininext.ts
async build(
  mini?: Mini,
  root?: string,
  config?: Bun.BuildConfig,
): Promise<Skeleton> {
  if (!root) root = getCallerDir();
  return await build({ stringLiterals, values, root, mini, config });
}
```

---

### `.fill()` — Fill Placeholders

Replaces `${null}` placeholders in a skeleton with dynamic content.

**File:** [`mininext/backend/html.ts`](../mininext/backend/html.ts)

```typescript
type Skeleton = {
  fill: (...args: MiniValue[]) => Blob;
};
```

**Usage:**

```typescript
// Simple fill
return new Response(
  skeleton.fill(html`<div id="count">${globalCounter}</div>`),
);
```

**Details:**

- Each `${null}` in the skeleton gets replaced with corresponding argument
- Uses string replacement (UUIDs generated at build time)
- Returns a `Blob` that can be used directly in `Response`

**Source:**

```typescript
// mininext/backend/html.ts
function curryFill(mini: Mini, htmlString: ResolvedMiniHtmlString): Blob {
  // ... string replacement logic
}
```

---

### `.mini()` — Create Mini Instance

Creates a `Mini` instance with `.fill()` bound to it, enabling state sharing without props drilling.

**File:** [`mininext/backend/html.ts`](../mininext/backend/html.ts)

```typescript
type Skeleton = {
  mini: () => Mini;
};
```

**Usage:**

```typescript
function fetch(req: Request) {
  const mini = skeleton.mini();
  mini.state("request", req);
  return new Response(
    mini.fill((mini: Mini) => {
      const req = mini.state("request", null);
      return mini.html`<h1>Hello</h1>`;
    }),
  );
}
```

**Details:**

- Returns a `Mini` with `.fill()` bound to the skeleton
- `mini.state()` attaches data to the cache
- Any component can access the data without props

**Source:**

```typescript
// mininext/backend/html.ts
type Skeleton = {
  mini: () => Mini;
  fill: (...args: MiniValue[]) => Blob;
  static_routes: BunStaticRoutes;
};
```

---

## State Management

### `mini.state()` — Attach/Access State

Attaches or retrieves data from the cache.

**File:** [`mininext/minicache.ts`](../mininext/minicache.ts)

```typescript
export type Mini = {
  state: <T>(name: string, value: T, global?: boolean) => StateObject<T>;
};
```

**Usage:**

```typescript
// Attach data
mini.state("user", { id: 1, name: "Alice" });

// Access data
const user = mini.state("user", null);
```

**Details:**

- Stores data in `CacheAndCursor` (per-request on backend)
- On backend, `global` is always `true` (shared scope)
- Returns `StateObject<T>` with `.value` and `.name`

**Source:**

```typescript
// mininext/minicache.ts
export function state<T>(
  name: string,
  value: T,
  cacheAndCursor: CacheAndCursor,
  global?: boolean,
): StateObject<T> {
  // ... cache lookup/insert logic
}
```

---

### `mini.html` — Template in Components

Template literal available inside components (same as top-level `html`).

**File:** [`mininext/mininext.ts`](../mininext/mininext.ts)

```typescript
export type Mini = {
  html: typeof html;
};
```

**Usage:**

```typescript
function Component(mini: Mini) {
  return mini.html`<div>Hello</div>`;
}
```

**Details:**

- Same as top-level `html` function
- Available on `Mini` instance for use in components

---

## Utility Functions

### `mini.flatten()` — Flatten Array of HTML Strings

Combines an array of `MiniHtmlString` into a single one with a root element.

**File:** [`mininext/mininext.ts`](../mininext/mininext.ts)

```typescript
export type Mini = {
  flatten(
    htmlStringArray: MiniHtmlString[],
    flattenRootFn?: (htmlstrings: MiniHtmlString) => MiniHtmlString,
  ): MiniHtmlString;
};
```

**Usage:**

```typescript
const items = ["a", "b", "c"].map((item) => html`<li>${item}</li>`);

function Component(mini: Mini) {
  return mini.html`<ul>${mini.flatten(items)}</ul>`;
}
```

**Details:**

- Wraps array in a root element (default: `<div>`)
- Custom root function: `flattenRootFn(htmlstrings) => html`<ul>${htmlstrings}</ul>`
- Throws if components are not resolved before flattening

**Source:**

```typescript
// mininext/mininext.ts
export function flatten(
  htmlStringArray: MiniHtmlString[],
  flattenRootFn = standardFlattenRoot,
): MiniHtmlString {
  const flattenedArray = combineMiniHtmlStrings(htmlStringArray);
  return flattenValues(flattenRootFn(flattenedArray));
}
```

---

## Types

### `MiniHtmlString`

The core type representing HTML with embedded expressions.

**File:** [`mininext/mininext.ts`](../mininext/mininext.ts)

```typescript
export type MiniHtmlString = {
  stringLiterals: TemplateStringsArray;
  values: MiniValue[];
  resolve(mini?: Mini): ResolvedMiniHtmlString;
  build(
    mini?: Mini,
    root?: string,
    config?: Bun.BuildConfig,
  ): Promise<Skeleton>;
  renderBackend(mini?: Mini): string;
};
```

---

### `MiniComponent`

A function that takes a `Mini` and returns HTML.

**File:** [`mininext/mininext.ts`](../mininext/mininext.ts)

```typescript
export type MiniComponent = (mini: Mini) => MiniHtmlString;
```

---

### `Mini`

The context object passed to components.

**File:** [`mininext/mininext.ts`](../mininext/mininext.ts)

```typescript
export type Mini = {
  html: typeof html;
  state: <T>(name: string, value: T, global?: boolean) => StateObject<T>;
  cacheAndCursor: CacheAndCursor;
  flatten(
    htmlStringArray: MiniHtmlString[],
    flattenRootFn?: (htmlstrings: MiniHtmlString) => MiniHtmlString,
  ): MiniHtmlString;
  fill(...args: MiniValue[]): Blob;
};
```

---

### `Skeleton`

The result of `.build()` — contains static routes and fill methods.

**File:** [`mininext/backend/html.ts`](../mininext/backend/html.ts)

```typescript
type Skeleton = {
  static_routes: BunStaticRoutes;
  fill: (...args: MiniValue[]) => Blob;
  mini: () => Mini;
};
```

---

## See Also

- [Getting Started](./getting-started.md) — Quick start guide
- [Architecture](./architecture.md) — Conceptual overview
- [Patterns](./patterns.md) — Real-world usage patterns
- [GitHub Repository](https://github.com/spirobel/mininext)

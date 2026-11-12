# Mininext API Reference

For the ideas behind the API, see [Architecture](./architecture.md) and [Getting Started](./getting-started.md).

## Entry points

| Import | Contains | Use it in |
| --- | --- | --- |
| `@spirobel/mininext` | everything: `html`, `build()`, `fill()`, `crawl()` and the browser parts | server code |
| `@spirobel/mininext/browser` | `html`, `renderRoot`, `createRouter`, types | frontend code |

Bundlers that know the `"browser"` export condition (Bun does) pick `browser` automatically, so a frontend file can import from `@spirobel/mininext` too. No server code goes into a browser bundle.

---

## `html` template literal

**File:** [`mininext/core.ts`](../mininext/core.ts)

```typescript
function html(stringLiterals: TemplateStringsArray, ...values: MiniValue[]): MiniHtmlString;
```

Only the literal parts are html. Every `${value}` is data:

| Value | Between tags | In an attribute |
| --- | --- | --- |
| `string`, `number` | text (escaped, never markup) | the attribute value (escaped, quoted) |
| `null`, `undefined`, `false` | nothing | no attribute |
| `true` | nothing | boolean attribute, like `disabled` |
| `html\`...\`` | a nested template | refused |
| `(mini) => value` | a component, runs every render. it returns `html` or any value in this table | refused |
| `(event) => ...` | refused | handler, only in `on*` attributes: `onclick=${() => go(id)}` |
| array | a list, one slot per item | refused |
| plain object | refused | refused |

The full rules (url checks, `srcdoc`, values in `<style>`) are in [Architecture: Values](./architecture.md#values).

```typescript
const greeting = html`<h1 class="${cls}">Hello, ${name}!</h1>`;
```

---

## `renderRoot` start rendering

**File:** [`mininext/frontend/minidom.ts`](../mininext/frontend/minidom.ts)

```typescript
function renderRoot(options: {
  component: (mini: Mini) => MiniHtmlString;
  container: HTMLElement;
  cac?: CacheAndCursor; // your own cache, if you want to read it
}): void;
```

```typescript
let count = 0;
renderRoot({
  container: document.getElementById("root")!,
  component: (mini) => mini.html`<button onclick=${() => count++}>${count}</button>`,
});
```

- Runs `component` once per `requestAnimationFrame`. A hidden tab gets about one frame per second.
- The first frame parses each template once and keeps references to its nodes.
- After that, it writes only values that changed: `Text.nodeValue`, `setAttribute`, live properties (`value`, `checked`, `selected`) and handler properties. A frame with no change writes nothing to the DOM.
- A template that changes into a different template is built again. In development, a slot that is built again 10 frames in a row throws an error, because it loses focus and state each frame.
- A second `renderRoot` call on the same container (hot reload) swaps the component and keeps the state.

---

## `createRouter` hash router

**File:** [`mininext/frontend/minirouter.ts`](../mininext/frontend/minirouter.ts)

```typescript
function createRouter(routes: Record<string, (params, mini: Mini) => MiniHtmlString>): {
  component: (mini: Mini) => MiniHtmlString;
  navigate(path: string, params?): void;
  link(path: string, params?): string; // "#/users/42"
  getCurrentPath(): string;
};
```

```typescript
const router = createRouter({
  "/": () => html`<h1>Home</h1>`,
  "/users/:id": (params) => html`<h1>User ${params.id}</h1>`,
  "/files/*": (params) => html`<p>${params["*"]}</p>`,
});
renderRoot({ container, component: router.component });
html`<a href="${router.link("/users/:id", { id: "42" })}">user 42</a>`;
```

Static segments match before `:params`, and routes that end in `/*` match last, whatever the order of the keys. Params are typed from the route string, also in inline handlers. Params are percent decoded, and `link()` / `navigate()` encode them. A `?query` after the path is ignored. An unknown hash renders nothing and warns one time.

---

## `.build()` build a skeleton (server)

**File:** [`mininext/backend/html.ts`](../mininext/backend/html.ts)

```typescript
html`...`.build(mini?: Mini, root?: string, config?: Bun.BuildConfig): Promise<Skeleton>;
```

```typescript
const skeleton = await html`<!doctype html>
  <html>
    <head><script type="module" src="./frontend.ts"></script></head>
    <body>${null}</body>
  </html>`.build();
```

- `root` is the folder that relative `src` and `href` start from. It defaults to the folder of the file that calls `build()`.
- Each `${null}` becomes a numbered placeholder (`__mini_null_0__`, ...). The same skeleton gives the same html on every build.
- `NODE_ENV=production`: `Bun.build()` bundles and minifies the scripts and styles. `static_routes` serves the files. A page without scripts gets no empty script chunk.
- Development (`bun --hot`): the page goes through Bun's own html bundler, so frontend edits hot swap and keep state. A server edit reloads the page.

---

## `skeleton.fill()` fill the placeholders

```typescript
skeleton.fill(...values: MiniValue[]): Blob;
```

```typescript
"/": () => new Response(skeleton.fill(html`<p>count ${count}</p>`)),
```

- The values go into the `${null}` placeholders in order.
- A string or a number is escaped. A template or a component is rendered on the server.
- A placeholder inside an attribute, like `href="${null}"`, takes only a string or a number, with the same checks as a template value.
- The result is a `Blob` with type `text/html;charset=utf-8`.

---

## `skeleton.mini()` request state

```typescript
skeleton.mini(): Mini; // its fill() is bound to the skeleton
```

```typescript
function handler(req: Request) {
  const mini = skeleton.mini();
  mini.state("req", req);
  return new Response(mini.fill(page));
}
function page(mini: Mini) {
  const req = mini.state<Request | null>("req", null).value;
  return mini.html`<p>you asked for ${new URL(req!.url).pathname}</p>`;
}
```

Every component in that `fill()` can read the state. You do not pass it down through props.

---

## `mini.state()` state

**File:** [`mininext/minicache.ts`](../mininext/minicache.ts)

```typescript
mini.state<T>(name: string, initial: T, global?: boolean): { value: T; name: string };
```

- The first call makes the state with `initial`. Later calls return the same object. Change it with `.value`.
- In the browser, state belongs to the slot of the component. When the slot gets a different template, its state is deleted.
- `global: true` (always on the server) shares one scope for the whole page or request.

---

## `mini.html`

The same function as `html`, on the `Mini` that a component gets.

---

## `.renderBackend()` render to a string (server)

```typescript
html`...`.renderBackend(mini?: Mini): string;
```

Renders a template to an html string with the server rules. It does not need a skeleton.

---

## `crawl()` static site export (server)

**File:** [`mininext/backend/static.ts`](../mininext/backend/static.ts)

```typescript
crawl(start: string | URL, outdir: string, options?: { paths?: string[]; version?: string }): Promise<MiniArtifact>;
```

```typescript
process.env.NODE_ENV = "production";
const server = Bun.serve({ port: 0, routes });
await crawl(server.url, "dist", { version: "1.0.0" });
server.stop();
```

- Starts at `paths` (default `["/"]`) and follows every same-origin `href`, `src` and css `url()`.
- `/docs` is written as `docs/index.html`, so any static host can serve it.
- Writes `mini_artifact.json`: the sha256 of each file, and one sha256 of the whole site. The combined hash uses `sha256sum` lines, so a shell can check it too.

---

## Types

```typescript
type MiniValue = string | number | null | boolean | undefined
  | MiniComponent | MiniHandler | MiniHtmlString | MiniValue[];
type MiniComponent = (mini: Mini) => MiniHtmlString;
type MiniHandler = (event: any) => unknown;

type MiniHtmlString = {
  stringLiterals: TemplateStringsArray;
  values: MiniValue[];
  resolve(mini?: Mini): ResolvedMiniHtmlString;
  build(mini?: Mini, root?: string, config?: Bun.BuildConfig): Promise<Skeleton>;
  renderBackend(mini?: Mini): string;
};

type Mini = {
  html: typeof html;
  state<T>(name: string, value: T, global?: boolean): StateObject<T>;
  cacheAndCursor: CacheAndCursor;
  fill(...args: MiniValue[]): Blob; // only on skeleton.mini()
};

type Skeleton = {
  static_routes: BunStaticRoutes; // put these in Bun.serve({ routes })
  fill(...args: MiniValue[]): Blob;
  mini(): Mini;
};

type MiniArtifact = {
  schema: "mini_artifact/1";
  version: string;
  sha256: string;
  files: { path: string; sha256: string }[];
};
```

---

## See Also

- [Getting Started](./getting-started.md): quick start
- [Architecture](./architecture.md): how it works
- [Patterns](./patterns.md): real-world patterns
- [GitHub Repository](https://github.com/spirobel/mininext)

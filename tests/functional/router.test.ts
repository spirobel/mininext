import { expect, spyOn, test } from "bun:test";
import { tick } from "../dom-setup";
import { testDataFor } from "../testdata";
const testData = testDataFor(import.meta.path);
// import after dom setup, because isBackend checks window at import time
const { html, makeNewMini, renderRoot, createRouter } = await import(
  "../../mininext/browser"
);
type Mini = import("../../mininext/browser").Mini;
type MiniHtmlString = import("../../mininext/browser").MiniHtmlString;

// same chain as renderRoot uses for each frame
function mount(component: (mini: Mini) => MiniHtmlString) {
  const container = document.createElement("div");
  document.body.append(container);
  const cac = { cache: new Map(), cursor: "t" };
  const frame = () => {
    const mini = makeNewMini(cac);
    component(mini).resolve(mini).render(container, cac);
  };
  return { container, frame };
}

// each handler writes its route name and params into the dom
function show(route: string) {
  return (params: Record<string, string>) =>
    html`<p data-route="${route}">${JSON.stringify(params)}</p>`;
}
function read(container: HTMLElement) {
  const p = container.querySelector("p");
  return p ? { route: p.dataset.route, params: JSON.parse(p.textContent!) } : null;
}
// go to a hash, render one frame, keep what the browser and the dom show
function visit(
  td: ReturnType<typeof testData>,
  m: ReturnType<typeof mount>,
  hash: string,
) {
  window.location.hash = hash;
  m.frame();
  const result = read(m.container);
  td.dump(
    `${hash.replace(/[^\w-]/g, "_")}.json`,
    JSON.stringify({ set: hash, locationHash: window.location.hash, result, dom: m.container.innerHTML }, null, 2),
  );
  return result;
}

test("R01 basic routes match and give params", () => {
  const td = testData("R01-basic");
  const router = createRouter({
    "/": show("home"),
    "/users/:id": show("user"),
    "/files/*": show("files"),
  });
  const m = mount(router.component);
  // all cases in one assert, so a failure shows every wrong case, not only the first
  const got = {
    home: visit(td, m, ""),
    user: visit(td, m, "#/users/42"),
    files: visit(td, m, "#/files/a/b.txt"),
    currentPath: router.getCurrentPath(),
  };
  expect(got).toEqual({
    home: { route: "home", params: {} },
    user: { route: "user", params: { id: "42" } },
    files: { route: "files", params: { "*": "/a/b.txt" } },
    currentPath: "/files/a/b.txt",
  });
});

test("R02 params are decoded like the bun router does", () => {
  const td = testData("R02-decode");
  const router = createRouter({ "/users/:id": show("user"), "/files/*": show("files") });
  const m = mount(router.component);
  const got = {
    space: visit(td, m, "#/users/John Doe"),
    utf8: visit(td, m, "#/users/%C3%A4"),
    wildcard: visit(td, m, "#/files/my dir/a b.txt"),
  };
  expect(got).toEqual({
    space: { route: "user", params: { id: "John Doe" } },
    utf8: { route: "user", params: { id: "ä" } },
    wildcard: { route: "files", params: { "*": "/my dir/a b.txt" } },
  });
});

test("R03 link and navigate round trip any param value", () => {
  const td = testData("R03-round-trip");
  const router = createRouter({ "/users/:id": show("user"), "/files/*": show("files") });
  const m = mount(router.component);
  const values = ["a/b c", "50%", "x?y=1", "#hash", "ä"];
  // navigate, render, read back. a frame that throws counts as a result too
  const roundTrip = (path: string, params: Record<string, string>, file: string) => {
    let result;
    try {
      router.navigate(path as any, params as any);
      m.frame();
      result = read(m.container);
    } catch (e) {
      result = `throws: ${(e as Error).message}`;
    }
    td.dump(file, JSON.stringify({ params, link: router.link(path as any, params as any), locationHash: window.location.hash, result }, null, 2));
    return result;
  };
  const got = values.map((id, i) => roundTrip("/users/:id", { id }, `user-${i}.json`));
  // the wildcard keeps its slashes, each segment is encoded
  const files = roundTrip("/files/*", { "*": "/a?b/%41 c/50%.txt" }, "files.json");
  expect({ got, files }).toEqual({
    got: values.map((id) => ({ route: "user", params: { id } })),
    files: { route: "files", params: { "*": "/a?b/%41 c/50%.txt" } },
  });
});

test("R04 static beats param beats wildcard, whatever the object order", () => {
  const td = testData("R04-order");
  const router = createRouter({
    "/*": show("catch-all"),
    "/users/:id": show("user"),
    "/users/new": show("new-user"),
    "/docs/*": show("docs"),
    "/docs/:page/edit": show("edit"),
  });
  const m = mount(router.component);
  const paths = ["#/users/new", "#/users/7", "#/docs/a", "#/docs/a/edit", "#/x/y"];
  const got = Object.fromEntries(paths.map((p) => [p, visit(td, m, p)?.route]));
  expect(got).toEqual({
    "#/users/new": "new-user",
    "#/users/7": "user",
    "#/docs/a": "docs",
    "#/docs/a/edit": "edit",
    "#/x/y": "catch-all",
  });
});

test("R05 a query string after the path does not break the match", () => {
  const td = testData("R05-query");
  const router = createRouter({ "/users/:id": show("user") });
  const m = mount(router.component);
  const got = { result: visit(td, m, "#/users/7?tab=2"), currentPath: router.getCurrentPath() };
  expect(got).toEqual({ result: { route: "user", params: { id: "7" } }, currentPath: "/users/7" });
});

test("R05b a query string after a static route still matches", () => {
  const td = testData("R05b-query-static");
  const router = createRouter({ "/settings": show("settings") });
  const m = mount(router.component);
  expect(visit(td, m, "#/settings?tab=2")).toEqual({ route: "settings", params: {} });
});

test("R06 link keeps one leading #", () => {
  const td = testData("R06-link");
  const router = createRouter({ "/foo": show("foo") });
  const links = { hash: router.link("#/foo"), slash: router.link("/foo"), bare: router.link("foo") };
  td.dump("links.json", JSON.stringify(links));
  expect(links).toEqual({ hash: "#/foo", slash: "#/foo", bare: "#/foo" });
});

test("R07 a malformed percent escape stays raw and does not throw", () => {
  const td = testData("R07-malformed");
  const router = createRouter({ "/users/:id": show("user") });
  const m = mount(router.component);
  const result = visit(td, m, "#/users/%E0%A4%A");
  expect(result).toEqual({ route: "user", params: { id: "%E0%A4%A" } });
});

test("R08 an unknown hash renders nothing and the loop keeps running", () => {
  const td = testData("R08-unknown-hash");
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const router = createRouter({ "/": show("home"), "/other": show("other") });
  const container = document.createElement("div");
  document.body.append(container);
  // a throw out of a frame is a result too: it stops the real loop
  const frames: string[] = [];
  const safeTick = (n: number) => {
    try {
      tick(n);
      frames.push("ok");
    } catch (e) {
      frames.push(`throws: ${(e as Error).message}`);
    }
  };
  window.location.hash = "#/";
  renderRoot({ container, component: router.component });
  safeTick(1);
  const before = container.innerHTML;
  window.location.hash = "#/nope";
  safeTick(3);
  const unknown = container.innerHTML;
  // a different route than before: a dead loop would leave the stale home dom
  window.location.hash = "#/other";
  safeTick(1);
  const after = container.innerHTML;
  // copy the calls, mockRestore clears them
  const warnings = warn.mock.calls.map((args) => args.map(String));
  warn.mockRestore();
  td.dump("frames.json", JSON.stringify({ frames, before, unknown, after, warnings }, null, 2));
  // one warning per bad path, not one per frame
  expect({
    frames,
    beforeIsHome: before.includes('data-route="home"'),
    unknownIsEmpty: !unknown.includes("data-route"),
    afterIsOther: after.includes('data-route="other"'),
    warnings,
  }).toEqual({
    frames: ["ok", "ok", "ok"],
    beforeIsHome: true,
    unknownIsEmpty: true,
    afterIsOther: true,
    warnings: [['mininext router: no route matches "/nope"']],
  });
});

// type test, checked by bun run typecheck (tests/tsconfig.json)
export const typedRouter = createRouter({
  "/users/:id": (params) => html`${params.id}`,
  // @ts-expect-error nope is not a param of this route
  "/posts/:slug": (params) => html`${params.nope}`,
});

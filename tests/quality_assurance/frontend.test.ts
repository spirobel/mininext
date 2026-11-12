// injection tests for the frontend render (jsdom). run in its own process:
// bun test ./tests/quality_assurance/frontend.test.ts
import { expect, test } from "bun:test";
import "../dom-setup";
import { testDataFor } from "../testdata";
const testData = testDataFor(import.meta.path);
const { html, makeNewMini } = await import("../../mininext/browser");
type Mini = import("../../mininext/browser").Mini;
type MiniHtmlString = import("../../mininext/browser").MiniHtmlString;

function mount(component: (mini: Mini) => MiniHtmlString) {
  const container = document.createElement("div");
  document.body.append(container);
  const cac = { cache: new Map(), cursor: "t" };
  const frame = () => {
    const mini = makeNewMini(cac);
    component(mini).resolve(mini).render(container, cac);
  };
  frame();
  return { container, frame };
}
// all elements under the container, so a test can see if a value made new ones
const tags = (el: Element) => [...el.querySelectorAll("*")].map((e) => e.localName);

const PAYLOADS = [
  `<script>alert(1)</script>`,
  `<img src=x onerror=alert(1)>`,
  `"><img src=x onerror=alert(1)>`,
  `'><img src=x onerror=alert(1)>`,
  `" onmouseover="alert(1)`,
  `</style><img src=x onerror=alert(1)>`,
  `</textarea><img src=x onerror=alert(1)>`,
  `<!--`,
  `--><img src=x onerror=alert(1)>`,
  `0`,
  `<!--0-->`,
  `\${alert(1)}`,
  `&lt;script&gt;`,
];

test("f01 text values stay text, for every payload", () => {
  const td = testData("f01-text");
  for (const p of PAYLOADS) {
    const { container } = mount(() => html`<p>${p}</p>`);
    td.dump("last.html", container.innerHTML);
    expect(tags(container)).toEqual(["p"]);
    expect(container.querySelector("p")!.textContent).toBe(p);
  }
});

test("f02 attribute values stay one attribute, quoted and unquoted", () => {
  const td = testData("f02-attr");
  for (const p of PAYLOADS) {
    for (const make of [
      () => html`<p title="${p}">x</p>`,
      () => html`<p title='${p}'>x</p>`,
      () => html`<p title=${p}>x</p>`,
      () => html`<p title="a ${p} b">x</p>`,
    ]) {
      const { container } = mount(make);
      td.dump("last.html", container.innerHTML);
      const el = container.querySelector("p")!;
      expect(tags(container)).toEqual(["p"]);
      expect([...el.attributes].map((a) => a.name)).toEqual(["title"]);
      expect(el.getAttribute("title")).toContain(p);
    }
  }
});

test("f03 raw text elements: style, textarea, title keep the value as text", () => {
  const td = testData("f03-raw-text");
  for (const p of PAYLOADS) {
    const { container } = mount(
      () => html`<div><style>.a{content:"${p}"}</style><textarea>${p}</textarea><title>${p}</title></div>`,
    );
    td.dump("last.html", container.innerHTML);
    expect(tags(container)).toEqual(["div", "style", "textarea", "title"]);
    expect(container.querySelector("style")!.textContent).toBe(`.a{content:"${p}"}`);
    expect(container.querySelector("textarea")!.value).toBe(p);
    expect(container.querySelector("title")!.textContent).toBe(p);
  }
});

test("f04 a value can not add an attribute or a tag name", () => {
  const td = testData("f04-bare");
  const bad = [
    () => html`<div ${"onload=alert(1)"}>x</div>`,
    () => html`<div data-${"x onload=alert(1)"}="1">x</div>`,
  ];
  for (const make of bad) expect(() => mount(make)).toThrow("attribute value");
  td.dump("ok.txt", "both threw");
});

test("f05 on* attributes take a function, never a string", () => {
  const td = testData("f05-on-string");
  expect(() => mount(() => html`<button onclick="${"alert(1)"}">x</button>`)).toThrow("onclick");
  expect(() => mount(() => html`<button onclick="go('${"x');alert(1);('"}')">x</button>`)).toThrow("onclick");
  expect(() => mount(() => html`<iframe srcdoc="${"<script>alert(1)</script>"}"></iframe>`)).toThrow("srcdoc");
  let clicked = 0;
  const { container } = mount(() => html`<button onclick=${() => clicked++}>x</button>`);
  container.querySelector("button")!.click();
  td.dump("dom.html", container.innerHTML);
  expect(clicked).toBe(1);
});

test("f06 url attributes refuse javascript:, vbscript: and non-image data:", () => {
  const td = testData("f06-url");
  const bad = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
  ];
  for (const url of bad) {
    expect(() => mount(() => html`<a href="${url}">x</a>`)).toThrow("url");
    expect(() => mount(() => html`<form action="${url}"></form>`)).toThrow("url");
  }
  // the same check runs on updates, not only on the first render
  let url = "/ok";
  const { frame } = mount(() => html`<a href="${url}">x</a>`);
  url = "javascript:alert(1)";
  expect(() => frame()).toThrow("url");
  // split over two values
  expect(() => mount(() => html`<a href="${"java"}${"script:alert(1)"}">x</a>`)).toThrow("url");
  const ok = ["/docs", "https://example.com/a?b=1&c=2", "#top", "mailto:a@b.c", "data:image/png;base64,AAAA"];
  for (const u of ok) {
    const { container } = mount(() => html`<a href="${u}">x</a><img src="${u}" />`);
    expect(container.querySelector("a")!.getAttribute("href")).toBe(u);
  }
  td.dump("ok.txt", ok.join("\n"));
});

test("f07 plain objects can not pretend to be templates (json from a request)", () => {
  const td = testData("f07-duck");
  const evil = JSON.parse(
    `{"resolve":1,"stringLiterals":["<img src=x onerror=alert(1)>"],"values":[],"slots":[]}`,
  );
  expect(() => mount(() => html`<p>${evil}</p>`)).toThrow("object");
  expect(() => mount(() => html`<p title="${evil}">x</p>`)).toThrow();
  // arrays of strings from json are fine, each item is text
  const list = JSON.parse(`["<b>a</b>", "<img src=x onerror=alert(1)>"]`);
  const { container } = mount(() => html`<ul>${list.map((s: string) => html`<li>${s}</li>`)}</ul>`);
  td.dump("dom.html", container.innerHTML);
  expect(tags(container)).toEqual(["ul", "li", "li"]);
  // a raw array of strings is text too
  const { container: c2 } = mount(() => html`<p>${list}</p>`);
  expect(tags(c2)).toEqual(["p"]);
});

test("f08 fuzz: random payloads in text, attribute and style never make elements", () => {
  const td = testData("f08-fuzz");
  const parts = ["<", ">", '"', "'", "&", "=", "/", "`", "${", "}", "script", "img", "on", "error", " ", "--", "!", "", "0", "style", "\n", "javascript:"];
// mulberry32: small seeded prng. (an lcg with seed % n repeats in its low bits)
  let seed = 7;
  const rnd = (n: number) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  let value = "";
  const { container, frame } = mount(
    () => html`<div title="${value}"><span>${value}</span><style>.x{content:"${value}"}</style></div>`,
  );
  for (let i = 0; i < 2000; i++) {
    value = Array.from({ length: 1 + rnd(12) }, () => parts[rnd(parts.length)]).join("");
    frame();
    const div = container.querySelector("div")!;
    if (tags(container).join() !== "div,span,style" || div.getAttribute("title") !== value || div.querySelector("span")!.textContent !== value) {
      td.dump("fail.txt", JSON.stringify({ i, value, html: container.innerHTML }));
      throw new Error(`fuzz broke at ${i}: ${JSON.stringify(value)}`);
    }
  }
  td.dump("ok.txt", "2000 rounds");
});

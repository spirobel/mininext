// the dom is written only where a value changed. a MutationObserver counts every write.
// the result can be right and still slow (an attribute set again each frame),
// so the other tests do not catch this. runs in jsdom and in chrome (tests/chrome/).
//   bun test ./tests/performance/writes.test.ts
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
  // every dom write since the last call, as short lines
  const observer = new MutationObserver(() => {});
  observer.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });
  const writes = () =>
    observer.takeRecords().map((r) =>
      r.type === "attributes"
        ? `attr ${r.attributeName}`
        : r.type === "characterData"
          ? `text ${r.target.nodeValue}`
          : `list +${r.addedNodes.length} -${r.removedNodes.length} <${r.target.nodeName.toLowerCase()}>`,
    );
  return { container, frame, writes };
}

// one page with every kind of value
function page() {
  const s = { title: "t", cls: "a", off: false, items: [1, 2, 3], opts: ["o1", "o2"], val: "v", css: "c", deep: "d" };
  let counter: { value: number } = { value: 0 };
  const comp = (mini: Mini) => {
    counter = mini.state("n", 0);
    return mini.html`<em onclick=${() => counter.value++}>${counter.value}</em>`;
  };
  const nest = (d: number): MiniHtmlString =>
    d === 0 ? html`<span>${s.deep}</span>` : html`<div class="d${d}">${nest(d - 1)}</div>`;
  const app = () => html`<section title="${s.title}" class="x ${s.cls}">
    <h1>${s.title}</h1>
    <ul>${s.items.map((i) => html`<li data-i="${i}">${i}</li>`)}</ul>
    <button disabled=${s.off} onclick=${() => {}}>b</button>
    <input value="${s.val}" />
    <select value="${s.opts[0]}">${s.opts.map((o) => html`<option value="${o}">${o}</option>`)}</select>
    <textarea>${s.title}</textarea>
    <style>.a{content:"${s.css}"}</style>
    ${comp}
    ${nest(3)}
  </section>`;
  return { s, app, counter: () => counter };
}

test("w01 idle frames write nothing", () => {
  const td = testData("w01-idle");
  const p = page();
  const { container, frame, writes } = mount(p.app);
  const all: string[] = [];
  for (let i = 0; i < 50; i++) {
    frame();
    all.push(...writes());
  }
  td.dump("dom.html", container.innerHTML);
  td.dump("writes.txt", all.join("\n"));
  expect(all).toEqual([]);
});

test("w02 a text value 3 levels deep: one write to the same text node", () => {
  const td = testData("w02-deep-text");
  const p = page();
  const { container, frame, writes } = mount(p.app);
  const span = container.querySelector("span")!;
  const text = span.firstChild;
  p.s.deep = "e";
  frame();
  const w = writes();
  td.dump("writes.txt", w.join("\n"));
  expect(w).toEqual(["text e"]);
  expect(container.querySelector("span")).toBe(span);
  expect(span.firstChild).toBe(text);
});

test("w03 one value in a multi-value attribute: one attribute write", () => {
  const td = testData("w03-class");
  const p = page();
  const { container, frame, writes } = mount(p.app);
  p.s.cls = "b";
  frame();
  const w = writes();
  td.dump("writes.txt", w.join("\n"));
  expect(w).toEqual(["attr class"]);
  expect(container.querySelector("section")!.getAttribute("class")).toBe("x b");
});

test("w04 boolean attribute: one write per toggle", () => {
  const td = testData("w04-disabled");
  const p = page();
  const { frame, writes } = mount(p.app);
  p.s.off = true;
  frame();
  const on = writes();
  frame();
  const same = writes();
  p.s.off = false;
  frame();
  const off = writes();
  td.dump("writes.json", JSON.stringify({ on, same, off }));
  expect(on).toEqual(["attr disabled"]);
  expect(same).toEqual([]);
  expect(off).toEqual(["attr disabled"]);
});

test("w05 a value in <style>: one write to its text", () => {
  const td = testData("w05-style");
  const p = page();
  const { container, frame, writes } = mount(p.app);
  const style = container.querySelector("style")!;
  p.s.css = "z";
  frame();
  const w = writes();
  td.dump("writes.txt", w.join("\n"));
  expect(w).toEqual([`text .a{content:"z"}`]);
  expect(container.querySelector("style")).toBe(style);
});

test("w06 list push: only adds, in the list, old items stay the same nodes", () => {
  const td = testData("w06-push");
  const p = page();
  const { container, frame, writes } = mount(p.app);
  const before = [...container.querySelectorAll("li")];
  p.s.items.push(4);
  frame();
  const w = writes();
  td.dump("writes.txt", w.join("\n"));
  expect(w.length).toBeGreaterThan(0);
  expect(w.every((x) => /^list \+\d+ -0 <ul>$/.test(x))).toBe(true);
  const after = [...container.querySelectorAll("li")];
  expect(after.length).toBe(4);
  for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]);
});

test("w07 list pop: only removes, other items stay the same nodes", () => {
  const td = testData("w07-pop");
  const p = page();
  const { container, frame, writes } = mount(p.app);
  const before = [...container.querySelectorAll("li")];
  p.s.items.pop();
  frame();
  const w = writes();
  td.dump("writes.txt", w.join("\n"));
  expect(w.length).toBeGreaterThan(0);
  expect(w.every((x) => /^list \+0 -\d+ <ul>$/.test(x))).toBe(true);
  const after = [...container.querySelectorAll("li")];
  expect(after).toEqual(before.slice(0, 2));
});

test("w08 one list item changes: one text write and one attribute write in that item", () => {
  const td = testData("w08-one-item");
  const p = page();
  const { frame, writes } = mount(p.app);
  p.s.items[1] = 9;
  frame();
  const w = writes();
  td.dump("writes.txt", w.join("\n"));
  expect(w.sort()).toEqual(["attr data-i", "text 9"]);
});

test("w09 component state from a click: one text write", () => {
  const td = testData("w09-state");
  const p = page();
  const { container, frame, writes } = mount(p.app);
  (container.querySelector("em") as HTMLElement).click();
  frame();
  const w = writes();
  td.dump("writes.txt", w.join("\n"));
  expect(p.counter().value).toBe(1);
  expect(w).toEqual(["text 1"]);
});

test("w10 input value is a live property: no attribute write, the field updates", () => {
  const td = testData("w10-input-value");
  const p = page();
  const { container, frame, writes } = mount(p.app);
  p.s.val = "new";
  frame();
  const w = writes();
  td.dump("writes.txt", w.join("\n"));
  expect(w).toEqual([]);
  expect((container.querySelector("input") as HTMLInputElement).value).toBe("new");
});

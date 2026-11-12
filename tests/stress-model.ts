// the random workload, shared by the jsdom stress test and the cdp browser test.
// like the old minitest.ts: templates flip, values change every frame,
// lists grow and shrink, item kinds switch, one template object is used many times.
// each item has its own list (tags), so lists sit inside list items.
import { html, makeNewMini, type Mini, type MiniHtmlString, type MiniValue } from "../mininext/browser";

type Kind = "text" | "tpl" | "null" | "comp" | "false";
type Item = { id: number; kind: Kind; label: string; on: boolean; clicks: number; tags: string[] };
const KINDS: Kind[] = ["text", "tpl", "null", "comp", "false"];
const WORDS = ["a", "b", "<b>", '"q"', "'s'", "&amp;", "x y", "", "0", "</style>", "", "javascript", "ok"];
const BASELINE = () => ({
  variant: 0,
  title: "t",
  cls: "c",
  items: [] as Item[],
  rows: [] as number[],
  opts: [] as string[],
  picked: "",
  show: false,
  deep: 0,
  typed: "",
});

export function createModel(start: number) {
  // mulberry32: small seeded prng. (an lcg with seed % n repeats in its low bits)
  let seed = start;
  const rnd = (n: number) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const pick = <T,>(a: T[]) => a[rnd(a.length)]!;
  const state = BASELINE();
  let nextId = 0;
  const newItem = (): Item => ({ id: nextId++, kind: pick(KINDS), label: pick(WORDS), on: rnd(2) === 0, clicks: 0, tags: Array.from({ length: rnd(4) }, () => pick(WORDS)) });

  const shared = html`<i class="shared">${"s"}</i>`;
  const item = (it: Item): MiniValue =>
    it.kind === "text"
      ? it.label
      : it.kind === "null"
        ? null
        : it.kind === "false"
          ? false
          : it.kind === "tpl"
            ? html`<b class="${it.on ? "on" : "off"}" data-id="${it.id}">${it.label}
                <button onclick=${() => it.clicks++}>${it.clicks}</button>
                <span class="tags">${it.tags.map((t) => html`<i>${t}</i>`)}</span></b>`
            : (mini: Mini) => {
                mini.state("renders", 0).value++;
                return mini.html`<em title="${it.label}">${it.label}</em>${it.tags}`;
              };
  const nest = (d: number): MiniHtmlString =>
    d === 0 ? html`<span>${state.title}</span>` : html`<div class="d${d}">${nest(d - 1)}</div>`;

  const app = () =>
    state.variant === 0
      ? html`<section title="${state.title}" class="a ${state.cls}">
          <h1>${state.title}</h1>${shared}${shared}
          <ul>${state.items.map((it) => html`<li>${item(it)}</li>`)}</ul>
          <select value="${state.picked}">${state.opts.map((o) => html`<option value="${o}">${o}</option>`)}</select>
          <table><tbody>${state.rows.map((r) => html`<tr><td>${r}</td></tr>`)}</tbody></table>
          <input oninput=${(e: Event) => (state.typed = (e.target as HTMLInputElement).value)} />
          ${state.typed}
          ${state.show ? nest(state.deep) : ""}
          <style>.x{content:"${state.title}"}</style>
        </section>`
      : html`<article class="${state.cls}">${state.items.length} items ${shared}${state.items.map(item)}</article>`;

  function mutate() {
    if (rnd(100) < 4) state.variant = 1 - state.variant;
    if (rnd(3) === 0) state.title = pick(WORDS) + pick(WORDS);
    if (rnd(4) === 0) state.cls = pick(WORDS);
    for (let k = rnd(4); k > 0; k--) {
      const op = rnd(9);
      if ((op === 0 || op === 7) && state.items.length < 40) state.items.push(newItem());
      else if (op === 1) state.items.pop();
      else if (op === 2 && state.items.length) state.items.splice(rnd(state.items.length), 1);
      else if (op === 3 && state.items.length) state.items[rnd(state.items.length)] = newItem();
      else if (op === 4 && state.items.length) state.items[rnd(state.items.length)]!.on = rnd(2) === 0;
      else if (op === 5) state.items.reverse();
      else if (op === 6 && state.items.length) state.items[rnd(state.items.length)]!.kind = pick(KINDS);
      else if (op === 8 && state.items.length) {
        // the list inside an item: grow, shrink, change one, or empty it
        const tags = state.items[rnd(state.items.length)]!.tags;
        const t = rnd(4);
        if (t === 0 && tags.length < 12) tags.push(pick(WORDS));
        else if (t === 1) tags.pop();
        else if (t === 2 && tags.length) tags[rnd(tags.length)] = pick(WORDS);
        else if (t === 3) tags.length = 0;
      }
    }
    if (rnd(5) === 0) state.rows = Array.from({ length: rnd(30) }, () => rnd(1000));
    if (rnd(6) === 0) state.opts = Array.from({ length: rnd(10) }, (_, i) => `o${i}${pick(WORDS)}`);
    if (rnd(4) === 0) state.picked = state.opts.length ? pick(state.opts) : "";
    if (rnd(10) === 0) state.show = !state.show;
    if (rnd(10) === 0) state.deep = rnd(4);
  }
  // click a random handler button and type into the input: handlers must stay live
  function interact(container: Element) {
    const buttons = container.querySelectorAll("button");
    if (buttons.length && rnd(3) === 0) (buttons[rnd(buttons.length)] as HTMLButtonElement).click();
    const input = container.querySelector("input");
    if (input && rnd(5) === 0) {
      input.value = pick(WORDS);
      input.dispatchEvent(new Event("input"));
    }
  }
  const reset = () => Object.assign(state, BASELINE());

  // the stressed dom must equal a fresh render of the same state,
  // and every cache key must be reachable from the root
  function check(container: Element, cache: Map<string, any>, root: string) {
    const fresh = document.createElement("div");
    const cac = { cache: new Map(), cursor: root };
    const mini = makeNewMini(cac);
    app().resolve(mini).render(fresh, cac);
    const a = normalized(container);
    const b = normalized(fresh);
    const tags = state.items.reduce((n, it) => n + it.tags.length, 0);
    return { same: a === b, a, b, orphans: orphans(cache, root), cache: cache.size, nodes: nodeCount(container), items: state.items.length, tags };
  }
  return { state, app, mutate, interact, reset, check };
}

export const normalized = (el: Element) => el.innerHTML.replace(/<!---->/g, "");
export function nodeCount(el: Element) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_ALL);
  let n = 0;
  while (w.nextNode()) n++;
  return n;
}
export function orphans(cache: Map<string, any>, root: string) {
  const seen = new Set<string>();
  const walk = (key: string) => {
    if (seen.has(key) || !cache.has(key)) return;
    seen.add(key);
    const value = cache.get(key).value;
    if (value && typeof value === "object" && value.slots) for (const s of value.slots) walk(s);
  };
  walk(root);
  return [...cache.keys()].filter((k) => !seen.has(k));
}

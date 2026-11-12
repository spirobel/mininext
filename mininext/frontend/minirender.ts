import {
  getCacheEntry,
  type CacheAndCursor,
  type CacheObject,
  type ResolvedMiniCacheHtmlString,
  type ResolvedMiniCacheValue,
} from "../minicache";
import { checkAttribute, isList, valuePositions, type StringArray } from "../core";

// each value position gets a marker in the html we parse:
// between tags a comment <!--#i#>, inside a tag a token #i#.
// after the parse we keep the nodes and never parse again for values.
const MARK = "";
const COMMENT_MARKER = new RegExp(`^${MARK}(\\d+)${MARK}$`);
const ATTR_MARKER = new RegExp(`${MARK}(\\d+)${MARK}`);
// in <style>, <textarea>, <title> a comment is plain text
const RAW_TEXT_MARKER = new RegExp(`<!--${MARK}(\\d+)${MARK}-->`);
// for these the live property counts, not the attribute
const LIVE_PROPS = new Set(["value", "checked", "selected"]);
const REBUILD_LIMIT = 10;
const UNSET = Symbol("unset");
let DEV = true;
try {
  DEV = process.env.NODE_ENV !== "production"; // replaced by the bundler
} catch {}

type Part = {
  node: Text | Element;
  name?: string; // attribute name, none for a text part
  strings: string[];
  idx: number[]; // value index between strings[k] and strings[k+1]
  last?: unknown;
};
type Range = [start: Comment, end: Comment];
export type SlotDom = {
  start: Comment;
  end: Comment;
  text?: Text; // text slot
  kids?: Map<number, Range>; // template slot: child ranges by value index
  parts?: Part[]; // template slot: attributes and raw text
  items?: Range[]; // list slot
};

const mounts = new WeakMap<Node, Range>();
export function render(
  target: Element | HTMLElement,
  cac: CacheAndCursor,
): CacheAndCursor {
  let range = mounts.get(target);
  if (!range) {
    range = [document.createComment(""), document.createComment("")];
    target.replaceChildren(...range);
    mounts.set(target, range);
  }
  renderSlot(cac, range[0], range[1]);
  return cac;
}

// a slot owns the nodes between start and end
function renderSlot(cac: CacheAndCursor, start: Comment, end: Comment) {
  const entry = getCacheEntry(cac);
  if (!entry) return;
  if (entry.dom?.start !== start) {
    entry.dom = { start, end }; // new place, render it fresh
    entry.dirty = true;
  }
  const value = entry.value;
  if (!value || typeof value !== "object") {
    if (!entry.dirty) return;
    entry.dirty = false;
    const text = String(value ?? "");
    if (entry.dom.text) {
      entry.dom.text.nodeValue = text;
      return;
    }
    clear(start, end);
    entry.dom = { start, end, text: document.createTextNode(text) };
    end.before(entry.dom.text!);
    return;
  }
  if (isList(value.stringLiterals)) return renderList(cac, entry, value);
  if (entry.dirty || !entry.dom.kids) return rebuild(cac, entry, value);
  entry.rebuilds = 0;
  renderKids(cac, value, entry.dom);
  applyParts(entry.dom.parts!, value.values!);
}

function rebuild(
  cac: CacheAndCursor,
  entry: CacheObject,
  value: ResolvedMiniCacheHtmlString,
) {
  entry.rebuilds = (entry.rebuilds ?? 0) + 1;
  if (DEV && entry.rebuilds >= REBUILD_LIMIT)
    throw new Error(
      `mininext: slot ${cac.cursor} was rebuilt ${entry.rebuilds} frames in a row.
       its template changes each frame, so focus and child state are lost.
       keep the template the same and change only values.
       template: ${value.stringLiterals!.join("${}").slice(0, 200)}`,
    );
  const { start, end } = entry.dom!;
  clear(start, end);
  const { fragment, kids, parts } = parse(value.stringLiterals!);
  entry.dom = { start, end, kids, parts };
  // fill the fragment before it goes into the page,
  // so no marker ever reaches the page (like a src)
  renderKids(cac, value, entry.dom);
  applyParts(parts, value.values!);
  end.before(fragment);
  entry.dirty = false;
}

function renderKids(
  cac: CacheAndCursor,
  value: ResolvedMiniCacheHtmlString,
  dom: SlotDom,
) {
  for (const [i, [start, end]] of dom.kids!)
    renderSlot({ ...cac, cursor: value.slots![i]! }, start, end);
}

// items are reused by index, so a list can grow without a rebuild
function renderList(
  cac: CacheAndCursor,
  entry: CacheObject,
  value: ResolvedMiniCacheHtmlString,
) {
  if (entry.dirty || !entry.dom!.items) {
    const { start, end } = entry.dom!;
    clear(start, end);
    entry.dom = { start, end, items: [] };
    entry.dirty = false;
  }
  const { items, end } = entry.dom!;
  const count = value.slots!.length;
  while (items!.length > count) {
    const [s, e] = items!.pop()!;
    clear(s, e);
    s.remove();
    e.remove();
  }
  while (items!.length < count) {
    const range: Range = [document.createComment(""), document.createComment("")];
    end.before(...range);
    items!.push(range);
  }
  items!.forEach(([s, e], i) =>
    renderSlot({ ...cac, cursor: value.slots![i]! }, s, e),
  );
}

function parse(stringLiterals: StringArray) {
  const inTag = valuePositions(stringLiterals);
  let markup = "";
  stringLiterals.forEach((literal, i) => {
    markup += literal;
    if (i === stringLiterals.length - 1) return;
    const token = `${MARK}${i}${MARK}`;
    markup += inTag[i] ? token : `<!--${token}-->`;
  });
  const template = document.createElement("template");
  template.innerHTML = markup;
  const fragment = template.content;
  const kids = new Map<number, Range>();
  const parts: Part[] = [];
  const walker = document.createTreeWalker(
    fragment,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT,
  );
  const nodes: Node[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.nodeType === Node.COMMENT_NODE) {
      const match = COMMENT_MARKER.exec((node as Comment).data);
      if (!match) continue;
      const start = document.createComment("");
      (node as Comment).before(start);
      (node as Comment).data = "";
      kids.set(Number(match[1]), [start, node as Comment]);
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      if (text.data.includes(MARK))
        parts.push(splitPart(text, text.data, RAW_TEXT_MARKER));
    } else {
      const el = node as Element;
      for (const attr of [...el.attributes]) {
        if (attr.name.includes(MARK))
          throw new Error(
            `mininext: a value in <${el.localName}> must be an attribute value, like name="\${value}"`,
          );
        if (!attr.value.includes(MARK)) continue;
        const part = splitPart(el, attr.value, ATTR_MARKER, attr.name);
        // a single value sets the whole attribute later (or a property)
        if (isSingle(part)) el.removeAttribute(attr.name);
        parts.push(part);
      }
    }
  }
  return { fragment, kids, parts };
}

function splitPart(
  node: Text | Element,
  text: string,
  marker: RegExp,
  name?: string,
): Part {
  // split with a capture group: [str, idx, str, idx, str]
  const pieces = text.split(marker);
  const strings = pieces.filter((_, k) => k % 2 === 0);
  const idx = pieces.filter((_, k) => k % 2 === 1).map(Number);
  return { node, name, strings, idx, last: UNSET };
}
function isSingle(part: Part) {
  return part.idx.length === 1 && part.strings.every((s) => s === "");
}

function applyParts(parts: Part[], values: ResolvedMiniCacheValue[]) {
  for (const part of parts) {
    const el = part.node as any;
    if (!part.name) {
      const text = join(part, values);
      if (text !== part.last) el.nodeValue = part.last = text;
      continue;
    }
    if (!isSingle(part)) {
      const text = join(part, values);
      if (text === part.last) continue;
      checkAttribute(part.name, text);
      el.setAttribute(part.name, (part.last = text));
      continue;
    }
    const value = values[part.idx[0]!];
    if (typeof value === "function") {
      checkAttribute(part.name, value);
      el[part.name] = value; // handler: set each frame, so it is never stale
      continue;
    }
    if (value === part.last) continue;
    checkAttribute(part.name, value);
    part.last = value;
    if (LIVE_PROPS.has(part.name) && part.name in el) {
      el[part.name] = part.name === "value" ? String(value ?? "") : !!value;
    } else if (value === null || value === undefined || typeof value === "boolean") {
      el.toggleAttribute(part.name, !!value);
    } else {
      el.setAttribute(part.name, String(value));
    }
  }
}

function join(part: Part, values: ResolvedMiniCacheValue[]) {
  let text = part.strings[0]!;
  part.idx.forEach((i, k) => {
    const value = values[i];
    if (value && typeof value === "object")
      throw new Error(
        "mininext: inside a tag or <style> use only string, number, boolean or a handler",
      );
    text += (value === null || value === undefined || value === false ? "" : String(value)) + part.strings[k + 1];
  });
  return text;
}

function clear(start: Node, end: Node) {
  while (start.nextSibling && start.nextSibling !== end)
    start.nextSibling.remove();
}

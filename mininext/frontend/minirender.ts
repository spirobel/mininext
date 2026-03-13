import {
  getCacheEntryThrows,
  getResolvedMiniHtmlStringThrows,
  type CacheAndCursor,
  type CacheObject,
  type ResolvedMiniCacheValue,
} from "../minicache";

export function render(
  target: Element | HTMLElement,
  cac: CacheAndCursor,
): CacheAndCursor {
  const cacheEntry = getCacheEntryThrows(cac);
  const htmlsnippet = getResolvedMiniHtmlStringThrows(cac);
  if (!htmlsnippet.stringLiterals || !htmlsnippet.values || !htmlsnippet.slots)
    throw new Error("should have literals,values & slots once resolved");
  const children: Map<string, CacheObject> = new Map();
  let new_html_portion: HTMLElement | null = null;

  if (cacheEntry.dirty) {
    let placeholder = "";
    let index = 0;
    const inside = {
      element: false,
      singleQuotes: false,
      doubleQuotes: false,
      lastElement: "",
    };
    for (const literal of htmlsnippet.stringLiterals) {
      isInside(literal, inside);
      const id = htmlsnippet.slots[index];
      if (inside.element || inside.lastElement.trim().endsWith("<style")) {
        placeholder += literal + escapeHtml(htmlsnippet.values[index]);
      } else if (!inside.element && index < htmlsnippet.values.length) {
        placeholder += literal + `<span id="${id}"></span>`;
      } else {
        placeholder += literal;
      }
      index++;
    }
    new_html_portion = htmlPortion(placeholder);
    const idmap = makeIdMap(new_html_portion);
    for (const childId of htmlsnippet.slots) {
      const cacheEntry = cac.cache.get(childId);
      if (!cacheEntry) continue;
      cacheEntry.el = idmap.get(childId) as HTMLElement;
      children.set(childId, cacheEntry);
    }
  }

  if (!cacheEntry.dirty) {
    for (const childId of htmlsnippet.slots) {
      const cacheEntry = cac.cache.get(childId);
      if (!cacheEntry) continue;
      children.set(childId, cacheEntry);
    }
  }
  for (const [childId, child] of children) {
    const value = child.value;
    if (typeof value == "object") {
      const childtarget = child.el;
      if (!childtarget)
        throw new Error(`if not dirty should have el: ${childId}`);
      render(childtarget, { ...cac, cursor: childId });
    } else {
      if (!child.dirty) continue;
      if (!child.el) child.el = document.getElementById(childId) ?? undefined;
      if (!child.el) continue; //throw new Error(`${child.value} should have el`);
      child.el.textContent = String(value);
      child.dirty = false;
    }
  }
  if (new_html_portion) {
    const parent = target.parentNode;
    if (parent) parent.replaceChild(new_html_portion, target);
    cacheEntry.el = new_html_portion;
    cacheEntry.dirty = false;
  }

  return cac;
}

export type IsInside = {
  element: boolean;
  singleQuotes: boolean;
  doubleQuotes: boolean;
  lastElement: string;
};

export function isInside(stringLiteral: string, isInside: IsInside) {
  for (const char of stringLiteral) {
    // Check for HTML element start (< not in quotes)
    if (char === "<" && !isInside.singleQuotes && !isInside.doubleQuotes) {
      isInside.element = true;
    }
    if (char === ">" && !isInside.singleQuotes && !isInside.doubleQuotes) {
      isInside.element = false;
    }
    if (isInside.element) isInside.lastElement += char;
    if (!isInside.element) continue;
    // Handle quotes
    if (char === "'" && !isInside.doubleQuotes) {
      isInside.singleQuotes = !isInside.singleQuotes;
    } else if (char === '"' && !isInside.singleQuotes) {
      isInside.doubleQuotes = !isInside.doubleQuotes;
    }
  }
}

function escapeHtml(string?: ResolvedMiniCacheValue): string {
  if (!string) return "";
  if (typeof string !== "string" && typeof string !== "number")
    throw new Error(
      `inside < html > tags or open style tags only use string | number as values.
       ${JSON.stringify(string)}`,
    );

  string = String(string);
  const div = document.createElement("div");
  div.textContent = string;
  return div.innerHTML;
}

function htmlPortion(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html;

  const fragment = template.content;

  const hasManyRoots = fragment.childElementCount > 1;
  if (hasManyRoots)
    throw new Error(
      `Mini html placeholder template:\n
    ${html}\n
    Root elements: ${fragment.childElementCount}
    Every mini html string should have only one root element.\n`,
    );

  return fragment.firstElementChild! as HTMLElement;
}
// if element is not in DOM yet we cant use getElementById
export function makeIdMap(parent: Element): Map<string, HTMLElement> {
  const idMap = new Map<string, HTMLElement>();

  function recurse(el: Element): void {
    if (el.id) {
      idMap.set(el.id, el as HTMLElement);
    }
    for (const child of el.children) {
      recurse(child);
    }
  }

  recurse(parent);
  return idMap;
}

import {
  getCacheEntry,
  type CacheAndCursor,
  type MiniCache,
  type ResolvedMiniCacheHtmlString,
  type ResolvedMiniCacheValue,
} from "../minicache";
import {
  isList,
  resolveMiniValue,
  valuePositions,
  type Mini,
  type MiniValue,
  type ResolvedMiniHtmlString,
  type StringArray,
} from "../core";
import { render } from "./minirender";

export function resolve(
  stringLiterals: StringArray,
  unresolvedValues: MiniValue[],
  mini: Mini,
): ResolvedMiniHtmlString {
  const cac = mini.cacheAndCursor;
  const inTag = valuePositions(stringLiterals);
  let entry = getCacheEntry(cac);
  if (!entry) {
    entry = { value: null, dirty: true };
    cac.cache.set(cac.cursor, entry);
  }
  if (!entry.value || typeof entry.value !== "object") {
    entry.value = { stringLiterals: null, values: null, slots: null, state: null };
    entry.dirty = true;
  }
  const cacheValue: ResolvedMiniCacheHtmlString = entry.value;
  const old = cacheValue.stringLiterals;
  if (isList(old) && isList(stringLiterals)) {
    // same list, maybe other length: drop only the items past the end
    for (let i = unresolvedValues.length; i < (cacheValue.slots?.length ?? 0); i++)
      deleteSlot(cac.cache, `${cac.cursor}.${i}`);
  } else if (!old || !arraysEqual(old, stringLiterals)) {
    // other template: the children belong to the old one
    deleteAllChildren(cac);
    entry.dirty = true;
  }
  // keys are paths, so they stay the same when only values change
  const slots = unresolvedValues.map((_, i) => `${cac.cursor}.${i}`);
  cacheValue.stringLiterals = stringLiterals;
  cacheValue.slots = slots;
  cacheValue.values = unresolvedValues.map((value, i) =>
    inTag[i]
      ? (value as ResolvedMiniCacheValue)
      : cacheChild(cac.cache, slots[i]!, value),
  );
  // in a tag, functions are handlers, not components
  const values = unresolvedValues.map((value, i) =>
    inTag[i] ? value : resolveMiniValue(value, mini, slots[i]!),
  );
  return {
    slots,
    stringLiterals,
    values: values as ResolvedMiniHtmlString["values"],
    render: (target: Element | HTMLElement, cacheAndCursor = cac) =>
      render(target, cacheAndCursor),
  };
}

// text values get their own cache entry, templates make theirs in resolve
function cacheChild(
  cache: MiniCache,
  key: string,
  value: MiniValue,
): ResolvedMiniCacheValue {
  if (typeof value === "function" || (value && typeof value === "object"))
    return { childId: key };
  const text =
    value === null || value === undefined || value === false
      ? ""
      : String(value);
  const entry = cache.get(key);
  if (!entry) {
    cache.set(key, { value: text, dirty: true });
    return text;
  }
  if (entry.value === text) return text;
  if (entry.value && typeof entry.value === "object")
    deleteAllChildren({ cache, cursor: key });
  entry.value = text;
  entry.dirty = true;
  return text;
}

function deleteSlot(cache: MiniCache, key: string) {
  deleteAllChildren({ cache, cursor: key });
  cache.delete(key);
}
function deleteAllChildren(cac: CacheAndCursor) {
  const value = getCacheEntry(cac)?.value;
  if (!value || typeof value !== "object" || !value.slots) return;
  for (const child of value.slots) deleteSlot(cac.cache, child);
}
function arraysEqual(arr1: StringArray, arr2: StringArray): boolean {
  if (arr1 === arr2) return true;
  if (arr1.length !== arr2.length) return false;
  return arr1.every((str, index) => str === arr2[index]);
}

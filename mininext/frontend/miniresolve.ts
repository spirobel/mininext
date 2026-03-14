import {
  getCacheEntry,
  getResolvedMiniHtmlStringThrows,
  type CacheAndCursor,
  type ResolvedMiniCacheValue,
} from "../minicache";
import {
  makeNewMini,
  type Mini,
  type MiniValue,
  type ResolvedMiniHtmlString,
  type ResolvedMiniValue,
  type StringArray,
} from "../mininext";
import { isInside, render } from "./minirender";

export function resolveMiniValue(
  value: MiniValue,
  parentMini: Mini,
  slotId: string,
): ResolvedMiniValue {
  // make new mini with slotid as cursor
  const mini = makeNewMini({ ...parentMini.cacheAndCursor, cursor: slotId });

  if (typeof value === "function") {
    const component = value(mini);
    // if this happened we need to save the state to the cache
    return component.resolve(mini);
  }
  if (value && typeof value === "object" && "resolve" in value)
    return value.resolve(mini);
  return value;
}
export function resolveMiniHtmlString(
  stringLiterals: StringArray,
  unresolvedValues: MiniValue[],
  mini: Mini,
  slots: string[],
): ResolvedMiniHtmlString {
  const resolvedValues: ResolvedMiniValue[] = [];
  let index = 0;
  for (const unresolvedValue of unresolvedValues) {
    const slotId = slots[index];
    if (!slotId)
      throw new Error(`Could not find slot id for ${unresolvedValue}`);
    resolvedValues.push(resolveMiniValue(unresolvedValue, mini, slotId));
    index++;
  }

  return {
    slots,
    stringLiterals,
    values: resolvedValues,
    render: (
      target: Element | HTMLElement,
      cacheAndCursor?: CacheAndCursor,
    ) => {
      if (!cacheAndCursor) cacheAndCursor = mini.cacheAndCursor; //and cache here
      return render(target, cacheAndCursor);
    },
  };
}

export function resolveValuesForCache(
  unresolvedValues: MiniValue[],
  cac: CacheAndCursor,
  slots: string[] | null = null,
) {
  if (!slots) slots = unresolvedValues.map(() => crypto.randomUUID());
  const values: ResolvedMiniCacheValue[] = unresolvedValues.map(
    (value, index) => {
      const childId = slots[index];
      if (!childId) throw new Error("Could not find slot id for value");

      // CASE: primitive
      if (typeof value === "string" || typeof value === "number") {
        const cacheEntry = cac.cache.get(childId);
        if (cacheEntry) {
          if (cacheEntry.value === value) return value;
          cacheEntry.value = value;
          cacheEntry.dirty = true;
          return value;
        }
        cac.cache.set(childId, { value, dirty: true });
        return value;
      }

      // CASE: child mini htmlstring or component

      return { childId };
    },
  );
  return { slots, values };
}
export function resolve(
  stringLiterals: StringArray,
  unresolvedValues: MiniValue[],
  mini: Mini,
): ResolvedMiniHtmlString {
  // CASE our cache entry does not exist yet
  const cac = mini.cacheAndCursor;
  const cacheEntry = getCacheEntry(cac);
  if (!cacheEntry) {
    const { slots, values } = resolveValuesForCache(unresolvedValues, cac);

    cac.cache.set(cac.cursor, {
      value: { stringLiterals, values, slots, state: null },
      dirty: true,
    });
  } else if (cacheEntry && typeof cacheEntry.value !== "object") {
    const { slots, values } = resolveValuesForCache(unresolvedValues, cac);
    cacheEntry.dirty = true;
    cacheEntry.value = {
      stringLiterals,
      values,
      slots,
      state: null,
    };
  } else {
    const cacheValue = getResolvedMiniHtmlStringThrows(cac);

    const htmlUnchanged = arraysEqual(
      stringLiterals,
      cacheValue.stringLiterals || [],
    );
    const styleOrTagContentChanged = parametricHtmlChanges(
      stringLiterals,
      cacheValue.values,
      unresolvedValues,
    );
    const { slots, values } = resolveValuesForCache(
      unresolvedValues,
      cac,
      htmlUnchanged
        ? cacheValue.slots
        : unresolvedValues.map(() => crypto.randomUUID()),
    );
    if (!htmlUnchanged || styleOrTagContentChanged) {
      //recursively delete all children
      deleteAllChildren(cac);
      cacheValue.stringLiterals = stringLiterals;
      cacheValue.slots = slots;
      cacheEntry.dirty = true;
    }
    cacheValue.values = values;
  }
  // at this point we know the cache entry exists

  const cacheValue = getResolvedMiniHtmlStringThrows(cac);
  const slots = cacheValue.slots;
  // we also know slots exist
  if (!slots) throw new Error("slots not found");
  return resolveMiniHtmlString(stringLiterals, unresolvedValues, mini, slots);
}
function deleteAllChildren(cac: CacheAndCursor, last = true) {
  const cacheEntry = getCacheEntry(cac);
  if (!cacheEntry) return;
  if (typeof cacheEntry.value !== "object") {
    cac.cache.delete(cac.cursor); // leaf primitive value
    return;
  }
  const cacheValue = getResolvedMiniHtmlStringThrows(cac);
  if (!cacheValue.slots) {
    // when attaching state we have a placeholder cache entry with slots null
    return;
  }
  for (const child of cacheValue.slots) {
    deleteAllChildren({ ...cac, cursor: child }, false); // delete all children
  }
  if (last) return; // dont delete the node that called this
  cac.cache.delete(cac.cursor); // delete intermediate nodes
}
function arraysEqual(arr1: StringArray, arr2: StringArray): boolean {
  if (arr1.length !== arr2.length) return false;
  return arr1.every((str, index) => str === arr2[index]);
}

export function parametricHtmlChanges(
  stringLiterals: StringArray,
  cached_values: ResolvedMiniCacheValue[] | null,
  values: MiniValue[],
): boolean {
  const inside = {
    element: false,
    singleQuotes: false,
    doubleQuotes: false,
    lastElement: "",
  };
  let index = 0;
  for (const literal of stringLiterals) {
    isInside(literal, inside);
    if (inside.element || inside.lastElement.trim().endsWith("<style")) {
      const oldValue = cached_values ? cached_values[index] : undefined;
      const newValue = values[index];
      if (oldValue !== newValue) return true;
      if (typeof oldValue === "undefined") return true;
      if (typeof newValue === "undefined") return true;
    }
    index++;
  }
  return false;
}

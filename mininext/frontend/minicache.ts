import type { StringArray } from "./minirender";

export function getCacheEntry(cacheAndCursor: CacheAndCursor) {
  return cacheAndCursor.cache.get(cacheAndCursor.cursor);
}
export function getCacheEntryThrows(cacheAndCursor: CacheAndCursor) {
  const entry = getCacheEntry(cacheAndCursor);
  if (!entry)
    throw new Error(
      `Could not find cache entry for cursor ${cacheAndCursor.cursor}`,
    );
  return entry;
}
export function getResolvedMiniHtmlStringThrows(
  cacheAndCursor: CacheAndCursor,
) {
  const cacheEntry = getCacheEntryThrows(cacheAndCursor);
  if (typeof cacheEntry.value !== "object")
    throw new Error(
      `the result is a primitive value, we expected a ResolvedMiniCacheHtmlString. ${JSON.stringify(
        cacheEntry,
      )}`,
    );
  return cacheEntry.value;
}

export function state<T>(
  name: string,
  value: T,
  cacheAndCursor: CacheAndCursor,
): StateObject<T> {
  let cacheEntry = getCacheEntry(cacheAndCursor);
  if (!cacheEntry) {
    cacheAndCursor.cache.set(cacheAndCursor.cursor, {
      value: {
        stringLiterals: null,
        values: null,
        slots: null,
        state: [],
      },
      dirty: true,
    });
    cacheEntry = getCacheEntryThrows(cacheAndCursor);
  }
  const cacheValue = getResolvedMiniHtmlStringThrows(cacheAndCursor);
  if (!cacheValue.state) cacheValue.state = [];
  const stateObjects = cacheValue.state;

  const stateObject = stateObjects.find(
    (stateObject) => stateObject.name === name,
  );
  if (stateObject) return stateObject as StateObject<T>; //CASE: state already exists
  const newStateObject: StateObject<T> = { value, name };
  stateObjects.push(newStateObject);
  cacheEntry.dirty = true; // we want to dirty the cache in any case, not just if cache entry did not exist yet
  return newStateObject;
}
export type CacheValue = PrimitiveValue | ResolvedMiniCacheHtmlString;

export type CacheObject = {
  el?: HTMLElement;
  value: CacheValue;
  dirty: boolean;
};

export type MiniCache = Map<string, CacheObject>;
export type CacheAndCursor = {
  cache: MiniCache;
  cursor: string;
};

export type PrimitiveValue = string | number;

export type ResolvedMiniCacheHtmlString = {
  stringLiterals: StringArray | null;
  values: ResolvedMiniCacheValue[] | null;
  slots: string[] | null;
  state: StateObject[] | null;
};
export type ResolvedMiniCacheValue =
  | PrimitiveValue
  | ResolvedMiniChildHtmlString;
export type ResolvedMiniChildHtmlString = { childId: string };

export type StateObject<T = unknown> = {
  value: T;
  name: string;
};

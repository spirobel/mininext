import type {
  MiniHandler,
  PrimitiveValue,
  StateObject,
  StringArray,
} from "./core";
import type { SlotDom } from "./frontend/minirender";

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
): ResolvedMiniCacheHtmlString {
  const cacheEntry = getCacheEntryThrows(cacheAndCursor);
  if (typeof cacheEntry.value !== "object")
    throw new Error(
      `the result is a primitive value, we expected a ResolvedMiniCacheHtmlString. ${JSON.stringify(
        cacheEntry,
      )}`,
    );
  return cacheEntry.value!;
}
export function state<T>(
  name: string,
  value: T,
  cacheAndCursor: CacheAndCursor,
  global?: boolean,
): StateObject<T> {
  const localCac = { ...cacheAndCursor };
  if (global) localCac.cursor = "global";
  let cacheEntry = getCacheEntry(localCac);
  if (!cacheEntry) {
    cacheEntry = { value: null, dirty: true };
    cacheAndCursor.cache.set(localCac.cursor, cacheEntry);
  }
  // no entry yet, or the slot held text before: make it a template entry
  if (!cacheEntry.value || typeof cacheEntry.value !== "object") {
    cacheEntry.value = { stringLiterals: null, values: null, slots: null, state: [] };
    cacheEntry.dirty = true;
  }
  const cacheValue = getResolvedMiniHtmlStringThrows(localCac);
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
  dom?: SlotDom; // frontend: the nodes this slot owns
  rebuilds?: number; // frontend: rebuilds in a row (twitch check)
  value: CacheValue;
  dirty: boolean;
};

export type MiniCache = Map<string, CacheObject>;
export type CacheAndCursor = {
  cache: MiniCache;
  cursor: string;
};

export type ResolvedMiniCacheHtmlString = {
  stringLiterals: StringArray | null;
  values: ResolvedMiniCacheValue[] | null;
  slots: string[] | null;
  //TODO make this a record of name -> value
  state: StateObject[] | null;
};
export type ResolvedMiniCacheValue =
  | PrimitiveValue
  | boolean
  | undefined
  | MiniHandler
  | ResolvedMiniChildHtmlString;
export type ResolvedMiniChildHtmlString = { childId: string };

import { type CacheAndCursor, type ResolvedMiniCacheValue } from "../minicache";
import {
  makeNewMini,
  type Mini,
  type MiniValue,
  type ResolvedMiniHtmlString,
  type ResolvedMiniValue,
  type StringArray,
} from "../mininext";

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
      throw new Error(
        `not implemented, should not be called on backend.
        Use .build() to make an html skeleton, then use .fill() to fill in the values`,
      );
    },
  };
}

export function resolveValuesForCache(
  unresolvedValues: MiniValue[],
  cac: CacheAndCursor,
  slots: string[] | null = null,
) {
  // todo increment number in root cursor instead of using random  (1-randromroot-to-avoid-collisions-in-frontend)
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
  // CASE our cache entry does not exist yet is the only one we need to handle in the backend
  const cac = mini.cacheAndCursor;
  const { slots, values } = resolveValuesForCache(unresolvedValues, cac);

  cac.cache.set(cac.cursor, {
    value: { stringLiterals, values, slots, state: null },
    dirty: true,
  });

  return resolveMiniHtmlString(stringLiterals, unresolvedValues, mini, slots);
}

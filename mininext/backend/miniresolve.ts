import { type ResolvedMiniCacheValue } from "../minicache";
import {
  resolveMiniValue,
  valuePositions,
  type Mini,
  type MiniValue,
  type ResolvedMiniHtmlString,
  type StringArray,
} from "../core";

// on the backend each template resolves once, so the cache entry is always new
export function resolve(
  stringLiterals: StringArray,
  unresolvedValues: MiniValue[],
  mini: Mini,
): ResolvedMiniHtmlString {
  const cac = mini.cacheAndCursor;
  const inTag = valuePositions(stringLiterals);
  const slots = unresolvedValues.map((_, i) => `${cac.cursor}.${i}`);
  const values: ResolvedMiniCacheValue[] = unresolvedValues.map((value, i) => {
    // in a tag the value is checked and written by renderBackend (handlers are dropped there)
    if (inTag[i]) return value as ResolvedMiniCacheValue;
    if (value === null || typeof value === "string" || typeof value === "number")
      return value;
    if (value === undefined || typeof value === "boolean") return "";
    return { childId: slots[i]! };
  });
  cac.cache.set(cac.cursor, {
    value: { stringLiterals, values, slots, state: null },
    dirty: true,
  });
  return {
    slots,
    stringLiterals,
    values: unresolvedValues.map((value, i) =>
      inTag[i] ? values[i] : resolveMiniValue(value, mini, slots[i]!),
    ) as ResolvedMiniHtmlString["values"],
    render: () => {
      throw new Error(
        `not implemented, should not be called on backend.
        Use .build() to make an html skeleton, then use .fill() to fill in the values`,
      );
    },
  };
}

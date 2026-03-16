import { state, type CacheAndCursor } from "./minicache";
import { resolve } from "./frontend/miniresolve";
import { resolve as backendResolve } from "./backend/miniresolve";
import {
  build,
  getCallerDir,
  newBackendMini,
  renderBackend,
  type Skeleton,
} from "./backend/html";
export { renderRoot } from "./frontend/minidom";
export { createRouter, type Params } from "./frontend/minirouter";

export const isBackend = typeof window === "undefined";
export type PrimitiveValue = string | number | null;
export type MiniHtmlString = {
  stringLiterals: TemplateStringsArray;
  values: MiniValue[];
  resolve(mini?: Mini): ResolvedMiniHtmlString;
  build(
    mini?: Mini,
    root?: string,
    config?: Bun.BuildConfig,
  ): Promise<Skeleton>;
  renderBackend(mini?: Mini): string;
};

export type MiniComponent = (mini: Mini) => MiniHtmlString;
export type MiniValue = PrimitiveValue | MiniComponent | MiniHtmlString;
export type StateObject<T = unknown> = {
  value: T;
  name: string;
};

export type Mini = {
  html: typeof html;
  state: <T>(name: string, value: T, global?: boolean) => StateObject<T>;
  cacheAndCursor: CacheAndCursor;
  flatten(
    htmlStringArray: MiniHtmlString[],
    flattenRootFn?: (htmlstrings: MiniHtmlString) => MiniHtmlString,
  ): MiniHtmlString;
  fill(...args: MiniValue[]): Blob;
};

export function html(
  stringLiterals: TemplateStringsArray,
  ...values: MiniValue[]
): MiniHtmlString {
  return constructMiniHtmlString(stringLiterals, values);
}
export function constructMiniHtmlString(
  stringLiterals: TemplateStringsArray,
  values: MiniValue[],
): MiniHtmlString {
  return {
    stringLiterals,
    values,
    resolve: (mini: Mini): ResolvedMiniHtmlString => {
      if (isBackend) return backendResolve(stringLiterals, values, mini);
      return resolve(stringLiterals, values, mini);
    },
    async build(
      mini?: Mini,
      root?: string,
      config?: Bun.BuildConfig,
    ): Promise<Skeleton> {
      if (!root) root = getCallerDir();
      return await build(stringLiterals, values, root, mini, config);
    },
    renderBackend: (mini?: Mini): string => {
      if (!mini) mini = newBackendMini();
      backendResolve(stringLiterals, values, mini);
      return renderBackend(mini.cacheAndCursor).result;
    },
  };
}

export function makeNewMini(cac: CacheAndCursor): Mini {
  return {
    html,
    state: (name, value, global) => {
      if (isBackend) global = true;
      return state(name, value, cac, global);
    },
    flatten,
    cacheAndCursor: cac,
    fill: (...args) => {
      throw new Error(
        "this method can only be used if the mini instance was made from a html skeleton, const skeleton = html`<div></div>`.build(); const mini = skeleton.mini(); const htmlresult = skeleton.fill(...args);",
      );
    },
  };
}

export function standardFlattenRoot(
  htmlstrings: MiniHtmlString,
): MiniHtmlString {
  return html`<div>${htmlstrings}</div>`;
}

export function flatten(
  htmlStringArray: MiniHtmlString[],
  flattenRootFn = standardFlattenRoot,
): MiniHtmlString {
  const flattenedArray = combineMiniHtmlStrings(htmlStringArray);
  return flattenValues(flattenRootFn(flattenedArray));
}
export function flattenValues(miniHtmlString: MiniHtmlString): MiniHtmlString {
  const literalsArray: string[] = [];
  const values: MiniValue[] = [];
  let mergeWithPrior = false;

  let index = 0;
  for (const literal of miniHtmlString.stringLiterals) {
    if (mergeWithPrior) {
      mergeWithPrior = false;
      literalsArray[index] += literal;
    } else {
      literalsArray.push(literal);
    }
    const value = miniHtmlString.values[index];
    if (typeof value === "function") {
      throw new Error(
        `resolve components before passing them into the root element when flattening,
         with const miniHtmlString = component(mini);
         
         optimally just have the root element's only value be the htmlstringsarray
         you want to flatten. This is not the place for complex logic,
         it is just to wrap your array in an <ul>, <ol> or <div> element.
         
         (every mini html string needs to have only one root element)`,
      );
    } else if (value && typeof value === "object" && "resolve" in value) {
      const priorLiteral = literalsArray[index];
      if (!priorLiteral) throw new Error("no prior literal, ");
      literalsArray[index] = priorLiteral + value.stringLiterals[0];
      literalsArray.push(...value.stringLiterals.slice(1));
      mergeWithPrior = true;

      values.push(...value.values);
      index += value.stringLiterals.slice(1).length;
    } else {
      if (typeof value === "string" || typeof value === "number")
        values.push(value);
      index++;
    }
  }
  const stringLiterals = createTemplateStringsArray(literalsArray);
  return constructMiniHtmlString(stringLiterals, values);
}
function combineMiniHtmlStrings(htmlstrings: MiniHtmlString[]): MiniHtmlString {
  const stringLiterals = combineTemplateStringsArrays(
    htmlstrings.map((hs) => hs.stringLiterals),
  );
  const values = htmlstrings.flatMap((hs) => hs.values);

  return constructMiniHtmlString(stringLiterals, values);
}

function combineTemplateStringsArrays(tsas: TemplateStringsArray[]) {
  const stringlits: string[] = [];
  for (const litarray of tsas) {
    const prior = stringlits.at(-1);
    const first = litarray[0];
    if (prior && first) {
      stringlits[stringlits.length - 1] += first;
      stringlits.push(...litarray.slice(1));
    } else {
      stringlits.push(...litarray);
    }
  }
  return createTemplateStringsArray(stringlits);
}
function createTemplateStringsArray(strings: string[]): TemplateStringsArray {
  const stringsArray = [...strings];

  const frozenRaw = Object.freeze([...strings]);

  Object.defineProperty(stringsArray, "raw", {
    value: frozenRaw,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  return Object.freeze(stringsArray) as TemplateStringsArray;
}

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

export type StringArray = string[] | TemplateStringsArray;

export type ResolvedMiniHtmlString = {
  stringLiterals: StringArray;
  values: ResolvedMiniValue[];
  slots: string[];
  render: (
    target: Element | HTMLElement,
    cacheAndCursor?: CacheAndCursor,
  ) => CacheAndCursor;
};
export type ResolvedMiniValue = PrimitiveValue | ResolvedMiniHtmlString;

import {
  state,
  type CacheAndCursor,
  type PrimitiveValue,
  type StateObject,
} from "./minicache";
import { resolve, type ResolvedMiniHtmlString } from "./miniresolve";
export { renderRoot } from "./minidom";
export { createRouter, type Params } from "./minirouter";
export type Mini = {
  html: typeof html;
  state: <T>(name: string, value: T) => StateObject<T>;
  cacheAndCursor: CacheAndCursor;
  flatten(
    htmlStringArray: MiniHtmlString[],
    flattenRootFn?: (htmlstrings: MiniHtmlString) => MiniHtmlString,
  ): MiniHtmlString;
};
export function makeNewMini(cac: CacheAndCursor): Mini {
  return {
    html,
    state: (name, value) => {
      return state(name, value, cac);
    },
    flatten,
    cacheAndCursor: cac,
  };
}
export type MiniHtmlString = {
  stringLiterals: TemplateStringsArray;
  values: MiniValue[];
  resolve(mini?: Mini): ResolvedMiniHtmlString;
};

export type MiniComponent = (mini: Mini) => MiniHtmlString;
export type MiniValue = PrimitiveValue | MiniComponent | MiniHtmlString;

export function html(
  stringLiterals: TemplateStringsArray,
  ...values: MiniValue[]
): MiniHtmlString {
  return {
    stringLiterals,
    values,
    resolve: (mini: Mini): ResolvedMiniHtmlString => {
      return resolve(stringLiterals, values, mini);
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
    } else if (typeof value === "object" && "resolve" in value) {
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
  return {
    stringLiterals,
    values,
    resolve: (mini: Mini): ResolvedMiniHtmlString => {
      return resolve(stringLiterals, values, mini);
    },
  };
}
function combineMiniHtmlStrings(htmlstrings: MiniHtmlString[]): MiniHtmlString {
  const stringLiterals = combineTemplateStringsArrays(
    htmlstrings.map((hs) => hs.stringLiterals),
  );
  const values = htmlstrings.flatMap((hs) => hs.values);

  return {
    stringLiterals,
    values,
    resolve: (mini: Mini): ResolvedMiniHtmlString => {
      return resolve(stringLiterals, values, mini);
    },
  };
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

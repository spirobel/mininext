// the shared core: templates, values, checks, cache. it never imports frontend/ or backend/.
// the renderers register themselves in `renderers`, so a bundle built from browser.ts
// has no backend code in it (tests/quality_assurance.backend.test.ts checks this).
import { state, type CacheAndCursor } from "./minicache";
import type { Skeleton, SkeletonBuildParams, renderBackend as RenderBackend } from "./backend/html";

export const isBackend = typeof window === "undefined";
export type PrimitiveValue = string | number | null;
export type MiniHtmlString = {
  [MINI_HTML]: true;
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

// in content a function is a component. it returns html or any other value
export type MiniComponent = (mini: Mini) => MiniValue;
// inside a tag a function is an event handler: onclick=${fn}
export type MiniHandler = (event: any) => unknown;
export type MiniValue =
  | PrimitiveValue
  | boolean
  | undefined
  | MiniComponent
  | MiniHandler
  | MiniHtmlString
  | MiniValue[];
export type StateObject<T = unknown> = {
  value: T;
  name: string;
};

export type Mini = {
  html: typeof html;
  state: <T>(name: string, value: T, global?: boolean) => StateObject<T>;
  cacheAndCursor: CacheAndCursor;
  fill(...args: MiniValue[]): Blob;
};

export function html(
  stringLiterals: TemplateStringsArray,
  ...values: MiniValue[]
): MiniHtmlString {
  return constructMiniHtmlString(stringLiterals, values);
}
// only html`` makes templates. json from a request can not fake one:
// it has no symbols and no functions.
const MINI_HTML: unique symbol = Symbol.for("mininext.html") as any;
export function isMiniHtml(value: unknown): value is MiniHtmlString {
  return !!value && typeof value === "object" && (value as any)[MINI_HTML] === true;
}

// values in attributes that would run as code.
// checked on the backend and the frontend, for every value that goes into a tag.
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href", "poster", "cite", "background", "ping", "data", "codebase"]);
export function checkAttribute(name: string, value: unknown) {
  const n = name.toLowerCase();
  const on = n.startsWith("on");
  if (typeof value === "function") {
    if (on) return;
    throw new Error(`mininext: a function can only be the value of an on* attribute, not of ${name}`);
  }
  if (value && typeof value === "object")
    throw new Error(`mininext: an object can not be the value of the attribute ${name}`);
  if (value === null || value === undefined || typeof value === "boolean") return;
  if (on || n === "srcdoc")
    throw new Error(`mininext: ${name} can not take a string, it would run as code. use ${name}=\${() => ...} or a fixed literal`);
  if (URL_ATTRIBUTES.has(n)) {
    // browsers ignore control chars and spaces in the scheme: "java\tscript:" runs
    const url = String(value).replace(/[\u0000-\u0020]/g, "").toLowerCase();
    if (/^(javascript|vbscript):/.test(url) || (url.startsWith("data:") && !url.startsWith("data:image/")))
      throw new Error(`mininext: unsafe url in ${name}: ${JSON.stringify(String(value).slice(0, 60))}`);
  }
}

type Resolve = (stringLiterals: StringArray, values: MiniValue[], mini: Mini) => ResolvedMiniHtmlString;
export const renderers: {
  frontend?: Resolve;
  backend?: {
    resolve: Resolve;
    build: (params: SkeletonBuildParams) => Promise<Skeleton>;
    render: typeof RenderBackend;
    newMini: () => Mini;
  };
} = {};
function backend() {
  if (!renderers.backend)
    throw new Error("mininext: build() and renderBackend() run on the server. import them from mininext, not mininext/browser");
  return renderers.backend;
}

export function constructMiniHtmlString(
  stringLiterals: TemplateStringsArray,
  values: MiniValue[],
): MiniHtmlString {
  return {
    [MINI_HTML]: true,
    stringLiterals,
    values,
    resolve: (mini: Mini): ResolvedMiniHtmlString => {
      const resolve = isBackend ? backend().resolve : renderers.frontend;
      if (!resolve) throw new Error("mininext: no frontend renderer. import from mininext/browser or mininext");
      return resolve(stringLiterals, values, mini);
    },
    async build(
      mini?: Mini,
      root?: string,
      config?: Bun.BuildConfig,
    ): Promise<Skeleton> {
      if (!root) root = getCallerDir();
      return await backend().build({ stringLiterals, values, root, mini, config });
    },
    renderBackend: (mini?: Mini): string => {
      const b = backend();
      if (!mini) mini = b.newMini();
      b.resolve(stringLiterals, values, mini);
      return b.render(mini.cacheAndCursor).result;
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
    cacheAndCursor: cac,
    fill: (...args) => {
      throw new Error(
        "this method can only be used if the mini instance was made from a html skeleton, const skeleton = html`<div></div>`.build(); const mini = skeleton.mini(); const htmlresult = skeleton.fill(...args);",
      );
    },
  };
}

// an array becomes a template with one slot per item.
// the literals are all empty. a new array each time (a cache per length leaked),
// marked in a weak set so resolve knows it is a list.
const isListLiterals = new WeakSet<object>();
export function isList(stringLiterals: StringArray | null): boolean {
  return !!stringLiterals && isListLiterals.has(stringLiterals);
}
function list(values: MiniValue[]): MiniHtmlString {
  const lits = Array(values.length + 1).fill("") as unknown as TemplateStringsArray;
  isListLiterals.add(lits);
  return constructMiniHtmlString(lits, values);
}

export type IsInside = {
  element: boolean;
  singleQuotes: boolean;
  doubleQuotes: boolean;
};

export function isInside(stringLiteral: string, isInside: IsInside) {
  for (const char of stringLiteral) {
    // html element start or end (< or > not in quotes)
    if (char === "<" && !isInside.singleQuotes && !isInside.doubleQuotes) {
      isInside.element = true;
    }
    if (char === ">" && !isInside.singleQuotes && !isInside.doubleQuotes) {
      isInside.element = false;
    }
    if (!isInside.element) continue;
    if (char === "'" && !isInside.doubleQuotes) {
      isInside.singleQuotes = !isInside.singleQuotes;
    } else if (char === '"' && !isInside.singleQuotes) {
      isInside.doubleQuotes = !isInside.doubleQuotes;
    }
  }
}
// for each value: true if it sits inside a tag (attribute position)
const positions = new WeakMap<object, boolean[]>();
const NOT_IN_TAG: boolean[] = [];
export function valuePositions(stringLiterals: StringArray): boolean[] {
  if (isList(stringLiterals)) return NOT_IN_TAG; // list items are always content
  let inTag = positions.get(stringLiterals);
  if (inTag) return inTag;
  const inside = { element: false, singleQuotes: false, doubleQuotes: false };
  inTag = stringLiterals.slice(0, -1).map((literal) => {
    isInside(literal, inside);
    return inside.element;
  });
  positions.set(stringLiterals, inTag);
  return inTag;
}

export function resolveMiniValue(
  value: MiniValue,
  parentMini: Mini,
  slotId: string,
): ResolvedMiniValue {
  // make new mini with slotid as cursor
  const mini = makeNewMini({ ...parentMini.cacheAndCursor, cursor: slotId });
  if (Array.isArray(value)) value = list(value);
  if (typeof value === "function") {
    // in content a function is a component (handlers never get here).
    // a plain result gets a template around it: the slot keeps its state,
    // and the result follows the same rules as any value
    const result = (value as MiniComponent)(mini);
    return (isMiniHtml(result) ? result : html`${result}`).resolve(mini);
  }
  if (isMiniHtml(value)) return value.resolve(mini);
  if (value && typeof value === "object")
    throw new Error(
      "mininext: a plain object can not be a template value. use html`` for markup, or turn it into a string",
    );
  return value as ResolvedMiniValue;
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
export type ResolvedMiniValue =
  | PrimitiveValue
  | boolean
  | undefined
  | MiniHandler
  | ResolvedMiniHtmlString;

export function getCallerDir(): string {
  const origPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => stack; // Return raw CallSite objects
  const err = new Error();
  Error.captureStackTrace(err, getCallerDir); // Skip frames up to this function
  const stack = err.stack as unknown as NodeJS.CallSite[]; // Type it as CallSite array
  Error.prepareStackTrace = origPrepareStackTrace; // Restore original

  // stack[0] should now be the caller of getCallerDir (inside build)
  // stack[1] is the external caller of build
  const callerCallsite = stack[1];
  if (!callerCallsite) {
    throw new Error("Unable to determine caller directory");
  }
  const callerFile = callerCallsite.getFileName();
  if (!callerFile) {
    throw new Error("Caller file name not available");
  }
  let lastSlash = callerFile.lastIndexOf("/");
  let lastBackslash = callerFile.lastIndexOf("\\");
  let lastSep = Math.max(lastSlash, lastBackslash);

  if (lastSep <= 0) {
    return ".";
  }

  return callerFile.slice(0, lastSep);
}

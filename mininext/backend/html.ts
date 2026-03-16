import {
  getResolvedMiniHtmlStringThrows,
  type CacheAndCursor,
  type CacheObject,
} from "../minicache";
import {
  isBackend,
  makeNewMini,
  resolveMiniValue,
  type Mini,
  type MiniValue,
  type ResolvedMiniHtmlString,
} from "../mininext";
import { resolve as backendResolve } from "./miniresolve";

export function newBackendMini() {
  return makeNewMini({
    cache: new Map<string, CacheObject>(),
    cursor: "1",
  });
}
export type Skeleton = {
  static_routes: BunStaticRoutes;
  _build_result: Bun.BuildOutput;
  _rendered_skeleton: {
    result: string;
    placeholder_ids: string[];
  };
  _resolved_skeleton: ResolvedMiniHtmlString;
  fill: (...args: MiniValue[]) => string;
  mini: () => Mini;
};
export async function build(
  stringLiterals: TemplateStringsArray,
  values: MiniValue[],
  root: string,
  mini?: Mini,
  config?: Bun.BuildConfig,
): Promise<Skeleton> {
  if (!isBackend)
    throw new Error(`build() can only be called on backend, not frontend.
            Use renderRoot() in to mount components in the frontend`);

  if (!mini) mini = newBackendMini();
  const _resolved_skeleton = backendResolve(stringLiterals, values, mini);
  const _rendered_skeleton = renderBackend(mini.cacheAndCursor);

  const indexpath = root + "/index.html";
  const _build_result = await Bun.build({
    entrypoints: [indexpath],
    files: {
      [indexpath]: _rendered_skeleton.result,
    },
    root,
    ...(config ?? {}),
  });

  if (Bun.env.NODE_ENV === "production") {
    if (!_build_result.success) {
      console.error("Build failed:", _build_result.logs);
      process.exit(1);
    }
  }
  let htmlArtifact = _build_result.outputs.find(
    (output) => output.path === "./index.html",
  );

  if (!htmlArtifact) {
    throw new Error("No index.html found in build outputs");
  }

  const rendered_built_result = await htmlArtifact.text();

  const getMini = () => {
    const newMini = newBackendMini();
    newMini.fill = curryFill(
      _rendered_skeleton.placeholder_ids,
      rendered_built_result,
      newMini,
    );
    return newMini;
  };

  const fill = curryFill(
    _rendered_skeleton.placeholder_ids,
    rendered_built_result,
  );
  const static_routes = createStaticRoutes(_build_result);
  return {
    static_routes,
    _build_result,
    _rendered_skeleton,
    _resolved_skeleton,
    mini: getMini,
    fill,
  };
}

export function curryFill(
  placeholder_ids: string[],
  rendered_skeleton: string,
  mini?: Mini,
) {
  const fill = (...args: MiniValue[]): string => {
    let localSkeleton = rendered_skeleton;
    const localMini = mini ?? newBackendMini();
    let pointer = 0;
    for (const placeholderID of placeholder_ids) {
      const filler = args[pointer];
      if (typeof filler === undefined || filler === null) {
        localSkeleton = localSkeleton.replace(placeholderID, "");
      } else if (typeof filler === "string" || typeof filler === "number") {
        localSkeleton = localSkeleton.replace(placeholderID, String(filler));
      } else {
        const slotId = `${pointer}-filled`;
        resolveMiniValue(filler, localMini, slotId);
        const newCac = { ...localMini.cacheAndCursor, cursor: slotId };
        const renderedValue = renderBackend(newCac);
        localSkeleton = localSkeleton.replace(
          placeholderID,
          renderedValue.result,
        );
      }

      pointer++;
    }
    return localSkeleton;
  };
  return fill;
}
export function renderBackend(cac: CacheAndCursor) {
  const htmlsnippet = getResolvedMiniHtmlStringThrows(cac);
  if (!htmlsnippet.stringLiterals || !htmlsnippet.values || !htmlsnippet.slots)
    throw new Error("should have literals,values & slots once resolved");
  let result = "";
  const placeholder_ids: string[] = [];
  let index = 0;
  for (const literal of htmlsnippet.stringLiterals) {
    const value =
      index < htmlsnippet.values.length ? htmlsnippet.values[index] : "";
    if (value && typeof value === "object" && "childId" in value) {
      const partRender = renderBackend({
        cache: cac.cache,
        cursor: value.childId,
      });
      result += literal + partRender.result;
    } else {
      let primValue = value;
      if (primValue === null) {
        const pl_id = crypto.randomUUID();
        primValue = pl_id;
        placeholder_ids.push(pl_id);
      }
      result += literal + Bun.escapeHTML(primValue);
    }
    index++;
  }

  return { result, placeholder_ids };
}
export type BunStaticRoutes = Record<string, Response>;
export function createStaticRoutes(build_result: Bun.BuildOutput) {
  const routes: BunStaticRoutes = {};
  for (const output of build_result.outputs) {
    if (output.path === "./index.html") continue;

    let urlPath = output.path;
    if (urlPath.startsWith("./")) {
      urlPath = "/" + urlPath.slice(2);
    }
    routes[urlPath] = new Response(output);
  }
  return routes;
}

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

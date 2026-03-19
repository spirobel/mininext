import type { PluginBuilder } from "bun";
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
  import_paths: string[];
  fill: (...args: MiniValue[]) => Blob;
  mini: () => Mini;
};
export type SkeletonBuildParams = {
  stringLiterals: TemplateStringsArray;
  values: MiniValue[];
  root: string;
  mini?: Mini;
  config?: Bun.BuildConfig;
};
export async function buildSkeleton({
  stringLiterals,
  values,
  root,
  mini,
  config,
}: SkeletonBuildParams): Promise<Skeleton> {
  const watchedPaths: string[] = [];
  const logPathsPlugin = {
    name: "log-paths",
    setup(build: PluginBuilder) {
      build.onLoad({ filter: /.*/ }, (args) => {
        watchedPaths.push(args.path);
        return undefined;
      });
    },
  };

  if (!isBackend)
    throw new Error(`build() can only be called on backend, not frontend.
            Use renderRoot() in to mount components in the frontend`);

  if (!mini) mini = newBackendMini();
  const _resolved_skeleton = backendResolve(stringLiterals, values, mini);
  const _rendered_skeleton = renderBackend(mini.cacheAndCursor);
  const minify = Bun.env.NODE_ENV === "production";
  const indexpath = root + "/index.html";
  const _build_result = await Bun.build({
    entrypoints: [indexpath],
    files: {
      [indexpath]: _rendered_skeleton.result,
    },
    plugins: [logPathsPlugin],
    root,
    minify,
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

  let rendered_built_result = await htmlArtifact.text();
  const static_routes = createStaticRoutes(_build_result);

  if (Bun.env.NODE_ENV !== "production") {
    const buildId = crypto.randomUUID();
    const hmrUrl = `/hmr-${buildId}`;
    static_routes[hmrUrl] = new Response(JSON.stringify({ buildId: buildId }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
    const hmrReloadScript = `<script>
          setInterval(reload, 100); 
          async function reload(){
            try {
              const res = await fetch("${hmrUrl}");
              if (!res.ok) return location.reload();
              const { buildId } = await res.json();
              if (buildId !== "${buildId}") location.reload();
            } catch {
              location.reload();
            }
          }
    </script>`;
    const rewriter = new HTMLRewriter().on("body", {
      element(head) {
        head.append(hmrReloadScript, { html: true });
      },
    });

    rendered_built_result = rewriter.transform(rendered_built_result);
  }

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
  const result: Skeleton = {
    static_routes,
    _build_result,
    _rendered_skeleton,
    _resolved_skeleton,
    mini: getMini,
    fill,
    import_paths: watchedPaths,
  };
  return result;
}

export async function build(params: SkeletonBuildParams): Promise<Skeleton> {
  const result: Skeleton = await buildSkeleton(params);
  if (Bun.env.NODE_ENV !== "production") {
    hmr(result, params);
  }
  return result;
}

export function curryFill(
  placeholder_ids: string[],
  rendered_skeleton: string,
  mini?: Mini,
) {
  const fill = (...args: MiniValue[]): Blob => {
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
    return new Blob([localSkeleton], { type: "text/html;charset=utf-8" });
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
    routes[urlPath] = new Response(output, {
      headers: { "Content-Type": output.type },
    });
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

export async function hmr(skel: Skeleton, params: SkeletonBuildParams) {
  const escapedPaths = skel.import_paths
    .slice(1)
    .map((p) => JSON.stringify(p))
    .join(", ");
  const watcherCode = `
  import fs from "node:fs"; 
  const files=[${escapedPaths}];
  files.forEach(f=>fs.watchFile(f,{interval:100},()=>{
              console.log("file changed:",f);
             process.exit(0);
            })
   );`;

  const proc = Bun.spawn(["bun", "run", "-"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(watcherCode);
  proc.stdin.end();

  const output = await proc.stdout.text();
  console.log("(hmr process)", output);
  if (output.includes("file changed:")) {
    const newSkel = await buildSkeleton(params);
    Object.assign(skel, {
      static_routes: newSkel.static_routes,
      _build_result: newSkel._build_result,
      _rendered_skeleton: newSkel._rendered_skeleton,
      _resolved_skeleton: newSkel._resolved_skeleton,
      fill: newSkel.fill,
      mini: newSkel.mini,
    });
    hmr(skel, params);
    if (globalThis.minireload) globalThis.minireload();
  }
}
declare global {
  interface ReadableStream<R = any> {
    /** consumes the stream and returns the full content as string */
    text(): Promise<string>;

    /** consumes the stream and parses it as JSON */
    json(): Promise<unknown>;

    /** consumes the stream as ArrayBuffer */
    arrayBuffer(): Promise<ArrayBuffer>;

    /** consumes the stream as Uint8Array */
    bytes(): Promise<Uint8Array>;
  }
  var minireload: () => void;
}

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
  mini?: Mini,
  config?: Bun.BuildConfig,
): Promise<Skeleton> {
  if (!isBackend)
    throw new Error(`build() can only be called on backend, not frontend.
            Use renderRoot() in to mount components in the frontend`);

  if (!mini) mini = newBackendMini();
  const _resolved_skeleton = backendResolve(stringLiterals, values, mini);
  const _rendered_skeleton = renderBackend(mini.cacheAndCursor);
  const _build_result = await Bun.build({
    entrypoints: ["/index.html"],
    files: {
      "/index.html": _rendered_skeleton.result,
    },
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
    if (!mini) mini = newBackendMini();
    let pointer = 0;
    for (const placeholderID of placeholder_ids) {
      const filler = args[pointer];
      if (typeof filler === undefined) continue;

      const slotId = `${pointer}-filled`;
      resolveMiniValue(filler, mini, slotId);
      const newCac = { ...mini.cacheAndCursor, cursor: slotId };
      const renderedValue = renderBackend(newCac);
      rendered_skeleton = rendered_skeleton.replace(
        placeholderID,
        renderedValue.result,
      );

      pointer++;
    }
    return rendered_skeleton;
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
    if (index < htmlsnippet.values.length) {
      const value = htmlsnippet.values[index];
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

import { html, type Mini, type MiniHtmlString } from "../core";

export type ExtractRouteParam<Path extends string> =
  Path extends `:${infer Param}/${infer Rest}`
    ? Param | ExtractRouteParam<Rest>
    : Path extends `:${infer Param}`
      ? Param
      : Path extends `${infer Prefix}/*`
        ? ExtractRouteParam<Prefix> | "*"
        : Path extends `${infer _Prefix}/${infer Rest}`
          ? ExtractRouteParam<Rest>
          : never;

export type Params<Path extends string> = {
  [Param in ExtractRouteParam<Path>]: string;
};

export type Handler<Path extends string = string> = (
  params: Params<Path>,
  mini: Mini,
) => MiniHtmlString;

export type RoutePaths<RoutesObj> = {
  [K in keyof RoutesObj]: K extends string
    ? K extends `/${string}` | "/*"
      ? K
      : never
    : never;
}[keyof RoutesObj];

export type TypedRouter<TRoutes> = {
  component: (mini: Mini) => MiniHtmlString;
  navigate(path: string): void;
  navigate<Path extends RoutePaths<TRoutes>>(
    path: Path,
    params: Params<Path>,
  ): void;
  link(path: string): string;
  link<Path extends RoutePaths<TRoutes>>(
    path: Path,
    params: Params<Path>,
  ): string;
  getCurrentPath(): string;
};

type Route = {
  template: string;
  handler: Handler<any>;
  parts: string[];
  wildcard: boolean;
};

// like the bun router: the browser gives the hash percent encoded
function decode(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    // a malformed escape stays raw
    return segment;
  }
}

// static before param before wildcard, the object order does not matter
function compareRoutes(a: Route, b: Route) {
  if (a.wildcard !== b.wildcard) return a.wildcard ? 1 : -1;
  // a longer wildcard prefix is more specific
  if (a.wildcard && a.parts.length !== b.parts.length) {
    return b.parts.length - a.parts.length;
  }
  for (let i = 0; i < Math.min(a.parts.length, b.parts.length); i++) {
    const aParam = a.parts[i]!.startsWith(":");
    const bParam = b.parts[i]!.startsWith(":");
    if (aParam !== bParam) return aParam ? 1 : -1;
  }
  return 0;
}

// the handler params are typed from each route string
export function createRouter<const TRoutes extends Record<string, unknown>>(
  routes: { [K in keyof TRoutes]: Handler<K & string> },
): TypedRouter<TRoutes> {
  let currentPath = "";
  let warnedPath: string | null = null;

  const table: Route[] = Object.entries(routes as Record<string, Handler<any>>)
    .map(([template, handler]) => {
      const wildcard = template.endsWith("/*");
      const base = wildcard ? template.slice(0, -2) : template;
      return { template, handler, parts: base.split("/").filter(Boolean), wildcard };
    })
    .sort(compareRoutes);

  function matchRoute(path: string) {
    const segments = path.split("/").filter(Boolean);
    for (const route of table) {
      const { parts, wildcard } = route;
      if (wildcard ? segments.length < parts.length : segments.length !== parts.length) {
        continue;
      }
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (part.startsWith(":")) params[part.slice(1)] = decode(segments[i]!);
        else if (part !== decode(segments[i]!)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (wildcard) {
        const rest = segments.slice(parts.length).map(decode);
        params["*"] = rest.length ? "/" + rest.join("/") : "";
      }
      return { handler: route.handler, params };
    }
    return null;
  }

  function buildPath(template: string, params: Record<string, string>): string {
    let base = template;
    let append = "";
    if (template.endsWith("/*")) {
      base = template.slice(0, -2);
      const wildcardValue = params["*"];
      if (wildcardValue !== undefined) {
        // keep the slashes, encode each segment
        append = wildcardValue
          .split("/")
          .filter(Boolean)
          .map((s) => "/" + encodeURIComponent(s))
          .join("");
      }
    }
    return (
      base.replace(/:(\w+)/g, (_, param) => {
        const value = params[param];
        if (value === undefined) {
          throw new Error(`Missing param: ${param}`);
        }
        return encodeURIComponent(value);
      }) + append
    );
  }

  function link(pathOrTemplate: string, params?: Record<string, string>): string {
    let path = params ? buildPath(pathOrTemplate, params) : pathOrTemplate;
    if (path.startsWith("#")) path = path.slice(1);
    return "#" + (path.startsWith("/") ? path : "/" + path);
  }

  return {
    component(mini: Mini): MiniHtmlString {
      // the part after ? is a query, not part of the path
      const hash = window.location.hash.slice(1).split("?")[0]!;
      const cleanPath = hash === "" ? "/" : hash;
      currentPath = cleanPath;

      const match = matchRoute(cleanPath);
      if (match) return match.handler(match.params, mini);
      // render nothing, the render loop must keep running.
      // warn once per path, not once per frame
      if (warnedPath !== cleanPath) {
        warnedPath = cleanPath;
        console.warn(`mininext router: no route matches "${cleanPath}"`);
      }
      return html``;
    },
    navigate(pathOrTemplate: string, params?: Record<string, string>): void {
      window.location.hash = link(pathOrTemplate, params);
    },
    link,
    getCurrentPath(): string {
      return currentPath;
    },
  } as TypedRouter<TRoutes>;
}

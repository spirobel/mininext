import type { Mini, MiniHtmlString } from "../mininext";

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

export type TypedRouter<TRoutes extends Record<string, any>> = {
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

export function createRouter<
  const TRoutes extends Record<string, Handler<any>>,
>(routes: TRoutes): TypedRouter<TRoutes> {
  let currentPath = "";

  function matchRoute(path: string): {
    handler: Handler<any>;
    params: Record<string, string>;
    routeKey?: string;
  } | null {
    const routeKeys = Object.keys(routes) as (keyof TRoutes)[];
    // Exact matches first
    for (const key of routeKeys) {
      const template = String(key);
      const match = pathMatch(template, path);
      if (match) {
        return {
          handler: routes[key]!,
          params: match.params,
          routeKey: template,
        };
      }
    }
    // Wildcard routes ending with /*
    for (const key of routeKeys) {
      const template = String(key);
      if (template.endsWith("/*")) {
        const prefix = template.slice(0, -2);
        const match = pathMatch(prefix, path, true);
        if (match) {
          const params = match.params;
          params["*"] = match.rest ?? "";
          return { handler: routes[key]!, params, routeKey: template };
        }
      }
    }
    return null;
  }

  function pathMatch(
    template: string,
    path: string,
    isPrefix = false,
  ): { params: Record<string, string>; rest?: string } | null {
    const templateParts = template.split("/").filter(Boolean);
    const pathParts = path.split("/").filter(Boolean);
    if (!isPrefix && templateParts.length !== pathParts.length) return null;
    if (pathParts.length < templateParts.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < templateParts.length; i++) {
      const part = templateParts[i]!;
      if (part.startsWith(":")) {
        params[part.slice(1)] = pathParts[i]!;
      } else if (part !== pathParts[i]) {
        return null;
      }
    }
    let rest = "";
    if (isPrefix && pathParts.length > templateParts.length) {
      rest = "/" + pathParts.slice(templateParts.length).join("/");
    }
    return { params, rest };
  }

  function buildPath(template: string, params: Record<string, string>): string {
    let base = template;
    let append = "";
    if (template.endsWith("/*")) {
      base = template.slice(0, -2);
      const wildcardValue = params["*"];
      if (wildcardValue !== undefined) {
        append = wildcardValue.startsWith("/")
          ? wildcardValue
          : "/" + wildcardValue;
      }
    }
    return (
      base.replace(/:(\w+)/g, (_, param) => {
        const value = params[param];
        if (value === undefined) {
          throw new Error(`Missing param: ${param}`);
        }
        return value;
      }) + append
    );
  }
  function link(pathOrTemplate: any, params?: Record<string, string>): string {
    let finalPath: string;
    if (params && typeof pathOrTemplate === "string") {
      finalPath = buildPath(pathOrTemplate, params);
    } else {
      finalPath = pathOrTemplate;
    }
    const result = finalPath.startsWith("/") ? finalPath : "/" + finalPath;

    return result.startsWith("#") ? result : "#" + result;
  }

  return {
    component(mini: Mini): MiniHtmlString {
      const path = window.location.hash;
      const cleanPath = path === "#" || path === "" ? "/" : path.slice(1);
      currentPath = cleanPath;

      const match = matchRoute(cleanPath);
      if (match) {
        const handler = match.handler;
        const params = match.params;
        return handler(params, mini);
      }
      throw new Error("no url matched");
    },
    navigate: function (
      pathOrTemplate: any,
      params?: Record<string, string>,
    ): void {
      window.location.hash = link(pathOrTemplate, params);
    },
    link,
    getCurrentPath(): string {
      return currentPath;
    },
  } as TypedRouter<TRoutes>;
}

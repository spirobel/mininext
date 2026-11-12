import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  getResolvedMiniHtmlStringThrows,
  type CacheAndCursor,
  type CacheObject,
} from "../minicache";
import {
  isBackend,
  checkAttribute,
  makeNewMini,
  valuePositions,
  resolveMiniValue,
  type Mini,
  type MiniValue,
  type ResolvedMiniHtmlString,
} from "../core";
import { resolve as backendResolve } from "./miniresolve";

export function newBackendMini() {
  return makeNewMini({
    cache: new Map<string, CacheObject>(),
    cursor: "1",
  });
}
export type Skeleton = {
  static_routes: BunStaticRoutes;
  _build_result?: Bun.BuildOutput; // production only
  _rendered_skeleton: {
    result: string;
    placeholders: Placeholder[];
    placeholder_ids: string[];
  };
  _resolved_skeleton: ResolvedMiniHtmlString;
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
export async function build({
  stringLiterals,
  values,
  root,
  mini,
  config,
}: SkeletonBuildParams): Promise<Skeleton> {
  if (!isBackend)
    throw new Error(`build() can only be called on backend, not frontend.
            Use renderRoot() in to mount components in the frontend`);

  if (!mini) mini = newBackendMini();
  const _resolved_skeleton = backendResolve(stringLiterals, values, mini);
  const _rendered_skeleton = renderBackend(mini.cacheAndCursor, []);
  const built =
    Bun.env.NODE_ENV === "production"
      ? await bundle(root, _rendered_skeleton.result, config)
      : await devBundle(root, _rendered_skeleton.result);

  const { placeholders } = _rendered_skeleton;
  return {
    static_routes: built.static_routes,
    _build_result: built._build_result,
    _rendered_skeleton,
    _resolved_skeleton,
    mini: () => {
      const newMini = newBackendMini();
      newMini.fill = curryFill(placeholders, built.html, newMini);
      return newMini;
    },
    fill: curryFill(placeholders, built.html),
  };
}

async function bundle(root: string, html: string, config?: Bun.BuildConfig) {
  const indexpath = root + "/index.html";
  const _build_result = await Bun.build({
    entrypoints: [indexpath],
    files: { [indexpath]: html },
    root,
    publicPath: "/", // absolute asset urls, so nested routes work
    minify: true,
    // lets the frontend turn off dev checks
    define: { "process.env.NODE_ENV": '"production"' },
    ...(config ?? {}),
  });
  if (!_build_result.success) {
    console.error("Build failed:", _build_result.logs);
    process.exit(1);
  }
  const htmlArtifact = _build_result.outputs.find(
    (output) => output.path === "./index.html",
  );
  if (!htmlArtifact) throw new Error("No index.html found in build outputs");
  // bun gives a page without js an empty js chunk and a <script> for it. drop both.
  const empty = _build_result.outputs
    .filter((o) => o.path.endsWith(".js") && o.size === 0)
    .map((o) => o.path.replace(/^\.\//, ""));
  const isEmpty = (src: string | null) => !!src && empty.some((name) => src.endsWith(`/${name}`) || src === name);
  const page = new HTMLRewriter()
    .on("script[src]", { element: (el) => void (isEmpty(el.getAttribute("src")) && el.remove()) })
    .transform(await htmlArtifact.text());
  const static_routes = createStaticRoutes(_build_result) as BunStaticRoutes;
  for (const name of empty) delete static_routes[`/${name}`];
  return { html: page, static_routes, _build_result };
}

// dev: bun's own dev server bundles the page and does hmr.
// run the server with bun --hot, so backend changes swap the routes too.
let devPages = 0;
const local = (url: string | null) => !!url && !/^([a-z]+:|\/\/)/i.test(url);
// bun --hot reruns build() on every backend edit. rewriting a file with the same content
// makes bun's dev server reload that module and fail ("Failed to load bundled module").
async function writeIfChanged(file: string, text: string) {
  const old = Bun.file(file);
  if ((await old.exists()) && (await old.text()) === text) return;
  await Bun.write(file, text);
}
// bun's dev server needs real files for a page. they go to .mininext/<pid>/ in the working
// folder, not next to the sources. the folder has its own .gitignore.
// one subfolder per process: two dev servers in one folder do not overwrite each other.
function devFolder() {
  // bun --hot runs this module again. the process keeps its folder
  const g = globalThis as { __mininextDevFolder?: string };
  if (g.__mininextDevFolder) return g.__mininextDevFolder;
  const base = resolve(process.cwd(), ".mininext");
  mkdirSync(base, { recursive: true });
  if (!existsSync(resolve(base, ".gitignore"))) writeFileSync(resolve(base, ".gitignore"), "*\n");
  // folders of processes that are gone (a crash, ctrl-c), and an old one with our pid
  for (const name of readdirSync(base))
    if (/^\d+$/.test(name) && !runs(Number(name))) rmSync(resolve(base, name), { recursive: true, force: true });
  const dir = resolve(base, String(process.pid));
  mkdirSync(dir, { recursive: true });
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return (g.__mininextDevFolder = dir);
}
// another process with this pid runs
function runs(pid: number) {
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it runs, as another user
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
// the file that calls build(): the first file on the stack that is not in this library
function callerFile() {
  const prepare = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => stack;
  const err = new Error();
  Error.captureStackTrace(err, callerFile);
  const stack = err.stack as unknown as NodeJS.CallSite[];
  Error.prepareStackTrace = prepare;
  const lib = resolve(import.meta.dir, "..") + sep;
  return stack.map((site) => site.getFileName()).find((file) => file && !file.startsWith(lib));
}
async function devBundle(root: string, html: string) {
  const id = devPages++;
  const route = `/__mininext/${id}`;
  const dir = devFolder();
  // dashboard.ts calls build(): dashboard-<id>.html
  const name = `${callerFile()?.split(/[\\/]/).pop()?.replace(/\.[^.]*$/, "").replace(/[^\w.-]/g, "_") || "page"}-${id}`;
  const file = resolve(dir, `${name}.html`);
  // a local url of the skeleton, as a path from the dev folder
  const fromDev = (url: string) => {
    if (!local(url) || url.startsWith("/")) return url;
    const path = relative(dir, resolve(root, url)).split(sep).join("/");
    return path.startsWith("../") ? path : `./${path}`;
  };
  // each local module script gets a small entry file that accepts hot updates.
  // bun then swaps edited code in place (renderRoot keeps the state), with no hmr code in the app.
  const entries: Promise<void>[] = [];
  const move = (attr: string) => ({
    element: (el: HTMLRewriterTypes.Element) => void el.setAttribute(attr, fromDev(el.getAttribute(attr)!)),
  });
  const devPage = new HTMLRewriter()
    // the urls that bun resolves start from the dev folder now
    .on("[src]", {
      element: (el) => {
        const src = el.getAttribute("src")!;
        if (el.tagName !== "script" || el.getAttribute("type") !== "module" || !local(src))
          return void el.setAttribute("src", fromDev(src));
        const entry = `${name}-${entries.length}.ts`;
        entries.push(writeIfChanged(resolve(dir, entry), `import ${JSON.stringify(fromDev(src))};\nimport.meta.hot.accept();\n`));
        el.setAttribute("src", `./${entry}`);
      },
    })
    .on("link[href]", move("href"))
    .on("[poster]", move("poster"))
    .on("[srcset]", {
      element: (el) => {
        const sources = el.getAttribute("srcset")!.split(",").map((source) => {
          const [url = "", ...size] = source.trim().split(/\s+/);
          return [fromDev(url), ...size].join(" ");
        });
        el.setAttribute("srcset", sources.join(", "));
      },
    })
    // a new id on every build(): bun --hot reruns build() after any backend edit,
    // the page file changes, and bun reloads the browser with the new server html
    .on("head", {
      element: (el) => void el.append(`<meta name="mininext-build" content="${Date.now()}-${devPages}">`, { html: true }),
    })
    .transform(html);
  await Promise.all(entries);
  await writeIfChanged(file, devPage);
  const page: Bun.HTMLBundle = (await import(file)).default;
  const static_routes: BunStaticRoutes = {
    [route]: page,
    // bun changes the asset urls on each edit. this loader writes the current ones
    // into the page before first paint, so fill() can stay sync and serve our own html.
    [`${route}.js`]: async (req: Request) => {
      let tags = "";
      new HTMLRewriter()
        .on("script[src^='/_bun/'], link[href^='/_bun/']", {
          element: (el) => {
            const attrs = [...el.attributes].map(([k, v]) => `${k}="${Bun.escapeHTML(v)}"`);
            tags += `<${el.tagName} ${attrs.join(" ")}>${el.tagName === "script" ? "</script>" : ""}`;
          },
        })
        .transform(await (await fetch(new URL(route, req.url))).text());
      return new Response(
        `document.write(${JSON.stringify(tags)});`,
        { headers: { "Content-Type": "text/javascript;charset=utf-8", "Cache-Control": "no-store" } },
      );
    },
  };
  // the html we fill: bun bundles the local scripts, styles and icons, the loader adds them
  return {
    static_routes,
    _build_result: undefined,
    html: new HTMLRewriter()
      .on("script[src], link[rel=stylesheet], link[rel~=icon]", {
        element: (el) => {
          if (local(el.getAttribute("src") ?? el.getAttribute("href"))) el.remove();
        },
      })
      .on("head", {
        element: (el) =>
          void el.append(`<script src="${route}.js"></script>`, { html: true }),
      })
      .transform(html),
  };
}

// ${null} in a skeleton becomes this token. it must be the same on each build:
// random text in the html changes how bun minifies the js, so the artifact hash changes.
const placeholder = (n: number) => `__mini_null_${n}__`;
const PLACEHOLDER = /__mini_null_\d+__/;
// a placeholder inside an attribute remembers it, so fill() can check what goes there
export type Placeholder = { id: string; attribute?: { name: string; prefix: string } };

export function curryFill(
  placeholders: Placeholder[],
  rendered_skeleton: string,
  mini?: Mini,
) {
  // split once. filled content is never scanned again.
  const parts = rendered_skeleton.split(PLACEHOLDER);
  if (parts.length !== placeholders.length + 1)
    throw new Error(
      `mininext: the skeleton has ${placeholders.length} \${null} placeholders, but ${parts.length - 1} are left after the build`,
    );
  const fill = (...args: MiniValue[]): Blob => {
    const localMini = mini ?? newBackendMini();
    let result = parts[0]!;
    placeholders.forEach(({ attribute }, i) => {
      const filler = args[i];
      if (attribute) {
        if (filler !== null && filler !== undefined && typeof filler !== "string" && typeof filler !== "number")
          throw new Error(`mininext: fill() can only put a string or a number into the attribute ${attribute.name}`);
        if (filler !== null && filler !== undefined)
          checkAttribute(attribute.name, attribute.prefix + filler);
      }
      if (filler === undefined || filler === null) {
        // empty
      } else if (typeof filler === "string" || typeof filler === "number") {
        result += Bun.escapeHTML(String(filler));
      } else {
        const slotId = `${i}-filled`;
        resolveMiniValue(filler, localMini, slotId);
        result += renderBackend({ ...localMini.cacheAndCursor, cursor: slotId }).result;
      }
      result += parts[i + 1];
    });
    return new Blob([result], { type: "text/html;charset=utf-8" });
  };
  return fill;
}

// the attribute a value in a tag belongs to: its name, the text before the value
// inside the quotes, and if it has no quotes. no attribute = the value is bare: refused.
const ATTRIBUTE = /([^\s"'<>\/=]+)\s*=\s*(?:"([^"]*)|'([^']*)|([^\s"'<>`=]*))$/;
function attributeAt(before: string) {
  const m = before.slice(before.lastIndexOf("<")).match(ATTRIBUTE) ?? before.match(ATTRIBUTE);
  if (!m)
    throw new Error(
      `mininext: a value in a tag must be an attribute value, like name="\${value}". near: ${before.slice(-40)}`,
    );
  return { name: m[1]!, prefix: m[2] ?? m[3] ?? m[4] ?? "", unquoted: m[4] !== undefined };
}

// placeholders: given for a skeleton, then ${null} becomes a fillable token.
// otherwise ${null} renders as nothing.
export function renderBackend(cac: CacheAndCursor, placeholders?: Placeholder[]) {
  const htmlsnippet = getResolvedMiniHtmlStringThrows(cac);
  if (!htmlsnippet.stringLiterals || !htmlsnippet.values || !htmlsnippet.slots)
    throw new Error("should have literals,values & slots once resolved");
  let result = "";
  const inTag = valuePositions(htmlsnippet.stringLiterals);
  htmlsnippet.stringLiterals.forEach((literal, index) => {
    result += literal;
    if (index >= htmlsnippet.values!.length) return;
    const value = htmlsnippet.values![index];
    const attribute = inTag[index] ? attributeAt(result) : undefined;
    if (attribute) checkAttribute(attribute.name, typeof value === "string" || typeof value === "number" ? attribute.prefix + value : value);
    if (value === null && placeholders) {
      const id = placeholder(placeholders.length);
      placeholders.push({ id, attribute: attribute && { name: attribute.name, prefix: attribute.prefix } });
      result += id;
    } else if (!attribute && value && typeof value === "object" && "childId" in value) {
      result += renderBackend({ cache: cac.cache, cursor: value.childId }, placeholders).result;
    } else if (attribute?.unquoted && (value === false || value === undefined || value === null || typeof value === "function")) {
      // disabled=${false}, or a handler (no dom here): leave the attribute out
      result = result.replace(/\s+[^\s=]+=\s*$/, "");
    } else {
      let text = value === true ? "" : Bun.escapeHTML(String(value ?? ""));
      // unquoted attribute value: quote it, or a space ends it
      if (attribute?.unquoted) text = `"${text}"`;
      result += text;
    }
  });
  return {
    result,
    placeholders: placeholders ?? [],
    placeholder_ids: (placeholders ?? []).map((p) => p.id),
  };
}
export type BunStaticRoutes = Record<
  string,
  Response | Bun.HTMLBundle | ((req: Request) => Promise<Response>)
>;
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


import { html, type MiniHtmlString } from "../mininext/mininext";
import { version } from "./info";
import { docs, docsIndex } from "./pages/docs";
import { landing } from "./pages/landing";

// one skeleton for every page: title + content
const skeleton = await html`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${null}</title>
      <link rel="stylesheet" href="./style.css" />
      <script type="module" src="./frontend.ts"></script>
    </head>
    <body>
      <div class="center">${null}</div>
    </body>
  </html>`.build(undefined, import.meta.dir);

const page = (title: string, content: MiniHtmlString) =>
  new Response(skeleton.fill(title, content));

export function makeRoutes() {
  return {
    ...skeleton.static_routes,
    "/": () => page(`mininext ${version}`, landing()),
    "/docs": () => page("mininext docs", docsIndex()),
    "/docs/:name": (req: Bun.BunRequest<"/docs/:name">) => {
      const doc = docs.find((d) => d.name === req.params.name);
      if (!doc) return new Response("not found", { status: 404 });
      return page(`${doc.title} - mininext docs`, doc.page());
    },
  };
}

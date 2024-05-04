import { url, Mini, type HtmlHandler } from "./url";
import { html, isError, HtmlString, head } from "./html";
import { watch } from "fs/promises";
import * as path from "path";
const PROJECT_ROOT = import.meta.dir + "/../../../../";

async function build(backendPath: string = "backend/backend.ts") {
  await buildBackend(backendPath);
  if (Bun.argv[2] === "dev") {
    await devServer();
  }
}
import type { BunPlugin } from "bun";

const myPlugin: BunPlugin = {
  name: "node buffer in the frontend",
  setup(build) {
    build.onResolve({ filter: /^buffer$/ }, (args) => {
      const path_to_buffer_lib = path.resolve(
        PROJECT_ROOT,
        "node_modules/buffer/index.js"
      );
      if (path_to_buffer_lib)
        return {
          path: path_to_buffer_lib,
        };
    });
  },
};
async function buildBackend(backendPath: string = "backend/backend.ts") {
  global.FrontendScriptUrls = [];
  global.FrontendScripts = [];
  global.bundledSVGs = {};
  const i = await import(path.resolve(PROJECT_ROOT, backendPath));

  for (const frontend of url.getFrontends()) {
    const f = await buildFrontend(frontend);
    FrontendScriptUrls.push("/" + f.url);
    FrontendScripts.push(f.script);
  }
  for (const svgPath of url.getSvgPaths()) {
    const parsedSvgPath = path.parse(svgPath);
    const svgContent = Bun.file(path.join(PROJECT_ROOT + "/backend/", svgPath));
    const svgHash = Bun.hash(await svgContent.arrayBuffer());
    const svgUrl = `/${parsedSvgPath.name}-${svgHash}.svg`;
    bundledSVGs[svgUrl] = {
      svgContent: await svgContent.text(),
      svgPath,
    };
  }
  const res = await Bun.build({
    entrypoints: [path.resolve(PROJECT_ROOT, backendPath)],
    outdir: path.resolve(PROJECT_ROOT, "dist"),
    naming: "backend.js",
    minify: Bun.argv[2] === "dev" ? false : true, //production
    target: "node",
    define: {
      FrontendScripts: JSON.stringify(FrontendScripts),
      FrontendScriptUrls: JSON.stringify(FrontendScriptUrls),
      bundledSVGs: JSON.stringify(bundledSVGs),
    },
  });
}

async function buildFrontend(file: string) {
  const result = await Bun.build({
    entrypoints: [path.resolve(PROJECT_ROOT, `frontend/${file}`)],
    outdir: path.resolve(PROJECT_ROOT, "dist"),
    naming: "[name]-[hash].[ext]",
    minify: Bun.argv[2] === "dev" ? false : true, //production
    target: "browser",
    plugins: [myPlugin],
  });
  if (!result?.outputs[0]?.path) console.log(result);
  const url = path.basename(result.outputs[0].path);
  //results.push({ file, p });
  return { url, script: await result.outputs[0].text() };
}

async function devServer() {
  //start the reloader and tell browser to refresh once
  await buildBackend();
  let refreshed_once = false;
  const server = Bun.serve({
    port: 3001,
    fetch(request) {
      const success: Boolean = server.upgrade(request);
      return success
        ? new Response("Reloader works!")
        : new Response("Reloader WebSocket upgrade error", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.subscribe("reloader");
        if (!refreshed_once) {
          ws.send("Reload!");
          refreshed_once = true;
        }
      },
      message(ws, message) {}, // a message is received
    },
  });
  async function watchAndBuild(dir: string) {
    try {
      //start the file watcher that will rebuild frontend on save
      const watcher = watch(path.resolve(PROJECT_ROOT, dir), {
        recursive: true,
      });
      for await (const event of watcher) {
        buildBackend().then(() => {
          // tell browser to refresh again because we saw a change
          server.publish("reloader", "Reload!");
        });
      }
    } catch (e) {
      console.log(
        `mini-next dev server has trouble watching "./${dir}", does the directory exist?`
      );
    }
  }
  watchAndBuild("frontend");
  watchAndBuild("backend");
}
const standardDevReloader = /*html*/ `
    <script>
      function reloader() {
        let socket = null;

        function connectWebSocket() {
          if (socket) {
            return;
          }
          socket = new WebSocket("ws://localhost:3001/reload");

          socket.addEventListener("message", (event) => {
            window.location.reload();
          });

          socket.addEventListener("close", (event) => {
            // Reestablish the connection after 1 second
            socket = null;
          });

          socket.addEventListener("error", (event) => {
            socket = null;
          });
        }
        connectWebSocket(); // connect to reloader, if it does not work:
        setInterval(connectWebSocket, 1000); // retry every 1 second
      }
      reloader();
    </script>
  `;

export {
  url,
  html,
  head,
  build,
  isError,
  HtmlString,
  type HtmlHandler,
  Mini,
  standardDevReloader,
};

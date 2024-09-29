import { url, Mini, has, type HtmlHandler } from "./url";
import {
  isError,
  HtmlString,
  BasedHtml,
  head,
  commonHead,
  cssReset,
  basedHtml as html,
} from "./html";
import type { BunPlugin, Server, WebSocketHandler } from "bun";
import { watch } from "fs/promises";
import * as path from "path";
function projectRoot() {
  return global.PROJECT_ROOT || import.meta.dir + "/../../../../";
}
declare global {
  var PROJECT_ROOT: string | undefined;
}
async function build(backendPath: string = "backend/backend.ts") {
  await buildBackend(backendPath);
  if (Bun.argv[2] === "dev") {
    await devServer();
  }
}

const streamPlugin: BunPlugin = {
  name: "node stream in the frontend",
  setup(build) {
    build.onResolve({ filter: /^stream$/ }, (args) => {
      const path_to_stream_lib = path.resolve(
        projectRoot(),
        "node_modules/stream-browserify/index.js"
      );
      if (path_to_stream_lib)
        return {
          path: path_to_stream_lib,
        };
    });
  },
};
const bufferPlugin: BunPlugin = {
  name: "node buffer in the frontend",
  setup(build) {
    build.onResolve({ filter: /^buffer$/ }, (args) => {
      const path_to_buffer_lib = path.resolve(
        projectRoot(),
        "node_modules/buffer/index.js"
      );
      if (path_to_buffer_lib)
        return {
          path: path_to_buffer_lib,
        };
    });
  },
};
const cryptoPlugin: BunPlugin = {
  name: "node crypto in the frontend",
  setup(build) {
    build.onResolve({ filter: /^crypto$/ }, (args) => {
      const path_to_crypto_lib = path.resolve(
        projectRoot(),
        "node_modules/crypto-browserify/index.js"
      );
      if (path_to_crypto_lib)
        return {
          path: path_to_crypto_lib,
        };
    });
  },
};
const nodeHttpsPlugin: BunPlugin = {
  name: "node https in the frontend",
  setup(build) {
    build.onResolve({ filter: /^https$/ }, (args) => {
      const path_to_node_https_lib = path.resolve(
        projectRoot(),
        "node_modules/https-browserify/index.js"
      );
      if (path_to_node_https_lib)
        return {
          path: path_to_node_https_lib,
        };
    });
  },
};
async function buildBackend(backendPath: string = "backend/backend.ts") {
  global.FrontendScriptUrls = [];
  global.FrontendScripts = [];
  global.bundledSVGs = {};
  const i = await import(path.resolve(projectRoot(), backendPath));

  for (const frontend of url.getFrontends()) {
    const firstPlaceToLook = path.resolve(
      path.dirname(frontend.callerPath),
      `frontend/${frontend.path}`
    );
    const secondPlaceToLook = path.resolve(
      projectRoot(),
      `frontend/${frontend.path}`
    );
    const frontEndPath = (await Bun.file(firstPlaceToLook).exists())
      ? firstPlaceToLook
      : secondPlaceToLook;
    const f = await buildFrontend(frontEndPath);
    FrontendScriptUrls.push("/" + f.url);
    FrontendScripts.push(f.script);
  }
  for (const svgPath of url.getSvgPaths()) {
    const parsedSvgPath = path.parse(svgPath);
    const svgContent = Bun.file(
      path.join(projectRoot() + "/backend/", svgPath)
    );
    const svgHash = Bun.hash(await svgContent.arrayBuffer());
    const svgUrl = `/${parsedSvgPath.name}-${svgHash}.svg`;
    bundledSVGs[svgUrl] = {
      svgContent: await svgContent.text(),
      svgPath,
    };
  }
  const res = await Bun.build({
    entrypoints: [path.resolve(projectRoot(), backendPath)],
    outdir: path.resolve(projectRoot(), "dist"),
    naming: "backend.js",
    minify: Bun.argv[2] === "dev" ? false : true, //production
    target: "bun",
    define: {
      FrontendScripts: JSON.stringify(FrontendScripts),
      FrontendScriptUrls: JSON.stringify(FrontendScriptUrls),
      bundledSVGs: JSON.stringify(bundledSVGs),
    },
  });
}

async function buildFrontend(file: string) {
  const result = await Bun.build({
    entrypoints: [file],
    outdir: path.resolve(projectRoot(), "dist"),
    naming: "[name]-[hash].[ext]",
    minify: Bun.argv[2] === "dev" ? false : true, //production
    target: "browser",
    plugins: [bufferPlugin, streamPlugin, cryptoPlugin, nodeHttpsPlugin],
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
      const watcher = watch(path.resolve(projectRoot(), dir), {
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
const standardDevReloader = html`
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
async function makeEntrypoint() {
  let module;
  const backendImportPath = projectRoot() + "/dist/backend.js";
  try {
    // @ts-ignore
    module = await import(backendImportPath);
  } catch (error) {
    await build();
    // @ts-ignore
    module = await import(backendImportPath);
  }
  return module.default() as {
    fetch: (req: Request, server: Server) => Promise<Response>;
    websocket: WebSocketHandler;
  };
}
export function getCallerFilePath(): string {
  // const stack = new Error().stack?.split("\n");
  // //console.log(stack);
  // if (!stack) return "";
  // return stack[2].slice(
  //   stack[2].lastIndexOf("(") + 1,
  //   stack[2].lastIndexOf(")") + 3
  // );
  return __dirname;
}
export {
  has,
  html,
  url,
  head,
  build,
  makeEntrypoint,
  isError,
  BasedHtml,
  HtmlString,
  type HtmlHandler,
  Mini,
  standardDevReloader,
  commonHead,
  cssReset,
};

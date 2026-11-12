// request data on mini, read by any component, no props.
// run: bun examples/request-state.ts
import { html, type Mini } from "../mininext/mininext";

const skeleton = await html`<!DOCTYPE html>
  <html>
    <body>
      ${null}
    </body>
  </html>`.build();

function path(mini: Mini) {
  const req = mini.state<Request | null>("req", null).value; // access it
  return mini.html`<p>you asked for ${req ? new URL(req.url).pathname : "?"}</p>`;
}

function fetch(req: Request) {
  const mini = skeleton.mini();
  mini.state("req", req); // attach the request
  return new Response(mini.fill((mini: Mini) => mini.html`<h1>hello</h1>${path}`));
}

const server = Bun.serve({ port: Number(process.env.PORT ?? 3001), routes: skeleton.static_routes, fetch });
console.log(`request state on ${server.url}`);

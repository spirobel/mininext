// a counter with zero js in the browser: a form post and a redirect.
// run: bun examples/counter.ts
import { html } from "../mininext/mininext";

const skeleton = await html`<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Counter</title>
    </head>
    <body>
      <main>${null}</main>
      <form method="POST" action="/">
        <button type="submit">+1</button>
      </form>
    </body>
  </html>`.build();

let globalCounter = 0;

function fetch(req: Request) {
  if (req.method === "POST") {
    globalCounter++;
    return Response.redirect("/", 303);
  }
  return new Response(
    skeleton.fill(html`<div id="count">${globalCounter}</div>`),
  );
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: skeleton.static_routes, // static assets from build
  fetch, // dynamic route handler
});
console.log(`counter on ${server.url}`);

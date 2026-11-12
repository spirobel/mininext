import { html } from "../../mininext/mininext";
// script in a nested folder on purpose: checks the old "no nested src" note
const skeleton = await html`<!doctype html>
  <html>
    <head><title>noderefs demo</title></head>
    <body>
      <div id="root"></div>
      <script type="module" src="./nested/frontend.ts"></script>
    </body>
  </html>`.build();
Bun.serve({
  port: Number(process.env.PORT ?? 3311),
  routes: { ...skeleton.static_routes, "/": () => new Response(skeleton.fill()) },
});
console.log("noderefs demo on", process.env.PORT ?? 3311);

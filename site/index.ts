// dev:    bun --hot site/index.ts      (from the repo folder)
// prod:   NODE_ENV=production bun site/index.ts
// static: bun site/export.ts
import { makeRoutes } from "./routes";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3320),
  routes: makeRoutes(),
  fetch: () => new Response("not found", { status: 404 }),
});
console.log(`mininext site on ${server.url}`);

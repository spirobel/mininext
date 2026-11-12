// the static site: start the normal server, crawl it, write the files.
// no second build system. the pages you serve are the pages you ship.
process.env.NODE_ENV = "production";
const { crawl } = await import("../mininext/mininext");
const { makeRoutes } = await import("./routes");
const { version } = await import("./info");

const outdir = `${import.meta.dir}/dist`;
const server = Bun.serve({ port: 0, routes: makeRoutes() });
// BASE=/mininext for github pages, the site is served from spirobel.github.io/mininext/
const artifact = await crawl(server.url, outdir, { version, base: process.env.BASE ?? "" });
server.stop();
console.log(`static site in ${outdir}: ${artifact.files.length} files, sha256 ${artifact.sha256}`);

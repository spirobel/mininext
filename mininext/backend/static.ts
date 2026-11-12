// static site export: wget --mirror, with fetch.
// start your server (NODE_ENV=production), then crawl it.
// every same-origin href and src it finds gets fetched and written.
// base: the site is served under a sub path (github pages: /repo/).
// absolute links like /docs then become /repo/docs in the written html and css.
// at the end it writes mini_artifact.json: each file with its sha256,
// and one sha256 for the whole artifact.
export type MiniArtifact = {
  schema: "mini_artifact/1";
  version: string;
  // sha256 of "mini_artifact/1\n<version>\n" + "<sha256>  <path>\n" for each file,
  // sorted by path. the lines are sha256sum format, so a shell can check it too.
  sha256: string;
  files: { path: string; sha256: string }[];
};

export async function crawl(
  start: string | URL,
  outdir: string,
  { paths = ["/"], version = "0.0.0", base = "" } = {},
): Promise<MiniArtifact> {
  const origin = new URL(start).origin;
  base = base.replace(/\/+$/, "");
  const rebase = (link: string) => (base && /^\/(?!\/)/.test(link) ? base + link : link);
  const seen = new Set(paths);
  const todo = [...paths];
  const files: MiniArtifact["files"] = [];
  while (todo.length) {
    const path = todo.shift()!;
    const res = await fetch(origin + path);
    if (!res.ok) {
      console.warn(`crawl: ${res.status} ${path}`);
      continue;
    }
    const type = res.headers.get("content-type") ?? "";
    const links: string[] = [];
    let body: string | ArrayBuffer;
    if (type.includes("html")) {
      body = new HTMLRewriter()
        .on("[href], [src]", {
          element: (el) => {
            for (const name of ["href", "src"]) {
              const link = el.getAttribute(name);
              if (link === null) continue;
              links.push(link);
              if (rebase(link) !== link) el.setAttribute(name, rebase(link));
            }
          },
        })
        .transform(await res.text());
    } else if (type.includes("css")) {
      body = await res.text();
      for (const m of body.matchAll(/url\(\s*['"]?([^'")]+)/g)) links.push(m[1]!);
      body = body.replace(/(url\(\s*['"]?)([^'")]+)/g, (_, open, link) => open + rebase(link));
    } else {
      body = await res.arrayBuffer();
    }
    for (const link of links) {
      const url = new URL(link, origin + path);
      if (url.origin === origin && !seen.has(url.pathname)) {
        seen.add(url.pathname);
        todo.push(url.pathname);
      }
    }
    // /docs -> docs/index.html, so it works on any static host
    let file = path.endsWith("/") ? path + "index.html" : path;
    if (type.includes("html") && !/\.html?$/.test(file)) file += "/index.html";
    await Bun.write(outdir + file, body);
    files.push({ path: file.slice(1), sha256: sha256(body) });
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const schema = "mini_artifact/1";
  const lines = files.map((f) => `${f.sha256}  ${f.path}\n`).join("");
  const manifest: MiniArtifact = {
    schema,
    version,
    sha256: sha256(`${schema}\n${version}\n${lines}`),
    files,
  };
  await Bun.write(`${outdir}/mini_artifact.json`, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

const sha256 = (data: string | ArrayBuffer) =>
  new Bun.CryptoHasher("sha256").update(data).digest("hex");

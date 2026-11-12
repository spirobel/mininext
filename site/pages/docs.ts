import { html } from "../../mininext/mininext";
import { header, footer } from "./landing";
import { trusted } from "../info";
import { highlight } from "../highlight";

const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

const dir = `${import.meta.dir}/../../docs`;
const files = [...new Bun.Glob("*.md").scanSync(dir)].sort();

// the markdown files are the docs. this page only renders them.
export const docs = await Promise.all(
  files.map(async (file) => {
    const name = file.replace(/\.md$/, "");
    // links between docs: ./patterns.md#x -> /docs/patterns#x
    // links to source files: ../mininext/x.ts -> github
    const md = (await Bun.file(`${dir}/${file}`).text())
      .replace(/\]\((?:\.\/)?([\w-]+)\.md(#[^)]*)?\)/g, "](/docs/$1$2)")
      .replace(/\]\(\.\.\/([^)]+)\)/g, "](https://github.com/spirobel/mininext/blob/master/$1)");
    const title = md.match(/^#\s+(.+)$/m)?.[1] ?? name;
    const summary =
      md
        .split("\n")
        .find((l) => l.trim() && !/^(#|```|\||!|<|-)/.test(l.trim()))
        ?.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*`_]/g, "")
        .match(/^.{0,200}?[.!?](\s|$)|^.{0,200}/)![0] ?? "";
    // highlight fenced code: bun escaped it, so unescape, then color it
    const body = trusted(
      Bun.markdown
        .html(md, { headings: { ids: true } })
        .replace(/<code class="language-(\w+)">([\s\S]*?)<\/code>/g, (_, lang, code) =>
          `<code class="language-${lang}">${highlight(unescape(code), lang)}</code>`,
        ),
    );
    const page = () => html`${header("Documentation")}
      <nav class="crumbs"><a href="/">mininext</a> &raquo; <a href="/docs">docs</a> &raquo; ${title}</nav>
      <div class="prose">${body}</div>
      ${footer()}`;
    return { name, title, summary, page };
  }),
);

export function docsIndex() {
  return html`${header("Documentation")}
    <nav class="crumbs"><a href="/">mininext</a> &raquo; docs</nav>
    <table>
      <tr class="h"><th>Document</th><th>Description</th></tr>
      ${docs.map(
        (d) => html`<tr>
          <td class="e"><a href="/docs/${d.name}">${d.title}</a></td>
          <td class="v">${d.summary}</td>
        </tr>`,
      )}
    </table>
    <p class="credit">The docs are the markdown files in the repo, rendered with <code>Bun.markdown</code>.</p>
    ${footer()}`;
}

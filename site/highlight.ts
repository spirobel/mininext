// tiny highlighter in the colors of php's highlight_string().
// ts/js: keywords, strings, comments. a backtick template is html,
// and each ${...} in it is code again. php: html outside <?php ?>.
const KEYWORDS = new Set(
  "const let var function return if else for of in await async new import export from type true false null undefined while throw try catch class extends echo as".split(" "),
);
// classes: hk keyword, hs string, hc comment, hd code, hh html (colors in style.css)
const span = (cls: string, text: string) =>
  text ? `<span class="h${cls}">${Bun.escapeHTML(text)}</span>` : "";

export function highlight(src: string, lang = "ts"): string {
  let html = colorize(src, lang);
  // merge runs of the same color into one span
  const same = /<span class="(\w+)">([^<]*)<\/span><span class="\1">/g;
  for (let prev = ""; prev !== html; ) {
    prev = html;
    html = html.replace(same, '<span class="$1">$2');
  }
  return html;
}

function colorize(src: string, lang: string): string {
  if (lang === "php") {
    let out = "";
    let i = 0;
    while (i < src.length) {
      const open = src.slice(i).search(/<\?(php|=)/);
      if (open < 0) return out + span("h", src.slice(i));
      out += span("h", src.slice(i, i + open));
      const tag = src.slice(i + open).match(/^<\?(php|=)/)![0];
      out += span("d", tag);
      const [code, end] = scan(src, i + open + tag.length, "?>", lang);
      out += code;
      i = end;
      if (src.startsWith("?>", i)) (out += span("d", "?>")), (i += 2);
    }
    return out;
  }
  if (!/^(ts|js|typescript|javascript|tsx|jsx)$/.test(lang)) return Bun.escapeHTML(src);
  return scan(src, 0, "", lang)[0];
}

// code until `stop` ("}" closes a ${...}, "?>" ends php). returns [html, index]
function scan(src: string, i: number, stop: string, lang: string): [string, number] {
  let out = "";
  let depth = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    if (stop === "}" && rest[0] === "}" && depth === 0) return [out, i];
    if (stop === "?>" && rest.startsWith("?>")) return [out, i];
    const comment = rest.match(lang === "php" ? /^(\/\/|#)[^\n]*|^\/\*[\s\S]*?\*\// : /^\/\/[^\n]*|^\/\*[\s\S]*?\*\//);
    const string = rest.match(/^"(\\.|[^"\\\n])*"|^'(\\.|[^'\\\n])*'/);
    const word = rest.match(/^[$\w]+/);
    if (comment) (out += span("c", comment[0])), (i += comment[0].length);
    else if (string) (out += span("s", string[0])), (i += string[0].length);
    else if (rest[0] === "`") [out, i] = template(src, i + 1, out, lang);
    else if (word) {
      out += span(KEYWORDS.has(word[0]) ? "k" : "d", word[0]);
      i += word[0].length;
    } else {
      if (rest[0] === "{") depth++;
      if (rest[0] === "}") depth--;
      out += span("d", rest[0]!);
      i++;
    }
  }
  return [out, i];
}

// inside `...`: html text, ${ code } holes, until the closing backtick
function template(src: string, i: number, out: string, lang: string): [string, number] {
  out += span("k", "`");
  let text = "";
  while (i < src.length && src[i] !== "`") {
    if (src[i] === "\\") (text += src.slice(i, i + 2)), (i += 2);
    else if (src.startsWith("${", i)) {
      out += span("h", text) + span("k", "${");
      text = "";
      const [code, end] = scan(src, i + 2, "}", lang);
      out += code + span("k", "}");
      i = end + 1;
    } else text += src[i++];
  }
  return [out + span("h", text) + span("k", "`"), i + 1];
}

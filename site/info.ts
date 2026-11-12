import { constructMiniHtmlString, type MiniHtmlString } from "../mininext/mininext";
import pkg from "../package.json";

export const version = pkg.version;

// count the library, live. the pitch says "small", the page proves it.
const lib = `${import.meta.dir}/../mininext`;
let lines = 0;
for await (const file of new Bun.Glob("**/*.ts").scan(lib))
  lines += (await Bun.file(`${lib}/${file}`).text()).split("\n").length;
export const linesOfCode = lines;

// markdown we wrote ourselves is trusted html: a template with one literal and no values
export const trusted = (s: string): MiniHtmlString =>
  constructMiniHtmlString(Object.assign([s], { raw: [s] }) as unknown as TemplateStringsArray, []);

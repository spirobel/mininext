import { expect, test } from "bun:test";
import { testDataFor } from "../testdata";
// no dom here: isBackend is true
import { html } from "../../mininext/mininext";

const testData = testDataFor(import.meta.path);

test("b01 backend renders arrays", () => {
  const { dump } = testData("b01-backend-array");
  const out = html`<ul>${["a", "b"].map((x) => html`<li>${x}</li>`)}</ul>`.renderBackend();
  dump("out.html", out);
  expect(out).toBe("<ul><li>a</li><li>b</li></ul>");
});

test("b02 backend does not call handlers and drops them", () => {
  const { dump } = testData("b02-backend-handler");
  let called = false;
  const out = html`<button onclick=${() => (called = true)} class="x">go</button>`.renderBackend();
  dump("out.html", out);
  expect(called).toBe(false);
  expect(out).toBe(`<button class="x">go</button>`);
});

test("b03 backend text still escaped", () => {
  const { dump } = testData("b03-backend-escape");
  const out = html`<p title="${'"<'}">${"<b>"}</p>`.renderBackend();
  dump("out.html", out);
  expect(out).toBe(`<p title="&quot;&lt;">&lt;b&gt;</p>`);
});

test("b04 backend quotes unquoted attribute values", () => {
  const { dump } = testData("b04-backend-unquoted");
  const out = html`<p class=${"a b"} id=${1}>x</p>`.renderBackend();
  dump("out.html", out);
  expect(out).toBe(`<p class="a b" id="1">x</p>`);
});

test("b05 backend boolean attributes", () => {
  const { dump } = testData("b05-backend-bool");
  const out = html`<button disabled=${false} hidden=${true}>x</button>`.renderBackend();
  dump("out.html", out);
  expect(out).toBe(`<button hidden="">x</button>`);
});

test("b06 fill does not scan filled content again", async () => {
  const { dir, dump } = testData("b06-fill-single-pass");
  const skeleton = await html`<p>${null}</p><i>${null}</i>`.build(undefined, dir);
  const second = skeleton._rendered_skeleton.placeholder_ids[1]!;
  const out = await new Response(skeleton.fill(`a ${second} b`, "two")).text();
  dump("out.html", out);
  expect(out).toContain("<i>two</i>");
  expect(out).toContain(Bun.escapeHTML(`a ${second} b`));
});

test("b07 nested null is a placeholder too", async () => {
  const { dir, dump } = testData("b07-nested-null");
  const skeleton = await html`<div>${html`<p>${null}</p>`}</div><b>${null}</b>`.build(undefined, dir);
  const out = await new Response(skeleton.fill("one", "two")).text();
  dump("out.html", out);
  expect(out).toContain("<p>one</p>");
  expect(out).toContain("<b>two</b>");
});

test("b08 backend: a component can return a plain value", () => {
  const { dump } = testData("b08-component-plain-value");
  let out: string;
  try {
    out = html`<p>${() => 5}</p><i>${() => "<b>"}</i><s>${() => null}</s>`.renderBackend();
  } catch (e) {
    out = `throws: ${(e as Error).message}`;
  }
  dump("out.html", out);
  expect(out).toBe("<p>5</p><i>&lt;b&gt;</i><s></s>");
});

test("b09 backend: a component that returns a plain object is refused", () => {
  const { dump } = testData("b09-component-object");
  let error = "no error";
  try {
    html`<p>${() => ({ a: 1 }) as any}</p>`.renderBackend();
  } catch (e) {
    error = (e as Error).message;
  }
  dump("error.txt", error);
  expect(error).toContain("a plain object can not be a template value");
});

import { expect, test } from "bun:test";
import { tick } from "../dom-setup";
import { testDataFor } from "../testdata";
const testData = testDataFor(import.meta.path);
// import after dom setup, because isBackend checks window at import time
const browserApi = await import("../../mininext/browser");
const { html, makeNewMini, renderRoot } = await import(
  "../../mininext/browser"
);
type Mini = import("../../mininext/browser").Mini;
type MiniHtmlString = import("../../mininext/browser").MiniHtmlString;

// same chain as renderRoot uses for each frame
function mount(component: (mini: Mini) => MiniHtmlString) {
  const container = document.createElement("div");
  document.body.append(container);
  const cac = { cache: new Map(), cursor: "t" };
  const frame = () => {
    const mini = makeNewMini(cac);
    component(mini).resolve(mini).render(container, cac);
  };
  frame();
  return { container, frame, cac };
}

test("01 text value keeps the same text node", () => {
  const td = testData("01-text-node");
  let n = 1;
  const { container, frame } = mount(() => html`<p>count ${n}</p>`);
  const p = container.querySelector("p")!;
  const textNode = [...p.childNodes].find(
    (c) => c.nodeType === Node.TEXT_NODE && c.nodeValue === "1",
  );
  n = 2;
  frame();
  td.dump("dom.html", container.innerHTML);
  expect(container.querySelector("p")).toBe(p);
  expect(p.textContent).toBe("count 2");
  expect(textNode).toBeDefined();
  expect(textNode!.nodeValue).toBe("2");
  expect(container.querySelectorAll("span").length).toBe(0);
});

test("02 attribute change keeps element, focus and child state", () => {
  const td = testData("02-attr-keeps-state");
  let cls = "a";
  let childState: { value: number } | null = null;
  const child = (mini: Mini) => {
    const s = mini.state("clicks", 0);
    childState = s;
    return mini.html`<input value="x" />`;
  };
  const { container, frame } = mount(
    () => html`<div class="${cls}">${child}</div>`,
  );
  const div = container.querySelector("div")!;
  const input = container.querySelector("input")!;
  input.focus();
  childState!.value = 5;
  cls = "b";
  frame();
  td.dump("dom.html", container.innerHTML);
  expect(container.querySelector("div")).toBe(div);
  expect(div.getAttribute("class")).toBe("b");
  expect(container.querySelector("input")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(childState!.value).toBe(5);
});

test("03 quote in attribute value cannot break out", () => {
  const td = testData("03-attr-quote");
  const evil = `a" onmouseover="alert(1)`;
  const { container } = mount(() => html`<div title="${evil}">x</div>`);
  td.dump("dom.html", container.innerHTML);
  const div = container.querySelector("div")!;
  expect(div.getAttribute("title")).toBe(evil);
  expect(div.hasAttribute("onmouseover")).toBe(false);
});

test("04 style value keeps raw css and zero", () => {
  const td = testData("04-style-raw");
  const { container } = mount(
    () => html`<div><style>.a > .b { opacity: ${0}; content: "${"&"}"; }</style></div>`,
  );
  td.dump("dom.html", container.innerHTML);
  const css = container.querySelector("style")!.textContent!;
  expect(css).toBe(`.a > .b { opacity: 0; content: "&"; }`);
});

test("05 template with many roots renders all", () => {
  const td = testData("05-many-roots");
  const { container } = mount(() => html`<b>1</b>text<i>${"2"}</i>`);
  td.dump("dom.html", container.innerHTML);
  expect(container.querySelector("b")?.textContent).toBe("1");
  expect(container.querySelector("i")?.textContent).toBe("2");
  expect(container.textContent).toBe("1text2");
});

test("06 select options from array, grow keeps old option nodes", () => {
  const td = testData("06-select-array");
  let opts = ["a", "b"];
  let selected = "b";
  const { container, frame } = mount(
    () =>
      html`<select value="${selected}">
        ${opts.map((o) => html`<option value="${o}">${o}</option>`)}
      </select>`,
  );
  const select = container.querySelector("select")!;
  const first = select.options[0];
  expect(select.options.length).toBe(2);
  expect(select.value).toBe("b");
  opts = ["a", "b", "c"];
  selected = "c";
  frame();
  td.dump("dom.html", container.innerHTML);
  expect(select.options.length).toBe(3);
  expect(select.options[0]).toBe(first);
  expect(select.options[2]!.textContent).toBe("c");
  expect(select.value).toBe("c");
  opts = ["a"];
  frame();
  expect(select.options.length).toBe(1);
});

test("07 table rows stay inside tbody", () => {
  const td = testData("07-table-rows");
  const rows = [1, 2, 3];
  const { container } = mount(
    () =>
      html`<table><tbody>${rows.map((r) => html`<tr><td>${r}</td></tr>`)}</tbody></table>`,
  );
  td.dump("dom.html", container.innerHTML);
  const tbody = container.querySelector("tbody")!;
  expect(tbody.querySelectorAll("tr").length).toBe(3);
  expect(container.firstElementChild?.tagName).toBe("TABLE");
});

test("08 handler uses the latest closure", () => {
  const td = testData("08-handler");
  let label = "first";
  const seen: string[] = [];
  const { container, frame } = mount(
    () => html`<button onclick=${() => seen.push(label)}>go</button>`,
  );
  const button = container.querySelector("button")!;
  label = "second";
  frame();
  button.click();
  td.dump("dom.html", container.innerHTML);
  expect(seen).toEqual(["second"]);
  expect(button.hasAttribute("onclick")).toBe(false);
});

test("09 boolean attribute toggles", () => {
  const td = testData("09-bool-attr");
  let off = true;
  const { container, frame } = mount(
    () => html`<button disabled=${off}>go</button>`,
  );
  const button = container.querySelector("button")!;
  expect(button.hasAttribute("disabled")).toBe(true);
  off = false;
  frame();
  td.dump("dom.html", container.innerHTML);
  expect(button.hasAttribute("disabled")).toBe(false);
});

test("10 no ids in dom and no crypto needed", () => {
  const td = testData("10-no-ids");
  const orig = crypto.randomUUID;
  (crypto as any).randomUUID = () => {
    throw new Error("randomUUID called");
  };
  try {
    const { container } = mount(
      () => html`<div>${"a"}<span>${html`<b>${1}</b>`}</span></div>`,
    );
    td.dump("dom.html", container.innerHTML);
    expect(container.querySelectorAll("[id]").length).toBe(0);
    expect(container.textContent).toBe("a1");
  } finally {
    (crypto as any).randomUUID = orig;
  }
});

test("11 null and false render nothing, switch to template and back", () => {
  const td = testData("11-null-switch");
  let v: any = null;
  const { container, frame } = mount(() => html`<div>${v}</div>`);
  expect(container.textContent).toBe("");
  v = html`<b>bold</b>`;
  frame();
  expect(container.querySelector("b")?.textContent).toBe("bold");
  v = false;
  frame();
  td.dump("dom.html", container.innerHTML);
  expect(container.querySelector("b")).toBeNull();
  expect(container.textContent).toBe("");
});

test("12 flatten is gone: arrays are values", () => {
  const td = testData("12-flatten-gone");
  const mini = makeNewMini({ cache: new Map(), cursor: "t" });
  const got = { exported: "flatten" in browserApi, onMini: "flatten" in mini };
  td.dump("api.json", JSON.stringify(got));
  expect(got).toEqual({ exported: false, onMini: false });
});

test("13 renderRoot renders into container and updates per frame", () => {
  const td = testData("13-render-root");
  const container = document.createElement("div");
  container.id = "root";
  document.body.append(container);
  let n = 1;
  renderRoot({ component: () => html`<p>${n}</p>`, container });
  tick();
  const p = container.querySelector("p")!;
  n = 2;
  tick();
  td.dump("dom.html", document.body.innerHTML);
  expect(document.getElementById("root")).toBe(container);
  expect(container.querySelector("p")).toBe(p);
  expect(p.textContent).toBe("2");
});

test("14 dev mode throws when a template rebuilds every frame", () => {
  const td = testData("14-twitch");
  let flip = false;
  const { frame } = mount(() => {
    flip = !flip;
    return html`<div>${flip ? html`<a>a</a>` : html`<b>b</b>`}</div>`;
  });
  let error: Error | null = null;
  try {
    for (let i = 0; i < 30; i++) frame();
  } catch (e) {
    error = e as Error;
  }
  td.dump("error.txt", String(error));
  expect(error?.message).toContain("rebuilt");
});

test("15 renderRoot again on the same container (hmr) keeps state, one root", () => {
  const td = testData("15-render-root-hmr");
  const container = document.createElement("div");
  document.body.append(container);
  let renders = 0;
  const v1 = (mini: Mini) => {
    renders++;
    const s = mini.state("n", 0);
    s.value++;
    return mini.html`<p>v1 ${s.value}</p>`;
  };
  renderRoot({ component: v1, container });
  tick(3);
  const v2 = (mini: Mini) => {
    renders++;
    const s = mini.state("n", 0);
    return mini.html`<p>v2 ${s.value}</p>`;
  };
  renderRoot({ component: v2, container }); // module ran again after an edit
  renders = 0;
  tick();
  td.dump("dom.html", container.innerHTML);
  expect(container.textContent).toBe("v2 3");
  expect(renders).toBe(1);
});

test("16 a text slot can switch to a component that uses mini.state, and back", () => {
  const td = testData("16-text-to-state-component");
  let v: any = "text";
  const comp = (mini: Mini) => {
    const s = mini.state("n", 0);
    s.value++;
    return mini.html`<b>${s.value}</b>`;
  };
  const { container, frame } = mount(() => html`<p>${v}</p>`);
  v = comp;
  frame();
  expect(container.querySelector("b")?.textContent).toBe("1");
  v = "back";
  frame();
  expect(container.textContent).toBe("back");
  v = comp;
  frame();
  td.dump("dom.html", container.innerHTML);
  expect(container.querySelector("b")?.textContent).toBe("1");
});

test("17 a component can return a plain value, like any ${value}", () => {
  const td = testData("17-component-plain-value");
  let n = 5;
  const counter = (mini: Mini) => {
    const s = mini.state("c", 0);
    s.value++;
    return s.value;
  };
  const container = document.createElement("div");
  document.body.append(container);
  const cac = { cache: new Map(), cursor: "t" };
  // same chain as mount(), but each frame is under our control
  const frame = () => {
    const mini = makeNewMini(cac);
    html`<p>${() => n}</p><i>${() => "<b>x</b>"}</i><s>${() => null}</s><u>${() => ["a", "b"]}</u><em>${counter}</em>`
      .resolve(mini)
      .render(container, cac);
  };
  const read = () => ({
    p: container.querySelector("p")?.textContent,
    i: container.querySelector("i")?.textContent,
    iHasElement: !!container.querySelector("i b"),
    s: container.querySelector("s")?.textContent,
    u: container.querySelector("u")?.textContent,
    em: container.querySelector("em")?.textContent,
  });
  // a frame that throws counts as a result too
  const safe = () => {
    try {
      frame();
      return read();
    } catch (e) {
      return `throws: ${(e as Error).message}`;
    }
  };
  const first = safe();
  const textNode = container.querySelector("p")?.firstChild ? [...container.querySelector("p")!.childNodes].find((c) => c.nodeType === Node.TEXT_NODE && c.nodeValue === "5") : undefined;
  n = 6;
  const second = safe();
  td.dump("frames.json", JSON.stringify({ first, second, dom: container.innerHTML }, null, 2));
  expect({ first, second, sameTextNode: !!textNode && textNode.nodeValue === "6" }).toEqual({
    first: { p: "5", i: "<b>x</b>", iHasElement: false, s: "", u: "ab", em: "1" },
    second: { p: "6", i: "<b>x</b>", iHasElement: false, s: "", u: "ab", em: "2" },
    sameTextNode: true,
  });
});

test("18 a component that returns a plain object is refused", () => {
  const td = testData("18-component-object");
  let error = "no error";
  try {
    mount(() => html`<p>${() => ({ a: 1 }) as any}</p>`);
  } catch (e) {
    error = (e as Error).message;
  }
  td.dump("error.txt", error);
  expect(error).toContain("a plain object can not be a template value");
});


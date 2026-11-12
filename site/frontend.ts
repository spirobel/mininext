import { html, renderRoot } from "../mininext/browser";

// copy buttons: <button data-copy="text">. plain dom, no render loop needed.
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.copy ?? "");
    button.textContent = "copied";
    setTimeout(() => (button.textContent = "copy"), 1500);
  });
}

// the live demo on the landing page. other pages have no #live, so nothing runs.
const container = document.getElementById("live");
if (container) {
  // hydration: the server put the data into the first response
  const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(container.dataset.hydrate ?? ""), (c) => c.charCodeAt(0)))) as {
    version: string;
    linesOfCode: number;
  };
  let count = 0;
  let frames = 0;
  let name = "";
  const started = performance.now();

  renderRoot({
    container,
    component: () => {
      frames++;
      return html`<table>
        <tr class="h"><th>Variable</th><th>Value</th></tr>
        <tr><td class="e">frames rendered</td><td class="v">${frames}</td></tr>
        <tr><td class="e">seconds on page</td><td class="v">${((performance.now() - started) / 1000).toFixed(1)}</td></tr>
        <tr><td class="e">count</td><td class="v">
          <button onclick=${() => count++}>clicked ${count} times</button>
        </td></tr>
        <tr><td class="e">your name</td><td class="v">
          <input placeholder="type, the frames keep running" oninput=${(e: Event) => (name = (e.target as HTMLInputElement).value)} />
          ${name ? html`<b> hello ${name}</b>` : ""}
        </td></tr>
        <tr><td class="e">library</td><td class="v">mininext ${data.version}, ${data.linesOfCode} lines <i>(hydrated)</i></td></tr>
      </table>`;
    },
  });
}

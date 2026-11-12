import { html, renderRoot, type Mini } from "../../../mininext/browser";

let wallets = ["alpha", "beta"];
let picked = "beta";
let active = false;
let ticks = 0;
let clicks = 0;
setInterval(() => ticks++, 100); // values change all the time

function counter(mini: Mini) {
  const s = mini.state("n", 0);
  return mini.html`<button id="inc" onclick=${() => s.value++}>child state ${s.value}</button>`;
}

function app(mini: Mini) {
  return mini.html`
    <h1 class="${active ? "on" : "off"}" style="opacity:${active ? 1 : 0.5}">ticks ${ticks}</h1>
    <style>.on > span { color: ${active ? "red" : "blue"}; }</style>
    <input id="name" placeholder="type here while ticks run" />
    <button id="toggle" onclick=${() => (active = !active)}>toggle</button>
    <button id="add" onclick=${() => wallets.push("w" + wallets.length)}>add wallet</button>
    <button id="pop" disabled=${wallets.length <= 1} onclick=${() => wallets.pop()}>remove wallet</button>
    <select id="wallet" value="${picked}" onchange=${(e: Event) => (picked = (e.target as HTMLSelectElement).value)}>
      ${wallets.map((w) => mini.html`<option value="${w}">${w}</option>`)}
    </select>
    <p id="picked">picked ${picked}, clicks ${clicks}</p>
    <table><tbody>${wallets.map((w, i) => mini.html`<tr><td>${i}</td><td>${w}</td></tr>`)}</tbody></table>
    ${counter}
  `;
}
const container = document.getElementById("root")!;
renderRoot({ component: app, container });
(window as any).demo = { get wallets() { return wallets; } };

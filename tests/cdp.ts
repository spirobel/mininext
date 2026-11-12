// chrome over the devtools protocol (cdp), for the browser tests.
// no dependencies: Bun.spawn starts chrome, a WebSocket talks cdp.
// CHROME=/path/to/chrome picks the browser.
import { existsSync, mkdirSync, readFileSync } from "node:fs";

export const CHROME = process.env.CHROME ?? "/home/spirobel/projects/monerochan-browser/src/out/Desktop/chrome";
// github's ubuntu runners do not allow chrome's sandbox
const CHROME_FLAGS = process.env.CI ? ["--no-sandbox"] : [];

export class CDP {
  private id = 0;
  private pending = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  readonly events: { method: string; params: any }[] = [];
  private constructor(private ws: WebSocket) {
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.id === undefined) return void this.events.push(msg);
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      msg.error ? p.fail(new Error(`${msg.error.message} ${msg.error.data ?? ""}`)) : p.ok(msg.result);
    };
  }
  static connect(url: string) {
    return new Promise<CDP>((ok, fail) => {
      const ws = new WebSocket(url);
      ws.onopen = () => ok(new CDP(ws));
      ws.onerror = () => fail(new Error(`cdp: can not connect to ${url}`));
    });
  }
  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((ok, fail) => {
      this.pending.set(id, { ok, fail });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression: string) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }
  async waitFor(expression: string, what: string, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await this.eval(expression).catch(() => false)) return;
      await Bun.sleep(50);
    }
    throw new Error(`timeout: ${what}`);
  }
  // uncaught exceptions and console / log errors of the page
  errors() {
    return this.events.filter(
      (e) =>
        e.method === "Runtime.exceptionThrown" ||
        (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") ||
        (e.method === "Log.entryAdded" && e.params.entry.level === "error"),
    );
  }
  close() {
    this.ws.close();
  }
}

// headless chrome with its profile in <dir>/profile, connected to its first tab
export async function openChrome(dir: string) {
  mkdirSync(`${dir}/profile`, { recursive: true });
  const chrome = Bun.spawn(
    [CHROME, ...CHROME_FLAGS, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}/profile`, "--no-first-run", "--no-default-browser-check",
      "--disable-background-timer-throttling",
      // no component downloads (speech models, crx updates) and no background traffic to google
      "--disable-component-update", "--disable-background-networking", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank"],
    { stdout: "ignore", stderr: "ignore" },
  );
  try {
    let port = "";
    for (let i = 0; i < 100 && !port; i++) {
      await Bun.sleep(100);
      if (existsSync(`${dir}/profile/DevToolsActivePort`)) port = readFileSync(`${dir}/profile/DevToolsActivePort`, "utf8").split("\n")[0]!;
    }
    if (!port) throw new Error(`chrome did not start: ${CHROME}`);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const cdp = await CDP.connect(targets.find((t: any) => t.type === "page").webSocketDebuggerUrl);
    for (const d of ["Runtime", "Page", "Log"]) await cdp.send(`${d}.enable`);
    // wait for the exit: a next run deletes this profile folder, and a chrome that is
    // still shutting down writes into it
    const close = async () => {
      cdp.close();
      chrome.kill();
      await chrome.exited;
    };
    return { cdp, close };
  } catch (e) {
    chrome.kill();
    throw e;
  }
}

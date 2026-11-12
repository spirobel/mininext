// real browser tests over the chrome devtools protocol (cdp), see tests/cdp.ts.
// chrome memory and layout under the random stress workload. slow (about a minute):
//   bun test ./tests/performance/browser.integration.test.ts
// CHROME=/path/to/chrome picks the browser. STRESS_SECONDS and CYCLES set the length.
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { html } from "../../mininext/mininext";
import { CDP, openChrome } from "../cdp";
import { testDataFor } from "../testdata";
const testData = testDataFor(import.meta.path);

const SECONDS = Number(process.env.STRESS_SECONDS ?? 15);
const CYCLES = Number(process.env.CYCLES ?? 3);

test(
  "b01 chrome: random frames with clicks, dom stays right, no leaks, no errors",
  async () => {
    const { dir } = testData("b01-chrome");
    const log = (name: string, data: unknown) => writeFileSync(`${dir}/${name}`, JSON.stringify(data, null, 2));

    // production build of the stress page, served like a real app
    const prev = Bun.env.NODE_ENV;
    Bun.env.NODE_ENV = "production";
    const skeleton = await html`<!doctype html><html><head><title>stress</title>
      <script type="module" src="./frontend.ts"></script></head>
      <body><div id="root"></div></body></html>`.build(undefined, `${import.meta.dir}/../browser-stress`);
    Bun.env.NODE_ENV = prev;
    const server = Bun.serve({
      port: 0,
      routes: {
        ...skeleton.static_routes,
        "/": () => new Response(skeleton.fill()),
        "/favicon.ico": () => new Response(null, { status: 204 }),
      },
    });
    const { cdp, close } = await openChrome(dir);
    try {
      await cdp.send("Performance.enable");
      await cdp.send("Page.navigate", { url: `${server.url}?seed=20261112` });
      for (let i = 0; i < 100; i++) {
        await Bun.sleep(100);
        if (await cdp.eval("!!window.__stress && __stress.frames > 30").catch(() => false)) break;
      }
      expect(await cdp.eval("__stress.frames")).toBeGreaterThan(30);

      // blink frees dom nodes on its own schedule, sometimes a second after the gc call.
      // a plateau of garbage can last several readings (130 nodes for 4 rounds, then 74).
      // so: gc until the lowest reading has not gone lower for 8 rounds, and use the lowest.
      // a real leak never goes lower, so it still fails. listeners flip by 1 between reads.
      const metrics = async () => {
        let m: any = {};
        let low = { nodes: Infinity, listeners: Infinity };
        let still = 0;
        let rounds = 0;
        while (rounds++ < 25 && still < 8) {
          await cdp.send("HeapProfiler.collectGarbage");
          await Bun.sleep(200);
          const { metrics } = await cdp.send("Performance.getMetrics");
          m = Object.fromEntries(metrics.map((x: any) => [x.name, x.value]));
          still = m.Nodes < low.nodes ? 0 : still + 1;
          low = { nodes: Math.min(low.nodes, m.Nodes), listeners: Math.min(low.listeners, m.JSEventListeners) };
        }
        return { heap: m.JSHeapUsedSize, nodes: low.nodes, listeners: low.listeners, documents: m.Documents, gcRounds: rounds, frames: await cdp.eval("__stress.frames") };
      };
      const baselines = [{ ...(await metrics()), check: await cdp.eval("__stress.check()") }];
      const checks: unknown[] = [];
      for (let cycle = 1; cycle <= CYCLES; cycle++) {
        await cdp.eval("__stress.start()");
        const until = Date.now() + SECONDS * 1000;
        while (Date.now() < until) {
          await Bun.sleep(2500);
          const r = await cdp.eval("__stress.check()");
          checks.push({ cycle, ...r, a: undefined, b: undefined });
          if (!r.same || r.orphans) {
            writeFileSync(`${dir}/stressed.html`, r.a);
            writeFileSync(`${dir}/fresh.html`, r.b);
            log("checks.json", checks);
            throw new Error(`cycle ${cycle}: ${!r.same ? "dom differs from a fresh render" : `${r.orphans} orphan cache entries`}`);
          }
        }
        await cdp.eval("__stress.stop()");
        baselines.push({ ...(await metrics()), check: await cdp.eval("__stress.check()") });
      }
      // idle frames after stop(): the page renders every frame but does no layout and no style work
      const counts = async () => {
        const { metrics } = await cdp.send("Performance.getMetrics");
        const m = Object.fromEntries(metrics.map((x: any) => [x.name, x.value]));
        return { layout: m.LayoutCount, style: m.RecalcStyleCount, frames: await cdp.eval("__stress.frames") };
      };
      const idle0 = await counts();
      await Bun.sleep(1000);
      const idle1 = await counts();
      log("idle-layout.json", { idle0, idle1 });
      const errors = cdp.errors();
      log("baselines.json", baselines);
      log("checks.json", checks);
      log("errors.json", errors);

      const [b0, b1] = baselines as any[];
      const last = baselines.at(-1) as any;
      expect(errors).toEqual([]);
      expect(idle1.frames - idle0.frames).toBeGreaterThan(30);
      expect(idle1.layout).toBe(idle0.layout);
      expect(idle1.style).toBe(idle0.style);
      // the page really ran: frames in each cycle
      for (let i = 1; i < baselines.length; i++) expect((baselines[i] as any).frames - (baselines[i - 1] as any).frames).toBeGreaterThan(SECONDS * 20);
      expect(checks.length).toBeGreaterThan(0);
      // back at the start state: exactly the same dom and cache as at the start
      for (const b of baselines as any[]) {
        expect(b.check.same).toBe(true);
        expect(b.check.cache).toBe(b0.check.cache);
        expect(b.check.nodes).toBe(b0.check.nodes);
        expect(b.documents).toBe(b0.documents);
        // blink's counters: a little garbage is fine, a leak adds up over the cycles
        expect(b.nodes).toBeLessThanOrEqual(b0.nodes + 2);
        expect(b.listeners).toBeLessThanOrEqual(b0.listeners + 2);
      }
      expect(last.nodes).toBeLessThanOrEqual(b1.nodes + 2);
      expect(last.listeners).toBeLessThanOrEqual(b1.listeners + 2);
      // the heap does not keep growing: the last cycle ends where cycle 1 ended
      expect(last.heap - b1.heap).toBeLessThan(1024 * 1024);
    } finally {
      await close();
      server.stop(true);
    }
  },
  (SECONDS * CYCLES + 60) * 1000,
);


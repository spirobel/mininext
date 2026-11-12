// the parts of bun:test that the dom tests use, for a run in a real browser.
// tests/dom.chrome.integration.test.ts bundles the test files with this file as "bun:test".
type Result = { name: string; ok: boolean; error?: string; ms: number };
const tests: { name: string; fn: () => unknown }[] = [];

export function test(name: string, fn: () => unknown) {
  tests.push({ name, fn });
}
export function beforeAll(fn: () => unknown) {
  tests.unshift({ name: "", fn });
}

export async function run(): Promise<Result[]> {
  const results: Result[] = [];
  for (const t of tests) {
    const start = performance.now();
    try {
      await t.fn();
      if (t.name) results.push({ name: t.name, ok: true, ms: performance.now() - start });
    } catch (e) {
      results.push({ name: t.name || "beforeAll", ok: false, error: String((e as Error)?.stack ?? e), ms: performance.now() - start });
    }
  }
  return results;
}

// like bun's toEqual: undefined properties count as missing
function equal(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = (o: any) => Object.keys(o).filter((k) => o[k] !== undefined);
  const ka = keys(a);
  return ka.length === keys(b).length && ka.every((k) => equal(a[k], b[k]));
}
const show = (v: unknown) => {
  try {
    return typeof v === "string" ? JSON.stringify(v) : String(JSON.stringify(v) ?? v);
  } catch {
    return String(v);
  }
};

export function expect(actual: any) {
  const matchers = (not: boolean) => {
    const check = (pass: boolean, what: string) => {
      if (pass === not) throw new Error(`expect(${show(actual)})${not ? ".not" : ""}.${what}`);
    };
    return {
      toBe: (v: unknown) => check(Object.is(actual, v), `toBe(${show(v)})`),
      toEqual: (v: unknown) => check(equal(actual, v), `toEqual(${show(v)})`),
      toBeDefined: () => check(actual !== undefined, "toBeDefined()"),
      toBeNull: () => check(actual === null, "toBeNull()"),
      toContain: (v: unknown) => check(actual.includes(v), `toContain(${show(v)})`),
      toBeGreaterThan: (v: number) => check(actual > v, `toBeGreaterThan(${v})`),
      toThrow: (part?: string) => {
        let error: Error | undefined;
        try {
          actual();
        } catch (e) {
          error = e as Error;
        }
        check(!!error && (part === undefined || String(error.message).includes(part)), `toThrow(${show(part)}) got ${show(error?.message)}`);
      },
    };
  };
  return { ...matchers(false), not: matchers(true) };
}

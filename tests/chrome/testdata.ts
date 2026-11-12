// browser version of tests/testdata.ts. the page has no file system,
// so dumps are kept here and the test runner writes them to test-data/.
export const dumps: { test: string; file: string; text: string }[] = [];

export function testDataFor(_testFile: string) {
  return (name: string) => ({ dir: name, dump: (file: string, text: string) => void dumps.push({ test: name, file, text }) });
}

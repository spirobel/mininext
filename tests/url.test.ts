import { expect, test, mock } from "bun:test";
import { html, url } from "../mininext/mininext";
// Example of creating a mock request object
const mockRequestObject: unknown = {
  method: "GET", // or 'POST', etc.
  url: "http://example.com/api/some-endpoint",
  body: JSON.stringify({ key: "value" }),
  headers: {
    "Content-Type": "application/json",
    get: () => undefined,
  },
};
const makeMockRequest = mock(() => mockRequestObject as Request);
test("urls work with all variations of added slashes", async () => {
  async function makeRequest(testurl: string) {
    const req = makeMockRequest();
    const response = await url.match(req, testurl);
    const responseText = await response?.text();
    try {
      expect(responseText).not.toInclude("No matching url found");
      expect(responseText).toInclude("ok");
    } catch (error) {
      error.message = `this url did not match correctly ${testurl}`;
      throw error;
    }
  }
  url.set([
    ["/test", (mini) => mini.html`ok`],
    ["testWithoutSlash", (mini) => mini.html`ok`],
  ]);
  url.set("/SingleTest", (mini) => mini.html`ok`);
  url.set("SingleTestWithoutSlash", (mini) => mini.html`ok`);
  for (const testurl of [
    "/test",
    "testWithoutSlash",
    "/SingleTest",
    "SingleTestWithoutSlash",
  ]) {
    await makeRequest(testurl);
    await makeRequest(testurl + "/");
  }
});

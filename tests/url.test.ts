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
      error.message = `this url did not match correctly ${testurl}: response text: ${responseText}`;
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
    "/testWithoutSlash", // important to note: the request object always has a preceding slash
    "/SingleTest",
    "/SingleTestWithoutSlash", // important to note: the request object always has a preceding slash
  ]) {
    await makeRequest(testurl);
    await makeRequest(testurl + "/");
  }
});

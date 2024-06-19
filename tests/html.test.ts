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
test("no xss when BasedHtml inside of html", async () => {
  const req = makeMockRequest();

  url.set([
    [
      "/",
      (mini) => {
        const basedHtmlString = html`<h2>
            this html string is resolved (it can't contain functions like
            mini.html HtmlStrings)
          </h2>
          ${"<script>alert(1)</script>"}`;
        return mini.html`<h1>  ${"<script>alert(1)</script>"}this HtmlString can contain functions,
                                         that get resolved at request time.</h1>${basedHtmlString}
        <h3>${(
          mini
        ) => mini.html` ${"<script>alert(1)</script>"}it gives you convenient access to the request object,
                                         anywhere in your code base:${
                                           mini.req.url
                                         }.
            no need to do "props drilling" anymore. just write a function like this:
             (mini: Mini)=> return some html and you are golden. ${"<script>alert(1)</script>"} `}`;
      },
    ],
  ]);
  const response = await url.match(req, "/");
  const responseText = await response?.text();
  expect(responseText).not.toInclude("<script>alert(1)</script>");
  expect(responseText).toInclude("&lt;script&gt;alert(1)&lt;/script&gt;");
});

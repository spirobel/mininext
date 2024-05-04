import type {
  HandlerReturnType,
  HtmlHandler,
  LazyHandlerReturnType,
  Mini,
} from "./url";
export type HtmlStringValues<T = undefined> =
  | HtmlString
  | HtmlString[]
  | string
  | number
  | HtmlHandler<T>
  | JsonString
  | LazyHandlerReturnType
  | undefined;
export type JsonStringValues<T = undefined> =
  | HtmlStringValues<T>
  | { [key: string]: any };
export class HtmlString extends Array {
  /**
   * a HtmlString is by default resolved.
   * if we we pass a function as a value to the html`` template string, it will be unresolved.
   */
  resolved = true;
  async resolve<T>(mini: Mini<T>) {
    if (this.resolved) return this;

    for (const [index, htmlPiece] of this.entries()) {
      if (typeof htmlPiece === "function") {
        let resolvedHtmlPiece = await htmlPiece(mini); //passing mini
        if (resolvedHtmlPiece instanceof HtmlString) {
          resolvedHtmlPiece = await resolvedHtmlPiece.resolve(mini);
        }
        // Replace the function with the resolved HTML piece in place
        this[index] = resolvedHtmlPiece;
      }
    }
    this.resolved = true;
    return this;
  }
  flat(depth: number = 1) {
    const flattened = super.flat(depth);
    const newHtmlString = new (this.constructor as any)(...flattened);
    newHtmlString.resolved = this.resolved;
    return newHtmlString as this;
  }
}

export function html<X = undefined>(
  strings: TemplateStringsArray,
  ...values: HtmlStringValues<X>[]
) {
  const htmlStringArray = new HtmlString();
  htmlStringArray.resolved = true;

  // Iterate over strings and values, alternating between them
  for (const [index, string] of strings.entries()) {
    htmlStringArray.push(string);

    if (index < values.length) {
      const value = values[index];

      // we can pass arrays of HtmlString and they will get flattened automatically
      if (
        Array.isArray(value) &&
        value.every((val) => val instanceof HtmlString)
      ) {
        // If the value is an array of HtmlString objects, add the whole array as a single value
        values[index] = value;
      } else if (typeof value === "function") {
        htmlStringArray.resolved = false;
        values[index] = value;
      } else if (value instanceof JsonString) {
        values[index] = html`<div style="color:red;">
          Please use dangerjson to include json in html. Untrusted input needs
          to pass through a html template function to get escaped. You can do
          html -> dangerjson -> html if you want!
        </div>`;
      } else if (!(value instanceof HtmlString)) {
        const notEmpty = value || "";
        // values will be escaped by default
        values[index] = Bun.escapeHTML(notEmpty + "");
      }
      htmlStringArray.push(values[index]);
    }
  }
  // Flatten the HtmlString array to ensure all nested arrays are properly included
  return htmlStringArray.flat();
}
export class JsonString extends HtmlString {}
export class DangerJsonInHtml extends HtmlString {}
//type JsonTemplateInput <X = undefined> = (strings: TemplateStringsArray, ...values: JsonStringValues<X>[])
function JsonTemplateProcessor(
  danger: true
): <X = undefined>(
  strings: TemplateStringsArray,
  ...values: JsonStringValues<X>[]
) => DangerJsonInHtml;
function JsonTemplateProcessor(
  danger?: false | undefined
): <X = undefined>(
  strings: TemplateStringsArray,
  ...values: JsonStringValues<X>[]
) => JsonString;

function JsonTemplateProcessor(danger: boolean = false) {
  const constructorr = danger
    ? () => new DangerJsonInHtml()
    : () => new JsonString();
  return function <X = undefined>(
    strings: TemplateStringsArray,
    ...values: JsonStringValues<X>[]
  ) {
    const jsonStringArray = constructorr();
    jsonStringArray.resolved = true;

    // Iterate over strings and values, alternating between them
    for (const [index, string] of strings.entries()) {
      jsonStringArray.push(string);

      if (index < values.length) {
        const value = values[index];

        // we can pass arrays of HtmlString and they will get flattened automatically
        if (
          Array.isArray(value) &&
          value.every((val) => val instanceof HtmlString)
        ) {
          // If the value is an array of HtmlString objects, add the whole array as a single value
          values[index] = value;
        } else if (typeof value === "function") {
          jsonStringArray.resolved = false;
          values[index] = value;
        } else if (!(value instanceof JsonString)) {
          const notEmpty = value || "";
          // values will be turned into a JSON string
          values[index] = JSON.stringify(notEmpty);
        }
        jsonStringArray.push(values[index]);
      }
    }
    // Flatten the HtmlString array to ensure all nested arrays are properly included
    return jsonStringArray.flat();
  };
}
export const json = JsonTemplateProcessor();
export const dangerjson = JsonTemplateProcessor(true);
export const commonHead = html` <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />
  <script>
    /* prevent form resubmission */
    if (window.history.replaceState) {
      window.history.replaceState(null, null, window.location.href);
    }
  </script>`;
export const cssReset = html` <style>
  /* CSS Reset */
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  /* Set the background color to black */
  html,
  body {
    background-color: #000;
    color: #fff; /* Set the default text color to white for better contrast */
  }
</style>`;
let default_head = html`
  <title>mini-next</title>
  ${commonHead} ${cssReset}
`;
/**
 * Set the default head for all pages. Can still be overwritten on a per page basis
 * @param defaultHead - HtmlString
 *
 * @example Here is what a default head might look like:
 *  ```ts
 *head(html` <title>hello hello</title> `);
 * url.set([
 * ["/", (mini) => mini.html`<h1>Hello world</h1>`],
 *  [
 *   "/bye",
 *   (mini) =>
 *     mini.html`<h1>Goodbye world</h1>${mini.head(
 *       mini.html` <title>bye bye</title>`
 *     )}`,
 *  ],
 * ]);
 *  ```
 */
export function head(defaultHead: HtmlString) {
  default_head = defaultHead;
}

export async function htmlResponder(
  mini: Mini,
  maybeUnresolved: HandlerReturnType,
  head: HtmlString = default_head,
  options: ResponseInit = {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  }
) {
  if (!(maybeUnresolved instanceof HtmlString)) {
    maybeUnresolved = html`${maybeUnresolved + ""}`;
  }
  if (maybeUnresolved instanceof DangerJsonInHtml) {
    maybeUnresolved = html`<div style="color:red;">
      Use json and not dangerjson. The purpose of dangerjson is to be explicit
      when you embed unescaped json elements in an html document.
    </div>`;
  }
  if (!(maybeUnresolved instanceof JsonString)) {
    const reloader = new HtmlString();
    reloader.push(global.Reloader || "");
    maybeUnresolved = html`<!DOCTYPE html>
      <html>
        <head>
          ${reloader} ${head}
        </head>
        <body>
          ${maybeUnresolved}
        </body>
      </html> `;
  } else {
    const headers = {
      ...options.headers,
      ...{ "Content-Type": "application/json; charset=utf-8" },
    };
    options.headers = headers;
  }
  const definitelyResolved = await maybeUnresolved.resolve(mini);
  const flattend = definitelyResolved.flat(Infinity);

  async function* stepGen() {
    let index = 0;
    while (index < flattend.length) {
      yield flattend[index++];
    }
  }
  function Stream(a: any) {
    return a as ReadableStream;
  }
  return new Response(Stream(stepGen), options);
}
/**
 * Generic html error type guard
 * @param submissionResult output of some function
 * @returns boolean - true if the given object has a property called "error" and its value is an instance of HtmlString
 */
export function isError(
  submissionResult:
    | any
    | {
        error: HtmlString;
      }
): submissionResult is { error: HtmlString } {
  return (
    "error" in submissionResult && submissionResult.error instanceof HtmlString
  );
}

declare global {
  var Reloader: HtmlString | undefined;
}

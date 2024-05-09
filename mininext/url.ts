import { htmlResponder, html, json, dangerjson, HtmlString } from "./html";
import type { DangerJsonInHtml, JsonString, JsonStringValues } from "./html";
export type Form = {
  post: boolean;
  urlencoded: boolean;
  multipart: boolean;
  formJson?: any;
  formData?: FormData;
  formName?: string;
  hiddenField?: HtmlString;
  actionlink<Y = undefined>(
    qs?: string[] | string,
    settings?: LinkSettings
  ): (mini: Mini<Y>) => string;
  onPostSubmit<F>(cb: () => F): F | undefined;
};

export type DataMaker<X, Z = undefined> =
  | ((mini: Mini<Z>) => DataMakerReturnType<X>)
  | (() => DataMakerReturnType<X>);
export type DataMakerReturnType<X> = X | Promise<X>;
export type HandlerReturnType =
  | JsonString
  | DangerJsonInHtml
  | HtmlString
  | string
  | void;
export type LazyHandlerReturnType =
  | HandlerReturnType
  | Promise<HandlerReturnType>;

export type NamedForm<Z> = {
  formResponse: LazyHandlerReturnType;
  formInfo?: Z;
};
export type NamedFormHandlerReturnType<X> =
  | HandlerReturnType
  | Promise<HandlerReturnType>
  | NamedForm<X>
  | Promise<NamedForm<X>>;

/**
 * Mini - the data object can be filled with url.data
 * @example
 * ``` js
 * const {html,json, css, data, req, form, link, svg, deliver, route, params, header, head } = mini  //pull everything out of the mini handbag
 * ```
 */
export class Mini<X = undefined> {
  html: typeof html<X>;
  css: typeof html<X>;
  json: typeof json<X>;
  dangerjson: typeof dangerjson<X>;

  data: X;
  req!: Request;
  head!: (head: HtmlHandler | HtmlString) => undefined;
  headers!: (headers: HeadersInit, overwrite?: boolean) => undefined;
  options!: (options: ResponseInit) => undefined;
  deliver!: typeof url.deliver;
  route!: string;
  params!: URLSearchParams;
  form!: Form;
  requrl!: Readonly<URL>;

  constructor(mini: Mini<undefined | any>, data: X) {
    Object.assign(this, mini);
    this.html = html<X>;
    this.css = html<X>;
    this.json = json<X>;
    this.dangerjson = dangerjson<X>;
    this.data = data;
    this.deliver = url.deliver;
    this.form.onPostSubmit = (cb) => {
      if (this.form.formName) {
        if (
          this.form.formData &&
          this.form.formData.get("formName") === this.form.formName
        ) {
          return cb();
        } else if (
          this.form.formJson &&
          this.form.formJson.formName === this.form.formName
        ) {
          return cb();
        }
      } else if (this.form.post) {
        return cb();
      }
    };
  }
}
/**
 * HtmlHandler
 * @param mini - the mini object
 * @returns - return a partially resolved html string with mini.html
 * @example
 * ``` js
 * const {html,json, css, data, req, form, link, svg, deliver, route, params, header, head } = mini  //pull everything out of the mini handbag
 * ```
 */
export type HtmlHandler<Y = undefined> =
  | ((mini: Mini<Y>) => LazyHandlerReturnType)
  | (() => LazyHandlerReturnType);
export type NamedFormHandler<Y = undefined, Z = undefined> =
  | ((mini: Mini<Y>) => NamedFormHandlerReturnType<Z>)
  | (() => NamedFormHandlerReturnType<Z>);

declare global {
  var FrontendScripts: Array<string>; // An array of the bundled scriptFiles corresponding to the frontend files, example frontends[0] = "index.tsx" -> FrontendScripts[0] = CONTENT OF frontend/index.js
  var FrontendScriptUrls: Array<string>;
  var bundledSVGs: Record<string, { svgContent: string; svgPath: string }>;
}
export type ScriptTag = (...params: any[]) => Promise<HtmlString>;
interface LinkSettings {
  [key: string]: string | null | undefined;
}
export class url {
  // direct mapping of "url string" -> function leads to Html Response
  static direct_handlers_html: ReadonlyMap<string, HtmlHandler>;

  // An array of the uncompiled frontend files, example frontends[0] = "index.tsx" -> frontend/index.tsx (from the project root)
  private static frontends: Array<string> = [];
  private static svgs: Map<string, ResponseInit> = new Map();

  static svg(
    path: string,
    options: ResponseInit = {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": "attachment",
      },
    }
  ) {
    url.svgs.set(path, options);
    var foundEntry = Object.entries(bundledSVGs).find(
      ([key, value]) => value.svgPath === path
    );

    return foundEntry && foundEntry[0];
  }
  static frontend(path: string, snippet?: HtmlHandler) {
    const frontendIndex = url.frontends.push(path) - 1;
    const scriptUrl = FrontendScriptUrls[frontendIndex];

    return html` ${snippet}
      <script type="module" src="${scriptUrl}"></script>`; // return an html script tag with the index hash
  }
  /**
   * This is used by the frontend bundler in order to find all frontends and their corresponding script files.
   */
  static getFrontends() {
    return url.frontends;
  }
  static getSvgPaths() {
    return [...url.svgs.keys()];
  }
  static serveFrontend(req: Request) {
    const reqPath = new URL(req.url).pathname;
    const index = FrontendScriptUrls.indexOf(reqPath);

    if (index !== -1) {
      return new Response(FrontendScripts[index], {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
        },
      });
    }
  }
  static serveSvg(req: Request) {
    const reqPath = new URL(req.url).pathname;
    const resolvedSvg = bundledSVGs[reqPath];
    if (resolvedSvg) {
      return new Response(
        resolvedSvg.svgContent,
        url.svgs.get(resolvedSvg.svgPath)
      );
    }
  }
  /**
   * tool to expose data to a frontend as a global variable.
   * @param name  this will be added as window.name to the window object in the frontend
   * @param value this will be parsed as json in the frontend and asigned as follows: window.name = JSON.parsed(value)
   * @returns the script tag to be embeded in the html response
   *
   * @example
   * ``` js
   * //backend
   * url.deliver("user", userData); // window.user = JSON.parse(userData)
   * //frontend
   * const user = window["user"];
   * ```
   * if you want to use types, declare them like so in your frontend code:
   * ``` ts
   * declare global {
   * var user: string;
   *}
   * ```
   */
  static deliver(name: string, value: JsonStringValues) {
    return html` <script type="application/json" id="${name}">
        ${dangerjson`${value}`}
      </script>

      <script>
        window["${name}"] = JSON.parse(
          document.getElementById("${name}").innerHTML
        );
      </script>`;
  }
  /**
   * @param dataHandler the function that prepares the data for the handlers
   * @example const {html,json, css, data, req, form, link, svg, deliver, route, params, header, head } = mini  //pull everything out of the mini handbag
   * @returns
   */
  static data<T, Z>(dataMaker: DataMaker<T, Z>) {
    return {
      /**
       * @param dataHandler the function that prepares the data for the handlers
       * @example const {html,json, css, data, req, form, link, svg, deliver, route, params, header, head } = mini  //pull everything out of the mini handbag
       * @returns
       */
      handler: (dataHandler: HtmlHandler<T>) => {
        return async (oldmini: Mini<Z>) => {
          const data = await dataMaker(oldmini);
          const mini = new Mini(oldmini, data);

          const unresolvedDataHandler = await dataHandler(mini); // passing mini
          if (unresolvedDataHandler instanceof HtmlString) {
            return await unresolvedDataHandler.resolve(mini);
          }
          return unresolvedDataHandler;
        };
      },
      dataMaker,
      /**
       * use this to **specify the input type for the functions**,
       *
       * that you want to use in the HtmlHandlers that follow this **data blend!**
       * @example type lol = typeof MaybeLoggedIn.$Mini
       */
      $Mini: {
        data: "DONT USE THIS DIRECTLY, ya goofball. This is just to infer the Mini type",
      } as Mini<T>,
      /**
       * use this to **specify the input type for the functions**,
       *
       * that you want to use in the Htmlhandlers that follow this **data blend!**
       * @example type haha = Mini<typeof MaybeLoggedIn.$Data>
       */
      $Data: {
        data: "DONT USE THIS DIRECTLY, ya goofball. This is just to infer the Mini type",
      } as T,
    };
  }
  /**
   * use this to define your routes.
   * @example
   * ``` js
   *    url.set([
   *      ["/", (mini) => mini.html`<h1>Hello world</h1>`],
   *      ["/apple", (mini) => mini.html`<h1>Hello apple</h1>`],
   *      ["/banana", (mini) => mini.html`<h1>Hello banana</h1>`],
   *    ]);
   * ```
   */
  static set<K extends string>(entries: [K, HtmlHandler][]) {
    url.direct_handlers_html = new Map(entries) as ReadonlyMap<K, HtmlHandler>;
  }
  /**
   * wrap your handlers in this if you mutate something to prevent CSRF issues.
   * @param handler - normal html handler with mini as the argument
   * @returns a wrapped html handler that will only be called when the request is post
   */
  static post(handler: HtmlHandler) {
    return (mini: Mini) => {
      if (mini.form.post) {
        return handler(mini);
      } else {
        return no_post_warning;
      }
    };
  }
  /**
   * wrap your handlers in this if you mutate something to prevent CSRF issues.
   * @param handler - normal html handler with mini as the argument
   * @returns a wrapped html handler that will only be called when the request is post and contains a json body
   */
  static postJson(handler: HtmlHandler) {
    return (mini: Mini) => {
      if (mini.form.formJson) {
        return handler(mini);
      } else {
        return no_post_warning;
      }
    };
  }
  /**
   * wrap your handlers in this if you mutate something to prevent CSRF issues.
   * @param handler - normal html handler with mini as the argument
   * @returns a wrapped html handler that will only be called when the request is post and contains a FormData body
   */
  static postFormData(handler: HtmlHandler) {
    return (mini: Mini) => {
      if (mini.form.formData) {
        return handler(mini);
      } else {
        return no_post_warning;
      }
    };
  }
  /**
   * This is useful to decouple forms from routes.
   * @param name name of the form - mini.form.onPostSubmit() will only be called if a (possibly hidden) field called formName matches this
   * @param handler just like a normal handler (aka you can return the form as a HtmlString), but you can optionally return additional data in formInfo
   * @returns - { formResponse: result of the handler, formInfo?: some info about the form. Totally up to you}
   */
  static namedForm<X = undefined, Z = undefined>(
    name: string,
    handler: NamedFormHandler<X, Z>
  ) {
    return async (mini: Mini<X>) => {
      mini.form.formName = name;
      mini.form.hiddenField = html`<input
        type="hidden"
        name="formName"
        value="${name}"
      />`;
      const namedFormResponse = await handler(mini);
      let handlerResult = {} as NamedForm<Z>;
      if (
        typeof namedFormResponse !== "string" &&
        namedFormResponse &&
        "formResponse" in namedFormResponse
      ) {
        handlerResult.formResponse = await namedFormResponse.formResponse;
        handlerResult.formInfo = namedFormResponse.formInfo;
      } else {
        handlerResult.formResponse = namedFormResponse;
      }
      delete mini.form.formName;
      delete mini.form.hiddenField;
      return handlerResult;
    };
  }

  /**
   * pass in all the query string parameter names that you want to preserve in the link
   * @param Url - the url that you want to link to (example: "/login")
   * @param qs - the query string parameters that you want to preserve in the link
   * @param settings - key and string values that you want to set in the link
   * @returns - the link that you can use in your html template
   */
  static link<X>(
    Url: string,
    qs: string[] | string = "",
    settings?: LinkSettings
  ) {
    return (mini: Mini<X>) => {
      return url.currylink(Url, qs, mini.req, settings);
    };
  }
  static currylink(
    Url: string,
    qs: string[] | string,
    req: Request,
    settings?: LinkSettings
  ) {
    if (!Array.isArray(qs)) {
      qs = [qs];
    }
    // Create a new URL object from the current location
    // https://github.com/whatwg/url/issues/531#issuecomment-1337050285
    const GOOFY_HACK = "http://goofyhack.com";
    const updatedUrl = new URL(url.get(Url), GOOFY_HACK);
    for (const q of qs) {
      // Use URLSearchParams to set the name query parameter
      const reqParam = new URL(req.url).searchParams.get(q);
      if (reqParam) {
        updatedUrl.searchParams.set(q, reqParam);
      }
    }
    for (const key in settings) {
      const value = settings[key];
      if (value !== undefined && value !== null) {
        updatedUrl.searchParams.set(key, value);
      }
    }
    // Return the updated URL as a string
    return updatedUrl.toString().slice(GOOFY_HACK.length);
  }
  /**
   * This method retrieves a url from the urls array. If the url does not exist in the urls array, an error will be thrown.
   * @param {string} Url - The url to retrieve.
   * @return {string} - The retrieved url.
   * @throws Will throw an Error if the provided url is not found in the urls array.
   */
  static get(Url: string): string {
    const foundUrl = url.direct_handlers_html.get(Url);
    if (!foundUrl) {
      throw new Error(`URL "${html`${Url}`}" was not set.`);
    }
    return Url;
  }
  static async match(req: Request, reqPath?: string) {
    const miniurl: Readonly<URL> = Object.freeze(new URL(req.url));
    if (typeof reqPath === "undefined") {
      reqPath = miniurl.pathname;
    }
    const handler = url.direct_handlers_html.get(reqPath);
    if (handler) {
      //this is the source of mini
      let handlerHead: HtmlHandler | HtmlString | undefined = undefined;
      let handlerOptions: ResponseInit = {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      };
      const post = req.method === "POST";
      let formJson: any;
      let formData: FormData | undefined;
      const urlencoded = (req.headers.get("Content-Type") + "").includes(
        "application/x-www-form-urlencoded"
      );
      const multipart = (req.headers.get("Content-Type") + "").includes(
        "multipart/form-data"
      );
      if (post && !urlencoded && !multipart) {
        const length = Number(req.headers.get("content-length"));
        const bodyNotEmpty = length > 0;
        if (bodyNotEmpty) {
          formJson = await req.json();
        } else {
          formJson = {};
        }
      }
      if (post && (urlencoded || multipart)) {
        formData = await req.formData();
      }

      const mini = new Mini(
        {
          requrl: miniurl,
          data: undefined,
          req,
          html,
          css: html,
          deliver: url.deliver,
          route: reqPath,
          params: new URL(req.url).searchParams,
          json,
          form: {
            post,
            urlencoded,
            multipart,
            formJson,
            formData,
            onPostSubmit(cb) {
              if (post) {
                return cb();
              }
            },
            actionlink: (qs = "", settings) => url.link(reqPath, qs, settings),
          },
          dangerjson,
          head: (head) => {
            handlerHead = head;
          },
          headers: (headers, overwrite = false) => {
            if (overwrite) {
              handlerOptions.headers = headers;
            } else {
              handlerOptions.headers = {
                ...handlerOptions.headers,
                ...headers,
              };
            }
          },
          options: (options) => {
            handlerOptions = options;
          },
        },
        undefined
      );
      const unresolved = await handler(mini); //passing mini
      return htmlResponder(mini, unresolved, handlerHead, handlerOptions);
    }
  }

  /**
   * Fetch handler that is called by the server when a request is made to any of the urls.
   * @param {Request} req - The Request object.
   * @return {Promise<Response>} - The Response object.
   */
  static async install(req: Request) {
    //go through all the Htmlhandlers and see if there is a match
    let res = await url.match(req);
    if (res) return res;

    //handle frontend js file serving
    res = url.serveFrontend(req);
    if (res) return res;
    //handle svg file serving
    res = url.serveSvg(req);
    if (res) return res;
    // go through all the Htmlhandlers again with added slash at the end.
    res = await url.match(req, new URL(req.url).pathname + "/");
    if (res) return res;

    return new Response("No matching url found", { status: 404 });
  }
}

const no_post_warning = html`<div style="color:red;">
  This method is only accessible through the POST method. Remember to make all
  mutations (insert / update data in the database) only accessible via POST and
  implement your session cookies like this:
  <div
    style="color:#0FFF50; width:800px; overflow:wrap; margin-left:30px; margin-top:20px; margin-bottom:20px;"
  >
    "Set-Cookie": sessionId=="some random string made with crypto.randomUUID()"
    expires=Thu, 01 Jan 1970 00:00:00 GMT Secure; HttpOnly; SameSite=Strict;
    path=/,
  </div>
  This is necessary to prevent CSRF issues.
</div>`;

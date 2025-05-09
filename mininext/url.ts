import type { Server, WebSocketHandler, RouterTypes, BunRequest } from "bun";
import { htmlResponder, html, json, dangerjson, HtmlString } from "./html";
import {
  BasedHtml,
  type DangerJsonInHtml,
  type JsonString,
  type JsonStringValues,
} from "./html";
export type HTTPMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "HEAD"
  | "OPTIONS";

export type MiniNextRouteHandlerObject<T extends string> = {
  [K in HTTPMethod]?: HtmlHandler<unknown, T>;
};
export type MiniNextRouteValue<T extends string> =
  | HtmlHandler<unknown, T>
  | MiniNextRouteHandlerObject<T>;
export type BunRoutes<
  R extends { [K in keyof R]: RouterTypes.RouteValue<Extract<K, string>> }
> = R;
export type MiniNextRoutes = Record<string, MiniNextRouteValue<"">>;

/**
 * A helper function that helps narrow unknown objects
 * @param object - the object of type unknown that is to be narrowed
 * @param key - the key that may or may not exist in object
 * @returns true if the key is present and false if not
 * @example
 * ``` js
 * has(this.form.formJson, "formName") &&
 * this.form.formJson.formName === this.form.formName
 * ```
 * https://stackoverflow.com/questions/70028907/narrowing-an-object-of-type-unknown
 */
export function has<T, K extends string>(
  object: T,
  key: K
): object is T & object & Record<K, unknown> {
  return typeof object === "object" && object !== null && key in object;
}
export type Form = {
  post: boolean;
  urlencoded: boolean;
  multipart: boolean;
  formJson?: unknown;
  formData?: FormData;
  formName?: string;
  hiddenField?: HtmlString;
  actionlink<Y = unknown>(
    qs?: string[] | string,
    settings?: LinkSettings
  ): (mini: Mini<Y>) => string;
  onPostSubmit<F>(cb: () => F): F | undefined;
};
export type DataMaker<X, Z = unknown> =
  | ((mini: Mini, rerun?: Z) => DataMakerReturnType<X>)
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
export class Mini<X = unknown, ROUTE extends string = ""> {
  html: typeof html<X>;
  css: typeof html<X>;
  json: typeof json<X>;
  dangerjson: typeof dangerjson<X>;

  data: X;
  req!: BunRequest<ROUTE>;
  head!: (head: HtmlHandler | HtmlString) => undefined;
  headers!: (headers: HeadersInit, overwrite?: boolean) => undefined;
  options!: (options: ResponseInit) => undefined;
  deliver!: typeof url.deliver;
  route!: string;
  params!: URLSearchParams;
  form!: Form;
  requrl!: Readonly<URL>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/redirect_static) */
  redirect!: (url: string | URL, status?: number) => void;

  constructor(mini: Mini<unknown>, data: X) {
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
          has(this.form.formJson, "formName") &&
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
export type HtmlHandler<Y = unknown, ROUTE extends string = ""> =
  | ((mini: Mini<Y, ROUTE>) => LazyHandlerReturnType)
  | (() => LazyHandlerReturnType);
export type NamedFormHandler<Y = unknown, Z = undefined> =
  | ((mini: Mini<Y>) => NamedFormHandlerReturnType<Z>)
  | (() => NamedFormHandlerReturnType<Z>);

declare global {
  var bundledFrontends: Record<
    string,
    { frontendFilePath: string; frontendContent: string; position: number }
  >;
  var bundledSVGs: Record<
    string,
    {
      svgContent: string;
      svgFilePath: string;
      options: ResponseInit;
      position: number;
    }
  >;
}
export type ScriptTag = (...params: any[]) => Promise<HtmlString>;
interface LinkSettings {
  [key: string]: string | null | undefined;
}
export class url {
  static websocket: WebSocketHandler | undefined = undefined;
  static server: Server;
  static routes: MiniNextRoutes = {};

  // direct mapping of "url string" -> function leads to Html Response
  static direct_handlers_html: Map<string, HtmlHandler> = new Map();

  // An array of the uncompiled frontend files, example frontends[0] = "index.tsx" -> frontend/index.tsx (from the project root)
  private static frontends: Array<{
    frontendFilePath: string;
    callerPath: string;
    position: number;
  }> = [];
  private static svgs: Array<{
    svgFilePath: string;
    callerPath: string;
    position: number;
    options: ResponseInit;
  }> = [];
  /**
   * This function takes care of bundling your svg (icons?) into the webapp
   * they will have a hash in the name to break the cache when needed
   * @param svgFilePath first place to look: svgs folder in the same path the calling file, after that path from project root.
   * @param options ResponseInit, default headers for an svg
   * @returns url to the svg
   */
  static svg(
    svgFilePath: string,
    options: ResponseInit = {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": "attachment",
      },
    }
  ) {
    const stack = new Error().stack?.split("\n");
    let callerPath = "";
    if (stack) {
      callerPath = stack[2].slice(
        stack[2].lastIndexOf("(") + 1,
        stack[2].lastIndexOf(".") + 3
      );
      callerPath = callerPath.slice(callerPath.search("at") + 2).trim();
    }
    const position = url.svgs.length;
    //we register the svg for bundleing.
    url.svgs.push({
      svgFilePath,
      callerPath,
      options,
      position: url.svgs.length,
    });
    //this will be filled in by the bundling step.
    var foundSvg = Object.entries(bundledSVGs).find(
      ([key, value]) => value.position === position
    );
    return foundSvg && foundSvg[0];
  }
  /**
   * this function helps you build frontends with any kind of framework (no framework at all) and get the bundle
   * @param path first place to look: frontend folder in the same path the calling file, after that /frontend path from project root.
   * @param snippet this is handy to pass in a piece of html that often goes along with a certain frontend
   * @returns a html script element with the bundled frontend as the src
   */
  static frontend<X>(frontendFilePath: string, snippet?: BasedHtml): HtmlString;
  static frontend<X>(
    frontendFilePath: string,
    snippet?: HtmlHandler<X>
  ): (mini: Mini<X>) => HtmlString;
  static frontend<X>(
    frontendFilePath: string,
    snippet?: HtmlHandler<X> | BasedHtml
  ) {
    const stack = new Error().stack?.split("\n");
    let callerPath = "";
    if (stack) {
      callerPath = stack[2].slice(
        stack[2].lastIndexOf("(") + 1,
        stack[2].lastIndexOf(".") + 3
      );
      callerPath = callerPath.slice(callerPath.search("at") + 2).trim();
    }
    const position = url.frontends.length;

    //we register the frontend for bundleing.
    url.frontends.push({ frontendFilePath, callerPath, position });
    //this will be filled in by the bundling step.
    const bundledFrontend = Object.entries(bundledFrontends).find(
      ([key, value]) => value.position === position
    );
    if (!bundledFrontend) return;
    const scriptUrl = bundledFrontend[0];
    if (snippet instanceof BasedHtml || !snippet) {
      return html` ${snippet}
        <script type="module" src="${scriptUrl}"></script>`; // return an html script tag with the index hash
    }
    return (mini: Mini<X>) => {
      return mini.html`${snippet}
        <script type="module" src="${scriptUrl}"></script>`;
    };
  }
  /**
   * This is used by the frontend bundler in order to find all frontends and their corresponding script files.
   */
  static getFrontends() {
    return url.frontends;
  }
  static getSvgs() {
    return url.svgs;
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
        return async (oldmini: Mini) => {
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
   *   //define all routes at once
   *    url.set([
   *      ["/", (mini) => mini.html`<h1>Hello world</h1>`],
   *      ["/apple", (mini) => mini.html`<h1>Hello apple</h1>`],
   *      ["/banana", (mini) => mini.html`<h1>Hello banana</h1>`],
   *    ]);
   *    //define or overwrite just one route
   *  url.set("/apple", (mini)=>mini.html`<h1> Hello pineapple </h1>`)
   * ```
   */
  static set<K extends string>(entries: [K, HtmlHandler][]): void;
  static set<
    R extends {
      [X in keyof R]: MiniNextRouteValue<Extract<X, string>>;
    }
  >({ routes }: { routes: R }): void;
  static set(urlPath: string, handler: HtmlHandler): void;
  static set<
    K extends string,
    R extends {
      [X in keyof R]: MiniNextRouteValue<Extract<X, string>>;
    }
  >(
    entries: [K, HtmlHandler][] | string | { routes: R },
    handler?: HtmlHandler
  ) {
    function addUrl(entryUrl: string, entryHandler: HtmlHandler) {
      for (const u of url.generateVariations(entryUrl)) {
        url.direct_handlers_html.set(u, entryHandler);
      }
    }

    if (typeof entries === "string" && handler) {
      addUrl(entries, handler);
    }
    if (typeof entries !== "string" && "routes" in entries) {
      url.routes = entries.routes as MiniNextRoutes;
    }
    if (typeof entries !== "string" && !("routes" in entries))
      for (const [entryUrl, entryHandler] of entries) {
        addUrl(entryUrl, entryHandler);
      }
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
  static namedForm<X = unknown, Z = undefined>(
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
    const updatedUrl = new URL(Url, GOOFY_HACK);
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
   * users expect links to work with or without a trailing slash.
   * Developers expect that that links work with or without a preceding slash.
   * We make sure that these expectations are met when using url.set and url.get.
   * (by adding all the variations to the url.direct_handlers Map)
   * @param {string} inputString - the url
   * @returns {string[]} - returns array of variations (added slash in the beginning, added, removed slash at the end)
   */
  static generateVariations(inputString: string) {
    const variations = [];

    // Special case for the index route
    if (inputString === "/") {
      variations.push("/");
      return variations;
    }

    // Check if the string starts with a slash and add/remove variations accordingly
    if (inputString.startsWith("/")) {
      variations.push(inputString); // With leading slash
    } else {
      inputString = "/" + inputString;
      variations.push(inputString); // With leading slash
    }

    // Check if the string ends with a slash and add/remove variations accordingly
    if (inputString.endsWith("/")) {
      variations.push(inputString.slice(0, -1)); // Without trailing slash
    } else {
      variations.push(inputString + "/"); // With trailing slash
    }

    return variations;
  }

  static async handleWithMini(
    req: BunRequest<string>,
    server: Server,
    handler: HtmlHandler
  ) {
    if (!url.server) url.server = server;
    const miniurl: Readonly<URL> = Object.freeze(new URL(req.url));
    const reqPath = miniurl.pathname;
    let redirectTarget: string | URL | null = null;
    let redirectStatus: number | undefined = undefined;
    let handlerHead: HtmlHandler | HtmlString | undefined = undefined;
    let handlerOptions: ResponseInit = {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    };
    const post = req.method === "POST";
    let formJson: unknown;
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

    //this is the source of mini
    const mini = new Mini(
      {
        requrl: miniurl,
        data: undefined,
        req: req as BunRequest<"">,
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
        redirect: (url: string | URL, status?: number) => {
          redirectTarget = url;
          redirectStatus = status;
        },
      },
      undefined
    );
    const unresolved = await handler(mini); //passing mini
    if (redirectTarget) {
      return Response.redirect(redirectTarget, redirectStatus);
    }
    return htmlResponder(mini, unresolved, handlerHead, handlerOptions);
  }
  /**
   * use this to set the Websocket object. Check out [the bun docs](https://bun.sh/docs/api/websockets) for more details.
   * @param wsObject the websocketsocket object {@link WebSocketHandler}
   */
  static setWebsocket<T = undefined>(wsObject: WebSocketHandler<T>) {
    url.websocket = wsObject as WebSocketHandler;
  }
  /**
   * Send a message to all connected {@link ServerWebSocket} subscribed to a topic
   * @param topic The topic to publish to
   * @param message The data to send
   * @returns 0 if the message was dropped, -1 if backpressure was applied, or the number of bytes sent.
   */
  static publishHtml(topic: string, message: BasedHtml) {
    return url.server.publish(topic, message as string);
  }
  /**
   * Fetch handler that is called by the server when a request is made to any of the urls.
   * @param {Request} req - The Request object.
   * @return {Promise<Response>} - The Response object.
   */
  static install() {
    const transformedRouteObject: Record<
      string,
      RouterTypes.RouteValue<string>
    > = {};

    for (const route in url.routes) {
      //handle route object split by methods and pull them through mininext
      const handler = url.routes[route];
      if (typeof handler === "function") {
        transformedRouteObject[route] = (req: BunRequest, server: Server) =>
          url.handleWithMini(req, server, handler);
      } else {
        const newHandlerObject: RouterTypes.RouteHandlerObject<string> = {};
        for (const HTTPmethod in handler) {
          newHandlerObject[HTTPmethod as HTTPMethod] = (
            req: BunRequest,
            server: Server
          ) =>
            url.handleWithMini(req, server, handler[HTTPmethod as HTTPMethod]!);
        }
        transformedRouteObject[route] = newHandlerObject;
      }
    }
    for (const [route, handler] of url.direct_handlers_html) {
      transformedRouteObject[route] = (req: BunRequest, server: Server) =>
        url.handleWithMini(req, server, handler);
    }
    for (const svgUrl in bundledSVGs) {
      const resolvedSvg = bundledSVGs[svgUrl];
      transformedRouteObject[svgUrl] = (req: BunRequest, server: Server) =>
        new Response(resolvedSvg.svgContent, resolvedSvg.options);
    }

    for (const frontendUrl in bundledFrontends) {
      const resolvedFrontend = bundledFrontends[frontendUrl];
      transformedRouteObject[frontendUrl] = (req: BunRequest, server: Server) =>
        new Response(resolvedFrontend.frontendContent, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
          },
        });
    }
    function fetchFunction(req: Request, server: Server) {
      return new Response("No matching url found", { status: 404 });
    }
    return {
      fetch: fetchFunction,
      websocket: url.websocket,
      routes: transformedRouteObject,
    };
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

# Hydration

## The argument for server side rendering (SSR)

Server side rendering is used to give information to search engine and social media preview bots that don't run a headless browser to execute the javascript. It is only useful for SEO.

For pages that are not public information meant to be crawled, SSR offers no advantage.

And even for public pages: most crawl [bots execute the javascript](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) by now, so SSR has no purpose in the vast majority of cases. Where it might still help, it is **not worth the added complexity and risk it introduces**. If you are not targeting the dwindling number of **crawl bots that don't use a headless browser, you don't need SSR**.

## The argument for hydration

Naive client side rendering (CSR) can take longer than SSR on the first request, but **on every request after that, CSR is faster than SSR.**

Why is the first request slower? In the naive version, **the client first parses the javascript, and while that script runs it makes a fetch request to the server for the data** it needs to render the page.

Getting the data to the client is a separate problem, but it keeps getting mixed into the CSR vs SSR debate. If client side rendering is not done in this naive way, it is faster than server side rendering on the first request too.

The expensive part of getting something on screen is waiting hundreds of milliseconds for the data to arrive. **Doing client side rendering naively means double the wait time,** because the initial request and the data fetch happen one after the other.

So there is a case for hydration, if it is defined in this clear, narrow way: **"embed the data that is needed on the client in the initial html response"**.

Let's contrast this definition with the vague and sprawling way web frameworks use the word today.

## How React messes up hydration

There is a clear benefit to hydration. If the data is on the same server, the time to render on the client is cut in half compared to naive client side rendering. **It is simple and effective to hand over the data with the first request**.

In modern React this idea is disappearing. The React team has accepted the false premise that server side rendering is worthwhile. Even worse, with React Server Components they split the rendering itself between client and server, and the server sends a serialized component tree over its own wire format.

![rsc hydration](https://www.plasmic.app/blog/static/images/react-server-components-placeholders.png)

That wire format is where a remote code execution vulnerability came from (CVE-2025-55182). It was followed by more CVEs that lead to denial of service and to exposure of source code and secrets.

The company with the most influence on the direction of React makes money selling a concept called **"serverless"**, which often ends in an architecture where the database is separated from the code that produces the html. That means a network call from the server that renders the page to the server that holds the data.

This **adds hundreds of milliseconds to the time it takes to render the page**. The overcomplex architecture of "modern" React and Next.js creates lock-in to Vercel's "serverless" racket.

There is no practical benefit to this approach. It makes systems less secure, and it lets the vendor charge absurdly high fees for no value in return.

Reading material:

[React Server Components remote code execution breakdown](https://securitylabs.datadoghq.com/articles/cve-2025-55182-react2shell-remote-code-execution-react-server-components/)

[CVE hn thread](https://news.ycombinator.com/item?id=46136026)

[Infographic and a detailed CSR vs SSR benchmark](https://www.plasmic.app/blog/how-react-server-components-work)

## Taking the good while leaving the bad

The good part is the narrow definition from above: the data the page needs travels with the first response, so the browser renders right away and never waits for a second round trip.

The bad part is what got piled on top of it: the component tree is serialized on the server and revived in the browser, rendering is split between two machines, and when the html from the server doesn't match what the client renders you get hydration errors, where the framework has to throw away work or fail ([TanStack Start has a whole guide on them](https://tanstack.com/start/latest/docs/framework/react/guide/hydration-errors)). Whether Server Components even make pages faster depends a lot on the case, and [this measurement](https://www.developerway.com/posts/react-server-components-performance) is worth reading before you assume they do.

In mininext, hydration is only the data. The server builds an html skeleton once and fills a `${null}` placeholder per request:

```typescript
// index.ts
const skeleton = await html`<!doctype html>
  <html>
    <body data-hydrate="${null}">
      <div id="root"></div>
      <script type="module" src="./frontend.ts"></script>
    </body>
  </html>`.build();

async function page(req: Request) {
  const data = await loadOrders(req); // all async work happens here
  const encoded = Buffer.from(JSON.stringify(data)).toString("base64");
  return new Response(skeleton.fill(encoded));
}
```

```typescript
// frontend.ts
const bytes = Uint8Array.from(atob(document.body.dataset.hydrate!), (c) => c.charCodeAt(0));
const data = JSON.parse(new TextDecoder().decode(bytes));
renderRoot({ container: document.getElementById("root")!, component: (mini) => app(mini, data) });
```

The base64 step is there on purpose. `JSON.stringify()` output put straight into html can break out of the tag or the attribute it sits in, and that is exactly what happened in [this Svelte SSR CVE](https://www.sentinelone.com/vulnerability-database/cve-2026-27902/). Base64 only has letters, digits, `+`, `/` and `=`, so it can't close anything. (Plain `btoa()` only takes Latin-1 text and throws on most other characters, which is why the server encodes the UTF-8 bytes.)

There are no hydration errors, because there is nothing to match: the server doesn't render the app, it hands over data, and the frontend renders from that data. And there is no component wire format that an attacker could feed a crafted payload.

## Building for an audience that cares about privacy and financial self defense

mininext came out of building payment and wallet software for Monero users. People who care about privacy and about keeping control of their money are right to ask what runs between them and the server, and how much of it anyone has actually read.

A good example of how distributed architectures create new attack surface is [this research on Astro's middleware](https://zhero-web-sec.github.io/research-and-things/astro-framework-and-standards-weaponization). Astro passes `locals` from the middleware to the renderer through request headers, because in serverless deployments the middleware and the renderer may not share a process, and http headers are the one interface every adapter (Vercel, Netlify, ...) supports. A context object would need shared runtime state, which isolated serverless invocations don't have. But headers are something every client can send too, and the research shows how this kind of internal channel can be turned against the application.

mininext doesn't have that problem, because it doesn't split the work across machines. The request context travels in memory, inside one Bun process: the route handler puts it on `mini` with `mini.state("req", req)`, and any component reads it from there. No internal state ever has to pass through headers, and the whole library is small enough to read before you trust it with payments.

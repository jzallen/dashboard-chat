// SPA server entry (Phase 0 — foamy-knitting-hennessy).
//
// DEVIATION FROM PLAN: the plan said not to add @react-router/node and not to add
// an entry.server. But @react-router/dev resolved to 7.17.0 (caret `^7.13.0`), and
// 7.17.0's vite plugin ALWAYS resolves a server entry — even in ssr:false SPA mode —
// throwing "Could not determine server runtime" unless @react-router/node is
// installed OR a custom entry.server is provided. We honor the plan's "no
// @react-router/node" intent by supplying this node-free entry instead.
//
// It must stream: RRv7's <ServerRouter> wraps the SPA shell in a <Suspense>
// boundary (the HydrateFallback), and renderToString cannot render Suspense — it
// emits a broken hydration payload and the client router never hydrates. So we use
// react-dom/server's renderToPipeableStream (Node streams, no @react-router/node)
// and bridge the Node stream to a web Response via node:stream/web. In ssr:false
// mode this renders only the static shell; RRv7 hydrates the real tree client-side.
import { PassThrough } from "node:stream";
import { ReadableStream } from "node:stream/web";

import reactDomServer from "react-dom/server";
import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = reactDomServer.renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        // SPA / static generation: wait for all content (incl. Suspense) before
        // responding, so the hydration payload is complete.
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough();
          responseHeaders.set("Content-Type", "text/html");
          // Bridge the Node PassThrough to a web ReadableStream the Response
          // constructor accepts (no @react-router/node helper needed).
          const stream = ReadableStream.from(body) as unknown as BodyInit;
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) console.error(error);
        },
      },
    );
    setTimeout(() => abort(), 10_000);
  });
}

// SPA server entry. A server entry is required even in ssr:false mode; this one is
// deliberately node-free.
//
// It must STREAM: <ServerRouter> wraps the SPA shell in a Suspense boundary (the
// HydrateFallback), and renderToString cannot render Suspense — it emits a broken
// hydration payload and the client router never hydrates. So it renders via
// renderToPipeableStream and bridges the Node stream to a web Response. In ssr:false
// mode this emits only the static shell; the real tree hydrates client-side.
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

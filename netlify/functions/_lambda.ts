/**
 * Adapts a Web-standard (Request -> Response) handler to the Lambda-style contract.
 *
 * Netlify runs two function formats. Its own build pipeline understands v2 - `export default`
 * taking a Request - but a pre-bundled zip uploaded through the deploy API is loaded by the
 * older runtime, which looks for `export const handler` and fails with HandlerNotFound otherwise.
 * Rather than write the endpoints twice, they stay in the modern format and this converts.
 *
 * Underscore prefix keeps the bundler from treating this shared module as its own endpoint.
 */

interface LambdaEvent {
  rawUrl?: string;
  path?: string;
  httpMethod?: string;
  headers?: Record<string, string>;
  body?: string | null;
  isBase64Encoded?: boolean;
  queryStringParameters?: Record<string, string> | null;
}

interface LambdaResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

type WebHandler = (req: Request, context: { ip: string }) => Promise<Response>;

export function toLambda(fn: WebHandler) {
  return async (event: LambdaEvent): Promise<LambdaResult> => {
    const headers = event.headers ?? {};

    // rawUrl is the complete original URL including query. Falling back to path alone would
    // silently drop ?symbol=, so rebuild the query from the parsed params in that case.
    let url = event.rawUrl;
    if (!url) {
      const qs = new URLSearchParams(event.queryStringParameters ?? {}).toString();
      url = `https://${headers.host ?? "localhost"}${event.path ?? "/"}${qs ? `?${qs}` : ""}`;
    }

    const method = event.httpMethod ?? "GET";
    const hasBody = method !== "GET" && method !== "HEAD" && event.body != null;

    const req = new Request(url, {
      method,
      headers,
      body: hasBody
        ? event.isBase64Encoded
          ? Buffer.from(event.body!, "base64")
          : event.body!
        : undefined,
    });

    const res = await fn(req, {
      ip: headers["x-nf-client-connection-ip"] ?? headers["client-ip"] ?? "unknown",
    });

    return {
      statusCode: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: await res.text(),
    };
  };
}

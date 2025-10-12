export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const SPA_FALLBACK_PATH = "/404.html";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    let response = await env.ASSETS.fetch(request);

    if (
      response.status === 404 &&
      request.method === "GET" &&
      !url.pathname.includes(".")
    ) {
      const fallbackUrl = new URL(SPA_FALLBACK_PATH, url.origin);
      const fallbackRequest = new Request(fallbackUrl.toString(), request);
      response = await env.ASSETS.fetch(fallbackRequest);
    }

    return applySecurityHeaders(response);
  },
};

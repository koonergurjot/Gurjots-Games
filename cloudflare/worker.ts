export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const SPA_FALLBACK_PATH = "/404.html";

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

    return response;
  },
};

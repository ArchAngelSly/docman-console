/**
 * Cloudflare Worker — serves the ISO DOC CONTROL static console AND handles
 * the /api/ai-proxy route for ChatGPT (OpenAI) / Microsoft Copilot (Azure
 * OpenAI Service).
 *
 * This replaces the earlier functions/api/ai-proxy.js approach, which only
 * works on classic Cloudflare Pages projects. This deployment is a Worker
 * (created via the Cloudflare "Connect GitHub" flow with `wrangler deploy`),
 * and Workers use a single entry script + an "assets" binding instead of the
 * Pages-only file-based functions/ routing convention.
 *
 * Required environment variables (Cloudflare dashboard -> Settings ->
 * Variables and Secrets, as "Secret" type, then redeploy):
 *
 *   For ChatGPT (provider: "openai"):
 *     OPENAI_API_KEY        (required)
 *     OPENAI_MODEL          (optional, defaults to "gpt-4o")
 *
 *   For Microsoft Copilot / Azure OpenAI (provider: "copilot"):
 *     AZURE_OPENAI_ENDPOINT     (required, e.g. https://yourresource.openai.azure.com)
 *     AZURE_OPENAI_DEPLOYMENT   (required, your model deployment name)
 *     AZURE_OPENAI_KEY          (required)
 *     AZURE_OPENAI_API_VERSION  (optional, defaults to "2024-06-01")
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS)
  });
}

async function handleAIProxy(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Invalid JSON request body." }, 400);
  }

  const { provider, prompt, maxTokens } = body || {};
  if (!prompt || typeof prompt !== "string") {
    return json({ error: "Missing 'prompt' in request body." }, 400);
  }
  const tokens = Number.isFinite(maxTokens) ? maxTokens : 1800;

  try {
    if (provider === "openai") {
      if (!env.OPENAI_API_KEY) {
        return json({ error: "OPENAI_API_KEY is not set as an environment variable on this Worker." }, 500);
      }
      const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-4o",
          max_tokens: tokens,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        const msg = (data && data.error && data.error.message) || `OpenAI returned HTTP ${upstream.status}`;
        return json({ error: msg }, upstream.status);
      }
      const text = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
      return json({ text: text || "" });
    }

    if (provider === "copilot") {
      const endpoint = env.AZURE_OPENAI_ENDPOINT;
      const deployment = env.AZURE_OPENAI_DEPLOYMENT;
      const apiKey = env.AZURE_OPENAI_KEY;
      const apiVersion = env.AZURE_OPENAI_API_VERSION || "2024-06-01";
      if (!endpoint || !deployment || !apiKey) {
        return json({ error: "AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT and AZURE_OPENAI_KEY must all be set as environment variables on this Worker." }, 500);
      }
      const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey
        },
        body: JSON.stringify({
          max_tokens: tokens,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        const msg = (data && data.error && data.error.message) || `Azure OpenAI returned HTTP ${upstream.status}`;
        return json({ error: msg }, upstream.status);
      }
      const text = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
      return json({ text: text || "" });
    }

    return json({ error: `Unknown provider "${provider}". Expected "openai" or "copilot".` }, 400);
  } catch (err) {
    return json({ error: err.message || String(err) }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ai-proxy") {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: CORS_HEADERS });
      }
      if (request.method === "POST") {
        return handleAIProxy(request, env);
      }
      return json({ error: "Method not allowed." }, 405);
    }

    // Everything else: serve the static console files (index.html, etc.)
    return env.ASSETS.fetch(request);
  }
};

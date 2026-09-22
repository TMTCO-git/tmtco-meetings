/**
 * Backend for the Teams-clone frontend.
 *
 * Talks to Cloudflare's RealtimeKit REST API (api.cloudflare.com) using a
 * server-side API token, so the token never reaches the browser. The
 * frontend only ever receives short-lived per-participant authTokens.
 *
 * Routes:
 *   POST /api/meetings              -> { meetingId }
 *   POST /api/meetings/:id/join     -> { authToken, meetingId }
 *   GET  /api/presets               -> { presets: [...] }  (debug helper)
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

function withCors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

function json(data, status = 200) {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function assertConfigured(env) {
  const missing = ["CF_ACCOUNT_ID", "CF_API_TOKEN", "RTK_APP_ID"].filter(
    (key) => !env[key]
  );
  if (missing.length) {
    throw new ConfigError(
      `Server is missing configuration: ${missing.join(
        ", "
      )}. See README.md for how to set these with 'wrangler secret put'.`
    );
  }
}

class ConfigError extends Error {}

async function rtkFetch(env, path, options = {}) {
  const url = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/realtime/kit${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.success === false) {
    const message =
      data?.errors?.[0]?.message ||
      data?.error ||
      `RealtimeKit API error (HTTP ${res.status})`;
    throw new Error(message);
  }

  return data;
}

async function createMeeting(env, title) {
  const data = await rtkFetch(env, `/${env.RTK_APP_ID}/meetings`, {
    method: "POST",
    body: JSON.stringify({
      title: title || "Meet now",
      record_on_start: false,
    }),
  });
  return data.data.id;
}

async function addParticipant(env, meetingId, name, isHost) {
  const presetName = isHost ? env.RTK_HOST_PRESET : env.RTK_GUEST_PRESET;

  const data = await rtkFetch(
    env,
    `/${env.RTK_APP_ID}/meetings/${meetingId}/participants`,
    {
      method: "POST",
      body: JSON.stringify({
        name: (name || "Guest").slice(0, 50),
        preset_name: presetName,
        custom_participant_id: crypto.randomUUID(),
      }),
    }
  );

  return data.data.token;
}

async function listPresets(env) {
  const data = await rtkFetch(env, `/${env.RTK_APP_ID}/presets`);
  return data.data || [];
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      // Not an API route — let the static asset handler / SPA fallback serve it.
      return env.ASSETS.fetch(request);
    }

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    try {
      assertConfigured(env);

      // POST /api/meetings
      if (url.pathname === "/api/meetings" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const meetingId = await createMeeting(env, body.title);
        return json({ meetingId });
      }

      // POST /api/meetings/:id/join
      const joinMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)\/join$/);
      if (joinMatch && request.method === "POST") {
        const meetingId = joinMatch[1];
        const body = await request.json().catch(() => ({}));
        const authToken = await addParticipant(
          env,
          meetingId,
          body.name,
          !!body.isHost
        );
        return json({ authToken, meetingId });
      }

      // GET /api/presets (debug helper — lets you confirm real preset names)
      if (url.pathname === "/api/presets" && request.method === "GET") {
        const presets = await listPresets(env);
        return json({ presets: presets.map((p) => p.name) });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      const status = err instanceof ConfigError ? 500 : 502;
      return json({ error: err.message }, status);
    }
  },
};

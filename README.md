# Meet — a self-hosted Teams-style video app

A small Teams-like web app: a dark, icon-rail shell for starting or joining
video calls, built on **Cloudflare RealtimeKit** for the actual video.

- **Frontend**: plain HTML/CSS/JS (`/public`) — no build step, no framework.
  Uses RealtimeKit's prebuilt `<rtk-meeting>` component for the in-call UI
  (mic/camera controls, tiles, screenshare, chat panel, etc. all included).
- **Backend**: a single Cloudflare Worker (`src/worker.js`) that talks to the
  RealtimeKit REST API using your API token. The token never reaches the
  browser — the browser only ever gets a short-lived, per-participant
  `authToken`.

This first version is video-calls only (create a call / join with a code or
link). Chat, channels and calendar in the sidebar are placeholders for now.

## 1. One-time RealtimeKit setup

You said you've got the Cloudflare account and Realtime subscription, but
not the API token or App ID yet — here's how to get both.

### Create an API token

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com/) → **My
   Profile → API Tokens → Create Token**.
2. Use a custom token and grant it the **Realtime → Realtime Admin**
   permission (Account scope).
3. Copy the token — you'll only see it once.

### Create a RealtimeKit app

Easiest via the dashboard, because it sets up default presets for you
automatically (skip the API version below if you do this):

- Cloudflare dashboard → **Realtime → RealtimeKit** → **Create App**.

Or via the API (find your Account ID on the right sidebar of any zone's
Overview page in the dashboard):

```bash
curl https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/realtime/kit/apps \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -d '{"name": "Meet"}'
```

The response's `data.app.id` is your **App ID**.

### Check your preset names

Presets control participant permissions (host vs. guest). If you created
the app via the dashboard, defaults already exist. Confirm the exact names
with:

```bash
curl https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/realtime/kit/$APP_ID/presets \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

`wrangler.jsonc` currently assumes `group_call_host` and
`group_call_participant`. If your dashboard shows different names (e.g.
just `host` / `guest`), update the `vars` block in `wrangler.jsonc`
accordingly. Once the app is deployed, you can also hit `GET /api/presets`
on your own deployment to list them.

## 2. Install & configure

```bash
npm install -g wrangler   # if you don't have it already
cd teams-clone
```

Set your three secrets (these are never written to disk in this project —
Wrangler stores them encrypted in Cloudflare):

```bash
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_API_TOKEN
wrangler secret put RTK_APP_ID
```

## 3. Run locally

```bash
wrangler dev
```

Open the printed `http://localhost:8787` URL, enter a name, and click
**New meeting**. Open a second tab (or send yourself the invite link) to
test joining as a second participant.

## 4. Deploy

```bash
wrangler deploy
```

This publishes the Worker (API) and the static frontend together to your
`*.workers.dev` subdomain (or a custom domain, if you've set one up in
`wrangler.jsonc`).

## How it works

1. **New meeting** → browser calls `POST /api/meetings` → Worker calls
   RealtimeKit's Create Meeting API → returns a `meetingId`.
2. Browser calls `POST /api/meetings/:id/join` with your display name →
   Worker calls RealtimeKit's Add Participant API with the right preset →
   returns a short-lived `authToken`.
3. Browser initializes `RealtimeKitClient.init({ authToken })` and hands the
   resulting `meeting` object to `<rtk-meeting>`, which renders the whole
   call UI.
4. The invite link is just your app's URL with `?m=<meetingId>` — anyone who
   opens it gets prompted to enter their name and join as a guest.

## Where to go from here

- **Presets/permissions**: tune host vs. guest permissions (recording,
  muting others, kicking) in the RealtimeKit dashboard's Preset editor.
- **Persistence**: meeting history right now lives only in each browser's
  `localStorage` ("Recent meetings"). For a real "Teams" list shared across
  people, you'd add a small store (Workers KV or D1) the Worker reads/writes.
- **Chat & channels**: the sidebar has disabled placeholders for these —
  natural next step once video is solid.

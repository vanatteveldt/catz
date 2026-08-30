---
name: run
description: Start, check, and stop the catz dev servers (vite client + express server). Use whenever asked to run, restart, or verify the app, or before checking something in the browser.
---

# Running catz

This is a workspace monorepo (`npm run dev` from repo root runs both via `concurrently`):

- **client** — Vite dev server, fixed port **5179** (`strictPort: true` in `client/vite.config.ts`, so it fails fast instead of silently picking a different port if occupied)
- **server** — Express, fixed port **3009** (default in `server/src/index.ts`, override with `PORT=...`)

These ports were deliberately moved off the common defaults (5173 / 3001) to avoid colliding with other node/vite projects running on the same machine — a `lsof -i :5173` hit could belong to an unrelated repo.

## Start

Always start in the background — `npm run dev` runs two long-lived watchers and blocks in the foreground:

```
npm run dev
```

Run this via the bash tool with `run_in_background: true` from the repo root (not inside `client/` or `server/`).

## Check it's actually up

Don't assume the background process started cleanly — poll the ports:

```
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5179
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3009/api
```

Any HTTP response (even a 404 from the server, which has no root route) means something is listening. No response / connection refused means it's not up yet — check the background shell's output for the actual error before retrying.

If you need to confirm *which* process owns a port (e.g. before killing):

```
lsof -i :5179
lsof -i :3009
```

## Stop

Kill by port, not by process name — `pkill -f node` or `pkill -f vite` can kill unrelated node/vite processes elsewhere on the machine:

```
lsof -ti :5179 | xargs -r kill
lsof -ti :3009 | xargs -r kill
```

If you started `npm run dev` as a background shell via the bash tool, prefer killing that shell directly (it owns the `concurrently` parent process, which will cleanly stop both children) and only fall back to the port-based kill if the shell handle was lost.

## Restart after a change

Both dev servers already watch and reload on their own (`vite` for the client, `tsx watch` for the server) — a plain file edit does **not** need a restart. Only restart if you changed `vite.config.ts`, `package.json`, ports, or env vars.

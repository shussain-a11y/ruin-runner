# Ruin Runner

An endless temple-dash browser game — three lanes in pseudo-3D, jump the logs,
slide under the gates, switch lanes around the stone blocks, collect relic
shards. Node.js + Express backend with a persistent leaderboard.
Ready to deploy on Cloudways.

Original code and visuals, inspired by the endless-runner genre.
No third-party game assets are used.

## Controls

| Action       | Keyboard              | Touch          |
|--------------|-----------------------|----------------|
| Switch lane  | ← / → (or A / D)      | swipe left/right |
| Jump         | ↑ / W / Space         | tap or swipe up |
| Slide        | ↓ / S                 | swipe down     |

Speed ramps up the longer you survive. Score = distance + 250 per shard.

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

## API

- `GET /api/leaderboard` — top 10 scores
- `POST /api/score` — `{ "name": "...", "score": 12345 }`
- `GET /healthz` — health check

Scores persist to `data/scores.json` on the server. The file is gitignored,
so redeploys via git pull never wipe the leaderboard.

## Deploy on Cloudways

1. Create a Node.js application in the Cloudways console.
2. Connect this GitHub repo via **Deployment via Git** and pull `main`.
3. SSH into the app folder and run `npm install --production`.
4. Set the startup file to `server.js` — the app reads `process.env.PORT`
   and binds to `0.0.0.0`, so no changes are needed.
5. (Optional) run under PM2: `pm2 start ecosystem.config.js`.

## Structure

```
├── server.js                # Express server
├── routes/leaderboard.js    # score API + JSON persistence
├── data/                    # scores.json is created here at runtime
└── public/
    ├── index.html           # HUD + overlays
    ├── css/styles.css
    └── js/game.js           # the whole game engine
```

# Deployment on Render

This project runs locally with SQLite and can be deployed to Render with a persistent disk so the database survives deploys and restarts.

## Current deployment model

- Runtime: Node.js + Express
- Database: local SQLite via `better-sqlite3`
- Default local database path: `./data/hours.db`
- Render start command: `npm start`
- Render build command: `npm install`

## Environment variables

- `PORT`: HTTP port used by the Express server
- `DB_PATH`: SQLite database path

Example local values:

```env
PORT=3000
DB_PATH=./data/hours.db
```

## Files added for deployment

- `.env.example`
- `render.yaml`
- `DEPLOYMENT.md`

## GitHub steps

1. Create a GitHub repository for the project.
2. Commit the project without local database files.
3. Push the repository to GitHub.

Suggested commands:

```bash
git init
git add .
git commit -m "Prepare app_hours for Render deployment"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## Render deployment step by step

1. Sign in to Render.
2. Click `New` -> `Web Service`.
3. Connect the GitHub repository.
4. Confirm these settings:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/healthz`
   - Instance Type: `Starter` or higher
5. Add or confirm environment variables:
   - `NODE_ENV=production`
   - `DB_PATH=/var/data/hours.db`
6. Add a persistent disk:
   - Mount Path: `/var/data`
   - Size: default is fine to start
7. Deploy the service.
8. Test:
   - `/healthz`
   - main app page
   - login/register flow
   - PWA install prompt on HTTPS

## Important SQLite limitation on Render free tier

Render free web services use an ephemeral filesystem by default. That means the SQLite file is lost when the service:

- redeploys
- restarts
- spins down on idle

This makes SQLite on a free Render web service unsuitable if you want to keep accounts and data between deploys.

Official Render docs:

- Web services: https://render.com/docs/web-services
- Free tier limitations: https://render.com/docs/free
- Persistent disks: https://render.com/docs/disks

Inference from those docs: free web services are fine for demonstrating the app, but not for durable SQLite storage.

## Persistent storage note

The included `render.yaml` is configured for a persistent-disk setup:

- service plan: `starter`
- disk mount path: `/var/data`
- database path: `/var/data/hours.db`

This is the minimum setup required if you want your SQLite database to survive new deploys.

## Local behavior

Local behavior remains unchanged:

- if `DB_PATH` is not set, the app uses `./data/hours.db`
- the `data` directory is created automatically if missing
- the database file is created automatically on first start

## PWA in production

The app is close to installable in production:

- `manifest.json` exists
- service worker registration exists
- app will be served over HTTPS on Render

Current caveat:

- the manifest only declares an SVG icon; some install surfaces work better with PNG icons (`192x192` and `512x512`)

## Recommended future production improvements

Minimal improvements already added:

- `healthz` route
- basic security headers
- bind on `0.0.0.0`

Recommended next steps:

1. Add PNG icons to `manifest.json`
2. Add cache strategy to the service worker
3. Move from SQLite to PostgreSQL
4. Add structured request logging
5. Add backup/export strategy for user data

## Recommended future database migration

For any real production usage on Render, migrate from SQLite to PostgreSQL.

Why:

- persistent storage on free tier is not available for SQLite
- PostgreSQL is safer for concurrent access
- easier scaling and operational reliability

Recommended migration path:

1. Abstract DB access behind the current `db.js` interface
2. Introduce Postgres alongside SQLite
3. Migrate auth, clients, entries, and pay-period data
4. Keep SQLite only for local/dev if desired

# Deployment on Render

This project runs locally with SQLite and can be deployed to Render Free with PostgreSQL hosted remotely on Neon or Supabase.

## Current deployment model

- Runtime: Node.js + Express
- Database in production: PostgreSQL via `pg`
- Database in local fallback mode: SQLite via `better-sqlite3`
- Default local database path: `./data/hours.db`
- Render start command: `npm start`
- Render build command: `npm install`

## Environment variables

- `PORT`: HTTP port used by the Express server
- `DB_PATH`: SQLite database path
- `DATABASE_URL`: PostgreSQL connection string

Example local values:

```env
PORT=3000
DB_PATH=./data/hours.db
DATABASE_URL=
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
   - Instance Type: `Free`
5. Add or confirm environment variables:
   - `NODE_ENV=production`
   - `DATABASE_URL=postgresql://...`
6. Deploy the service.
7. Test:
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
The app now supports remote PostgreSQL specifically to solve that constraint.

Official Render docs:

- Web services: https://render.com/docs/web-services
- Free tier limitations: https://render.com/docs/free
- Persistent disks: https://render.com/docs/disks

Inference from those docs: free web services are fine for demonstrating the app, but not for durable SQLite storage.

## Neon free database

1. Create a free Neon project.
2. Copy the Postgres connection string.
3. Add it to Render as `DATABASE_URL`.

Official Neon docs:

- https://neon.tech/docs/connect/connect-from-any-app

## Supabase free database

1. Create a Supabase project.
2. Open `Project Settings` -> `Database`.
3. Copy the Postgres connection string.
4. Add it to Render as `DATABASE_URL`.

Official Supabase docs:

- https://supabase.com/docs/guides/database/connecting-to-postgres

## Local behavior

Local behavior remains unchanged:

- if `DATABASE_URL` is set, the app uses PostgreSQL
- if `DATABASE_URL` is not set, the app uses SQLite with `DB_PATH`
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
3. Add request logging and database health checks
4. Add structured request logging
5. Add backup/export strategy for user data

## Optional migration from SQLite to PostgreSQL

To import local SQLite data into PostgreSQL:

```bash
DATABASE_URL=postgresql://... npm run migrate:postgres
```

Optional custom SQLite source path:

```bash
SQLITE_DB_PATH=./data/hours.db DATABASE_URL=postgresql://... npm run migrate:postgres
```

The migration script imports:

- users
- per-user clients
- work entries
- pay-period salaries

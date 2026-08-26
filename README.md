# AB Address Service (backend)

Central Address Master + Address Mapping API for AcreBytes (AB). Node.js + Express +
TypeScript + Prisma + PostgreSQL.

## Run it
```bash
npm install
npx prisma migrate dev     # only needed once
npm run seed                # a few demo Areas (Sector 62/63, DLF Phase 1/2, ...) for merge/match demos
npm run import:india-geo    # full India reference data: 35 states, ~2.7k cities, ~25k pincodes, ~39k areas
npm run dev                 # http://localhost:4000
```
`DATABASE_URL` lives in `.env` (see `.env.example`).

## AI-assisted duplicate detection (optional)
Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default `gpt-4o`) in `.env` to
supplement the text-similarity matcher with a semantic check — it catches duplicates
that read as totally different strings (a landmark name vs the official area name,
e.g. "Rajiv Chowk Metro Area" vs "Connaught Place"), which edit-distance can never find.
Only called from the explicit admin "Check duplicates" action (`src/services/aiMatch.service.ts`),
never on every keystroke, so it adds no latency/cost to normal address entry. Leave the
key blank and the app runs exactly as before — no code changes needed either way.

## Tests
Integration tests run against a real, separate Postgres database
(`acrebytes_address_test_db`, wiped clean before each run) covering matching/abbreviation
resolution, pending review, merge + auto-relink, wrong-address correction, alias resolution
after merge, audit logging, admin auth, and clean-master search — plus unit tests for the
normalization/matching utility.
```bash
npm test
```

## Where to look
- `prisma/schema.prisma` — one self-referencing `AddressNode` table models
  Country→State→City→Pincode→Area→Sub-area, so master CRUD, matching, pending-review
  and merge logic is written once and works at every level.
- `src/services/addressNode.service.ts` — matching/resolve logic ("Sec 62" / "Sector-62" /
  "Sector 62" → same master; different numbers never auto-match).
- `src/services/merge.service.ts` — merge/correct + automatic relink of every existing
  linked address + audit trail.
- `prisma/importIndiaGeo.ts` — bulk loader for the India Post reference dataset.

## CI/CD
`.github/workflows/ci-cd.yml`: on push/PR to `main` → `npm test` against a throwaway
Postgres service container → (main only) build & push `koushik172/ab-address-backend`
to Docker Hub as `:latest` and `:<sha>` → SSH into the EC2 host and
`docker compose pull backend && docker compose up -d backend --no-deps` (only this
container restarts; postgres and frontend are untouched).

**Required GitHub Secrets** (Settings → Secrets and variables → Actions) — the frontend
repo needs the same five:

| Secret | Value |
|---|---|
| `DOCKERHUB_USERNAME` | `koushik172` |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `EC2_HOST` | EC2 public IP/DNS |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | full contents of the EC2 `.pem` key |

Database is managed Postgres (Supabase) — its connection string lives only in
`~/ab-app/.env` on the EC2 host (as `DATABASE_URL`), not in any GitHub secret; this
workflow never touches it.

This workflow assumes `~/ab-app/docker-compose.yml` already exists on the EC2 host (it
defines backend + frontend together) — see the deployment notes kept alongside this
project for the one-time EC2 setup and that file's contents.

## No login system
No password auth — a request header (`x-user-role`) picks the role. The frontend's
User/Admin toggle sets it. Wire in real auth later without touching any address logic.

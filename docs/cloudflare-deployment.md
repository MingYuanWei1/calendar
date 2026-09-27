# Cloudflare deployment

Production: https://calendar.keydion.com

A single Worker, `calendar`, serves both the static assets in `dist/pages` (Workers static assets, `run_worker_first: true`) and `/api/*`. `cloudflare/pages.mjs` is the router: it checks protected pages via `/api/page-access` before serving them, and the Worker adds the security headers to non-API responses. The old Pages project `school-calendar` is retired once the custom domain has moved to the Worker.

The backend keeps one `SchoolCalendar` SQLite Durable Object per configured school. Its synchronous SQL adapter preserves event versions, publication transactions, login sessions, and private seating. Images are validated and converted to WebP using Cloudflare Images, then stored in 512 KiB SQLite chunks. R2 is not required. Published-image authorization remains in the API; storage is not publicly accessible.

The Node server and Cloudflare backend share `server/api.mjs` and the exam routes. Local Node development still uses the filesystem and `node:sqlite`. Cloudflare uses the browser distributions of PDFKit and ExcelJS, and loads the same Chinese fonts served as static assets.

## Build and verify

```sh
npm ci
npm test
npm run typecheck
npm run build:cloudflare
npx wrangler deploy --dry-run
```

`wrangler.jsonc` describes the Worker and its assets. `npx wrangler deploy` uploads `dist/pages` together with the Worker; never point the assets directory at the repository root, `.env`, or `.data`.

Deploy with `npx wrangler deploy --keep-vars`. Preserve the Worker name, bindings and secrets; do not repeat the `v1` Durable Object migration. The custom domain `calendar.keydion.com` is attached to the Worker as a Custom Domain.

## Automatic deployment from GitHub

Cloudflare's native Git integration deploys `MingYuanWei1/calendar` on pushes to `main`. GitHub Actions (`.github/workflows/deploy.yml`) only validates changes; it does not publish and needs no Cloudflare API token.

The Worker build uses Node.js `24.17.0` (also pinned in `.node-version`) and the repository root:

| Project | Build command | Publish configuration |
| --- | --- | --- |
| Worker `calendar` | `npm test && npm run typecheck && npm run build:cloudflare` | `npx wrangler deploy --keep-vars` |

Use the existing Cloudflare GitHub authorization and select `main` as the production branch. Disable preview builds because preview frontends must not use the production backend. Worker build credentials are managed in Cloudflare, not in GitHub repository secrets.

The Worker uses the root `wrangler.jsonc`. `--keep-vars` preserves additional dashboard variables; values explicitly defined in the repository remain managed by Git. Worker secrets remain in Cloudflare.

Frontend and API deploy together as one Worker version. Inspect and retry failed builds in the Worker's Cloudflare deployment history.

## Administration and external services

The live database started empty, as requested. The newly generated admin credentials are in `.data/cloudflare-admin-login.txt` (owner-readable only, ignored by Git). This is separate from the local development admin. The bootstrap hash was installed as a temporary Worker secret, used to initialize the durable admin record, and removed after successful login.

`APP_ORIGIN` is `https://calendar.keydion.com`. Any future domain change must update this setting and the Microsoft callback URI. The local LLM Worker connection was copied into encrypted Worker secrets. Microsoft SSO is not configured: set `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, and `MICROSOFT_CLIENT_SECRET`, with the Web redirect URI `https://calendar.keydion.com/api/school/callback`, to enable school login. Local SSO preview is never enabled in production.

`npm run admin:create` and `npm run backup` affect only the local Node database. They do not modify or back up production. Manage production storage through Cloudflare Durable Objects, including its point-in-time recovery facilities. Preserve the `SchoolCalendar` class, `SCHOOLS` binding, and `SCHOOL_ID=calendar` across deployments (the Durable Object namespace keeps its original name `school-calendar-api_SchoolCalendar` after the Worker was renamed to `calendar`); changing the object name selects a different database.

`MICROSOFT_LOGIN_URL` is a plain-text Worker variable for the Microsoft authorization endpoint. It is set in `wrangler.jsonc` to `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize`. Change this variable to change the login URL; keep the repository configuration in sync with dashboard edits for future deployments. Local Node uses the same variable in `.env`. When unset, login uses the tenant-specific endpoint. Token exchange uses the sibling `/token` endpoint of this login URL. Identity validation still restricts users to `MICROSOFT_TENANT_ID`, which must identify the allowed school directory.

## Verification recorded

On 2026-09-23, all 22 existing integration tests and frontend type checks passed. The Cloudflare bundle passed local runtime and live HTTPS checks for login, CSRF rejection, private drafts/images, image transformation, publication/version conflicts, exam creation, Excel template/import, searchable Chinese PDF generation, deletion, and logout. Smoke-test calendar and exam records were deleted. The public calendar and exam lists are empty.

The repeatable smoke test reads the local credential file and creates temporary records:

```sh
node --use-env-proxy scripts/smoke-cloudflare.mjs https://calendar.keydion.com
```

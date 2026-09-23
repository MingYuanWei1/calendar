# Cloudflare deployment

Production: https://calendar.keydion.com

Pages project: `school-calendar` (`school-calendar-e9t.pages.dev`). Pages serves `dist/pages` and forwards `/api/*` through its private `CALENDAR_API` service binding to `school-calendar-api`.

The backend keeps one `SchoolCalendar` SQLite Durable Object per configured school. Its synchronous SQL adapter preserves event versions, publication transactions, login sessions, and private seating. Images are validated and converted to WebP using Cloudflare Images, then stored in 512 KiB SQLite chunks. R2 is not required. Published-image authorization remains in the API; storage is not publicly accessible.

The Node server and Cloudflare backend share `server/api.mjs` and the exam routes. Local Node development still uses the filesystem and `node:sqlite`. Cloudflare uses the browser distributions of PDFKit and ExcelJS, and loads the same Chinese fonts served by Pages.

## Build and verify

```sh
npm ci
npm test
npm run typecheck
npm run build:cloudflare
npx wrangler deploy --dry-run
```

`wrangler.jsonc` describes the backend. A Pages upload must include `_worker.js`, `_routes.json`, `_headers`, and the asset manifest. Only upload `dist/pages`; never upload the repository root, `.env`, or `.data`.

The initial deployment used Cloudflare MCP to create the Pages project, upload the backend, configure bindings, create the Pages deployment, and attach the custom domain/DNS. Static asset bytes were uploaded with the short-lived upload token issued through MCP because the MCP execution proxy rejected JWT-authenticated asset uploads. `scripts/upload-pages-assets.mjs` consumes prepared batches and this token in the ignored `.scratch/cf-upload` directory. The token was deleted afterward.

For future MCP deployments, use the existing resources. Preserve backend bindings/secrets; do not repeat the `v1` Durable Object migration. Upload the backend with the Workers multipart API, issue a Pages upload token, upload changed assets, and create the Pages deployment with the resulting manifest. The Pages production configuration must retain `CALENDAR_API` -> `school-calendar-api` and `fail_open: false`.

## Administration and external services

The live database started empty, as requested. The newly generated admin credentials are in `.data/cloudflare-admin-login.txt` (owner-readable only, ignored by Git). This is separate from the local development admin. The bootstrap hash was installed as a temporary Worker secret, used to initialize the durable admin record, and removed after successful login.

`APP_ORIGIN` is `https://calendar.keydion.com`. Any future domain change must update this setting and the Microsoft callback URI. The local LLM Worker connection was copied into encrypted Worker secrets. Microsoft SSO is not configured: set `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, and `MICROSOFT_CLIENT_SECRET`, with the Web redirect URI `https://calendar.keydion.com/api/school/callback`, to enable school login. Local SSO preview is never enabled in production.

`npm run admin:create` and `npm run backup` affect only the local Node database. They do not modify or back up production. Manage production storage through Cloudflare Durable Objects, including its point-in-time recovery facilities. Preserve the `SchoolCalendar` class, `SCHOOLS` binding, and `SCHOOL_ID=calendar` across deployments; changing the object name selects a different database.

## Verification recorded

On 2026-09-23, all 22 existing integration tests and frontend type checks passed. The Cloudflare bundle passed local runtime and live HTTPS checks for login, CSRF rejection, private drafts/images, image transformation, publication/version conflicts, exam creation, Excel template/import, searchable Chinese PDF generation, deletion, and logout. Smoke-test calendar and exam records were deleted. The public calendar and exam lists are empty.

The repeatable smoke test reads the local credential file and creates temporary records:

```sh
node --use-env-proxy scripts/smoke-cloudflare.mjs https://calendar.keydion.com
```

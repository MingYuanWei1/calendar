# Relay server in front of Cloudflare

Visitors reach `calendar.keydion.com` on our own server (nginx), which forwards to the Worker over a pooled, pre-warmed TLS connection and serves static assets from its own cache. This helps when the relay has a better route to visitors (for example a Hong Kong CN2 GIA/CMI VPS) than Cloudflare's edge does.

```
browser ──TLS──▶ relay (calendar.keydion.com, nginx) ──TLS keepalive──▶ Cloudflare (calendar.mingyuanw.workers.dev) ──▶ Worker
```

The public hostname stays `calendar.keydion.com`, so `APP_ORIGIN`, the Microsoft callback URI, cookies and the API's Origin check are unchanged.

## 1. Origin hostname

The relay forwards to the Worker's `workers.dev` address, enabled by `"workers_dev": true` in `wrangler.jsonc`. `workers.dev` is unreliable from mainland China, so the relay must run outside the mainland.

After deploying, check it serves the app: `curl -I https://calendar.mingyuanw.workers.dev/`.

## 2. Relay secret

The login rate limit is keyed by client IP. Behind a relay every request would come from the relay's IP, so one wrong-password streak would lock out everyone. The Worker therefore trusts `X-Relay-Client-IP` only when `X-Relay-Secret` matches the Worker secret `RELAY_SECRET` (`cloudflare/worker.mjs`); otherwise it uses `CF-Connecting-IP`.

```sh
openssl rand -hex 32                    # keep this value
npx wrangler secret put RELAY_SECRET    # paste it
```

Deploy the Worker change (push to `main`) before switching DNS.

## 3. Relay server

On the server (Debian/Ubuntu shown):

```sh
sudo apt install nginx certbot
sudo mkdir -p /var/cache/nginx/calendar
sudo cp deploy/relay/nginx.conf /etc/nginx/conf.d/calendar-relay.conf
sudo sed -i 's/RELAY_SECRET_VALUE/<secret>/' /etc/nginx/conf.d/calendar-relay.conf
sudo chmod 600 /etc/nginx/conf.d/calendar-relay.conf
```

Get a certificate for `calendar.keydion.com` before DNS moves, using the DNS-01 challenge (for example `certbot certonly --manual --preferred-challenges dns -d calendar.keydion.com`, or the `certbot-dns-cloudflare` plugin with a DNS-edit API token so renewal is automatic). Then `sudo nginx -t && sudo systemctl reload nginx`.

Test through the relay without touching DNS:

```sh
curl -I --resolve calendar.keydion.com:443:<relay-ip> https://calendar.keydion.com/
curl -sI --resolve calendar.keydion.com:443:<relay-ip> https://calendar.keydion.com/calendar.css | grep X-Relay-Cache   # MISS, then HIT
node --use-env-proxy scripts/smoke-cloudflare.mjs https://calendar.keydion.com   # with /etc/hosts pointing at the relay
```

## 4. Switch DNS

1. Remove the Custom Domain `calendar.keydion.com` from the Worker (the relay reaches the Worker through `workers.dev`).
2. Create an `A` (and `AAAA` if available) record `calendar` → relay IP, **DNS only (grey cloud)**. An orange cloud would send traffic back through Cloudflare's edge and defeat the purpose.
3. Use a low TTL at first so you can roll back quickly by re-attaching the Custom Domain.

## Notes

- **Measure first.** Compare from the users' networks, e.g. `curl -o /dev/null -s -w '%{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total}\n' https://calendar.keydion.com/calendar.css` before the switch (direct to Cloudflare) against the same URL through the relay (`--resolve calendar.keydion.com:443:<relay-ip>`). The relay only helps if its route to users is clearly better than Cloudflare's.
- **Relay → Cloudflare leg.** API calls still travel relay → Cloudflare → Durable Object. If that leg is slow, try a relay closer to a good Cloudflare PoP (HK, Tokyo, Singapore) or run the relay's upstream through a well-peered path.
- **Asset changes** appear on the relay at once: it keeps copies of static files but checks each request with the Worker by ETag, serving its copy only when the Worker answers 304 or is down. To flush the copies anyway: `sudo rm -rf /var/cache/nginx/calendar/* && sudo systemctl reload nginx`.
- **Direct origin access.** `calendar.mingyuanw.workers.dev` is publicly reachable, but state-changing API calls from it fail the Origin check. `workers.dev` hostnames cannot have WAF rules; to block direct access entirely, move the relay upstream to a Custom Domain on `keydion.com` and add a WAF rule requiring the `X-Relay-Secret` header.

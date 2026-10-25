#!/usr/bin/env bash
# One-command LuxeMail deploy for luxedealers.com. Safe to run again: every step checks what already exists.
#
# Needs these environment variables (never printed):
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, RESEND_API_KEY,
#   MAIN_SHOPIFY_CLIENT_ID, MAIN_SHOPIFY_CLIENT_SECRET
#
# Steps: D1 database + schema -> deploy + PUBLIC_URL -> secrets -> theme tracking URL + pixel.js address ->
#        health check -> build every email preview.
# It changes nothing in Shopify. Sending stays off until SENDING_ENABLED = "1" in wrangler.toml
# (only after the luxedealers.com sending domain is verified in Resend).
set -euo pipefail
cd "$(dirname "$0")"

for v in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID RESEND_API_KEY MAIN_SHOPIFY_CLIENT_ID MAIN_SHOPIFY_CLIENT_SECRET; do
  if [ -z "${!v:-}" ]; then echo "Missing environment variable $v" >&2; exit 1; fi
done
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

WRANGLER="npx --yes wrangler@4.135.0"
NAME="luxemail-main"

# Unsubscribe-link secret, derived from the Shopify client secret so every deploy gets the same value
# (changing it would break links in emails already sent).
UNSUB_SECRET="$(node -e 'const c=require("crypto");process.stdout.write(c.createHmac("sha256",process.env.MAIN_SHOPIFY_CLIENT_SECRET).update("luxemail-main-unsubscribe-v1").digest("hex"))')"
export UNSUB_SECRET

echo "== 1. D1 database"
find_db() { $WRANGLER d1 list --json 2>/dev/null | node -e 'const l=JSON.parse(require("fs").readFileSync(0));const d=l.find(x=>x.name===process.argv[1]);process.stdout.write(d?d.uuid:"")' "$NAME"; }
DB_ID="$(find_db)"
if [ -z "$DB_ID" ]; then $WRANGLER d1 create "$NAME" >/dev/null; DB_ID="$(find_db)"; fi
[ -n "$DB_ID" ] || { echo "Could not create the D1 database" >&2; exit 1; }
sed -i "s/^database_id = \".*\"/database_id = \"$DB_ID\"/" wrangler.toml
$WRANGLER d1 execute "$NAME" --remote --file schema.sql --yes >/dev/null
echo "   database ready"

echo "== 2. Deploy"
DEPLOY_OUT="$($WRANGLER deploy 2>&1)" || { echo "$DEPLOY_OUT" >&2; exit 1; }
WORKER_URL="$(printf '%s' "$DEPLOY_OUT" | grep -oE "https://$NAME\.[a-z0-9-]+\.workers\.dev" | head -1)"
[ -n "$WORKER_URL" ] || { echo "$DEPLOY_OUT" >&2; echo "No workers.dev address found." >&2; exit 1; }
if ! grep -q "PUBLIC_URL = \"$WORKER_URL\"" wrangler.toml; then
  sed -i "s#^PUBLIC_URL = \".*\"#PUBLIC_URL = \"$WORKER_URL\"#" wrangler.toml
  $WRANGLER deploy >/dev/null
fi
echo "   live at $WORKER_URL"

echo "== 3. Secrets"
SECRETS_FILE="$(mktemp)"; chmod 600 "$SECRETS_FILE"; trap 'rm -f "$SECRETS_FILE"' EXIT
node -e 'const e=process.env;require("fs").writeFileSync(process.argv[1],JSON.stringify({SHOPIFY_CLIENT_ID:e.MAIN_SHOPIFY_CLIENT_ID,SHOPIFY_CLIENT_SECRET:e.MAIN_SHOPIFY_CLIENT_SECRET,UNSUB_SECRET:e.UNSUB_SECRET,...(e.TRACK17_KEY?{TRACK17_KEY:e.TRACK17_KEY}:{})}))' "$SECRETS_FILE"
$WRANGLER secret bulk "$SECRETS_FILE" >/dev/null
rm -f "$SECRETS_FILE"
echo "   secrets stored in Cloudflare (plus TRACK17_KEY when set) (RESEND_API_KEY is set by the owner in the Cloudflare dashboard and left alone)"

echo "== 4. Theme tracking URL and custom pixel address"
node lib/theme-endpoint.mjs "$WORKER_URL/t"
node lib/pixel-endpoint.mjs "$WORKER_URL/p"

echo "== 5. Health"
curl -fsS "$WORKER_URL/health"; echo

echo "== 6. Every email builds (previews only: placeholder codes, nothing sent)"
FAILED=0
for flow in welcome1 welcome2 welcome3 checkout1 checkout2 cart1 cart2 browse wishlist postpurchase nextreminder vip winback \
            "fortnight&theme=new" "fortnight&theme=picks" "fortnight&theme=best" journal; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$WORKER_URL/preview?flow=$flow&key=$UNSUB_SECRET")"
  printf '   %-22s %s\n' "$flow" "$([ "$CODE" = 200 ] && echo ok || echo "FAILED ($CODE)")"
  [ "$CODE" = 200 ] || FAILED=1
done
[ "$FAILED" = 0 ] || echo "   Some emails failed to build; check: npx wrangler tail $NAME" >&2
echo "Done. Commit config/settings_data.json, mailer/wrangler.toml and mailer/pixel.js to make the tracking live."

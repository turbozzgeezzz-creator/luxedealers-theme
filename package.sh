#!/usr/bin/env sh
# Builds an uploadable theme zip for manual upload. Not needed when the store
# is connected to this repo through Shopify's GitHub integration.
set -e
cd "$(dirname "$0")"
mkdir -p dist
rm -f dist/luxedealers-theme.zip
zip -rq dist/luxedealers-theme.zip layout templates sections snippets assets config locales -x '.*'
echo "Wrote $(pwd)/dist/luxedealers-theme.zip"

#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT=${1:-"$ROOT/port/staging"}
rm -rf "$OUT"
mkdir -p "$OUT/opt/zapret2" "$OUT/etc/config" "$OUT/etc/init.d" "$OUT/usr/bin" "$OUT/usr/share" "$OUT/www"
mkdir -p "$OUT/opt/zapret2/nfq2" "$OUT/opt/zapret2/mdig" "$OUT/opt/zapret2/ip2net"
cp -a "$ROOT/routerich/backend/opt/zapret2/." "$OUT/opt/zapret2/"
cp -a "$ROOT/routerich/backend/etc/config/zapret2" "$OUT/etc/config/zapret2"
cp -a "$ROOT/routerich/backend/etc/init.d/zapret2" "$OUT/etc/init.d/zapret2"
cp -a "$ROOT/routerich/backend/etc/uci-defaults/99-zapret2" "$OUT/etc/uci-defaults" 2>/dev/null || true
cp -a "$ROOT/routerich/luci/." "$OUT/"
cp -a "$ROOT/upstream/openwrt-embedded/zapret2-v1.0.6/binaries/linux-x86_64/nfqws2" "$OUT/opt/zapret2/nfq2/nfqws2"
cp -a "$ROOT/upstream/openwrt-embedded/zapret2-v1.0.6/binaries/linux-x86_64/mdig" "$OUT/opt/zapret2/mdig/mdig"
cp -a "$ROOT/upstream/openwrt-embedded/zapret2-v1.0.6/binaries/linux-x86_64/ip2net" "$OUT/opt/zapret2/ip2net/ip2net"
cp -a "$ROOT/port/usr/bin/zapret2-testctl" "$OUT/usr/bin/zapret2-testctl"
cp -a "$ROOT/port/usr/bin/zapret2" "$OUT/usr/bin/zapret2"
cp -a "$ROOT/routerich/backend/usr/bin/zapret2" "$OUT/usr/bin/zapret2"
cp -a "$ROOT/port/opt/zapret2/zapret2-finder" "$OUT/opt/zapret2/zapret2-finder"
chmod 755 "$OUT/opt/zapret2/nfq2/nfqws2" "$OUT/opt/zapret2/zapret2-finder" "$OUT/opt/zapret2/blockcheck2.sh" "$OUT/etc/init.d/zapret2" "$OUT/usr/bin/zapret2" "$OUT/usr/bin/zapret2-testctl"
find "$OUT/opt/zapret2" -type f \( -name '*.sh' -o -name 'uci2config' -o -name 'functions' -o -name 'zapret2' \) -exec chmod 755 {} +
find "$OUT" -type f -name '*.key' -o -name 'codex_*' -o -name '*.bak' | xargs -r rm -f
tar -C "$OUT" -czf "$ROOT/port/zapret2-openwrt-x86_64.tar.gz" .
printf '%s\n' "$ROOT/port/zapret2-openwrt-x86_64.tar.gz"

#!/bin/sh
set -eu

REPO="${ZAPRET2_REPO:-BerkutSolutions/zapret2-openwrt-x86_64}"
API="https://api.github.com/repos/$REPO/releases/latest"
TMP="${TMPDIR:-/tmp}/zapret2-openwrt-install.$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT INT TERM

die() { echo "Zapret2 installer: $*" >&2; exit 1; }

fetch() {
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  else
    die "wget or curl is required"
  fi
}

fetch_stdout() {
  if command -v wget >/dev/null 2>&1; then
    wget -qO- "$1"
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1"
  else
    die "wget or curl is required"
  fi
}

asset_url() {
  asset="$1"
  printf '%s\n' "$release_json" |
    tr ',' '\n' |
    sed -n 's|.*"browser_download_url":[[:space:]]*"\([^\"]*\)".*|\1|p' |
    grep "/$asset$" |
    head -n 1
}

[ -f /etc/openwrt_release ] || die "OpenWrt is required"
. /etc/openwrt_release
[ "${DISTRIB_TARGET:-}" = "x86/64" ] || die "only OpenWrt x86/64 is supported"
[ "${DISTRIB_ARCH:-}" = "x86_64" ] || die "only x86_64 is supported"

release_json=$(fetch_stdout "$API") || die "cannot read the latest GitHub release"
tag=$(printf '%s\n' "$release_json" | sed -n 's/.*"tag_name":[[:space:]]*"\([^\"]*\)".*/\1/p' | head -n 1)
case "$tag" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) die "latest release has no valid version tag" ;;
esac
version=${tag#v}
echo "Installing Zapret2 OpenWrt x86_64 $version from $REPO"

is_current() {
  command -v apk >/dev/null 2>&1 || return 1
  apk info -e zapret2 >/dev/null 2>&1 || return 1
  apk info -e zapret2-uci >/dev/null 2>&1 || return 1
  apk info -e luci-app-zapret2 >/dev/null 2>&1 || return 1
  installed=$(apk list --installed zapret2 2>/dev/null | awk 'NR == 1 { sub(/^zapret2-/, "", $1); print $1 }')
  case "$installed" in
    "$version"*) return 0 ;;
  esac
  return 1
}

if is_current; then
  echo "Zapret2 $version is already up to date; configuration was not changed."
  exit 0
fi

download_asset() {
  asset="$1"
  url=$(asset_url "$asset")
  [ -n "$url" ] || die "release asset not found: $asset"
  fetch "$url" "$TMP/$asset"
}

download_asset "SHA256SUMS"
assets="zapret2-$version-x86_64.apk
luci-app-zapret2-$version-x86_64.apk
zapret2-uci-$version-all.apk"
for asset in $assets; do
  download_asset "$asset"
done

cd "$TMP"
for asset in $assets; do
  expected=$(awk -v name="$asset" '$2 == name { print $1; exit }' SHA256SUMS)
  actual=$(sha256sum "$asset" | awk '{ print $1 }')
  [ -n "$expected" ] && [ "$actual" = "$expected" ] || die "checksum verification failed: $asset"
done

config_backup="$TMP/zapret2.config"
[ ! -f /etc/config/zapret2 ] || cp -p /etc/config/zapret2 "$config_backup"
if command -v apk >/dev/null 2>&1 && ls ./*.apk >/dev/null 2>&1; then
  apk add --allow-untrusted ./*.apk || die "apk installation failed"
elif command -v opkg >/dev/null 2>&1 && ls ./*.ipk >/dev/null 2>&1; then
  opkg install ./*.ipk || die "opkg installation failed"
else
  die "no compatible package manager or package assets found"
fi
[ ! -f "$config_backup" ] || cp -p "$config_backup" /etc/config/zapret2

if [ -t 0 ] && [ -t 1 ]; then
  printf 'Restart zapret2 now? [y/N] '
  read answer || answer=""
  case "$answer" in
    y|Y|yes|YES) /etc/init.d/zapret2 restart ;;
  esac
else
  echo "Packages installed; zapret2 was not restarted in non-interactive mode."
fi
echo "Installed Zapret2 $version. Open LuCI at /cgi-bin/luci/admin/services/zapret2."

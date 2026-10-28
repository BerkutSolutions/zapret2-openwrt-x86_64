param([string]$OutputArchive = '')
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Stage = Join-Path $Root 'port\staging'
if ([string]::IsNullOrWhiteSpace($OutputArchive)) { $OutputArchive = Join-Path $Root 'port\zapret2-openwrt-x86_64.tar.gz' }
if (Test-Path $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Force $Stage | Out-Null
New-Item -ItemType Directory -Force (Join-Path $Stage 'opt\zapret2\nfq2'), (Join-Path $Stage 'opt\zapret2\mdig'), (Join-Path $Stage 'opt\zapret2\ip2net') | Out-Null
Copy-Item (Join-Path $Root 'upstream\openwrt-embedded\zapret2-v1.0.6\common') (Join-Path $Stage 'opt\zapret2') -Recurse -Force
Copy-Item (Join-Path $Root 'upstream\openwrt-embedded\zapret2-v1.0.6\blockcheck2.d') (Join-Path $Stage 'opt\zapret2') -Recurse -Force
Copy-Item (Join-Path $Root 'upstream\openwrt-embedded\zapret2-v1.0.6\ipset') (Join-Path $Stage 'opt\zapret2') -Recurse -Force
Copy-Item (Join-Path $Root 'upstream\openwrt-embedded\zapret2-v1.0.6\lua') (Join-Path $Stage 'opt\zapret2') -Recurse -Force
Copy-Item (Join-Path $Root 'upstream\openwrt-embedded\zapret2-v1.0.6\files') (Join-Path $Stage 'opt\zapret2') -Recurse -Force
Copy-Item (Join-Path $Root 'upstream\openwrt-embedded\zapret2-v1.0.6\init.d\openwrt\*') (Join-Path $Stage 'opt\zapret2\init.d\openwrt') -Recurse -Force
New-Item -ItemType Directory -Force (Join-Path $Stage 'etc\init.d'), (Join-Path $Stage 'etc\config') | Out-Null
Copy-Item (Join-Path $Root 'upstream\openwrt-embedded\zapret2-v1.0.6\config.default') (Join-Path $Stage 'opt\zapret2\config.default') -Force
# The init script sources this file during package post-install.  Keep a safe
# disabled copy in the standalone archive as well; uci2config will replace it
# from /etc/config/zapret2 before the service is enabled.
Copy-Item (Join-Path $Root 'upstream\openwrt-embedded\zapret2-v1.0.6\config.default') (Join-Path $Stage 'opt\zapret2\config') -Force
Copy-Item (Join-Path $Root 'openwrt\opt\zapret2\init.d\openwrt\uci2config') (Join-Path $Stage 'opt\zapret2\init.d\openwrt\uci2config') -Force
Copy-Item (Join-Path $Root 'openwrt\etc\config\zapret2') (Join-Path $Stage 'etc\config\zapret2') -Force
Copy-Item (Join-Path $Root 'upstream\openwrt-embedded\zapret2-v1.0.6\init.d\openwrt\zapret2') (Join-Path $Stage 'etc\init.d\zapret2') -Force
Copy-Item (Join-Path $Root 'upstream\openwrt-embedded\zapret2-v1.0.6\binaries\linux-x86_64\nfqws2') (Join-Path $Stage 'opt\zapret2\nfq2\nfqws2') -Force
Copy-Item (Join-Path $Root 'upstream\openwrt-embedded\zapret2-v1.0.6\binaries\linux-x86_64\mdig') (Join-Path $Stage 'opt\zapret2\mdig\mdig') -Force
Copy-Item (Join-Path $Root 'upstream\openwrt-embedded\zapret2-v1.0.6\binaries\linux-x86_64\ip2net') (Join-Path $Stage 'opt\zapret2\ip2net\ip2net') -Force
New-Item -ItemType Directory -Force (Join-Path $Stage 'usr\bin') | Out-Null
Copy-Item (Join-Path $Root 'port\usr\bin\zapret2-testctl') (Join-Path $Stage 'usr\bin') -Force
Copy-Item (Join-Path $Root 'port\usr\bin\zapret2') (Join-Path $Stage 'usr\bin\zapret2') -Force
Copy-Item (Join-Path $Root 'port\opt\zapret2\zapret2-finder') (Join-Path $Stage 'opt\zapret2\zapret2-finder') -Force
if (Test-Path $OutputArchive) { Remove-Item -LiteralPath $OutputArchive -Force }
tar -C $Stage -czf $OutputArchive .
Get-Item -LiteralPath $OutputArchive | Select-Object -ExpandProperty FullName

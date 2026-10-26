# Third-party notices

The runtime includes Zapret2 v1.0.6 from the official upstream project by
bol-van. Its MIT notice and embedded-component notices are retained under
`upstream/official` and `upstream/openwrt-embedded`.

The DEV installer may fetch Xray-core `v26.10.21` from the official
`XTLS/Xray-core` release when the router has no Xray binary. The installer
verifies SHA-256 `0eec3ed4163c273d8c8bf821f7d219e257921cf584aa3fb970715e458e631978`
before transfer. Xray-core is distributed under its upstream MPL-2.0 terms;
the source and notices remain the responsibility of the deployment package.

Routerich LuCI/backend material is included in the x86_64 port with permission
from Routerich Support. It is attributed to
https://github.com/routerich and is not relicensed as Berkut Solutions code.
Preserve the attribution and this notice when redistributing it.

The original packaging and OpenWrt x86_64 integration are Apache-2.0. The
upstream Zapret2 files remain MIT; the Routerich material remains covered by
the permission described above. Passwall2 is consumed as an installed OpenWrt
service through UCI/rpcd APIs and is not bundled here; its GPL-3.0 terms remain
applicable to that installed package.

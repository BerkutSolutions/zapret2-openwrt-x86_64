#!/bin/sh
# Reset zapret2 configuration to package defaults
uci import zapret2 < /opt/zapret2/defaults/zapret2.uci && uci commit zapret2

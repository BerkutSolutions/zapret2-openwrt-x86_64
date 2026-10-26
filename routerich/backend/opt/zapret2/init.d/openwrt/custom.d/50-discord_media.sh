# Discord media desync based on working PC zapret config
# UDP ranges: 19294-19344,50000-50100
# fake: quic_initial_dbankcloud_ru.bin, repeats=6

NFQWS_OPT_DESYNC_DISCORD_MEDIA="${NFQWS_OPT_DESYNC_DISCORD_MEDIA:---payload discord_ip_discovery --blob=dbank:@/opt/zapret2/files/fake/quic_initial_dbankcloud_ru.bin --lua-desync=fake:blob=dbank:repeats=6}"

alloc_dnum DNUM_DISCORD_MEDIA
alloc_qnum QNUM_DISCORD_MEDIA

zapret_custom_daemons()
{
 local opt="--qnum=$QNUM_DISCORD_MEDIA $NFQWS_OPT_DESYNC_DISCORD_MEDIA"
 do_nfqws $1 $DNUM_DISCORD_MEDIA "$opt"
}

zapret_custom_firewall()
{
 local DISABLE_IPV6=1
 local f="-p udp -m multiport --dports 19294:19344,50000:50100"
 fw_nfqws_post $1 "$f" '' $QNUM_DISCORD_MEDIA
}

zapret_custom_firewall_nft()
{
 local DISABLE_IPV6=1
 local f="udp dport { 19294-19344, 50000-50100 }"
 nft_fw_nfqws_post "$f" '' $QNUM_DISCORD_MEDIA
}

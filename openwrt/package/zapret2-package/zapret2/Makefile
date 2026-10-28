include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2
PKG_VERSION:=$(ZAPRET2_VERSION)
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/zapret2
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Zapret2 OpenWrt x86_64 runtime
  URL:=https://github.com/bol-van/zapret2
  DEPENDS:=+kmod-nfnetlink-queue +libnetfilter-queue +libmnl +libcap +zlib
endef

define Package/zapret2/description
  OpenWrt x86_64 packaging of the upstream Zapret2 runtime and scripts.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	mkdir -p $(PKG_BUILD_DIR)/nfq2 $(PKG_BUILD_DIR)/mdig $(PKG_BUILD_DIR)/ip2net
	$(CP) $(ZAPRET2_ROOT)/upstream/openwrt-embedded/zapret2-v$(ZAPRET2_VERSION)/common $(PKG_BUILD_DIR)/
	$(CP) $(ZAPRET2_ROOT)/upstream/openwrt-embedded/zapret2-v$(ZAPRET2_VERSION)/blockcheck2.d $(PKG_BUILD_DIR)/
	$(CP) $(ZAPRET2_ROOT)/upstream/openwrt-embedded/zapret2-v$(ZAPRET2_VERSION)/blockcheck2.sh $(PKG_BUILD_DIR)/
	$(CP) $(ZAPRET2_ROOT)/upstream/openwrt-embedded/zapret2-v$(ZAPRET2_VERSION)/files $(PKG_BUILD_DIR)/
	$(CP) $(ZAPRET2_ROOT)/upstream/openwrt-embedded/zapret2-v$(ZAPRET2_VERSION)/ipset $(PKG_BUILD_DIR)/
	$(CP) $(ZAPRET2_ROOT)/upstream/openwrt-embedded/zapret2-v$(ZAPRET2_VERSION)/lua $(PKG_BUILD_DIR)/
	$(CP) $(ZAPRET2_ROOT)/upstream/openwrt-embedded/zapret2-v$(ZAPRET2_VERSION)/init.d/openwrt $(PKG_BUILD_DIR)/init.d
	$(CP) $(ZAPRET2_ROOT)/upstream/openwrt-embedded/zapret2-v$(ZAPRET2_VERSION)/config.default $(PKG_BUILD_DIR)/
	$(CP) $(ZAPRET2_ROOT)/upstream/openwrt-embedded/zapret2-v$(ZAPRET2_VERSION)/binaries/linux-x86_64/nfqws2 $(PKG_BUILD_DIR)/nfq2/
	$(CP) $(ZAPRET2_ROOT)/upstream/openwrt-embedded/zapret2-v$(ZAPRET2_VERSION)/binaries/linux-x86_64/mdig $(PKG_BUILD_DIR)/mdig/
	$(CP) $(ZAPRET2_ROOT)/upstream/openwrt-embedded/zapret2-v$(ZAPRET2_VERSION)/binaries/linux-x86_64/ip2net $(PKG_BUILD_DIR)/ip2net/
	$(CP) $(ZAPRET2_ROOT)/port/opt/zapret2/zapret2-finder $(PKG_BUILD_DIR)/
	$(CP) $(ZAPRET2_ROOT)/port/usr/bin/zapret2-testctl $(PKG_BUILD_DIR)/
	$(CP) $(ZAPRET2_ROOT)/port/usr/bin/zapret2 $(PKG_BUILD_DIR)/zapret2-cli
endef

define Build/Compile
	true
endef

define Package/zapret2/install
	$(INSTALL_DIR) $(1)/opt/zapret2/nfq2 $(1)/opt/zapret2/mdig $(1)/opt/zapret2/ip2net
	$(INSTALL_DIR) $(1)/opt/zapret2
	$(INSTALL_DIR) $(1)/opt/zapret2/init.d/openwrt
	$(INSTALL_DIR) $(1)/etc/init.d
	$(CP) $(PKG_BUILD_DIR)/common $(1)/opt/zapret2/
	$(CP) $(PKG_BUILD_DIR)/blockcheck2.d $(1)/opt/zapret2/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/blockcheck2.sh $(1)/opt/zapret2/blockcheck2.sh
	$(CP) $(PKG_BUILD_DIR)/files $(1)/opt/zapret2/
	$(CP) $(PKG_BUILD_DIR)/ipset $(1)/opt/zapret2/
	$(CP) $(PKG_BUILD_DIR)/lua $(1)/opt/zapret2/
	$(CP) $(PKG_BUILD_DIR)/init.d/* $(1)/opt/zapret2/init.d/openwrt/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/init.d/zapret2 $(1)/etc/init.d/zapret2
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/config.default $(1)/opt/zapret2/
	# The upstream init script sources /opt/zapret2/config even before the
	# UCI companion package's post-install hook has a chance to run. Ship a
	# safe disabled initial config in the runtime package so apk post-install
	# actions never fail with a missing config file.
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/config.default $(1)/opt/zapret2/config
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/nfq2/nfqws2 $(1)/opt/zapret2/nfq2/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/mdig/mdig $(1)/opt/zapret2/mdig/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/ip2net/ip2net $(1)/opt/zapret2/ip2net/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/zapret2-finder $(1)/opt/zapret2/
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/zapret2-testctl $(1)/usr/bin/zapret2-testctl
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/zapret2-cli $(1)/usr/bin/zapret2
	find $(1)/opt/zapret2 -type f -name '*.sh' -exec chmod 755 {} +
endef

$(eval $(call BuildPackage,zapret2))

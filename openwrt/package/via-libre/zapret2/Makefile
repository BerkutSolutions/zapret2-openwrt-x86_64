include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2
PKG_VERSION:=$(VIA_LIBRE_VERSION)
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
	$(CP) $(VIA_LIBRE_ROOT)/upstream/openwrt-embedded/zapret2-v$(VIA_LIBRE_VERSION)/common $(PKG_BUILD_DIR)/
	$(CP) $(VIA_LIBRE_ROOT)/upstream/openwrt-embedded/zapret2-v$(VIA_LIBRE_VERSION)/blockcheck2.d $(PKG_BUILD_DIR)/
	$(CP) $(VIA_LIBRE_ROOT)/upstream/openwrt-embedded/zapret2-v$(VIA_LIBRE_VERSION)/files $(PKG_BUILD_DIR)/
	$(CP) $(VIA_LIBRE_ROOT)/upstream/openwrt-embedded/zapret2-v$(VIA_LIBRE_VERSION)/ipset $(PKG_BUILD_DIR)/
	$(CP) $(VIA_LIBRE_ROOT)/upstream/openwrt-embedded/zapret2-v$(VIA_LIBRE_VERSION)/lua $(PKG_BUILD_DIR)/
	$(CP) $(VIA_LIBRE_ROOT)/upstream/openwrt-embedded/zapret2-v$(VIA_LIBRE_VERSION)/init.d/openwrt $(PKG_BUILD_DIR)/init.d
	$(CP) $(VIA_LIBRE_ROOT)/upstream/openwrt-embedded/zapret2-v$(VIA_LIBRE_VERSION)/config.default $(PKG_BUILD_DIR)/
	$(CP) $(VIA_LIBRE_ROOT)/upstream/openwrt-embedded/zapret2-v$(VIA_LIBRE_VERSION)/binaries/linux-x86_64/nfqws2 $(PKG_BUILD_DIR)/nfq2/
	$(CP) $(VIA_LIBRE_ROOT)/upstream/openwrt-embedded/zapret2-v$(VIA_LIBRE_VERSION)/binaries/linux-x86_64/mdig $(PKG_BUILD_DIR)/mdig/
	$(CP) $(VIA_LIBRE_ROOT)/upstream/openwrt-embedded/zapret2-v$(VIA_LIBRE_VERSION)/binaries/linux-x86_64/ip2net $(PKG_BUILD_DIR)/ip2net/
	$(CP) $(VIA_LIBRE_ROOT)/port/opt/zapret2/zapret2-finder $(PKG_BUILD_DIR)/
	$(CP) $(VIA_LIBRE_ROOT)/port/usr/bin/zapret2-testctl $(PKG_BUILD_DIR)/
	$(CP) $(VIA_LIBRE_ROOT)/port/usr/bin/zapret2 $(PKG_BUILD_DIR)/zapret2-cli
endef

define Build/Compile
	true
endef

define Package/zapret2/install
	$(INSTALL_DIR) $(1)/opt/zapret2/nfq2 $(1)/opt/zapret2/mdig $(1)/opt/zapret2/ip2net
	$(INSTALL_DIR) $(1)/opt/zapret2/init.d/openwrt
	$(CP) $(PKG_BUILD_DIR)/common $(1)/opt/zapret2/
	$(CP) $(PKG_BUILD_DIR)/blockcheck2.d $(1)/opt/zapret2/
	$(CP) $(PKG_BUILD_DIR)/files $(1)/opt/zapret2/
	$(CP) $(PKG_BUILD_DIR)/ipset $(1)/opt/zapret2/
	$(CP) $(PKG_BUILD_DIR)/lua $(1)/opt/zapret2/
	$(CP) $(PKG_BUILD_DIR)/init.d/* $(1)/opt/zapret2/init.d/openwrt/
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/config.default $(1)/opt/zapret2/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/nfq2/nfqws2 $(1)/opt/zapret2/nfq2/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/mdig/mdig $(1)/opt/zapret2/mdig/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/ip2net/ip2net $(1)/opt/zapret2/ip2net/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/zapret2-finder $(1)/opt/zapret2/
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/zapret2-testctl $(1)/usr/bin/zapret2-testctl
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/zapret2-cli $(1)/usr/bin/zapret2
endef

$(eval $(call BuildPackage,zapret2))

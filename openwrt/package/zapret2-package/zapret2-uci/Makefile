include $(TOPDIR)/rules.mk

PKG_NAME:=zapret2-uci
PKG_VERSION:=$(ZAPRET2_VERSION)
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/zapret2-uci
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Zapret2 UCI and OpenWrt service integration
  DEPENDS:=+zapret2
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) $(ZAPRET2_ROOT)/openwrt/etc/config/zapret2 $(PKG_BUILD_DIR)/
	$(CP) $(ZAPRET2_ROOT)/openwrt/opt/zapret2/init.d/openwrt/uci2config $(PKG_BUILD_DIR)/
endef

define Build/Compile
	true
endef

define Package/zapret2-uci/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/opt/zapret2/init.d/openwrt
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/zapret2 $(1)/etc/config/zapret2
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/uci2config $(1)/opt/zapret2/init.d/openwrt/uci2config
endef

define Package/zapret2-uci/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
/opt/zapret2/init.d/openwrt/uci2config 2>/dev/null || true
endef

$(eval $(call BuildPackage,zapret2-uci))

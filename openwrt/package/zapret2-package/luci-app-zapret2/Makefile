include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-zapret2
PKG_VERSION:=$(ZAPRET2_VERSION)
PKG_RELEASE:=1
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-zapret2
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI interface for Zapret2
  DEPENDS:=+luci-base +rpcd +zapret2-uci
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) $(ZAPRET2_ROOT)/routerich/luci/. $(PKG_BUILD_DIR)/
endef

define Build/Compile
	true
endef

define Package/luci-app-zapret2/install
	# Copy only package payload directories. PKG_BUILD_DIR contains OpenWrt's
	# generated .pkgdir directory during install; copying `.` would recurse
	# into that destination and fail with "cannot copy ... into itself".
	$(INSTALL_DIR) $(1)/usr $(1)/www
	$(CP) $(PKG_BUILD_DIR)/usr/. $(1)/usr/
	$(CP) $(PKG_BUILD_DIR)/www/. $(1)/www/
	$(INSTALL_DIR) $(1)/usr/lib/opkg/info
	printf 'Package: luci-app-zapret2\nVersion: $(PKG_VERSION)-$(PKG_RELEASE)\nArchitecture: all\nDescription: LuCI interface for Zapret2\n' > $(1)/usr/lib/opkg/info/luci-app-zapret2.control
endef

$(eval $(call BuildPackage,luci-app-zapret2))

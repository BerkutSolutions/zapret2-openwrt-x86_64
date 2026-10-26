'use strict';
'require view';

var _appPromise = null;

function normalizeVersionToken(version) {
	if (typeof(version) !== 'string') {
		return '';
	}

	return version.trim().replace(/[^0-9A-Za-z._~-]+/g, '_');
}

function fetchInstalledLuciAppVersion() {
	var url = L.resource('view/zapret2/version.json') + '?_=' + Date.now();

	return fetch(url, { cache: 'no-store' }).then(function(response) {
		if (!response.ok) {
			throw new Error('HTTP ' + response.status);
		}

		return response.json();
	}).then(function(payload) {
		return normalizeVersionToken(payload && payload.luci_app_version);
	});
}

function loadApp() {
	if (_appPromise) {
		return _appPromise;
	}

	_appPromise = fetchInstalledLuciAppVersion().catch(function() {
		return '';
	}).then(function(version) {
		var previousResourceVersion = L.env.resource_version;

		if (version) {
			L.env.resource_version = 'zapret2-' + version;
		}

		return L.require('view.zapret2.app').finally(function() {
			L.env.resource_version = previousResourceVersion;
		});
	}).catch(function(error) {
		_appPromise = null;
		throw error;
	});

	return _appPromise;
}

return view.extend({
	load: function() {
		return loadApp().then(function(app) {
			return (app && typeof(app.load) === 'function') ? app.load() : null;
		}).catch(function() {
			return null;
		});
	},

	render: function(data) {
		return loadApp().then(function(app) {
			return (app && typeof(app.render) === 'function')
				? app.render(data)
				: E('div', {}, _('Failed to load Zapret2 UI'));
		}).catch(function() {
			return E('div', {}, _('Failed to load Zapret2 UI'));
		});
	}
});

'use strict';
'require baseclass';
'require form';
'require fs';
'require ui';
'require poll';
'require view.zapret2.logviewer as logviewer';

var _pollFn = null;

function escapeCssSelector(str) {
	return str.replace(/["\\]/g, '\\$&');
}

var ALLOWED_LOG_DIRS = ['/tmp/zapret2/', '/opt/zapret2/ipset/'];

function isAllowedLogPath(path) {
	if (!path || typeof path !== 'string') return false;
	if (path.indexOf('..') !== -1 || path.indexOf('\0') !== -1) return false;
	var normalized = path.replace(/\/+/g, '/');
	if (!normalized.endsWith('.log')) return false;
	for (var i = 0; i < ALLOWED_LOG_DIRS.length; i++) {
		if (normalized.startsWith(ALLOWED_LOG_DIRS[i])) return true;
	}
	return false;
}

function formatTitle(cfgname) {
	if (cfgname === 'main') return _('Main');
	if (cfgname === 'autohostlist') return _('Autohostlist');

	var name = cfgname.replace(/^\d+-/, '');
	name = name.replace(/[_-]/g, ' ');
	name = name.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
	return name;
}

function retrieveLogs() {
	return fs.exec('/usr/bin/find', [
		'/tmp/zapret2', '-maxdepth', '1', '-type', 'f', '-name', '*.log'
	]).then(function(findResult) {
		var logdata = [];

		logdata.push({
			filename: '/opt/zapret2/ipset/zapret_hosts_auto_debug.log',
			cfgname: 'autohostlist',
			title: _('Autohostlist')
		});

		if (findResult.code === 0 && findResult.stdout) {
			var logFiles = findResult.stdout.trim().split('\n').filter(function(f) {
				return f && f.endsWith('.log');
			});

			logFiles.sort(function(a, b) {
				var aName = a.replace(/.*\//, '').replace(/\.log$/, '');
				var bName = b.replace(/.*\//, '').replace(/\.log$/, '');
				if (aName === 'main') return -1;
				if (bName === 'main') return 1;
				return aName.localeCompare(bName);
			});

			for (var i = 0; i < logFiles.length; i++) {
				var path = logFiles[i];
				var cfgname = path.replace(/.*\//, '').replace(/\.log$/, '');
				logdata.push({
					filename: path,
					cfgname: cfgname,
					title: formatTitle(cfgname)
				});
			}
		}

		return logdata;
	}).catch(function(e) {
		ui.addNotification(null, E('p', _('Unable to retrieve log files:') + ' ' + e.message));
		return [];
	});
}

function downloadLog(log) {
	if (!log || !isAllowedLogPath(log.filename)) {
		ui.addNotification(null, E('p', _('Invalid log path')), 'error');
		return;
	}

	return fs.read_direct(log.filename).then(function(content) {
		var blob = new Blob([content || ''], { 'type': 'text/plain;charset=utf-8' });
		var url = URL.createObjectURL(blob);
		var link = document.createElement('a');
		link.href = url;
		link.download = log.filename.replace(/.*\//, '');
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(function() { URL.revokeObjectURL(url); }, 0);
	}).catch(function(err) {
		ui.addNotification(null, E('p', {}, err.message || _('Unable to download log')), 'error');
	});
}

function renderDebuglogUI() {
	if (_pollFn) {
		poll.remove(_pollFn);
		_pollFn = null;
	}

	var container = E('div', { 'class': 'cbi-section' }, [
		E('div', { 'class': 'cbi-value-description', 'style': 'margin-bottom: 1em;' },
			_('View debug logs from zapret2 service and custom scripts. Enable debug mode in Settings first.')),
		E('div', { 'id': 'debuglog-loading', 'style': 'padding: 20px; text-align: center;' }, _('Loading logs...'))
	]);

	retrieveLogs().then(function(logdata) {
		var loadingDiv = document.getElementById('debuglog-loading');
		if (loadingDiv) loadingDiv.remove();

		if (!logdata || logdata.length === 0) {
			container.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('No log files found. Enable debug logging in Settings and restart the service.')));
			return;
		}

		var tabButtons = E('ul', { 'class': 'cbi-tabmenu' });
		var tabContents = E('div', { 'class': 'cbi-tabcontainer' });
		var activeLog = logdata[0];

		logdata.forEach(function(log, index) {
			var tabId = 'log-' + log.cfgname;
			var isActive = index === 0;
			log.viewer = logviewer.create({
				path: log.filename,
				initialLines: 6000,
				renderedLines: 6000
			});

			var li = E('li', {
				'class': isActive ? 'cbi-tab' : 'cbi-tab-disabled',
				'data-tab': tabId
			}, E('a', {
				'href': '#',
				'click': function(ev) {
					ev.preventDefault();

					tabButtons.querySelectorAll('li').forEach(function(el) {
						el.className = 'cbi-tab-disabled';
					});
					this.parentNode.className = 'cbi-tab';

					tabContents.querySelectorAll('.cbi-tabcontainer-content').forEach(function(el) {
						el.style.display = 'none';
					});
					var target = tabContents.querySelector('[data-tab-content="' + escapeCssSelector(tabId) + '"]');
					if (target) {
						target.style.display = 'block';
						activeLog = log;
						log.viewer.refresh();
					}
				}
			}, log.title));

			tabButtons.appendChild(li);

			var content = E('div', {
				'class': 'cbi-tabcontainer-content',
				'data-tab-content': tabId,
				'style': isActive ? 'display: block;' : 'display: none;'
			}, [
				E('div', { 'class': 'cbi-section' }, [
					E('p', { 'class': 'cbi-section-descr' }, _('Path:') + ' ' + log.filename),
					E('div', { 'style': 'margin-bottom: 10px;' }, [
						E('button', {
							'type': 'button',
							'class': 'btn cbi-button cbi-button-neutral',
							'style': 'margin-right: 5px;',
							'click': function() { log.viewer.scrollToTail(); }
						}, _('Scroll to tail')),
						E('button', {
							'type': 'button',
							'class': 'btn cbi-button cbi-button-neutral',
							'click': function() { log.viewer.scrollToHead(); }
						}, _('Scroll to head'))
					]),
					log.viewer.render(),
					E('div', { 'class': 'cbi-page-actions', 'style': 'margin-top: 10px;' }, [
						E('button', {
							'type': 'button',
							'class': 'btn cbi-button cbi-button-action',
							'click': function() { log.viewer.refresh(); }
						}, _('Refresh')),
						' ',
						E('button', {
							'type': 'button',
							'class': 'btn cbi-button cbi-button-reset',
							'click': function() {
								if (!isAllowedLogPath(log.filename)) {
									ui.addNotification(null, E('p', _('Invalid log path')), 'error');
									return;
								}
								L.resolveDefault(fs.remove(log.filename), null).then(function() {
									log.viewer.reset();
								});
							}
						}, _('Clear'))
					])
				])
			]);

			tabContents.appendChild(content);
		});

		var logActions = E('div', { 'style': 'margin-bottom: 1em;' }, [
			E('button', {
				'type': 'button',
				'class': 'btn cbi-button cbi-button-neutral',
				'click': function() { downloadLog(activeLog); }
			}, _('Download log'))
		]);

		container.appendChild(logActions);
		container.appendChild(tabButtons);
		container.appendChild(tabContents);

		_pollFn = function() {
			return activeLog.viewer.refresh();
		};
		_pollFn();
		poll.add(_pollFn, 2);
	});

	return container;
}

return baseclass.extend({
	createDebuglogTab: function(map) {
		var s, o;

		// Use TypedSection with fake type for independent tab
		s = map.section(form.TypedSection, '_debuglog_tab', _('Debug Logs'));
		s.anonymous = true;
		s.addremove = false;
		s.cfgsections = function() { return ['_debuglog']; };

		o = s.option(form.DummyValue, '_debuglog_ui', ' ');
		o.rawhtml = true;
		o.cfgvalue = function() { return ''; };
		o.render = function() {
			return renderDebuglogUI();
		};
	}
});

'use strict';
'require baseclass';
'require form';
'require uci';
'require fs';
'require ui';
'require request';
var LISTS_DIR = '/opt/zapret2/ipset';
var MAX_FILE_SIZE = 1024 * 1024;
var pendingDeletes = [];
function writeFileDirect(path, content) {
	var blob = new Blob([content], { type: 'application/octet-stream' });
	var data = new FormData();
	data.append('sessionid', L.env.sessionid);
	data.append('filename', path);
	data.append('filedata', blob, path.split('/').pop());
	return request.post(L.env.cgi_base + '/cgi-upload', data).then(function(res) {
		var reply = res.json();
		if (L.isObject(reply) && reply.failure) {
			return Promise.reject(new Error(reply.message || 'Upload failed'));
		}
		return true;
	});
}

function isPathInDir(path, dir) {
	if (!path || !dir) return false;
	var normalizedPath = path.replace(/\/+/g, '/');
	var normalizedDir = dir.replace(/\/+$/, '') + '/';
	return normalizedPath.startsWith(normalizedDir) && normalizedPath.indexOf('..') === -1;
}

function isValidListFilename(name) {
	if (!name || name.indexOf('..') !== -1 || name.indexOf('/') !== -1) return false;
	if (name.startsWith('.') || name.startsWith('-')) return false;
	if (!/^zapret_(hosts|ipset)_[a-zA-Z0-9_]+\.txt$/.test(name)) return false;
	if (name.length > 128) return false;
	return true;
}

function sectionIdToDisplayName(section_id) {
	if (section_id.indexOf('list_') === 0) {
		return section_id.substring(5);
	}
	return section_id;
}
return baseclass.extend({
	createListsTab: function(map) {
		var s, o;
		var origSave = map.save;
		map.save = function(cb, silent) {
			if (silent) {
				return origSave.call(map, cb, silent);
			}
			var promises = [];
			pendingDeletes.forEach(function(path) {
				promises.push(L.resolveDefault(fs.remove(path), null));
			});
			pendingDeletes = [];
			return Promise.all(promises).then(function() {
				return origSave.call(map, cb, silent);
			});
		};
		s = map.section(form.GridSection, 'list', _('Lists'));
		s.addremove = true;
		s.anonymous = true;
		s.sortable = true;
		s.nodescriptions = true;
		s.filter = function(section_id) {
			var path = uci.get('zapret2', section_id, 'path') || '';
			if (path === '/opt/zapret2/ipset/zapret-ip-exclude.txt' ||
				path === '/opt/zapret2/ipset/zapret-ip-exclude6.txt') {
				return false;
			}
			return true;
		};
		var originalRender = s.render;
		s.render = function() {
			return originalRender.apply(this, arguments).then(function(el) {
				var headerEl = E('div', { 'class': 'cbi-section', 'style': 'padding-bottom: 0;' }, [
					E('div', { 'class': 'cbi-section-descr' },
						_('Manage lists of domains and IP addresses for filtering strategies.')),
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'style': 'margin-bottom: 1em;',
						'click': function(ev) {
							ev.target.disabled = true;
							ev.target.textContent = _('Reloading...');
							fs.exec('/etc/init.d/zapret2', ['reload']).then(function() {
								ev.target.disabled = false;
								ev.target.textContent = _('Reload Lists');
								ui.addTimeLimitedNotification(null, E('p', _('Hostlists reloaded')), 3000, 'info');
							}).catch(function(err) {
								ev.target.disabled = false;
								ev.target.textContent = _('Reload Lists');
								ui.addNotification(null, E('p', {}, _('Reload failed:') + ' ' + err.message), 'error');
							});
						}
					}, _('Reload Lists'))
				]);
				el.insertBefore(headerEl, el.firstChild);
				return el;
			});
		};
		s.renderSectionAdd = function() {
			var el = E('div', { 'class': 'cbi-section-create' }, [
				E('input', {
					'type': 'text',
					'class': 'cbi-section-create-name',
					'placeholder': _('List name (letters, numbers, underscores)')
				}),
				E('button', {
					'class': 'cbi-button cbi-button-add',
					'title': _('Add'),
					'click': ui.createHandlerFn(this, 'handleAdd')
				}, _('Add'))
			]);
			return el;
		};
		s.handleAdd = function(ev) {
			var self = this;
			var input = ev.target.parentNode.querySelector('.cbi-section-create-name');
			var name = input ? input.value.trim() : '';
			if (input) input.value = '';
			if (!name || !/^[a-zA-Z0-9_]+$/.test(name)) {
				ui.addNotification(null, E('p', {}, _('Invalid name. Use only letters, numbers and underscores.')), 'error');
				return;
			}
			var config_name = self.uciconfig || self.map.config;
			if (uci.get(config_name, 'list_hosts_' + name) || uci.get(config_name, 'list_ipset_' + name)) {
				ui.addNotification(null, E('p', {}, _('List with this name already exists.')), 'error');
				return;
			}
			var hostsPath = LISTS_DIR + '/zapret_hosts_' + name + '.txt';
			var ipsetPath = LISTS_DIR + '/zapret_ipset_' + name + '.txt';
			return Promise.all([
				L.resolveDefault(fs.stat(hostsPath), null),
				L.resolveDefault(fs.stat(ipsetPath), null)
			]).then(function(stats) {
				if (stats[0] || stats[1]) {
					ui.addNotification(null, E('p', {}, _('List with this name already exists.')), 'error');
					return;
				}
				return self.showListModal(name, null);
			});
		};
		s.handleRemove = function(section_id) {
			var config = this.uciconfig || this.map.config;
			var path = uci.get(config, section_id, 'path');
			if (path && isPathInDir(path, LISTS_DIR)) {
				pendingDeletes.push(path);
			}
			uci.remove(config, section_id);
			return this.map.save(null, true);
		};
		o = s.option(form.DummyValue, '_name', _('Name'));
		o.modalonly = false;
		o.cfgvalue = function(section_id) {
			var path = uci.get('zapret2', section_id, 'path') || '';
			var match = path.match(/zapret_(?:hosts|ipset)_(.+)\.txt$/);
			if (match) return match[1];
			return sectionIdToDisplayName(section_id);
		};
		o = s.option(form.DummyValue, '_type', _('Type'));
		o.modalonly = false;
		o.cfgvalue = function(section_id) {
			var path = uci.get('zapret2', section_id, 'path') || '';
			if (path.indexOf('zapret_ipset_') !== -1) {
				return _('IP set');
			} else if (path.indexOf('zapret_hosts_') !== -1) {
				return _('Domain list');
			}
			return _('Unknown');
		};
		o = s.option(form.DummyValue, 'path', _('Path'));
		o.cfgvalue = function(section_id) {
			return uci.get('zapret2', section_id, 'path') || '';
		};
		s.renderMoreOptionsModal = function(section_id) {
			return this.showListModal(sectionIdToDisplayName(section_id), section_id);
		};
		s.showListModal = function(name, section_id) {
			var self = this;
			var config = self.uciconfig || self.map.config;
			var isNew = !section_id;
			var oldPath = isNew ? '' : (uci.get(config, section_id, 'path') || '');
			if (!isNew && oldPath) {
				var match = oldPath.match(/zapret_(?:hosts|ipset)_(.+)\.txt$/);
				if (match) name = match[1];
			}
			var currentType = (oldPath.indexOf('zapret_ipset_') !== -1) ? 'ipset' : 'domain';
			var loadPromise = oldPath ? L.resolveDefault(fs.read_direct(oldPath), '') : Promise.resolve('');
			return loadPromise.then(function(content) {
				ui.showModal(isNew ? _('New List:') + ' ' + name : _('Edit List:') + ' ' + name, [
					E('div', {}, [
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('List type')),
							E('div', { 'class': 'cbi-value-field' }, [
								E('select', { 'id': 'edit_list_type', 'class': 'cbi-input-select' }, [
									E('option', { 'value': 'domain', 'selected': currentType === 'domain' ? '' : null }, _('Domain list')),
									E('option', { 'value': 'ipset', 'selected': currentType === 'ipset' ? '' : null }, _('IP set'))
								]),
								E('div', { 'class': 'cbi-value-description' }, _('Domain list — hostnames, IP set — IP addresses and subnets.'))
							])
						]),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('Content')),
							E('div', { 'class': 'cbi-value-field' }, [
								E('textarea', {
									'id': 'edit_list_content',
									'class': 'cbi-input-textarea',
									'rows': '20',
									'style': 'width: 100%; font-family: monospace;',
									'placeholder': _('Enter one domain or IP per line')
								}, content || '')
							])
						])
					]),
					E('div', { 'class': 'right', 'style': 'margin-top: 1em;' }, [
						E('button', {
							'class': 'cbi-button',
							'click': function() {
								ui.hideModal();
							}
						}, _('Cancel')),
						' ',
						E('button', {
							'class': 'cbi-button cbi-button-positive',
							'click': function() {
								var selectedType = document.getElementById('edit_list_type').value;
								var newContent = document.getElementById('edit_list_content').value;
								if (newContent.length > MAX_FILE_SIZE) {
									ui.addNotification(null, E('p', _('File too large (max 1MB).')), 'error');
									return;
								}
								var newFilename = (selectedType === 'ipset')
									? 'zapret_ipset_' + name + '.txt'
									: 'zapret_hosts_' + name + '.txt';
								var newPath = LISTS_DIR + '/' + newFilename;
								if (!isValidListFilename(newFilename) || !isPathInDir(newPath, LISTS_DIR)) {
									ui.addNotification(null, E('p', _('Invalid path.')), 'error');
									return;
								}
								if (isNew) {
									section_id = 'list_' + (selectedType === 'ipset' ? 'ipset_' : 'hosts_') + name;
									uci.add(config, self.sectiontype, section_id);
									uci.set(config, section_id, 'path', newPath);
								}
								writeFileDirect(newPath, newContent).then(function() {
									return fs.exec('/bin/chmod', ['644', newPath]);
								}).then(function() {
									if (!isNew && newPath !== oldPath) {
										var newSectionId = 'list_' + (selectedType === 'ipset' ? 'ipset_' : 'hosts_') + name;
										if (newSectionId !== section_id) {
											uci.add(config, self.sectiontype, newSectionId);
											uci.set(config, newSectionId, 'path', newPath);
											uci.remove(config, section_id);
										} else {
											uci.set(config, section_id, 'path', newPath);
										}
										if (oldPath && isPathInDir(oldPath, LISTS_DIR)) {
											return L.resolveDefault(fs.remove(oldPath), null);
										}
									}
								}).then(function() {
									ui.hideModal();
									return self.map.save(null, true);
								}).then(function() {
									return self.map.load();
								}).then(function() {
									return self.map.reset();
								}).catch(function(err) {
									ui.addNotification(null, E('p', _('Failed to save:') + ' ' + err.message), 'error');
								});
							}
						}, _('Save'))
					])
				], 'cbi-modal');
			});
		};
	}
});

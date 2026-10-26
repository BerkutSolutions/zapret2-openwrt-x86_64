'use strict';
'require baseclass';
'require form';
'require uci';
'require fs';
'require ui';

var ACTIVE_DIR = '/opt/zapret2/init.d/openwrt/custom.d';
var DISABLED_DIR = ACTIVE_DIR + '/disabled';
var SCRIPT_MANAGER = '/usr/bin/zapret2';
var _scriptsData = [];
var _desiredEnabled = {};
var _selectedEnabled = {};
var _selectedDisabled = {};
var _scriptsContainer = null;
var _applying = false;

function isValidScriptName(name) {
	if (!name || name.length === 0 || name.length > 50) return false;
	return /^[a-zA-Z0-9_]+$/.test(name);
}

function isValidFilename(name) {
	if (!name || name.indexOf('..') !== -1 || name.indexOf('/') !== -1) return false;
	if (name.startsWith('.') || name.startsWith('-')) return false;
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_\-\.]*\.sh$/.test(name)) return false;
	return name.length <= 64;
}

function isPathInDir(path, dir) {
	if (!path || !dir || path.indexOf('\0') !== -1) return false;
	var normalizedPath = path.replace(/\/+/g, '/');
	var normalizedDir = dir.replace(/\/+$/, '') + '/';
	if (!normalizedPath.startsWith(normalizedDir) || normalizedPath.indexOf('..') !== -1)
		return false;
	return normalizedPath.substring(normalizedDir.length).indexOf('/') === -1;
}

function isValidScriptPath(path) {
	if (!isPathInDir(path, ACTIVE_DIR) && !isPathInDir(path, DISABLED_DIR))
		return false;
	return isValidFilename(path.replace(/.*\//, ''));
}

function parseFilename(filename) {
	var match = filename.match(/^(\d+)-(.+)\.sh$/);
	if (match) return { order: match[1], name: match[2] };
	match = filename.match(/^(.+)\.sh$/);
	if (match) return { order: '', name: match[1] };
	return { order: '', name: filename };
}

function buildFilename(order, name) {
	if (order && order.trim()) return order.trim() + '-' + name + '.sh';
	return name + '.sh';
}

function parseRegistry(result) {
	if (!result || result.code !== 0)
		throw new Error((result && result.stderr) || _('Script manager failed.'));
	var registry;
	try {
		registry = JSON.parse(result.stdout || '');
	} catch (e) {
		throw new Error(_('Script manager returned invalid data.'));
	}
	if (!registry || !Array.isArray(registry.scripts))
		throw new Error(_('Script registry is invalid.'));

	var scripts = registry.scripts.map(function(entry) {
		if (!entry || !isValidFilename(entry.name) || !isValidScriptPath(entry.path) ||
			entry.path.replace(/.*\//, '') !== entry.name)
			throw new Error(_('Script registry contains an invalid entry.'));
		var parsed = parseFilename(entry.name);
		return {
			filename: entry.name,
			path: entry.path,
			order: parsed.order,
			name: parsed.name,
			enabled: isPathInDir(entry.path, ACTIVE_DIR)
		};
	});
	scripts.sort(function(a, b) { return a.filename.localeCompare(b.filename); });
	return scripts;
}

function setScriptsData(scripts) {
	_scriptsData = scripts;
	_desiredEnabled = {};
	scripts.forEach(function(script) {
		_desiredEnabled[script.filename] = script.enabled;
	});
	_selectedEnabled = {};
	_selectedDisabled = {};
}

function loadScripts() {
	return fs.exec(SCRIPT_MANAGER, ['scripts', 'list']).then(function(result) {
		setScriptsData(parseRegistry(result));
		return _scriptsData;
	});
}

function desiredEnabled(script) {
	return _desiredEnabled[script.filename] === true;
}

function hasPendingChanges() {
	return _scriptsData.some(function(script) {
		return desiredEnabled(script) !== script.enabled;
	});
}

function clearElement(element) {
	while (element.firstChild) element.removeChild(element.firstChild);
}

function safeParseScriptData(value) {
	try {
		var data = JSON.parse(value);
		if (data && isValidFilename(data.filename) && isValidScriptPath(data.path))
			return data;
	} catch (e) {}
	return null;
}

function requireAppliedState() {
	if (!hasPendingChanges()) return true;
	ui.addNotification(null, E('p', _('Apply or revert script moves before editing files.')), 'warning');
	return false;
}

function renderScriptTable(scripts, enabled) {
	var table = E('table', { 'class': 'table zapret2-script-table' }, [
		E('tr', { 'class': 'tr cbi-section-table-titles' }, [
			E('th', { 'class': 'th zapret2-script-select' }, ''),
			E('th', { 'class': 'th' }, _('Order')),
			E('th', { 'class': 'th' }, _('Name')),
			E('th', { 'class': 'th cbi-section-actions' }, '')
		])
	]);

	if (!scripts.length) {
		table.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'colspan': '4' }, _('No scripts.'))
		]));
		return table;
	}

	scripts.forEach(function(script) {
		var selection = enabled ? _selectedEnabled : _selectedDisabled;
		var selected = selection[script.filename] === true;
		table.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td zapret2-script-select' }, [
				E('input', {
					'type': 'checkbox',
					'checked': selected ? 'checked' : null,
					'change': function() {
						if (this.checked) selection[script.filename] = true;
						else delete selection[script.filename];
						renderScriptsTables();
					}
				})
			]),
			E('td', { 'class': 'td left' }, script.order || '-'),
			E('td', { 'class': 'td left', 'title': script.filename }, script.name),
			E('td', { 'class': 'td right cbi-section-actions' }, [
				E('div', {}, [
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-edit',
						'data-script': JSON.stringify(script),
						'click': function() {
							var data = safeParseScriptData(this.getAttribute('data-script'));
							if (data) handleEdit(data);
						}
					}, _('Edit')),
					' ',
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-remove',
						'data-path': script.path,
						'click': function() { handleRemove(this.getAttribute('data-path')); }
					}, _('Delete'))
				])
			])
		]));
	});
	return table;
}

function moveSelected(enable) {
	var selection = enable ? _selectedDisabled : _selectedEnabled;
	Object.keys(selection).forEach(function(filename) {
		_desiredEnabled[filename] = enable;
	});
	if (enable) _selectedDisabled = {};
	else _selectedEnabled = {};
	renderScriptsTables();
}

function handleApplyScripts() {
	if (_applying || !hasPendingChanges()) return;
	_applying = true;
	renderScriptsTables();
	var args = ['scripts', 'apply'];
	_scriptsData.forEach(function(script) {
		if (desiredEnabled(script)) args.push(script.filename);
	});
	fs.exec(SCRIPT_MANAGER, args).then(function(result) {
		setScriptsData(parseRegistry(result));
		ui.addTimeLimitedNotification(null, E('p', _('Custom script selection applied.')), 5000, 'info');
	}).catch(function(error) {
		ui.addNotification(null, E('p', _('Failed to apply custom scripts:') + ' ' + error.message), 'error');
	}).then(function() {
		_applying = false;
		renderScriptsTables();
	});
}

function renderScriptsTables() {
	if (!_scriptsContainer) return;
	clearElement(_scriptsContainer);
	var enabled = _scriptsData.filter(desiredEnabled);
	var disabled = _scriptsData.filter(function(script) { return !desiredEnabled(script); });
	var pending = hasPendingChanges();

	var controlButtons = E('div', { 'class': 'zapret2-script-controls' }, [
		E('button', {
			'type': 'button',
			'class': 'cbi-button',
			'title': _('Disable selected scripts'),
			'disabled': _applying || Object.keys(_selectedEnabled).length === 0 ? 'disabled' : null,
			'click': function() { moveSelected(false); }
		}, '\u2192'),
		E('button', {
			'type': 'button',
			'class': 'cbi-button',
			'title': _('Enable selected scripts'),
			'disabled': _applying || Object.keys(_selectedDisabled).length === 0 ? 'disabled' : null,
			'click': function() { moveSelected(true); }
		}, '\u2190'),
		E('button', {
			'type': 'button',
			'class': 'cbi-button cbi-button-apply',
			'disabled': _applying || !pending ? 'disabled' : null,
			'click': handleApplyScripts
		}, _applying ? _('Applying...') : _('Apply'))
	]);
	var controls = E('div', { 'class': 'zapret2-script-panel zapret2-script-control-panel' }, [
		E('h4', { 'aria-hidden': 'true' }, '\u00a0'),
		E('table', { 'class': 'table zapret2-script-control-table' }, [
			E('tr', { 'class': 'tr cbi-section-table-titles', 'aria-hidden': 'true' }, [
				E('th', { 'class': 'th' }, '\u00a0')
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [controlButtons])
			])
		])
	]);

	_scriptsContainer.appendChild(E('div', { 'class': 'zapret2-script-grid' }, [
		E('div', { 'class': 'zapret2-script-panel' }, [
			E('h4', {}, _('Enabled Scripts')),
			renderScriptTable(enabled, true)
		]),
		controls,
		E('div', { 'class': 'zapret2-script-panel' }, [
			E('h4', {}, _('Disabled Scripts')),
			renderScriptTable(disabled, false)
		])
	]));

	_scriptsContainer.appendChild(E('div', { 'class': 'cbi-section-create zapret2-script-create' }, [
		E('input', {
			'type': 'text',
			'class': 'cbi-section-create-name',
			'id': 'new_script_name',
			'placeholder': _('Script name (letters, numbers, underscores)')
		}),
		E('button', {
			'type': 'button',
			'class': 'cbi-button cbi-button-add',
			'click': handleAdd
		}, _('Add'))
	]));
}

function handleAdd() {
	if (!requireAppliedState()) return;
	var input = document.getElementById('new_script_name');
	var name = input ? input.value.trim() : '';
	if (!isValidScriptName(name)) {
		ui.addNotification(null, E('p', _('Invalid name. Use only ASCII letters, numbers and underscores (max 50 chars).')), 'error');
		return;
	}
	var filename = '50-' + name + '.sh';
	var path = ACTIVE_DIR + '/' + filename;
	if (_scriptsData.some(function(script) { return script.filename === filename; })) {
		ui.addNotification(null, E('p', _('Script with this name already exists.')), 'error');
		return;
	}
	var template = '#!/bin/sh\n# Custom nfqws2 script\n# Variables available: $NFQWS2, $DESYNC_MARK, etc.\n\n';
	fs.write(path, template).then(function() {
		return fs.exec('/bin/chmod', ['755', path]);
	}).then(function() {
		input.value = '';
		return loadScripts();
	}).then(function() {
		renderScriptsTables();
		var script = _scriptsData.find(function(item) { return item.filename === filename; });
		if (script) handleEdit(script);
	}).catch(function(error) {
		ui.addNotification(null, E('p', _('Failed to create script:') + ' ' + error.message), 'error');
	});
}

function handleEdit(script) {
	if (!requireAppliedState()) return;
	L.resolveDefault(fs.read(script.path), '').then(function(content) {
		var parsed = parseFilename(script.filename);
		var body = E('div', {}, [
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Order')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', { 'type': 'text', 'id': 'edit_order', 'class': 'cbi-input-text', 'value': parsed.order, 'placeholder': '50' }),
					E('div', { 'class': 'cbi-value-description' }, _('Scripts execute in alphabetical order. Leave empty for no prefix.'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Name')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', { 'type': 'text', 'id': 'edit_name', 'class': 'cbi-input-text', 'value': parsed.name }),
					E('div', { 'class': 'cbi-value-description' }, _('Script name (without order prefix and .sh extension)'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Content')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('textarea', { 'id': 'edit_content', 'class': 'cbi-input-textarea', 'rows': '20', 'style': 'width: 100%; font-family: monospace;' }, content || '#!/bin/sh\n')
				])
			])
		]);
		ui.showModal(_('Edit Script'), [
			body,
			E('div', { 'class': 'right', 'style': 'margin-top: 1em;' }, [
				E('button', { 'type': 'button', 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')),
				' ',
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-positive',
					'data-script': JSON.stringify(script),
					'click': function() {
						var data = safeParseScriptData(this.getAttribute('data-script'));
						if (data) handleSaveEdit(data);
					}
				}, _('Save'))
			])
		], 'cbi-modal');
	});
}

function handleSaveEdit(script) {
	var newOrder = document.getElementById('edit_order').value.trim();
	var newName = document.getElementById('edit_name').value.trim();
	var content = document.getElementById('edit_content').value;
	if (!isValidScriptName(newName)) {
		ui.addNotification(null, E('p', _('Invalid name. Use only ASCII letters, numbers and underscores.')), 'error');
		return;
	}
	if (newOrder && !/^\d+$/.test(newOrder)) {
		ui.addNotification(null, E('p', _('Order must be a number.')), 'error');
		return;
	}
	var newFilename = buildFilename(newOrder, newName);
	if (!isValidFilename(newFilename) || !isValidScriptPath(script.path)) {
		ui.addNotification(null, E('p', _('Invalid filename.')), 'error');
		return;
	}
	var directory = isPathInDir(script.path, DISABLED_DIR) ? DISABLED_DIR : ACTIVE_DIR;
	var newPath = directory + '/' + newFilename;
	if (newFilename !== script.filename &&
		_scriptsData.some(function(item) { return item.filename === newFilename; })) {
		ui.addNotification(null, E('p', _('A script with this filename already exists.')), 'error');
		return;
	}
	fs.write(newPath, content || '').then(function() {
		return fs.exec('/bin/chmod', ['755', newPath]);
	}).then(function() {
		if (script.path !== newPath) return fs.remove(script.path);
	}).then(function() {
		ui.hideModal();
		ui.addNotification(null, E('p', _('Script saved successfully.')), 'info');
		return loadScripts();
	}).then(renderScriptsTables).catch(function(error) {
		ui.addNotification(null, E('p', _('Failed to save script:') + ' ' + error.message), 'error');
	});
}

function handleRemove(path) {
	if (!requireAppliedState() || !confirm(_('Are you sure you want to delete this script?')))
		return;
	if (!isValidScriptPath(path)) {
		ui.addNotification(null, E('p', _('Invalid path.')), 'error');
		return;
	}
	fs.remove(path).then(function() {
		ui.addNotification(null, E('p', _('Script deleted.')), 'info');
		return loadScripts();
	}).then(renderScriptsTables).catch(function(error) {
		ui.addNotification(null, E('p', _('Failed to delete script:') + ' ' + error.message), 'error');
	});
}

return baseclass.extend({
	createScriptsTab: function(map) {
		var section, option;
		section = map.section(form.TypedSection, '_scripts_tab', _('Scripts'));
		section.anonymous = true;
		section.addremove = false;
		section.cfgsections = function() { return ['_scripts']; };

		option = section.option(form.DummyValue, '_enable', _('Enable Custom Scripts'));
		option.rawhtml = true;
		option.cfgvalue = function() { return ''; };
		option.render = function() {
			var enabled = uci.get('zapret2', 'main', 'custom_scripts') !== '0';
			return E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Enable Custom Scripts')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', {
						'type': 'checkbox',
						'id': 'custom_scripts_enable',
						'checked': enabled ? 'checked' : null,
						'change': function() {
							uci.set('zapret2', 'main', 'custom_scripts', this.checked ? '1' : '0');
						}
					})
				])
			]);
		};

		option = section.option(form.DummyValue, '_scripts_list', _('Scripts List'));
		option.rawhtml = true;
		option.cfgvalue = function() { return ''; };
		option.render = function() {
			_scriptsContainer = E('div', { 'id': 'scripts-table-container' });
			loadScripts().then(renderScriptsTables).catch(function(error) {
				ui.addNotification(null, E('p', _('Failed to load custom scripts:') + ' ' + error.message), 'error');
				renderScriptsTables();
			});
			return _scriptsContainer;
		};
	}
});

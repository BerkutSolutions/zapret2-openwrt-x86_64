'use strict';
'require baseclass';
'require uci';
'require rpc';
'require fs';
var LISTS_DIR = '/opt/zapret2/ipset';
var BLOBS_DIR = '/opt/zapret2/files/fake';
var LUA_DIR = '/opt/zapret2/lua';
var LUA_BASE_SCRIPTS = ['zapret-lib.lua', 'zapret-antidpi.lua', 'zapret-auto.lua'];
var ZAPRET2_LUCI_APP_VERSION = '1.0.5.2-r15';
var callInitAction = rpc.declare({
	object: 'luci',
	method: 'setInitAction',
	params: [ 'name', 'action' ],
	expect: { result: false }
});
var callInitStatus = rpc.declare({
	object: 'luci',
	method: 'getInitList',
	params: [ 'name' ],
	expect: { '': {} }
});
var _initStatus = null;
var _processCount = 0;
var _qnumInfo = '';
function fileNameToListSection(filename) {
	var name = filename.replace(/\.txt$/, '');
	name = name.replace(/^zapret_/, '');
	name = name.replace(/[^a-zA-Z0-9]/g, '_');
	return 'list_' + name;
}
function fileNameToBlobSection(filename) {
	var name = filename.replace(/\.bin$/, '');
	name = name.replace(/[^a-zA-Z0-9]/g, '_');
	return 'blob_' + name;
}
function fileNameToLuaSection(filename) {
	var name = filename.replace(/\.lua$/, '');
	name = name.replace(/[^a-zA-Z0-9]/g, '_');
	return 'lua_' + name;
}
return baseclass.extend({
	LISTS_DIR: LISTS_DIR,
	BLOBS_DIR: BLOBS_DIR,
	LUA_DIR: LUA_DIR,
	callInitAction: callInitAction,
	callInitStatus: callInitStatus,
	getInitStatus: function() { return _initStatus; },
	getProcessCount: function() { return _processCount; },
	getQnumInfo: function() { return _qnumInfo; },
	loadServiceStatus: function() {
		return Promise.all([
			callInitStatus('zapret2'),
			L.resolveDefault(fs.exec('/usr/bin/pgrep', ['nfqws2']), { stdout: '' }),
			L.resolveDefault(fs.exec('/bin/sh', ['-c',
				'for pid in $(pgrep nfqws2 2>/dev/null); do ' +
				'cat /proc/$pid/cmdline 2>/dev/null | tr "\\0" " " | grep -o "qnum=[0-9]*" | head -1; ' +
				'done'
			]), { stdout: '' })
		]).then(function(results) {
			_initStatus = results[0];
			var pids = (results[1].stdout || '').trim();
			_processCount = pids ? pids.split('\n').length : 0;
			_qnumInfo = (results[2].stdout || '').trim();
			return _initStatus;
		});
	},
	loadListFiles: function() {
		return L.resolveDefault(fs.list(LISTS_DIR), []);
	},
	loadBlobFiles: function() {
		return L.resolveDefault(fs.list(BLOBS_DIR), []);
	},
	loadLuaFiles: function() {
		return L.resolveDefault(fs.list(LUA_DIR), []);
	},
	loadVersion: function() {
		return Promise.resolve(ZAPRET2_LUCI_APP_VERSION.indexOf('ZAPRET2_VERSION') !== -1
			? ''
			: ZAPRET2_LUCI_APP_VERSION);
	},
	syncListsWithUCI: function(files) {
		var existingLists = uci.sections('zapret2', 'list') || [];
		var existingPaths = {};
		existingLists.forEach(function(list) {
			if (list.path) {
				existingPaths[list.path] = list['.name'];
			}
		});
		var actualFiles = {};
		(files || []).forEach(function(file) {
			if (file.name && file.name.endsWith('.txt')) {
				actualFiles[LISTS_DIR + '/' + file.name] = true;
			}
		});
		var needsSave = false;
		existingLists.forEach(function(list) {
			if (list.path && list.path.startsWith(LISTS_DIR + '/') && !actualFiles[list.path]) {
				uci.remove('zapret2', list['.name']);
				needsSave = true;
			}
		});
		(files || []).forEach(function(file) {
			if (file.name && file.name.endsWith('.txt')) {
				var filePath = LISTS_DIR + '/' + file.name;
				if (!existingPaths[filePath]) {
					var sectionName = fileNameToListSection(file.name);
					var baseName = sectionName;
					var counter = 1;
					while (uci.get('zapret2', sectionName)) {
						sectionName = baseName + '_' + counter;
						counter++;
					}
					uci.add('zapret2', 'list', sectionName);
					uci.set('zapret2', sectionName, 'path', filePath);
					needsSave = true;
				}
			}
		});
		return needsSave;
	},
	syncBlobsWithUCI: function(files) {
		var existingBlobs = uci.sections('zapret2', 'blob') || [];
		var existingPaths = {};
		existingBlobs.forEach(function(blob) {
			if (blob.path) {
				existingPaths[blob.path] = blob['.name'];
			}
		});
		var actualFiles = {};
		(files || []).forEach(function(file) {
			if (file.name && file.name.endsWith('.bin')) {
				actualFiles[BLOBS_DIR + '/' + file.name] = true;
			}
		});
		var needsSave = false;
		existingBlobs.forEach(function(blob) {
			if (blob.path && blob.path.startsWith(BLOBS_DIR + '/') && !actualFiles[blob.path]) {
				uci.remove('zapret2', blob['.name']);
				needsSave = true;
			}
		});
		(files || []).forEach(function(file) {
			if (file.name && file.name.endsWith('.bin')) {
				var filePath = BLOBS_DIR + '/' + file.name;
				if (!existingPaths[filePath]) {
					var sectionName = fileNameToBlobSection(file.name);
					var baseName = sectionName;
					var counter = 1;
					while (uci.get('zapret2', sectionName)) {
						sectionName = baseName + '_' + counter;
						counter++;
					}
					uci.add('zapret2', 'blob', sectionName);
					uci.set('zapret2', sectionName, 'path', filePath);
					uci.set('zapret2', sectionName, 'enabled', '0');
					needsSave = true;
				}
			}
		});
		return needsSave;
	},
	syncLuaWithUCI: function(files) {
		var existingLua = uci.sections('zapret2', 'luascript') || [];
		var existingPaths = {};
		existingLua.forEach(function(lua) {
			if (lua.path) existingPaths[lua.path] = lua['.name'];
		});
		var actualFiles = {};
		(files || []).forEach(function(file) {
			if (file.name && file.name.endsWith('.lua') && LUA_BASE_SCRIPTS.indexOf(file.name) === -1) {
				actualFiles[LUA_DIR + '/' + file.name] = true;
			}
		});
		var needsSave = false;
		existingLua.forEach(function(lua) {
			if (lua.path && lua.path.startsWith(LUA_DIR + '/') && !actualFiles[lua.path]) {
				uci.remove('zapret2', lua['.name']);
				needsSave = true;
			}
		});
		(files || []).forEach(function(file) {
			if (file.name && file.name.endsWith('.lua') && LUA_BASE_SCRIPTS.indexOf(file.name) === -1) {
				var filePath = LUA_DIR + '/' + file.name;
				if (!existingPaths[filePath]) {
					var sectionName = fileNameToLuaSection(file.name);
					var baseName = sectionName;
					var counter = 1;
					while (uci.get('zapret2', sectionName)) {
						sectionName = baseName + '_' + counter;
						counter++;
					}
					uci.add('zapret2', 'luascript', sectionName);
					uci.set('zapret2', sectionName, 'path', filePath);
					uci.set('zapret2', sectionName, 'enabled', '0');
					needsSave = true;
				}
			}
		});
		return needsSave;
	},
	syncFilesWithUCI: function(listFiles, blobFiles, luaFiles) {
		var listsNeedsSave = this.syncListsWithUCI(listFiles);
		var blobsNeedsSave = this.syncBlobsWithUCI(blobFiles);
		var luaNeedsSave = this.syncLuaWithUCI(luaFiles);
		if (listsNeedsSave || blobsNeedsSave || luaNeedsSave) {
			this.reorderSections();
			return uci.save().then(function() {
				return uci.apply();
			}).then(function() {
				return uci.load('zapret2');
			});
		}
		return Promise.resolve();
	},
	injectStyles: function() {
		if (!document.getElementById('zapret2-css')) {
			var link = document.createElement('link');
			link.id = 'zapret2-css';
			link.rel = 'stylesheet';
			link.href = L.resource('view/zapret2/zapret2.css');
			if (ZAPRET2_LUCI_APP_VERSION.indexOf('ZAPRET2_VERSION') === -1) {
				link.href += '?v=' + encodeURIComponent(ZAPRET2_LUCI_APP_VERSION);
			}
			document.head.appendChild(link);
		}
	},
	initControllers: function() {
	},
	isValidStrategyName: function(name) {
		if (!name || name.length === 0 || name.length > 64) {
			return false;
		}
		if (!/^[a-zA-Z][a-zA-Z0-9_\-]*$/.test(name)) {
			return false;
		}
		if (/[^\x00-\x7F]/.test(name)) {
			return false;
		}
		return true;
	},
	validateStrategyName: function(name, config, excludeSectionId) {
		if (!name || !name.trim())
			return _('Name is required');
		name = name.trim();
		if (!this.isValidStrategyName(name))
			return _('Invalid name. Use only ASCII letters, numbers, underscores and hyphens (max 64 chars, must start with letter).');
		if (name !== excludeSectionId && uci.get(config, name))
			return _('Strategy with this name already exists');
		return true;
	},
	reorderSections: function() {
		var typeOrder = { 'zapret2': 0, 'list': 1, 'blob': 2, 'luascript': 3, 'strategy': 4 };
		var allSections = uci.sections('zapret2');
		allSections.sort(function(a, b) {
			var ta = typeOrder[a['.type']] !== undefined ? typeOrder[a['.type']] : 99;
			var tb = typeOrder[b['.type']] !== undefined ? typeOrder[b['.type']] : 99;
			if (ta !== tb) return ta - tb;
			return (a['.index'] || 0) - (b['.index'] || 0);
		});
		for (var i = 1; i < allSections.length; i++) {
			uci.move('zapret2', allSections[i]['.name'], allSections[i - 1]['.name'], true);
		}
	},
	populateListOptions: function(option, pathPattern, prefixToStrip, emptyMessage) {
		var hasFiles = false;
		(uci.sections('zapret2', 'list') || []).forEach(function(section) {
			var path = section.path || '';
			if (path.indexOf(pathPattern) !== -1) {
				var displayName = section['.name'];
				if (displayName.indexOf('list_') === 0) {
					displayName = displayName.substring(5);
				}
				if (displayName.indexOf(prefixToStrip) === 0) {
					displayName = displayName.substring(prefixToStrip.length);
				}
				option.value(section['.name'], displayName);
				hasFiles = true;
			}
		});
		if (!hasFiles) {
			option.value('', emptyMessage);
		}
	}
});

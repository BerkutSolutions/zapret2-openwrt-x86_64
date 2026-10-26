'use strict';
'require baseclass';
'require form';
'require uci';
'require fs';
'require ui';
return baseclass.extend({
	createAutohostlistTab: function(map) {
		var s, o;
		s = map.section(form.TypedSection, '_autohostlist_tab', _('Autohostlist'));
		s.anonymous = true;
		s.addremove = false;
		s.cfgsections = function() { return ['_autohostlist']; };
		o = s.option(form.DummyValue, '_settings', _('Settings'));
		o.rawhtml = true;
		o.cfgvalue = function() { return ''; };
		o.render = function() {
			function createInput(id, uciKey, defaultVal) {
				var currentVal = uci.get('zapret2', 'main', uciKey) || defaultVal;
				return E('input', {
					'type': 'text',
					'class': 'cbi-input-text',
					'id': id,
					'value': currentVal,
					'placeholder': defaultVal,
					'style': 'width: 80px;',
					'change': function() {
						uci.set('zapret2', 'main', uciKey, this.value);
					}
				});
			}

			function createGroup(title, children) {
				var items = Array.isArray(children) ? children : [children];
				return E('fieldset', { 'class': 'bc2-group' },
					[E('legend', {}, title)].concat(items)
				);
			}

			function createField(label, inputEl) {
				return [
					E('label', { 'style': 'white-space: nowrap; align-self: center;' }, label),
					inputEl
				];
			}

			var container = E('div', { 'class': 'cbi-section' });

			function createSelect(id, uciKey, defaultVal, options) {
				var currentVal = uci.get('zapret2', 'main', uciKey) || defaultVal;
				var selectEl = E('select', {
					'class': 'cbi-input-select',
					'id': id,
					'change': function() {
						uci.set('zapret2', 'main', uciKey, this.value);
					}
				});
				options.forEach(function(opt) {
					selectEl.appendChild(E('option', {
						'value': opt[0],
						'selected': (opt[0] === currentVal) ? 'selected' : null
					}, opt[1]));
				});
				return selectEl;
			}

			// Settings group
			container.appendChild(createGroup(_('Settings'), [
				E('div', { 'style': 'margin-bottom: 6px; display: flex; align-items: center; gap: 8px;' },
					createField(_('Mode Filter') + ': ',
						createSelect('ahl_mode_filter', 'mode_filter', 'none', [
							['none', _('None')],
							['ipset', _('IP Set')],
							['hostlist', _('Host List')],
							['autohostlist', _('Auto Host List')]
						]))
				),
				E('div', { 'style': 'display: grid; grid-template-columns: auto auto auto auto auto auto; gap: 4px 8px; align-items: center;' },
					[].concat(
						createField(_('Retransmission Threshold') + ': ',
							createInput('ahl_retrans', 'autohostlist_retrans_threshold', '3')),
						createField(_('Fail Threshold') + ': ',
							createInput('ahl_fail', 'autohostlist_fail_threshold', '3')),
						createField(_('Fail Time Window') + ': ',
							createInput('ahl_time', 'autohostlist_fail_time', '60')),
						createField(_('Incoming Max Seq') + ': ',
							createInput('ahl_incoming_maxseq', 'autohostlist_incoming_maxseq', '4096')),
						createField(_('Retransmission Max Seq') + ': ',
							createInput('ahl_retrans_maxseq', 'autohostlist_retrans_maxseq', '32768')),
						createField(_('Retransmission Reset') + ': ',
							createInput('ahl_retrans_reset', 'autohostlist_retrans_reset', '1')),
						createField(_('UDP Incoming Packets') + ': ',
							createInput('ahl_udp_in', 'autohostlist_udp_in', '1')),
						createField(_('UDP Outgoing Packets') + ': ',
							createInput('ahl_udp_out', 'autohostlist_udp_out', '4'))
					)
				)
			]));

			// Detected Hosts group
			var textarea = E('textarea', {
				'id': 'autohostlist_content',
				'class': 'cbi-input-textarea',
				'rows': '15',
				'style': 'width: 100%; font-family: monospace;'
			});
			L.resolveDefault(fs.read('/opt/zapret2/ipset/zapret_hosts_auto.txt'), '').then(function(content) {
				textarea.value = content || '';
			});

			container.appendChild(createGroup(_('Detected Hosts'), [
				E('div', { 'class': 'cbi-value-description', 'style': 'margin-bottom: 0.5em;' },
					_('List of automatically detected hosts. You can edit this list manually.')),
				textarea,
				E('div', { 'style': 'margin-top: 10px;' }, [
					E('button', {
						'class': 'cbi-button cbi-button-apply',
						'click': function() {
							var value = textarea.value || '';
							var MAX_SIZE = 1024 * 1024;
							if (value.length > MAX_SIZE) {
								ui.addNotification(null, E('p', _('Error: Content too large (max 1MB)')), 'error');
								return;
							}
							if (value.indexOf('\0') !== -1) {
								ui.addNotification(null, E('p', _('Error: Invalid characters in content')), 'error');
								return;
							}
							if (/[а-яА-ЯёЁ]/.test(value)) {
								ui.addNotification(null, E('p', _('Error: Cyrillic characters are not allowed')), 'error');
								return;
							}
							fs.write('/opt/zapret2/ipset/zapret_hosts_auto.txt', value.trim() + '\n').then(function() {
								ui.addTimeLimitedNotification(null, E('p', _('List saved')), 3000, 'info');
							}).catch(function(err) {
								ui.addNotification(null, E('p', _('Failed to save:') + ' ' + err.message), 'error');
							});
						}
					}, _('Save Hosts'))
				])
			]));

			return container;
		};
	}
});

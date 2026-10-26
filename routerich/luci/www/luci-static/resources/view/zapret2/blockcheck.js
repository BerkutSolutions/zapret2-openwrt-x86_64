'use strict';
'require baseclass';
'require form';
'require fs';
'require ui';
'require poll';
'require view.zapret2.main as main';

var LOG_FILE = '/tmp/zapret2/blockcheck2.log';
var STRATEGIES_FILE = '/tmp/zapret2/found_strategies.txt';
var WRAPPER_FILE = '/tmp/blockcheck_run.sh';
var STATE_FILE = '/tmp/zapret2/blockcheck2.state.json';
var STATUS_FILE = '/tmp/blockcheck2.status';
var STOP_FILE = '/tmp/blockcheck2.stop';
var PAGE_SIZE = 2000;
var DEFAULT_DOMAIN = 'rutracker.org';

var _state = {
	isRunning: false,
	stopping: false,
	currentPage: 0,
	totalLines: 0,
	domainQueue: [],
	autoCollect: false,
	maxStrategies: 5,
	killedDomains: {},
	pollFn: null,
	foundStrategies: []
};

function shellEscape(str) {
	if (!str) return '';
	return str.replace(/[^a-zA-Z0-9._\-\/,:=@%~+ ]/g, '');
}

function shQuote(str) {
	return "'" + String(str || '').replace(/'/g, "'\"'\"'") + "'";
}

function domainToLogKey(domain) {
	return encodeURIComponent(domain || DEFAULT_DOMAIN);
}

function getDomainLogPath(domain) {
	return '/tmp/zapret2/log_' + domainToLogKey(domain) + '.txt';
}

function parseRunState(content) {
	if (!content) return null;
	try {
		return JSON.parse(content);
	} catch (e) {
		return null;
	}
}

function applyRunState(state) {
	if (!state || !Array.isArray(state.domains)) return;
	_state.domainQueue = state.domains.filter(function(d) { return typeof d === 'string' && d.length > 0; });
	_state.autoCollect = state.autoCollect === true;
	_state.maxStrategies = parseInt(state.maxStrategies || '5', 10) || 5;
	_state.wasRunning = state.wasRunning === true;
}

function restoreRunState() {
	return L.resolveDefault(fs.read(STATE_FILE), '').then(function(content) {
		var state = parseRunState(content);
		if (state) applyRunState(state);
		return state;
	});
}

function sanitizeNumber(val) {
	var num = parseInt(val, 10);
	return isNaN(num) ? '0' : String(num);
}

function validateEnum(val, allowed, defaultVal) {
	return allowed.indexOf(val) !== -1 ? val : defaultVal;
}

function sanitizeBool(val) {
	return val === '1' ? '1' : '0';
}

function getFormValue(id) {
	var el = document.getElementById(id);
	if (!el) return null;
	if (el.type === 'checkbox') return el.checked ? '1' : '0';
	return el.value;
}

function buildEnvVars() {
	var scanlevel = validateEnum(getFormValue('bc2_scanlevel'), ['quick', 'standard', 'force'], 'standard');
	var repeats = validateEnum(getFormValue('bc2_repeats'), ['1', '2', '3', '4', '5'], '1');

	var enableHttp = sanitizeBool(getFormValue('bc2_http'));
	var enableHttpsTls12 = sanitizeBool(getFormValue('bc2_https_tls12'));
	var enableHttpsTls13 = sanitizeBool(getFormValue('bc2_https_tls13'));
	var enableHttp3 = sanitizeBool(getFormValue('bc2_http3'));

	var skipDnscheck = sanitizeBool(getFormValue('bc2_skip_dns'));
	var skipIpblock = sanitizeBool(getFormValue('bc2_skip_ipblock'));
	var parallel = sanitizeBool(getFormValue('bc2_parallel'));

	var minTtl = sanitizeNumber(getFormValue('bc2_min_ttl'));
	var maxTtl = sanitizeNumber(getFormValue('bc2_max_ttl'));
	var minAutottl = sanitizeNumber(getFormValue('bc2_min_autottl'));
	var maxAutottl = sanitizeNumber(getFormValue('bc2_max_autottl'));
	var curlTimeout = validateEnum(getFormValue('bc2_timeout'), ['1', '1.5', '2', '2.5', '3'], '2');
	var curlHttpsGet = sanitizeBool(getFormValue('bc2_https_get'));

	var curlPath = shellEscape(getFormValue('bc2_curl_path')) || '';
	var curlOpts = [];
	if (getFormValue('bc2_curl_k') === '1') curlOpts.push('-k');
	if (getFormValue('bc2_curl_v') === '1') curlOpts.push('-v');

	var filterL3 = validateEnum(getFormValue('bc2_filter_l3'), ['4', '6', '46'], '4');
	var testSet = validateEnum(getFormValue('bc2_test_set'), ['standard', 'custom'], 'standard');

	var extraPre = shellEscape(getFormValue('bc2_pktws_extra_pre') || '').trim();
	var extraPost = shellEscape(getFormValue('bc2_pktws_extra_post') || '').trim();

	var envVars = [
		'BATCH=1',
		'IPVS=' + filterL3,
		'TEST=' + testSet,
		'SCANLEVEL=' + scanlevel,
		'REPEATS=' + repeats,
		'ENABLE_HTTP=' + enableHttp,
		'ENABLE_HTTPS_TLS12=' + enableHttpsTls12,
		'ENABLE_HTTPS_TLS13=' + enableHttpsTls13,
		'ENABLE_HTTP3=' + enableHttp3,
		'SKIP_DNSCHECK=' + skipDnscheck,
		'SKIP_IPBLOCK=' + skipIpblock,
		'PARALLEL=' + parallel,
		'CURL_MAX_TIME=' + curlTimeout,
		'CURL_HTTPS_GET=' + curlHttpsGet
	];

	if (maxTtl !== '0' && maxTtl !== '') {
		envVars.push('MIN_TTL=' + minTtl);
		envVars.push('MAX_TTL=' + maxTtl);
	}

	if (maxAutottl !== '0' && maxAutottl !== '') {
		envVars.push('MIN_AUTOTTL_DELTA=' + minAutottl);
		envVars.push('MAX_AUTOTTL_DELTA=' + maxAutottl);
	}

	if (curlOpts.length > 0) {
		envVars.push('CURL_OPT="' + curlOpts.join(' ') + '"');
	}

	if (curlPath) {
		envVars.push('CURL="' + curlPath + '"');
	}

	if (extraPre) {
		var preParts = extraPre.split(/\s+/);
		if (preParts.length === 1) {
			envVars.push('PKTWS_EXTRA_PRE="' + preParts[0] + '"');
		} else {
			for (var i = 0; i < preParts.length && i < 9; i++)
				envVars.push('PKTWS_EXTRA_PRE_' + (i + 1) + '="' + preParts[i] + '"');
		}
	}

	if (extraPost) {
		var postParts = extraPost.split(/\s+/);
		if (postParts.length === 1) {
			envVars.push('PKTWS_EXTRA_POST="' + postParts[0] + '"');
		} else {
			for (var i = 0; i < postParts.length && i < 9; i++)
				envVars.push('PKTWS_EXTRA_POST_' + (i + 1) + '="' + postParts[i] + '"');
		}
	}

	return envVars;
}

function generateWrapper(domains, autoCollect, maxStrategies, wasRunning) {
	var envVars = buildEnvVars();
	var lines = ['#!/bin/sh'];
	lines.push('umask 0022');

	lines.push('STATE=' + STATE_FILE);
	lines.push('PIDFILE=/tmp/zapret2/blockcheck.pid');
	lines.push('STOP=' + STOP_FILE);
	lines.push('LOG=' + LOG_FILE);
	lines.push('rm -f "$STOP"');
	lines.push('mkdir -p /tmp/zapret2 && echo $$ > "$PIDFILE"');
	lines.push('');
	lines.push('WAS_RUNNING=' + (wasRunning ? '1' : '0'));
	lines.push('cleanup() { rm -f "$STOP" "$STATE" "$PIDFILE" ' + STATUS_FILE + ' ' + STATUS_FILE + '.tmp; [ "$WAS_RUNNING" = 1 ] && /etc/init.d/zapret2 start; }');
	lines.push('trap cleanup EXIT');
	lines.push('trap exit TERM INT');
	lines.push('');

	for (var i = 0; i < envVars.length; i++)
		lines.push('export ' + envVars[i]);

	lines.push('');
	lines.push('mkdir -p /tmp/zapret2 || exit 1');
	lines.push('> "$LOG"');
	lines.push('rm -f /tmp/zapret2/log_*.txt');
	lines.push('TOTAL=' + domains.length);
	lines.push('run_domain() {');
	lines.push('  d="$1"');
	lines.push('  log_key="$2"');
	lines.push('  n="$3"');
	lines.push('  domain_log="/tmp/zapret2/log_${log_key}.txt"');
	lines.push('  echo "$n/$TOTAL $d" > ' + STATUS_FILE + '.tmp && mv ' + STATUS_FILE + '.tmp ' + STATUS_FILE);

	if (autoCollect) {
		lines.push('MAX=' + maxStrategies);
		lines.push("  count_strats() { awk '/nfqws2/{p=1;next} p&&/!!!!! AVAILABLE/{c++;p=0} p&&/UNAVAILABLE/{p=0} END{print c+0}' \"$domain_log\"; }");
		lines.push('  (');
		lines.push('    while ! [ -f "$STOP" ]; do');
		lines.push('      sleep 1');
		lines.push('      NOW=$(count_strats)');
		lines.push('      [ "$NOW" -ge "$MAX" ] && {');
		lines.push('        kill $(pgrep -f "blockcheck2[.]sh") 2>/dev/null');
		lines.push('        /usr/bin/zapret2-testctl stop blockcheck 2>/dev/null');
		lines.push('        break');
		lines.push('      }');
		lines.push('    done');
		lines.push('  ) &');
		lines.push('  WD=$!');
	}

	lines.push('  DOMAINS="$d" /opt/zapret2/blockcheck2.sh 2>&1 | tee "$domain_log" >> "$LOG"');

	if (autoCollect) {
		lines.push('  kill $WD 2>/dev/null');
		lines.push('  wait $WD 2>/dev/null');
	}

	lines.push('  /usr/bin/zapret2-testctl stop blockcheck 2>/dev/null');
	lines.push('  sleep 0.5');
	lines.push('}');

	for (var i = 0; i < domains.length; i++) {
		lines.push('[ -f "$STOP" ] || run_domain ' + shQuote(domains[i]) + ' ' + shQuote(domainToLogKey(domains[i])) + ' ' + (i + 1));
	}

	return lines.join('\n');
}

function parseStrategiesFromLog(logContent) {
	if (!logContent) return { strategies: [], domainStrategies: {}, domains: [] };
	var lines = logContent.split('\n');
	var strategies = [];
	var domainStrategies = {};
	var domains = [];
	var currentDomain = '';
	var strategyLine = '';

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];

		var domainMatch = line.match(/^\* (?:curl_test_\S+|port block tests) ipv[46] (\S+)/);
		if (domainMatch) {
			var domain = domainMatch[1].replace(/:\d+$/, '');
			if (domain !== currentDomain) {
				currentDomain = domain;
				if (domains.indexOf(domain) === -1) {
					domains.push(domain);
					domainStrategies[domain] = [];
				}
			}
			continue;
		}

		if (line.indexOf(': nfqws2 ') !== -1) {
			strategyLine = line;
			continue;
		}

		if (strategyLine && line.indexOf('!!!!! AVAILABLE !!!!!') !== -1) {
			var match = strategyLine.match(/: nfqws2 (.+)$/);
			if (match && match[1]) {
				var params = match[1].trim();
				if (strategies.indexOf(params) === -1) {
					strategies.push(params);
				}
				if (currentDomain && domainStrategies[currentDomain]) {
					if (domainStrategies[currentDomain].indexOf(params) === -1) {
						domainStrategies[currentDomain].push(params);
					}
				}
			}
			strategyLine = '';
		} else if (strategyLine && line.indexOf('UNAVAILABLE') !== -1) {
			strategyLine = '';
		}
	}

	return { strategies: strategies, domainStrategies: domainStrategies, domains: domains };
}

function handleStart() {
	if (_state.isRunning) return;

	// Guard: check if wrapper or blockcheck is already running
	document.getElementById('btn_start').disabled = true;
	document.getElementById('bc2_status').textContent = _('Status') + ': ' + _('Checking') + '...';

	Promise.all([
		L.resolveDefault(fs.exec('/usr/bin/pgrep', ['-f', 'blockcheck_run']), null),
		L.resolveDefault(fs.exec('/usr/bin/pgrep', ['-f', 'blockcheck2.sh']), null)
	]).then(function(results) {
		var wrapperRunning = results[0] !== null && results[0].code === 0;
		var scriptRunning = results[1] !== null && results[1].code === 0;
		if (wrapperRunning || scriptRunning) {
			_state.isRunning = true;
			document.getElementById('btn_stop').disabled = false;
			document.getElementById('btn_clear').disabled = true;
			document.getElementById('bc2_status').textContent = _('Status') + ': ' + _('Already running');
			restoreRunState().catch(function() {});
			return;
		}

	_state.autoCollect = getFormValue('bc2_autocollect') === '1';
	_state.maxStrategies = parseInt(getFormValue('bc2_max_strategies') || '5', 10);
	_state.stopping = false;

	var domainInput = getFormValue('bc2_domain') || DEFAULT_DOMAIN;
	_state.domainQueue = domainInput.trim().split(/\s+/).filter(function(d) { return d.length > 0; });
	_state.killedDomains = {};
	_state.wasRunning = main.getProcessCount() > 0;

	var wrapperContent = generateWrapper(_state.domainQueue, _state.autoCollect, _state.maxStrategies, _state.wasRunning);
	var runState = JSON.stringify({
		domains: _state.domainQueue,
		autoCollect: _state.autoCollect,
		maxStrategies: _state.maxStrategies,
		wasRunning: _state.wasRunning
	});

	_state.currentPage = 0;
	_state.totalLines = 0;

	document.getElementById('btn_stop').disabled = false;
	document.getElementById('btn_clear').disabled = true;
	document.getElementById('bc2_status').textContent = _('Status') + ': ' + _('Running') + '...';
	document.getElementById('bc2_log').value = '';
	document.getElementById('bc2_strategies').value = '';
	document.getElementById('bc2_strategies_section').style.display = 'none';
	_state.foundStrategies = [];
	_state.isRunning = true;

	fs.exec('/usr/bin/zapret2-testctl', ['stop', 'blockcheck']).catch(function() {}).then(function() {
		return fs.exec('/bin/mkdir', ['-p', '/tmp/zapret2']);
	}).then(function() {
		return fs.write(LOG_FILE, '');
	}).then(function() {
		return fs.write(STRATEGIES_FILE, '');
	}).then(function() {
		return fs.write(STATE_FILE, runState);
	}).then(function() {
		return fs.write(WRAPPER_FILE, wrapperContent);
	}).then(function() {
		return fs.exec('/bin/sh', ['-c', 'sh ' + WRAPPER_FILE + ' </dev/null >/dev/null 2>&1 &']);
	}).catch(function(err) {
		_state.isRunning = false;
		document.getElementById('btn_start').disabled = false;
		document.getElementById('btn_stop').disabled = true;
		document.getElementById('btn_clear').disabled = false;
		document.getElementById('bc2_status').textContent = _('Status') + ': ' + _('Error');
	});

	}); // end guard promise
}

function handleStop() {
	_state.isRunning = false;
	_state.stopping = true;
	// Write stop file, kill wrapper+blockcheck+nfqws; EXIT trap restarts zapret2
	// Bracket trick: blockcheck_r[u]n matches "blockcheck_run" but not itself in sh -c cmdline
	fs.write(STOP_FILE, '').then(function() {
		return fs.exec('/bin/sh', ['-c',
			'/usr/bin/zapret2-testctl stop blockcheck 2>/dev/null'
		]);
	}).then(function() {
		if (_state.wasRunning) {
			return main.callInitAction('zapret2', 'start');
		}
	}).then(function() {
		document.getElementById('btn_start').disabled = false;
		document.getElementById('btn_stop').disabled = true;
		document.getElementById('btn_clear').disabled = false;
		document.getElementById('bc2_status').textContent = _('Status') + ': ' + _('Stopped');
	}).catch(function() {
		document.getElementById('btn_start').disabled = false;
		document.getElementById('btn_stop').disabled = true;
		document.getElementById('btn_clear').disabled = false;
	});
}

function handleClear() {
	document.getElementById('bc2_log').value = '';
	document.getElementById('btn_start').disabled = false;
	document.getElementById('btn_stop').disabled = true;
	document.getElementById('bc2_status').textContent = _('Status') + ': ' + _('Ready');
	document.getElementById('bc2_strategies').value = '';
	document.getElementById('bc2_strategies_section').style.display = 'none';
	_state.isRunning = false;
	_state.stopping = false;
	_state.currentPage = 0;
	_state.totalLines = 0;
	_state.domainQueue = [];
	_state.killedDomains = {};
	_state.foundStrategies = [];
	fs.remove(LOG_FILE).catch(function() {});
	fs.remove(STRATEGIES_FILE).catch(function() {});
	fs.remove(WRAPPER_FILE).catch(function() {});
	fs.remove(STATE_FILE).catch(function() {});
	fs.remove(STATUS_FILE).catch(function() {});
	fs.remove(STOP_FILE).catch(function() {});
	fs.exec('/bin/sh', ['-c', 'rm -f /tmp/zapret2/log_*.txt']).catch(function() {});
}

function bindButtonEvents() {
	var btnStart = document.getElementById('btn_start');
	var btnStop = document.getElementById('btn_stop');
	var btnClear = document.getElementById('btn_clear');

	if (btnStart && !btnStart._bound) {
		btnStart._bound = true;
		btnStart.addEventListener('click', function(ev) {
			ev.preventDefault();
			handleStart();
		});
	}

	if (btnStop && !btnStop._bound) {
		btnStop._bound = true;
		btnStop.addEventListener('click', function(ev) {
			ev.preventDefault();
			handleStop();
		});
	}

	if (btnClear && !btnClear._bound) {
		btnClear._bound = true;
		btnClear.addEventListener('click', function(ev) {
			ev.preventDefault();
			handleClear();
		});
	}
}

function startPolling() {
	bindButtonEvents();

	restoreRunState().catch(function() {});

	_state.pollFn = function() {
		return Promise.all([
			fs.exec('/usr/bin/wc', ['-l', LOG_FILE]).then(function(res) {
				if (res && res.code === 0 && res.stdout) {
					var match = res.stdout.match(/^(\d+)/);
					return match ? parseInt(match[1], 10) : 0;
				}
				return 0;
			}).catch(function() { return 0; }),
			L.resolveDefault(fs.exec('/usr/bin/pgrep', ['-f', 'blockcheck_run']), null),
			L.resolveDefault(fs.exec('/usr/bin/pgrep', ['-f', 'blockcheck2.sh']), null),
			L.resolveDefault(fs.read(STATUS_FILE), ''),
			L.resolveDefault(fs.read(STATE_FILE), '')
		]).then(function(data) {
			var total = data[0] || 0;
			var wrapperRunning = data[1] !== null && data[1].code === 0;
			var scriptRunning = data[2] !== null && data[2].code === 0;
			var running = wrapperRunning || scriptRunning;
			var statusContent = (data[3] || '').trim();
			var state = parseRunState(data[4] || '');

			if (state) applyRunState(state);

			var domainReads = _state.domainQueue.map(function(d) {
				return fs.exec('/bin/grep', ['-E', ': nfqws2 |AVAILABLE|working without bypass', getDomainLogPath(d)])
					.then(function(res) { return { domain: d, content: (res && res.stdout) || '' }; })
					.catch(function() { return { domain: d, content: '' }; });
			});

			return Promise.all(domainReads).then(function(domainResults) {

				// Parse status file: "N/TOTAL domain"
				var statusMatch = statusContent.match(/^(\d+)\/(\d+)\s+(.+)/);
				var currentIdx = statusMatch ? parseInt(statusMatch[1]) : 0;
				var totalDomains = statusMatch ? parseInt(statusMatch[2]) : 0;
				var currentDomain = statusMatch ? statusMatch[3].trim() : '';

				// Parse strategies from per-domain log files
				var displayLines = [];
				var totalCount = 0;
				var allStrategies = [];
				var currentDomainStratCount = 0;

				for (var i = 0; i < domainResults.length; i++) {
					var r = domainResults[i];
					var parsed = parseStrategiesFromLog(r.content);
					var strats = parsed.strategies;
					var isWorkingBypass = r.content.indexOf('working without bypass') !== -1;

					if (r.domain === currentDomain) {
						currentDomainStratCount = strats.length;
					}

					if (strats.length === 0 && !isWorkingBypass) continue;

					if (displayLines.length > 0) displayLines.push('');

					if (isWorkingBypass && strats.length === 0) {
						displayLines.push(r.domain + ': working without bypass');
					} else {
						totalCount += strats.length;
						if (_state.domainQueue.length > 1) {
							displayLines.push(r.domain + ' (' + strats.length + '):');
						}
						for (var si = 0; si < strats.length; si++) {
							displayLines.push(strats[si]);
							if (allStrategies.indexOf(strats[si]) === -1)
								allStrategies.push(strats[si]);
						}
					}
				}

				if (displayLines.length > 0) {
					document.getElementById('bc2_strategies_section').style.display = 'block';
					document.getElementById('bc2_strategies').value = displayLines.join('\n');
					document.getElementById('bc2_strategies_count').textContent = totalCount;
					_state.foundStrategies = allStrategies;
					fs.write(STRATEGIES_FILE, displayLines.join('\n')).catch(function() {});
				}

				// Per-domain maxStrategies: kill blockcheck, wrapper auto-advances
				if (_state.autoCollect && currentDomain && !_state.killedDomains[currentDomain]) {
					if (currentDomainStratCount >= _state.maxStrategies) {
						_state.killedDomains[currentDomain] = true;
						fs.exec('/usr/bin/zapret2-testctl', ['stop', 'blockcheck']).catch(function() {});
						return;
					}
				}

				_state.totalLines = total;

				// Update button states based on actual runtime status.
				if (running && !_state.isRunning && !_state.stopping) {
					_state.isRunning = true;
					document.getElementById('btn_start').disabled = true;
					document.getElementById('btn_stop').disabled = false;
					document.getElementById('btn_clear').disabled = true;
				}

				if (running && _state.isRunning) {
					var statusMsg = _('Running') + '...';
					if (currentIdx > 0 && totalDomains > 1) {
						statusMsg += ' [' + currentDomain + ' - ' + currentIdx + '/' + totalDomains + ']';
					}
					document.getElementById('bc2_status').textContent = _('Status') + ': ' + statusMsg;
				} else if (!running && _state.stopping) {
					// Stopped by user — wrapper EXIT trap restarts zapret2
					_state.stopping = false;
				} else if (!running && _state.isRunning) {
					// Wrapper/script finished naturally — restart zapret2 if it was running
					_state.isRunning = false;
					if (_state.wasRunning) {
						main.callInitAction('zapret2', 'start');
					}
					document.getElementById('btn_start').disabled = false;
					document.getElementById('btn_stop').disabled = true;
					document.getElementById('btn_clear').disabled = false;
					document.getElementById('bc2_status').textContent = _('Status') + ': ' + _('Completed');
				}

				var textarea = document.getElementById('bc2_log');
				if (textarea && total > 0) {
					var autoScroll = document.getElementById('bc2_autoscroll');
					var savedScrollTop = textarea.scrollTop;
					return fs.exec('/usr/bin/tail', ['-n', String(PAGE_SIZE), LOG_FILE]).then(function(res) {
						var content = (res && res.code === 0 && res.stdout) ? res.stdout : '';
						textarea.value = content || '';
						if (autoScroll && autoScroll.checked === true) {
							textarea.scrollTop = textarea.scrollHeight;
						} else {
							textarea.scrollTop = savedScrollTop;
						}
					});
				}
			});
		});
	};

	_state.pollFn();
	poll.add(_state.pollFn, 2);
}

function renderBlockcheckUI() {
	var G = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px 12px;';

	function inp(id, value, width) {
		return E('input', { 'type': 'text', 'id': id, 'class': 'cbi-input-text', 'value': value, 'style': 'width: ' + (width || '80px') });
	}

	function sel(id, options, defaultVal) {
		var s = E('select', { 'id': id, 'class': 'cbi-input-select' });
		options.forEach(function(opt) {
			var o = E('option', { 'value': opt.value }, opt.label);
			if (opt.value === defaultVal) o.selected = true;
			s.appendChild(o);
		});
		return s;
	}

	function field(label, inputEl) {
		return E('span', { 'class': 'bc2-field' }, [
			E('span', {}, label), inputEl
		]);
	}

	function cb(id, label, checked) {
		return E('label', { 'class': 'bc2-checkbox' }, [
			E('input', { 'type': 'checkbox', 'id': id, 'checked': checked ? 'checked' : null }),
			' ' + label
		]);
	}

	function header(text) {
		return E('div', { 'style': 'font-weight: bold; font-size: 90%; padding: 8px 0 2px; grid-column: 1 / -1;' }, text);
	}

	function fullRow(children) {
		return E('div', { 'style': 'grid-column: 1 / -1;' }, Array.isArray(children) ? children : [children]);
	}

	var grid = E('div', { 'style': G }, [

		// Domain
		fullRow([
			E('div', { 'class': 'cbi-value-description' }, _('Domain to test (without https://)')),
			E('input', { 'type': 'text', 'id': 'bc2_domain', 'class': 'cbi-input-text', 'value': DEFAULT_DOMAIN, 'style': 'width: 100%;' })
		]),

		// Auto-collect
		header(_('Auto-collect Strategies')),
		cb('bc2_autocollect', _('Enable'), true),
		field(_('Limit') + ': ', sel('bc2_max_strategies', [
			{ value: '3', label: '3' }, { value: '5', label: '5' },
			{ value: '10', label: '10' }, { value: '15', label: '15' }
		], '5')),

		// Protocols
		header(_('Protocols')),
		cb('bc2_http', 'HTTP', false),
		cb('bc2_https_tls12', 'HTTPS TLS 1.2', true),
		cb('bc2_https_tls13', 'HTTPS TLS 1.3', false),
		cb('bc2_http3', 'HTTP3/QUIC', false),

		// Skip Tests
		header(_('Skip Tests')),
		cb('bc2_skip_dns', _('DNS Check'), false),
		cb('bc2_skip_ipblock', _('IP Block Check'), false),

		// Options
		header(_('Options')),
		cb('bc2_parallel', _('Parallel Execution'), true),
		cb('bc2_https_get', _('HTTPS GET Method'), false),
		cb('bc2_curl_k', _('Ignore Certs (-k)'), false),
		cb('bc2_curl_v', _('Verbose (-v)'), false),
		fullRow(field(_('CURL') + ': ', inp('bc2_curl_path', '', '100%'))),

		// TTL Settings
		header(_('TTL Settings (0 = disabled)')),
		field(_('TTL Min') + ': ', inp('bc2_min_ttl', '0')),
		field(_('TTL Max') + ': ', inp('bc2_max_ttl', '0')),
		field(_('Autottl Min') + ': ', inp('bc2_min_autottl', '0')),
		field(_('Autottl Max') + ': ', inp('bc2_max_autottl', '0')),

		// Scan Settings
		header(_('Scan Settings')),
		field(_('Filter L3') + ': ', sel('bc2_filter_l3', [
			{ value: '4', label: 'IPv4' },
			{ value: '6', label: 'IPv6' },
			{ value: '46', label: 'IPv4+IPv6' }
		], '4')),
		field(_('Timeout') + ': ', sel('bc2_timeout', [
			{ value: '1', label: '1s' },
			{ value: '1.5', label: '1.5s' }, { value: '2', label: '2s' },
			{ value: '2.5', label: '2.5s' }, { value: '3', label: '3s' }
		], '1.5')),
		field(_('Test') + ': ', sel('bc2_test_set', [
			{ value: 'standard', label: 'standard' },
			{ value: 'custom', label: 'custom' }
		], 'standard')),
		field(_('Level') + ': ', sel('bc2_scanlevel', [
			{ value: 'quick', label: 'quick' },
			{ value: 'standard', label: 'standard' },
			{ value: 'force', label: 'force' }
		], 'standard')),
		field(_('Repeats') + ': ', sel('bc2_repeats', [
			{ value: '1', label: '1' }, { value: '2', label: '2' },
			{ value: '3', label: '3' }, { value: '4', label: '4' }, { value: '5', label: '5' }
		], '1')),

		// PKTWS Extra
		header(_('PKTWS Extra')),
		fullRow([
			E('div', { 'style': 'display: flex; align-items: center; gap: 8px; margin-bottom: 5px;' }, [
				E('span', {}, 'PRE:'), inp('bc2_pktws_extra_pre', '', '100%')
			]),
			E('div', { 'style': 'display: flex; align-items: center; gap: 8px;' }, [
				E('span', {}, 'POST:'), inp('bc2_pktws_extra_post', '', '100%')
			]),
			E('div', { 'class': 'cbi-value-description', 'style': 'margin-top: 4px;' }, _('Extra nfqws params before/after strategy'))
		])
	]);

	return E('div', { 'class': 'cbi-section' }, [
		grid,

		E('div', { 'style': 'display: flex; flex-wrap: wrap; justify-content: space-between; gap: 5px; margin-top: 1em;' }, [
			E('div', {}, [
				E('button', {
					'type': 'button',
					'id': 'btn_start',
					'class': 'btn cbi-button cbi-button-action'
				}, _('Start Test')),
				' ',
				E('button', {
					'type': 'button',
					'id': 'btn_stop',
					'class': 'btn cbi-button cbi-button-reset',
					'disabled': 'disabled'
				}, _('Stop')),
				' ',
				E('button', {
					'type': 'button',
					'id': 'btn_clear',
					'class': 'btn cbi-button cbi-button-neutral'
				}, _('Clear Log'))
			]),
			E('div', { 'id': 'bc2_status', 'style': 'font-weight: bold;' }, _('Status') + ': ' + _('Ready'))
		]),

		E('div', { 'id': 'bc2_strategies_section', 'style': 'display: none; margin-top: 1.5em;' }, [
			E('h3', {}, _('Found Strategies')),
			E('div', { 'style': 'margin-bottom: 10px;' }, [
				E('span', { 'class': 'label label-success' }, [
					E('span', { 'id': 'bc2_strategies_count' }, '0'),
					' ' + _('strategies found')
				])
			]),
			E('textarea', {
				'id': 'bc2_strategies',
				'class': 'cbi-input-textarea',
				'readonly': 'readonly',
				'style': 'width: 100%; height: 150px; font-family: monospace; font-size: 12px;'
			}, '')
		]),

		E('div', { 'style': 'margin-top: 1.5em;' }, [
			E('h3', {}, _('Test Output')),
			E('div', { 'style': 'margin-bottom: 10px;' }, [
				E('label', { 'class': 'cbi-checkbox' }, [
					E('input', { 'type': 'checkbox', 'id': 'bc2_autoscroll', 'checked': 'checked' }),
					' ' + _('Auto-scroll')
				])
			]),
			E('textarea', {
				'id': 'bc2_log',
				'class': 'cbi-input-textarea',
				'readonly': 'readonly',
				'wrap': 'off',
				'style': 'width: 100%; height: 400px; font-family: monospace; font-size: 12px;'
			}, '')
		])
	]);
}

return baseclass.extend({
	createBlockcheckTab: function(map) {
		var s, o;

		// Use TypedSection with fake type for independent tab
		s = map.section(form.TypedSection, '_blockcheck_tab', _('Blockcheck2'));
		s.anonymous = true;
		s.addremove = false;
		s.cfgsections = function() { return ['_blockcheck']; };

		o = s.option(form.DummyValue, '_blockcheck_ui', ' ');
		o.rawhtml = true;
		o.cfgvalue = function() { return ''; };
		o.render = function() {
			setTimeout(startPolling, 100);
			return renderBlockcheckUI();
		};
	}
});

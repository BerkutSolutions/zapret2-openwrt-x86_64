'use strict';
'require baseclass';
'require form';
'require fs';
'require uci';
'require ui';
'require poll';
'require view.zapret2.main as main';
'require view.zapret2.service as service';
'require view.zapret2.logviewer as logviewer';

var LOG_FILE = '/tmp/zapret2/finder.log';
var RESULTS_FILE = '/tmp/zapret2/finder-results.log';
var WRAPPER_FILE = '/tmp/zapret2-finder_run.sh';
var STATUS_FILE = '/tmp/zapret2-finder.status';
var STOP_FILE = '/tmp/zapret2-finder.stop';
var LOG_PIPE = '/tmp/zapret2-finder.log.pipe';
var LOG_MAX_BYTES = 8 * 1024 * 1024;
var LOG_KEEP_BYTES = 6 * 1024 * 1024;
var FINDER_BIN = '/opt/zapret2/zapret2-finder';
var MAX_FINDER_BLOBS = 64;
var FINDER_DEFAULT_BLOBS = [
	'fake_default_http',
	'fake_default_tls',
	'fake_default_quic',
	'0x00000000',
	'0x1603'
];
var FINDER_PRESETS = {
	preset_youtube: 'youtube',
	preset_discord: 'discord',
	preset_twitch: 'twitch',
	preset_x: 'x',
	preset_instagram: 'instagram'
};

var _state = {
	isRunning: false,
	stopping: false,
	wasRunning: false,
	pollFn: null,
	topStrategies: []
};
var _searchLog = logviewer.create({ path: LOG_FILE, id: 'rf_log' });

var UCI_SECTION = 'finder';

// All finder form fields: [element_id, uci_key, default_value]
var FINDER_FIELDS = [
	['rf_mode', 'mode', 'builtin'],
	['rf_domains', 'domains', 'rutracker.org'],
	['rf_http', 'http', '0'],
	['rf_tls12', 'tls12', '1'],
	['rf_tls13', 'tls13', '0'],
	['rf_quic', 'quic', '0'],
	['rf_http_port', 'http_port', '80'],
	['rf_https_port', 'https_port', '443'],
	['rf_quic_port', 'quic_port', '443'],
	['rf_ipv', 'ipv', '4'],
	['rf_scanlevel', 'scanlevel', 'standard'],
	['rf_timeout', 'timeout', '10'],
	['rf_repeats', 'repeats', '1'],
	['rf_jobs', 'jobs', '8'],
	['rf_strategy_jobs', 'strategy_jobs', '4'],
	['rf_min_kb', 'min_kb', '0'],
	['rf_curl_get', 'curl_get', '0'],
	['rf_no_default_blob', 'no_default_blob', '0'],
	['rf_no_sni', 'no_sni', '0'],
	['rf_sni', 'sni', ''],
	['rf_no_fake', 'no_fake', '0'],
	['rf_no_multisplit', 'no_multisplit', '0'],
	['rf_no_oob', 'no_oob', '0'],
	['rf_no_seqovl', 'no_seqovl', '0'],
	['rf_no_syndata', 'no_syndata', '0'],
	['rf_no_faked', 'no_faked', '0'],
	['rf_no_hostfake', 'no_hostfake', '0'],
	['rf_no_tcpseg', 'no_tcpseg', '0'],
	['rf_no_wssize', 'no_wssize', '0'],
	['rf_combo_only', 'combo_only', '0'],
	['rf_combo_reverse', 'combo_reverse', '0'],
	['rf_no_combo_multi', 'no_combo_multi', '0'],
	['rf_no_combo_faked', 'no_combo_faked', '0'],
	['rf_no_combo_hostfake', 'no_combo_hostfake', '0'],
	['rf_no_combo_syndata', 'no_combo_syndata', '0'],
	['rf_no_combo_oob', 'no_combo_oob', '0'],
	['rf_no_combo_ackdrop', 'no_combo_ackdrop', '0'],
	['rf_no_combo_doublefake', 'no_combo_doublefake', '0'],
	['rf_no_combo_seqovl', 'no_combo_seqovl', '0'],
	['rf_no_combo_ipfrag', 'no_combo_ipfrag', '0'],
	['rf_no_md5', 'no_md5', '0'],
	['rf_no_badsum', 'no_badsum', '0'],
	['rf_no_seq', 'no_seq', '0'],
	['rf_no_ack', 'no_ack', '0'],
	['rf_no_ts', 'no_ts', '0'],
	['rf_no_flags', 'no_flags', '0'],
	['rf_no_ttl', 'no_ttl', '0'],
	['rf_no_autottl', 'no_autottl', '0'],
	['rf_fake_repeats', 'fake_repeats', '1'],
	['rf_max_found', 'max_found', '0'],
	['rf_verbose', 'verbose', '0'],
	['rf_debug', 'debug', '0'],
	['rf_simulate', 'simulate', '0'],
	['rf_extra_pre', 'extra_pre', ''],
	['rf_extra_post', 'extra_post', '']
];

function getFinderUCI(key, def) {
	return uci.get('zapret2', UCI_SECTION, key) || def;
}

function ensureFinderSection() {
	if (!uci.get('zapret2', UCI_SECTION))
		uci.add('zapret2', 'finder', UCI_SECTION);
}

function getFormValue(id) {
	var el = document.getElementById(id);
	if (!el) return null;
	if (el.type === 'checkbox') return el.checked ? '1' : '0';
	return el.value;
}

function shellEscape(str) {
	if (!str) return '';
	return str.replace(/[^a-zA-Z0-9._\-\/,:?=&#%@~ ]/g, '');
}

function shellQuote(str) {
	return "'" + String(str).replace(/'/g, "'\\''") + "'";
}

function getFinderBlobName(blob) {
	if (blob.finderValue) return blob.finderValue;
	var path = blob.path || '';
	return path.substring(path.lastIndexOf('/') + 1) || blob['.name'] || '';
}

function isFinderInlineBlobValue(value) {
	return /^0x(?:[0-9a-fA-F]{2})+$/.test(value);
}

function getSelectedFinderBlobs() {
	return L.toArray(uci.get('zapret2', UCI_SECTION, 'blob')).filter(function(name) {
		return !!name;
	}).slice(0, MAX_FINDER_BLOBS);
}

function getFinderBlobArgs(noDefaultBlob, selectedBlobs) {
	var args = [];
	if (noDefaultBlob) args.push('--no-default-blob');
	selectedBlobs.forEach(function(name) {
		args.push('--blob ' + shellQuote(name));
	});
	return args;
}

function generateWrapper(wasRunning) {
	var lines = ['#!/bin/sh'];
	lines.push('umask 0022');
	lines.push('mkdir -p /tmp/zapret2 || exit 1');
	lines.push('PIDFILE=/tmp/zapret2/finder.pid');
	lines.push('echo $$ > "$PIDFILE"');
	lines.push('STOP=' + STOP_FILE);
	lines.push('LOG=' + LOG_FILE);
	lines.push('LOG_PIPE=' + LOG_PIPE);
	lines.push('LOGGER_PID=');
	lines.push('rm -f "$STOP"');
	lines.push('');
	lines.push('WAS_RUNNING=' + (wasRunning ? '1' : '0'));
	lines.push('cleanup() { [ -n "$LOGGER_PID" ] && kill "$LOGGER_PID" 2>/dev/null; rm -f "$STOP" "$PIDFILE" "$LOG_PIPE" ' + STATUS_FILE + '.tmp; if [ "$WAS_RUNNING" = 1 ] && ! /etc/init.d/zapret2 status >/dev/null 2>&1; then /etc/init.d/zapret2 start; fi; }');
	lines.push('trap cleanup EXIT');
	lines.push('trap exit TERM INT');
	lines.push('log_sink() {');
	lines.push("\tawk -v logfile=\"$LOG\" -v max=" + LOG_MAX_BYTES + ' -v keep=' + LOG_KEEP_BYTES + " '");
	lines.push("\tfunction rotate(  cmd) {");
	lines.push("\t\tclose(logfile)");
	lines.push("\t\tcmd = \"tail -c \" keep \" \\\"\" logfile \"\\\" > \\\"\" logfile \".tmp\\\" && mv \\\"\" logfile \".tmp\\\" \\\"\" logfile \"\\\"\"");
	lines.push("\t\tsystem(cmd)");
	lines.push("\t\tprint \"[finder log rotated: keeping the last 6 MiB]\" >> logfile");
	lines.push("\t\tbytes = keep + 49");
	lines.push("\t}");
	lines.push("\t{");
	lines.push("\t\tprint $0 >> logfile");
	lines.push("\t\tfflush(logfile)");
	lines.push("\t\tbytes += length($0) + 1");
	lines.push("\t\tif (bytes >= max) rotate()");
	lines.push("\t}");
	lines.push("\tEND { close(logfile) }");
	lines.push("\t'");
	lines.push('}');
	lines.push('');

	var args = [];

	// Mode
	var mode = getFormValue('rf_mode');
	var _testStrategyScript = null;
	if (mode === 'test_strategy') {
		// Test strategy mode — script saved to file, path passed via --test-strategy
		var stratId = getFormValue('rf_test_strategy');
		if (stratId) {
			var script = uci.get('zapret2', stratId, 'script') || '';
			script = script.replace(/\\/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
			if (script) {
				_testStrategyScript = script;
				args.push('--test-strategy @/tmp/zapret2-finder-strategy.txt');
			}
			var hostfiles = (getFormValue('rf_test_hostfiles') || '').trim();
			if (hostfiles) {
				hostfiles.split(/\s+/).forEach(function(f) {
					if (f) args.push('-f ' + shellEscape(f));
				});
			}
		}
	} else {
		if (mode === 'builtin') {
			args.push('--builtin');
		}
		if (mode === 'tcp16') {
			args.push('--tcp16');
		}
		if (FINDER_PRESETS[mode]) {
			args.push('--preset ' + FINDER_PRESETS[mode]);
		}

		// Custom domains
		if (mode === 'domains') {
			var domainInput = (getFormValue('rf_domains') || '').trim();
			var domains = domainInput.split(/\s+/).filter(function(d) { return d.length > 0; });
			for (var i = 0; i < domains.length; i++)
				args.push('-d ' + shellEscape(domains[i]));
		}
	}

	// Protocols
	if (getFormValue('rf_http') !== '1') args.push('--no-http');
	if (getFormValue('rf_tls12') !== '1') args.push('--no-tls12');
	if (getFormValue('rf_tls13') === '1') args.push('--tls13');
	if (mode !== 'tcp16' && getFormValue('rf_quic') === '1') args.push('--quic');

	// Protocol ports
	var httpPort = (getFormValue('rf_http_port') || '').trim();
	if (mode !== 'tcp16' && httpPort && httpPort !== '80') args.push('--http-port ' + httpPort);
	var httpsPort = (getFormValue('rf_https_port') || '').trim();
	if (mode !== 'tcp16' && httpsPort && httpsPort !== '443') args.push('--https-port ' + httpsPort);
	var quicPort = (getFormValue('rf_quic_port') || '').trim();
	if (mode !== 'tcp16' && quicPort && quicPort !== '443') args.push('--quic-port ' + quicPort);

	// IPv
	var ipv = getFormValue('rf_ipv');
	if (mode === 'tcp16') args.push('-4');
	else if (ipv === '4') args.push('-4');
	else if (ipv === '6') args.push('-6');
	else if (ipv === '46') args.push('-46');

	// Scan level
	var level = getFormValue('rf_scanlevel');
	if (level && level !== 'standard') args.push('-s ' + level);

	// Timeout
	var timeout = getFormValue('rf_timeout');
	if (timeout && timeout !== '10') args.push('--timeout ' + timeout);

	// Repeats
	var repeats = getFormValue('rf_repeats');
	if (repeats && repeats !== '1') args.push('-r ' + repeats);

	// Jobs
	var jobs = (getFormValue('rf_jobs') || '').trim();
	if (jobs && jobs !== '8') args.push('--jobs ' + jobs);
	var strategyJobs = (getFormValue('rf_strategy_jobs') || '').trim();
	if (strategyJobs && strategyJobs !== '4') args.push('--strategy-jobs ' + strategyJobs);

	// Min KB
	var minKb = getFormValue('rf_min_kb');
	if (minKb && minKb !== '0' && minKb !== '') args.push('--min-kb ' + minKb);

	// HTTPS GET
	if (getFormValue('rf_curl_get') === '1') args.push('--curl-get');

	// Default blob policy and explicit allowlist
	args = args.concat(getFinderBlobArgs(
		getFormValue('rf_no_default_blob') === '1',
		getSelectedFinderBlobs()
	));

	// SNI
	if (getFormValue('rf_no_sni') === '1') args.push('--no-sni');
	var sni = shellEscape(getFormValue('rf_sni') || '').trim();
	if (sni) args.push('--sni ' + sni);

	// Fake repeats
	var fakeRepeats = (getFormValue('rf_fake_repeats') || '').trim();
	if (fakeRepeats && fakeRepeats !== '1') args.push('--fake-repeats ' + fakeRepeats);

	// Strategy groups
	if (getFormValue('rf_combo_reverse') === '1') args.push('--combo-reverse');
	if (getFormValue('rf_combo_only') === '1') {
		args.push('--combo-only');
	} else {
		if (getFormValue('rf_no_fake') === '1') args.push('--no-fake');
		if (getFormValue('rf_no_multisplit') === '1') args.push('--no-multisplit');
		if (getFormValue('rf_no_oob') === '1') args.push('--no-oob');
		if (getFormValue('rf_no_seqovl') === '1') args.push('--no-seqovl');
		if (getFormValue('rf_no_syndata') === '1') args.push('--no-syndata');
		if (getFormValue('rf_no_faked') === '1') args.push('--no-faked');
		if (getFormValue('rf_no_hostfake') === '1') args.push('--no-hostfake');
		if (getFormValue('rf_no_tcpseg') === '1') args.push('--no-tcpseg');
		if (getFormValue('rf_no_wssize') === '1') args.push('--no-wssize');
	}

	// Combo sub-groups
	if (getFormValue('rf_no_combo_multi') === '1') args.push('--no-combo-multi');
	if (getFormValue('rf_no_combo_faked') === '1') args.push('--no-combo-faked');
	if (getFormValue('rf_no_combo_hostfake') === '1') args.push('--no-combo-hostfake');
	if (getFormValue('rf_no_combo_syndata') === '1') args.push('--no-combo-syndata');
	if (getFormValue('rf_no_combo_oob') === '1') args.push('--no-combo-oob');
	if (getFormValue('rf_no_combo_ackdrop') === '1') args.push('--no-combo-ackdrop');
	if (getFormValue('rf_no_combo_doublefake') === '1') args.push('--no-combo-doublefake');
	if (getFormValue('rf_no_combo_seqovl') === '1') args.push('--no-combo-seqovl');
	if (getFormValue('rf_no_combo_ipfrag') === '1') args.push('--no-combo-ipfrag');

	// Fooling methods
	if (getFormValue('rf_no_md5') === '1') args.push('--no-md5');
	if (getFormValue('rf_no_badsum') === '1') args.push('--no-badsum');
	if (getFormValue('rf_no_seq') === '1') args.push('--no-seq');
	if (getFormValue('rf_no_ack') === '1') args.push('--no-ack');
	if (getFormValue('rf_no_ts') === '1') args.push('--no-ts');
	if (getFormValue('rf_no_flags') === '1') args.push('--no-flags');
	if (getFormValue('rf_no_ttl') === '1') args.push('--no-ttl');
	if (getFormValue('rf_no_autottl') === '1') args.push('--no-autottl');

	// Max found
	var maxFound = (getFormValue('rf_max_found') || '').trim();
	if (maxFound && maxFound !== '0') args.push('--max-found ' + maxFound);

	// Verbose / Simulate
	if (getFormValue('rf_verbose') === '1') args.push('--verbose');
	if (getFormValue('rf_debug') === '1') args.push('--debug');
	if (getFormValue('rf_simulate') === '1') args.push('--simulate');

	// Extra pre/post
	var extraPre = shellEscape(getFormValue('rf_extra_pre') || '').trim();
	if (extraPre) args.push('--extra-pre "' + extraPre + '"');
	var extraPost = shellEscape(getFormValue('rf_extra_post') || '').trim();
	if (extraPost) args.push('--extra-post "' + extraPost + '"');

	lines.push('echo "starting" > ' + STATUS_FILE);
	lines.push('> "$LOG"');
	lines.push('');

	// Write test strategy script to file if needed
	if (_testStrategyScript) {
		lines.push("cat > /tmp/zapret2-finder-strategy.txt << 'STRATEOF'");
		lines.push(_testStrategyScript);
		lines.push('STRATEOF');
		lines.push('');
	}

	lines.push('rm -f "$LOG_PIPE"');
	lines.push('mkfifo "$LOG_PIPE" || exit 1');
	lines.push('log_sink < "$LOG_PIPE" &');
	lines.push('LOGGER_PID=$!');
	lines.push(FINDER_BIN + ' ' + args.join(' ') + ' > "$LOG_PIPE" 2>&1');
	lines.push('FINDER_RC=$?');
	lines.push('wait "$LOGGER_PID"');
	lines.push('LOGGER_PID=');
	lines.push('rm -f "$LOG_PIPE"');
	lines.push('if [ -f "$STOP" ] || [ "$FINDER_RC" -eq 130 ]; then FINDER_STATUS=stopped; elif [ "$FINDER_RC" -eq 0 ]; then FINDER_STATUS=done; else FINDER_STATUS="error:$FINDER_RC"; fi');
	lines.push('echo "$FINDER_STATUS" > ' + STATUS_FILE + '.tmp && mv ' + STATUS_FILE + '.tmp ' + STATUS_FILE);

	// Cleanup strategy file
	if (_testStrategyScript) {
		lines.push('rm -f /tmp/zapret2-finder-strategy.txt');
	}

	return lines.join('\n');
}

function parseResultLine(line, order) {
	var m = line.trim().match(/^fixed=(\d+)\/(\d+)(?:\s+broken=(\d+)\/(\d+))?\s+(.+)$/);
	if (!m) return null;

	return {
		rank: order + 1,
		order: order,
		fixed: parseInt(m[1]),
		total: parseInt(m[2]),
		broken: m[3] ? parseInt(m[3]) : 0,
		baselineTotal: m[4] ? parseInt(m[4]) : 0,
		strategy: m[5].trim(),
		raw: line
	};
}

// Match finder TOP ordering and keep equal results deterministic.
function compareResults(a, b) {
	if ((a.broken === 0) !== (b.broken === 0)) return a.broken === 0 ? -1 : 1;
	if (a.fixed !== b.fixed) return b.fixed - a.fixed;
	if (a.broken !== b.broken) return a.broken - b.broken;
	if (a.strategy !== b.strategy) return a.strategy < b.strategy ? -1 : 1;
	return a.order - b.order;
}

// Parse current and legacy finder result formats.
function parseResultsLog(content) {
	if (!content) return [];
	var results = [];
	var lines = content.split('\n');
	for (var i = 0; i < lines.length; i++) {
		if (!lines[i].trim()) continue;
		var result = parseResultLine(lines[i], results.length);
		if (result) results.push(result);
	}
	results.sort(compareResults);
	for (var i = 0; i < results.length; i++) results[i].rank = i + 1;
	return results;
}

function sortResultsForDownload(content) {
	var trailingNewline = /\n$/.test(content);
	var lines = content.split('\n');
	var results = [];

	for (var i = 0; i < lines.length; i++) {
		if (!lines[i].trim()) continue;
		var result = parseResultLine(lines[i], results.length);
		if (!result) return content;
		results.push(result);
	}

	if (!results.length) return content;
	results.sort(compareResults);
	return results.map(function(result) { return result.raw; }).join('\n') +
		(trailingNewline ? '\n' : '');
}

function downloadFinderResults() {
	var button = document.getElementById('rf_download_results');
	if (button) button.disabled = true;

	return fs.read_direct(RESULTS_FILE).then(function(content) {
		if (!content)
			throw new Error(_('No Finder results available'));

		var blob = new Blob([sortResultsForDownload(content)], { 'type': 'text/plain;charset=utf-8' });
		var url = URL.createObjectURL(blob);
		var link = document.createElement('a');
		link.href = url;
		link.download = 'finder.log';
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(function() { URL.revokeObjectURL(url); }, 0);
	}).catch(function(err) {
		ui.addNotification(null, E('p', {}, err.message || _('Unable to download finder.log')), 'error');
	}).then(function() {
		if (button) button.disabled = _state.topStrategies.length === 0;
	});
}

function handleStart() {
	if (_state.isRunning) return;

	// Guard: check if wrapper or finder is already running
	document.getElementById('rf_btn_start').disabled = true;
	document.getElementById('rf_status').textContent = _('Status') + ': ' + _('Checking') + '...';

	Promise.all([
		L.resolveDefault(fs.exec('/usr/bin/pgrep', ['-f', 'zapret2-finder_run']), null),
		L.resolveDefault(fs.exec('/usr/bin/pgrep', ['-f', 'zapret2-finde[r]']), null)
	]).then(function(results) {
		var wrapperRunning = results[0] !== null && results[0].code === 0;
		var finderRunning = results[1] !== null && results[1].code === 0;
		if (wrapperRunning || finderRunning) {
			_state.isRunning = true;
			document.getElementById('rf_btn_stop').disabled = false;
			document.getElementById('rf_btn_clear').disabled = true;
			document.getElementById('rf_status').textContent = _('Status') + ': ' + _('Already running');
			return;
		}

	_state.stopping = false;
	_state.wasRunning = main.getProcessCount() > 0;
	_state.topStrategies = [];

	var wrapperContent = generateWrapper(_state.wasRunning);

	document.getElementById('rf_btn_stop').disabled = false;
	document.getElementById('rf_btn_clear').disabled = true;
	document.getElementById('rf_status').textContent = _('Status') + ': ' + _('Running') + '...';
	_searchLog.reset();
	document.getElementById('rf_top_section').style.display = 'none';
	document.getElementById('rf_top_body').innerHTML = '';
	document.getElementById('rf_download_results').disabled = true;
	_state.isRunning = true;

	fs.exec('/usr/bin/zapret2-testctl', ['stop', 'finder']).catch(function() {}).then(function() {
		return fs.exec('/bin/mkdir', ['-p', '/tmp/zapret2']);
	}).then(function() {
		return fs.write(LOG_FILE, '');
	}).then(function() {
		return fs.write(WRAPPER_FILE, wrapperContent);
	}).then(function() {
		return fs.exec('/bin/sh', ['-c', 'sh ' + WRAPPER_FILE + ' </dev/null >/dev/null 2>&1 &']);
	}).catch(function(err) {
		_state.isRunning = false;
		document.getElementById('rf_btn_start').disabled = false;
		document.getElementById('rf_btn_stop').disabled = true;
		document.getElementById('rf_btn_clear').disabled = false;
		document.getElementById('rf_status').textContent = _('Status') + ': ' + _('Error');
	});

	}); // end guard promise
}

function handleStop() {
	_state.isRunning = false;
	_state.stopping = true;

	fs.write(STOP_FILE, '').then(function() {
		return fs.exec('/bin/sh', ['-c',
			'/usr/bin/zapret2-testctl stop finder 2>/dev/null'
		]);
	}).then(function() {
		if (_state.wasRunning) {
			return main.callInitAction('zapret2', 'start');
		}
	}).then(function() {
		document.getElementById('rf_btn_start').disabled = false;
		document.getElementById('rf_btn_stop').disabled = true;
		document.getElementById('rf_btn_clear').disabled = false;
		document.getElementById('rf_status').textContent = _('Status') + ': ' + _('Stopped');
	}).catch(function() {
		document.getElementById('rf_btn_start').disabled = false;
		document.getElementById('rf_btn_stop').disabled = true;
		document.getElementById('rf_btn_clear').disabled = false;
	});
}

function handleClear() {
	_searchLog.reset();
	document.getElementById('rf_btn_start').disabled = false;
	document.getElementById('rf_btn_stop').disabled = true;
	document.getElementById('rf_status').textContent = _('Status') + ': ' + _('Ready');
	document.getElementById('rf_top_section').style.display = 'none';
	document.getElementById('rf_top_body').innerHTML = '';
	document.getElementById('rf_download_results').disabled = true;
	_state.isRunning = false;
	_state.stopping = false;
	_state.topStrategies = [];
	fs.remove(LOG_FILE).catch(function() {});
	fs.remove(RESULTS_FILE).catch(function() {});
	fs.remove(WRAPPER_FILE).catch(function() {});
	fs.remove(STATUS_FILE).catch(function() {});
	fs.remove(STOP_FILE).catch(function() {});
}

function bindButtonEvents() {
	var btnStart = document.getElementById('rf_btn_start');
	var btnStop = document.getElementById('rf_btn_stop');
	var btnClear = document.getElementById('rf_btn_clear');
	var btnDownload = document.getElementById('rf_download_results');

	if (btnStart && !btnStart._bound) {
		btnStart._bound = true;
		btnStart.addEventListener('click', function(ev) { ev.preventDefault(); handleStart(); });
	}
	if (btnStop && !btnStop._bound) {
		btnStop._bound = true;
		btnStop.addEventListener('click', function(ev) { ev.preventDefault(); handleStop(); });
	}
	if (btnClear && !btnClear._bound) {
		btnClear._bound = true;
		btnClear.addEventListener('click', function(ev) { ev.preventDefault(); handleClear(); });
	}
	if (btnDownload && !btnDownload._bound) {
		btnDownload._bound = true;
		btnDownload.addEventListener('click', function(ev) { ev.preventDefault(); downloadFinderResults(); });
	}
}

function updateModeVisibility() {
	var mode = getFormValue('rf_mode');
	var tcp16 = mode === 'tcp16';
	var domainGroup = document.getElementById('rf_domain_group');
	var strategyGroup = document.getElementById('rf_strategy_group');
	if (domainGroup) {
		domainGroup.style.display = mode === 'domains' ? 'block' : 'none';
	}
	if (strategyGroup) {
		strategyGroup.style.display = (mode === 'test_strategy') ? 'block' : 'none';
	}
	['rf_http_port', 'rf_https_port', 'rf_quic_port', 'rf_ipv', 'rf_min_kb',
		'rf_curl_get'].forEach(function(id) {
		var el = document.getElementById(id);
		if (el) el.disabled = tcp16;
	});
	var quic = document.getElementById('rf_quic');
	if (quic) quic.disabled = tcp16;
}

function renderTopTable(strategies) {
	var tbody = document.getElementById('rf_top_body');
	if (!tbody) return;
	tbody.innerHTML = '';

	for (var i = 0; i < strategies.length; i++) {
		var s = strategies[i];
		var tr = E('tr', {}, [
			E('td', { 'style': 'text-align: center; font-weight: bold;' }, '#' + s.rank),
			E('td', { 'style': 'text-align: center;' }, [
				E('span', { 'class': 'label label-success' }, s.fixed + '/' + s.total)
			]),
			E('td', { 'style': 'text-align: center;' }, [
				E('span', { 'class': s.broken > 0 ? 'label label-danger' : 'label' },
					s.broken + '/' + s.baselineTotal)
			]),
			E('td', { 'style': 'font-family: monospace; font-size: 12px; word-break: break-all;' }, s.strategy)
		]);
		tbody.appendChild(tr);
	}
}

function startPolling() {
	bindButtonEvents();
	updateModeVisibility();

	var modeSelect = document.getElementById('rf_mode');
	if (modeSelect && !modeSelect._bound) {
		modeSelect._bound = true;
		modeSelect.addEventListener('change', updateModeVisibility);
	}

	_state.pollFn = function() {
		return Promise.all([
			L.resolveDefault(fs.exec('/usr/bin/pgrep', ['-f', 'zapret2-finder_run']), null),
			L.resolveDefault(fs.exec('/usr/bin/zapret2-testctl', ['status', 'finder']), null),
			L.resolveDefault(fs.read(STATUS_FILE), '')
		]).then(function(data) {
			// An expired LuCI session rejects RPC calls. Do not mistake an
			// unknown process state for a completed Finder run.
			if (data[0] === null || data[1] === null)
				return;

			var wrapperRunning = data[0] !== null && data[0].code === 0;
			var finderRunning = data[1] !== null && data[1].code === 0;
			var statusContent = (data[2] || '').trim();

			if ((wrapperRunning || finderRunning) && !_state.isRunning && !_state.stopping) {
				_state.isRunning = true;
				document.getElementById('rf_btn_start').disabled = true;
				document.getElementById('rf_btn_stop').disabled = false;
				document.getElementById('rf_btn_clear').disabled = true;
			}

			var anyRunning = wrapperRunning || finderRunning;

			if (anyRunning && _state.isRunning) {
				document.getElementById('rf_status').textContent = _('Status') + ': ' + _('Running') + '...';
			} else if (!anyRunning && _state.stopping) {
				_state.stopping = false;
			} else if (!anyRunning && _state.isRunning) {
				_state.isRunning = false;

				document.getElementById('rf_btn_start').disabled = false;
				document.getElementById('rf_btn_stop').disabled = true;
				document.getElementById('rf_btn_clear').disabled = false;
				var finalLabel = statusContent === 'done' ? _('Completed') :
					(statusContent === 'stopped' ? _('Stopped') : _('Error'));
				document.getElementById('rf_status').textContent = _('Status') + ': ' + finalLabel;
			} else if (!anyRunning && !_state.stopping && statusContent) {
				var savedLabel = statusContent === 'done' ? _('Completed') :
					(statusContent === 'stopped' ? _('Stopped') : _('Error'));
				document.getElementById('rf_status').textContent = _('Status') + ': ' + savedLabel;
			}

			// Read the Finder result log from the shared zapret2 log directory.
			return _searchLog.refresh().then(function() {
				return L.resolveDefault(fs.read(RESULTS_FILE), '');
			}).then(function(resultsContent) {
				var top = parseResultsLog(resultsContent);
				var downloadButton = document.getElementById('rf_download_results');
				if (downloadButton) downloadButton.disabled = top.length === 0;
				if (top.length > 0 && top.length !== _state.topStrategies.length) {
					_state.topStrategies = top;
					document.getElementById('rf_top_section').style.display = 'block';
					document.getElementById('rf_top_count').textContent = top.length;
					renderTopTable(top);
				}
			});
		});
	};

	_state.pollFn();
	poll.add(_state.pollFn, 2);
}

function renderFinderUI() {
	ensureFinderSection();
	var G4 = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 6px 12px; max-width: 100%;';

	// Lookup UCI key for a form element id
	function _uciKey(id) {
		for (var i = 0; i < FINDER_FIELDS.length; i++)
			if (FINDER_FIELDS[i][0] === id) return FINDER_FIELDS[i][1];
		return null;
	}
	function _uciVal(id, fallback) {
		var key = _uciKey(id);
		return key ? getFinderUCI(key, fallback) : (fallback || '');
	}

	function sel(id, options, defaultVal) {
		var saved = _uciVal(id, defaultVal);
		var uciKey = _uciKey(id);
		var s = E('select', { 'id': id, 'class': 'cbi-input-select',
			'change': function() { if (uciKey) uci.set('zapret2', UCI_SECTION, uciKey, this.value); }
		});
		options.forEach(function(opt) {
			var o = E('option', { 'value': opt.value }, opt.label);
			if (opt.value === saved) o.selected = true;
			s.appendChild(o);
		});
		return s;
	}

	function cb(id, label, defChecked) {
		var saved = _uciVal(id, defChecked ? '1' : '0');
		var uciKey = _uciKey(id);
		return E('label', { 'class': 'bc2-checkbox' }, [
			E('input', { 'type': 'checkbox', 'id': id, 'checked': saved === '1' ? 'checked' : null,
				'change': function() { if (uciKey) uci.set('zapret2', UCI_SECTION, uciKey, this.checked ? '1' : '0'); }
			}),
			' ' + label
		]);
	}

	function inp(id, defaultVal, style) {
		var uciKey = _uciKey(id);
		return E('input', { 'type': 'text', 'id': id, 'class': 'cbi-input-text',
			'value': _uciVal(id, defaultVal), 'style': style || '',
			'change': function() { if (uciKey) uci.set('zapret2', UCI_SECTION, uciKey, this.value); }
		});
	}

	function field(label, inputEl) {
		return E('span', { 'class': 'bc2-field' }, [
			E('span', {}, label), inputEl
		]);
	}

	function header(text) {
		return E('div', { 'style': 'font-weight: bold; font-size: 90%; padding: 8px 0 2px; grid-column: 1 / -1;' }, text);
	}

	function blobSelector() {
		var selected = getSelectedFinderBlobs();
		var selectedMap = {};
		selected.forEach(function(name) { selectedMap[name] = true; });
		var customValues = selected.filter(function(name) {
			return isFinderInlineBlobValue(name) && FINDER_DEFAULT_BLOBS.indexOf(name) < 0;
		});
		var countLabel = E('span', { 'class': 'label' },
			selected.length + '/' + MAX_FINDER_BLOBS);
		var button = E('button', {
			'type': 'button',
			'class': 'btn cbi-button',
			'click': function(ev) {
				ev.preventDefault();
				var customInput = E('input', {
					'type': 'text',
					'class': 'cbi-input-text',
					'value': customValues.join(' '),
					'placeholder': '0x1606 0xAABBCCDD',
					'style': 'width: 100%; max-width: 420px;'
				});
				service.showBlobsModal({
					title: _('Search blob'),
					description: [
						E('p', {}, _('With no selection Finder uses its default blobs. A non-empty selection is a strict allowlist.')),
						E('label', {}, [
							_('Custom inline blobs (space-separated)') + ': ', customInput
						])
					],
					showPath: false,
					extraBlobs: FINDER_DEFAULT_BLOBS.map(function(name, index) {
						return { '.name': '__finder_builtin_' + index, finderValue: name };
					}),
					displayName: getFinderBlobName,
					isSelected: function(blob) {
						return !!selectedMap[getFinderBlobName(blob)];
					},
					maxSelected: MAX_FINDER_BLOBS,
					onSave: function(blobs) {
						var custom = customInput.value.trim()
							? customInput.value.trim().split(/\s+/) : [];
						if (custom.some(function(value) { return !isFinderInlineBlobValue(value); })) {
							ui.addNotification(null, E('p', {},
								_('Custom blobs must use complete hexadecimal bytes, for example 0x1606.')), 'warning');
							return false;
						}
						var names = blobs.map(getFinderBlobName).concat(custom).filter(function(name, index, all) {
							return all.indexOf(name) === index;
						});
						if (names.length > MAX_FINDER_BLOBS) {
							ui.addNotification(null, E('p', {},
								_('You can select at most %d blobs.').replace('%d', MAX_FINDER_BLOBS)), 'warning');
							return false;
						}
						selectedMap = {};
						names.forEach(function(name) { selectedMap[name] = true; });
						customValues = custom;
						if (names.length)
							uci.set('zapret2', UCI_SECTION, 'blob', names);
						else
							uci.unset('zapret2', UCI_SECTION, 'blob');
						countLabel.textContent = names.length + '/' + MAX_FINDER_BLOBS;
						return true;
					}
				});
			}
		}, _('Select'));

		return E('span', {
			'class': 'bc2-field',
			'style': 'display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px;'
		}, [
			E('span', {}, _('Search blob') + ': '), countLabel, button
		]);
	}

	var grid = E('div', { 'style': G4 }, [

		// Mode
		E('div', { 'style': 'grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px 24px; align-items: center;' }, [
			field(_('Mode') + ': ', sel('rf_mode', [
				{ value: 'builtin', label: _('Builtin hosts') + ' (33)' },
				{ value: 'preset_youtube', label: _('YouTube preset') + ' (3)' },
				{ value: 'preset_discord', label: _('Discord preset') + ' (3)' },
				{ value: 'preset_twitch', label: _('Twitch preset') + ' (3)' },
				{ value: 'preset_x', label: _('X preset') + ' (3)' },
				{ value: 'preset_instagram', label: _('Instagram preset') + ' (2)' },
				{ value: 'tcp16', label: _('TCP 16-20KB candidates') + ' (110)' },
				{ value: 'domains', label: _('Custom domains') },
				{ value: 'test_strategy', label: _('Test strategy') }
			], 'builtin')),
			blobSelector()
		]),
		E('div', { 'id': 'rf_strategy_group', 'style': 'display: none; grid-column: 1 / -1;' }, [
			(function() {
				var strategies = uci.sections('zapret2', 'strategy') || [];
				var stratSel = E('select', { 'id': 'rf_test_strategy', 'class': 'cbi-input-select', 'style': 'margin-right: 12px;',
					'change': function() {
						var sid = this.value;
						var domainEl = document.getElementById('rf_test_hostfiles');
						if (!sid || !domainEl) { if (domainEl) domainEl.value = ''; return; }
						// Read hostlist paths (exclude hostlist_exclude)
						var hostlists = L.toArray(uci.get('zapret2', sid, 'hostlist'));
						var paths = [];
						hostlists.forEach(function(listName) {
							var path = uci.get('zapret2', listName, 'path');
							if (path) paths.push(path);
						});
						// Add autohostlist file if enabled
						if (uci.get('zapret2', sid, 'autohostlist') === '1') {
							paths.push('/opt/zapret2/ipset/zapret_hosts_auto.txt');
						}
						domainEl.value = paths.join(' ');
					}
				});
				stratSel.appendChild(E('option', { 'value': '' }, '-- ' + _('Select strategy') + ' --'));
				// Filter: skip strategies without hostlist/autohostlist, with --new or orchestration
				strategies.forEach(function(s) {
					var script = s.script || '';
					if (script.indexOf('--new') !== -1) return;
					if (script.indexOf('strategy=') !== -1) return;
					var hostlists = L.toArray(s.hostlist);
					var hasAutohostlist = s.autohostlist === '1';
					if (hostlists.length === 0 && !hasAutohostlist) return;
					var enabled = s.enabled !== '0';
					var listCount = hostlists.length + (hasAutohostlist ? 1 : 0);
					var label = s['.name'] + ' (' + listCount + ' list' + (listCount > 1 ? 's' : '') + ')';
					if (!enabled) label += ' [' + _('Disabled') + ']';
					stratSel.appendChild(E('option', { 'value': s['.name'] }, label));
				});
				return E('div', { 'style': 'display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center;' }, [
					field(_('Strategy') + ': ', stratSel),
					E('span', { 'class': 'bc2-field', 'style': 'flex: 1; min-width: 200px;' }, [
						E('span', {}, _('Hostlist files') + ': '),
						E('input', { 'type': 'text', 'id': 'rf_test_hostfiles', 'class': 'cbi-input-text',
							'value': '', 'style': 'flex: 1; width: 100%;', 'readonly': 'readonly' })
					])
				]);
			})()
		]),
		E('div', { 'id': 'rf_domain_group', 'style': 'display: none; grid-column: 1 / -1;' }, [
			inp('rf_domains', 'rutracker.org', 'width: 100%;')
		]),

		// Protocols header + 4-col fixed grid
		header(_('Protocols')),
		E('div', { 'style': 'grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 12px;' }, [
			cb('rf_http', 'HTTP', false),
			cb('rf_tls12', 'HTTPS TLS 1.2', true),
			cb('rf_tls13', 'HTTPS TLS 1.3', false),
			cb('rf_quic', 'HTTP3/QUIC', false),
			field(_('port') + ': ', inp('rf_http_port', '80', 'width: 60px;')),
			field(_('port') + ': ', inp('rf_https_port', '443', 'width: 60px;')),
			E('div', {}),
			field(_('port') + ': ', inp('rf_quic_port', '443', 'width: 60px;'))
		]),

		// Scan settings header
		header(_('Scan Settings')),
		field(_('IPv') + ': ', sel('rf_ipv', [
			{ value: '4', label: 'IPv4' },
			{ value: '6', label: 'IPv6' },
			{ value: '46', label: 'IPv4+IPv6' }
		], '4')),
		field(_('Level') + ': ', sel('rf_scanlevel', [
			{ value: 'quick', label: 'quick' },
			{ value: 'standard', label: 'standard' },
			{ value: 'force', label: 'force' }
		], 'standard')),
		field(_('Timeout') + ': ', sel('rf_timeout', [
			{ value: '5', label: '5s' }, { value: '7', label: '7s' },
			{ value: '10', label: '10s' }, { value: '15', label: '15s' },
			{ value: '20', label: '20s' }
		], '10')),
		field(_('Repeats') + ': ', sel('rf_repeats', [
			{ value: '1', label: '1' }, { value: '2', label: '2' },
			{ value: '3', label: '3' }, { value: '4', label: '4' }, { value: '5', label: '5' }
		], '1')),
		field(_('Target jobs') + ': ', inp('rf_jobs', '8', 'width: 60px;')),
		field(_('Strategy jobs') + ': ', inp('rf_strategy_jobs', '4', 'width: 60px;')),
		field(_('Min KB') + ': ', inp('rf_min_kb', '0', 'width: 60px;')),
		field(_('Max found') + ': ', inp('rf_max_found', '0', 'width: 60px;')),

		// Options header
		header(_('Options')),
		cb('rf_curl_get', _('HTTPS GET'), false),
		cb('rf_no_default_blob', _('Skip default blob'), false),
		cb('rf_verbose', _('Verbose'), false),
		cb('rf_debug', _('Debug nfqws2 logs'), false),
		cb('rf_simulate', _('Simulate'), false),
		cb('rf_no_sni', _('No SNI probe'), false),
		field(_('SNI') + ': ', inp('rf_sni', '', 'width: 120px;')),
		field(_('Fake repeats') + ': ', inp('rf_fake_repeats', '1', 'width: 60px;')),
		field(_('Extra PRE') + ': ', inp('rf_extra_pre', '', 'width: 200px;')),
		field(_('Extra POST') + ': ', inp('rf_extra_post', '', 'width: 200px;')),

		// Strategy groups header
		header(_('Strategy Groups — check to DISABLE')),
		cb('rf_no_fake', 'fake+TTL', false),
		cb('rf_no_multisplit', 'multisplit', false),
		cb('rf_no_oob', 'OOB', false),
		cb('rf_no_seqovl', 'seqovl', false),
		cb('rf_no_syndata', 'syndata', false),
		cb('rf_no_faked', 'fakedsplit', false),
		cb('rf_no_hostfake', 'hostfake', false),
		cb('rf_no_tcpseg', 'tcpseg', false),
		cb('rf_no_wssize', 'wssize', false),

		// Combo strategies
		header(_('Combo Strategies')),
		cb('rf_combo_only', _('Combo only (disable all standalone)'), false),
		cb('rf_combo_reverse', _('Combo reverse (split first, then fake)'), false),
		cb('rf_no_combo_multi', _('Disable') + ' fake+multisplit/multidisorder', false),
		cb('rf_no_combo_faked', _('Disable') + ' fake+fakedsplit/fakeddisorder', false),
		cb('rf_no_combo_hostfake', _('Disable') + ' fake+hostfakesplit', false),
		cb('rf_no_combo_syndata', _('Disable') + ' syndata+split/disorder/fake', false),
		cb('rf_no_combo_oob', _('Disable') + ' oob+multisplit', false),
		cb('rf_no_combo_ackdrop', _('Disable') + ' fake+pktmod ackdrop', false),
		cb('rf_no_combo_doublefake', _('Disable') + ' double fake', false),
		cb('rf_no_combo_seqovl', _('Disable') + ' seqovl+tcpseg/drop', false),
		cb('rf_no_combo_ipfrag', _('Disable') + ' fake+ipfrag+drop (QUIC)', false),

		// Fooling methods header
		header(_('Fooling Methods — check to DISABLE')),
		cb('rf_no_md5', 'tcp_md5', false),
		cb('rf_no_badsum', 'badsum', false),
		cb('rf_no_seq', 'tcp_seq', false),
		cb('rf_no_ack', 'tcp_ack', false),
		cb('rf_no_ts', 'tcp_ts', false),
		cb('rf_no_flags', 'tcp_flags', false),
		cb('rf_no_ttl', 'TTL', false),
		cb('rf_no_autottl', 'autottl', false)
	]);

	return E('div', { 'class': 'cbi-section' }, [
		grid,

		// Buttons + status
		E('div', { 'style': 'display: flex; flex-wrap: wrap; justify-content: space-between; gap: 5px; margin-top: 1em;' }, [
			E('div', {}, [
				E('button', {
					'type': 'button',
					'id': 'rf_btn_start',
					'class': 'btn cbi-button cbi-button-action'
				}, _('Start Test')),
				' ',
				E('button', {
					'type': 'button',
					'id': 'rf_btn_stop',
					'class': 'btn cbi-button cbi-button-reset',
					'disabled': 'disabled'
				}, _('Stop')),
				' ',
				E('button', {
					'type': 'button',
					'id': 'rf_btn_clear',
					'class': 'btn cbi-button cbi-button-neutral'
				}, _('Clear Log'))
			]),
			E('div', { 'id': 'rf_status', 'style': 'font-weight: bold;' }, _('Status') + ': ' + _('Ready'))
		]),

		// TOP strategies table
		E('div', { 'id': 'rf_top_section', 'style': 'display: none; margin-top: 1.5em;' }, [
			E('h3', {}, _('TOP Strategies')),
			E('div', { 'style': 'margin-bottom: 10px;' }, [
				E('span', { 'class': 'label label-success' }, [
					E('span', { 'id': 'rf_top_count' }, '0'),
					' ' + _('strategies')
				]),
				' ',
				E('button', {
					'type': 'button',
					'id': 'rf_download_results',
					'class': 'btn cbi-button cbi-button-neutral',
					'disabled': 'disabled'
				}, _('Download finder.log'))
			]),
			E('table', { 'class': 'table', 'style': 'width: 100%;' }, [
				E('thead', {}, [
					E('tr', {}, [
						E('th', { 'style': 'width: 40px;' }, '#'),
						E('th', { 'style': 'width: 70px;' }, _('Fixed')),
						E('th', { 'style': 'width: 70px;' }, _('Broken')),
						E('th', {}, _('Strategy'))
					])
				]),
				E('tbody', { 'id': 'rf_top_body' })
			])
		]),

		// Log output
		E('div', { 'style': 'margin-top: 1.5em;' }, [
			E('h3', {}, _('Test Output')),
			_searchLog.render()
		])
	]);
}

return baseclass.extend({
	createFinderTab: function(map) {
		var s, o;

		s = map.section(form.TypedSection, '_finder_tab', _('Finder'));
		s.anonymous = true;
		s.addremove = false;
		s.cfgsections = function() { return ['_finder']; };

		o = s.option(form.DummyValue, '_finder_ui', ' ');
		o.rawhtml = true;
		o.cfgvalue = function() { return ''; };
		o.render = function() {
			setTimeout(startPolling, 100);
			return renderFinderUI();
		};
	}
});

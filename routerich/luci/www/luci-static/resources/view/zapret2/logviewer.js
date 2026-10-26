'use strict';
'require baseclass';
'require fs';

var DEFAULT_INITIAL_LINES = 200;
var DEFAULT_TAIL_LINES = 50;
var DEFAULT_RENDERED_LINES = 2000;

function splitLogLines(content) {
	return String(content || '').replace(/\033\[[0-9;]*m/g, '').split('\n').filter(function(line) {
		return line.trim().length > 0;
	});
}

function findTailOverlap(previous, current) {
	var max = Math.min(previous.length, current.length);
	for (var length = max; length > 0; length--) {
		var matches = true;
		for (var i = 0; i < length; i++) {
			if (previous[previous.length - length + i] !== current[i]) {
				matches = false;
				break;
			}
		}
		if (matches) return length;
	}
	return 0;
}

function createLogViewer(options) {
	if (!options || !options.path)
		throw new Error('log viewer path is required');

	var initialLines = options.initialLines || DEFAULT_INITIAL_LINES;
	var tailLines = options.tailLines || DEFAULT_TAIL_LINES;
	var renderedLines = options.renderedLines || DEFAULT_RENDERED_LINES;
	var state = {
		container: null,
		tail: [],
		loaded: false,
		inflight: false,
		epoch: 0
	};

	function placeholder() {
		return E('em', { 'class': 'zapret2-log-placeholder' },
			options.placeholder || _('Waiting for output...'));
	}

	function reset() {
		state.epoch++;
		state.tail = [];
		state.loaded = false;
		state.inflight = false;
		if (state.container)
			state.container.replaceChildren(placeholder());
	}

	function append(lines) {
		if (!lines.length || !state.container) return;

		var empty = state.container.querySelector('.zapret2-log-placeholder');
		if (empty) empty.remove();

		var atBottom = (state.container.scrollHeight - state.container.scrollTop -
			state.container.clientHeight) < 40;
		for (var i = 0; i < lines.length; i++) {
			state.container.appendChild(E('div', {
				'class': 'zapret2-log-line'
			}, lines[i]));
		}

		while (state.container.childNodes.length > renderedLines)
			state.container.removeChild(state.container.firstChild);

		if (atBottom)
			state.container.scrollTop = state.container.scrollHeight;
	}

	function refresh() {
		var container = state.container;
		if (!container || state.inflight)
			return Promise.resolve();

		var epoch = state.epoch;
		var lineCount = state.loaded ? tailLines : initialLines;
		state.inflight = true;

		return fs.exec('/usr/bin/tail', ['-n', String(lineCount), options.path]).then(function(res) {
			if (epoch !== state.epoch || container !== state.container)
				return;
			if (!res || res.code !== 0)
				return;

			var lines = splitLogLines(res.stdout || '');
			if (!state.loaded) {
				if (!lines.length) return;
				state.loaded = true;
				state.tail = lines;
				append(lines);
				container.scrollTop = container.scrollHeight;
				return;
			}

			if (!lines.length) return;
			var startIdx = findTailOverlap(state.tail, lines);
			state.tail = lines;
			if (startIdx >= lines.length) return;

			append(lines.slice(startIdx));
		}).catch(function() {
			// The next refresh retries transient read errors.
		}).then(function() {
			if (epoch === state.epoch)
				state.inflight = false;
		});
	}

	function render() {
		var attrs = { 'class': 'zapret2-log-viewer' };
		if (options.id) attrs.id = options.id;
		state.container = E('div', attrs);
		reset();
		return state.container;
	}

	return {
		render: render,
		reset: reset,
		refresh: refresh,
		scrollToHead: function() {
			if (state.container) state.container.scrollTop = 0;
		},
		scrollToTail: function() {
			if (state.container) state.container.scrollTop = state.container.scrollHeight;
		}
	};
}

return baseclass.extend({
	create: createLogViewer
});

/* 质量面板、分片时间线、诊断建议。数据来自 StreamPlay，不另发请求。 */
(function () {
    'use strict';

    var core = window.StreamCore;
    if (!core) return;

    var tabs = document.querySelectorAll('.insp-tab');
    var panes = document.querySelectorAll('.insp-pane');
    var metricsEl = document.getElementById('quality-metrics');
    var variantsEl = document.getElementById('live-variants');
    var spark = document.getElementById('bw-spark');
    var sparkNow = document.getElementById('spark-now');
    var timeline = document.getElementById('seg-timeline');
    var tlMeta = document.getElementById('tl-meta');
    var tlLegend = document.getElementById('tl-legend');
    var adviceEl = document.getElementById('advice-card');
    var errorLogEl = document.getElementById('error-log');
    var moreBtn = document.getElementById('ctrl-more');
    var secondary = document.getElementById('ctrl-secondary');
    var llToggle = document.getElementById('ll-toggle');
    var samples = [];
    var seenError = 0;

    function show(name) {
        for (var i = 0; i < tabs.length; i++) {
            var on = tabs[i].getAttribute('data-pane') === name;
            tabs[i].classList.toggle('is-on', on);
            tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
        }
        for (var j = 0; j < panes.length; j++) {
            var match = panes[j].getAttribute('data-pane') === name;
            panes[j].hidden = !match;
            panes[j].classList.toggle('is-on', match);
        }
        if (name === 'share' && window.StreamPlay && window.StreamPlay.refreshEmbed) {
            window.StreamPlay.refreshEmbed();
        }
        if (name === 'timeline' || name === 'quality') draw();
    }

    for (var t = 0; t < tabs.length; t++) {
        tabs[t].addEventListener('click', function (e) {
            show(e.currentTarget.getAttribute('data-pane'));
        });
    }
    var jumpers = document.querySelectorAll('[data-pane-jump]');
    for (var jn = 0; jn < jumpers.length; jn++) {
        jumpers[jn].addEventListener('click', function (e) {
            e.preventDefault();
            show(e.currentTarget.getAttribute('data-pane-jump'));
            var insp = document.getElementById('inspector');
            if (insp && insp.scrollIntoView) insp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }

    if (moreBtn && secondary) {
        moreBtn.addEventListener('click', function () {
            var open = secondary.classList.toggle('is-open');
            moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            moreBtn.textContent = open ? '收起' : '更多';
        });
    }

    if (llToggle && window.StreamPlay && window.StreamPlay.setLowLatency) {
        try { llToggle.checked = localStorage.getItem('streamplay:ll') === '1'; } catch (e) { /* ignore */ }
        llToggle.addEventListener('change', function () {
            window.StreamPlay.setLowLatency(llToggle.checked);
        });
    }

    function metric(label, value, hint) {
        var el = document.createElement('div');
        el.className = 'metric';
        var k = document.createElement('span');
        k.className = 'metric-k';
        k.textContent = label;
        var v = document.createElement('strong');
        v.className = 'metric-v';
        v.textContent = value;
        el.appendChild(k);
        el.appendChild(v);
        if (hint) {
            var h = document.createElement('span');
            h.className = 'metric-h';
            h.textContent = hint;
            el.appendChild(h);
        }
        return el;
    }

    function renderMetrics(state) {
        if (!metricsEl) return;
        metricsEl.replaceChildren();
        if (!state || !state.url) {
            metricsEl.appendChild(metric('等待播放', '还没有流', '点播放之后，带宽、缓冲和丢帧会显示在这里'));
            return;
        }
        var res = state.videoWidth ? (state.videoWidth + '×' + state.videoHeight) : '—';
        metricsEl.appendChild(metric('画面', res, state.engineLabel || ''));
        metricsEl.appendChild(metric('当前码率', core.formatBitrate(state.bitrate), state.auto ? '自动切换' : '手动锁定'));
        var bwLabel = core.formatBitrate(state.bandwidth);
        var bwHint = '按最近下载估算，不是片源码率';
        if (state.bandwidth > 8e7) {
            bwLabel = '≥ 80 Mbps';
            bwHint = '下载很快，已经超过刻度';
        }
        metricsEl.appendChild(metric('估算带宽', bwLabel, bwHint));
        var buf = state.bufferAhead == null ? '—' : state.bufferAhead.toFixed(1) + ' 秒';
        var bufHint = '开始播放后才会有数';
        if (state.bufferAhead != null) {
            if (state.bufferAhead < 2) bufHint = '偏少，容易顿一下';
            else if (state.bufferAhead < 12) bufHint = '够播一小段';
            else bufHint = '缓冲充足';
        }
        metricsEl.appendChild(metric('前方缓冲', buf, bufHint));
        var drop = '—';
        if (state.totalFrames) {
            var pct = state.totalFrames ? (100 * state.dropped / state.totalFrames) : 0;
            drop = state.dropped + ' / ' + state.totalFrames;
            metricsEl.appendChild(metric('丢帧', drop, pct >= 2 ? '偏多，机器或解码吃力' : '正常范围'));
        } else {
            metricsEl.appendChild(metric('丢帧', '—', '有画面之后才计数'));
        }
        if (state.live) {
            metricsEl.appendChild(metric('距直播边缘', state.liveEdge == null ? '—' : state.liveEdge.toFixed(1) + ' 秒', '越小越接近实时'));
            metricsEl.appendChild(metric('引擎延迟', state.latency == null ? '—' : state.latency.toFixed(1) + ' 秒', 'hls.js 估算，不是端到端承诺'));
        } else {
            metricsEl.appendChild(metric('直播', '点播', '没有直播边缘可追'));
        }
        metricsEl.appendChild(metric('速度', (state.playbackRate || 1) + '×', state.codecs || ''));
    }

    function renderVariants(state) {
        if (!variantsEl) return;
        variantsEl.replaceChildren();
        var levels = (state && state.levels) || [];
        if (!levels.length) {
            var empty = document.createElement('p');
            empty.className = 'pane-empty';
            empty.textContent = state && state.url
                ? '这条地址没有多档码率，画质菜单保持自动即可。'
                : '多码率流会在这里列出每一档，点一行就能锁住。';
            variantsEl.appendChild(empty);
            return;
        }
        var table = document.createElement('table');
        table.className = 'var-table';
        var thead = document.createElement('thead');
        var hr = document.createElement('tr');
        ['', '分辨率', '码率', '编码'].forEach(function (h) {
            var th = document.createElement('th');
            th.textContent = h;
            hr.appendChild(th);
        });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tb = document.createElement('tbody');
        levels.forEach(function (lvl) {
            var tr = document.createElement('tr');
            var activeLevel = state.auto ? state.playingLevel : state.currentLevel;
            var current = activeLevel === lvl.index;
            if (current) tr.className = 'is-current';
            var mark = document.createElement('td');
            var swatch = document.createElement('i');
            swatch.className = 'swatch';
            swatch.style.background = core.LEVEL_COLORS[lvl.index % core.LEVEL_COLORS.length];
            mark.appendChild(swatch);
            if (current) mark.appendChild(document.createTextNode(' 正在播'));
            var res = document.createElement('td');
            res.textContent = lvl.height ? (lvl.height + 'p') : '—';
            var br = document.createElement('td');
            br.textContent = core.formatBitrate(lvl.bitrate);
            var codecs = document.createElement('td');
            codecs.textContent = lvl.codecs || '—';
            tr.appendChild(mark);
            tr.appendChild(res);
            tr.appendChild(br);
            tr.appendChild(codecs);
            tr.addEventListener('click', function () {
                var sel = document.getElementById('quality');
                if (!sel) return;
                sel.value = String(lvl.index);
                sel.dispatchEvent(new Event('change'));
            });
            tb.appendChild(tr);
        });
        table.appendChild(tb);
        variantsEl.appendChild(table);
        var note = document.createElement('p');
        note.className = 'pane-empty';
        note.textContent = state.auto
            ? '现在是自动切换。点表格里的一档就会锁住，想回到自动，用画质菜单选「自动」。'
            : '已经锁住一档。网络变差时不会自己降级，卡顿就换更低的，或改回自动。';
        variantsEl.appendChild(note);
    }

    function resizeCanvas(canvas) {
        var ratio = window.devicePixelRatio || 1;
        var w = Math.max(280, canvas.clientWidth || 640);
        var h = canvas.getAttribute('data-h') ? Number(canvas.getAttribute('data-h')) : (canvas.id === 'bw-spark' ? 86 : 128);
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
        var ctx = canvas.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        return { ctx: ctx, w: w, h: h };
    }

    function drawSpark(bandwidth) {
        if (!spark) return;
        if (bandwidth > 0) {
            samples.push(Math.min(bandwidth, 8e7));
            if (samples.length > 90) samples.shift();
        }
        if (sparkNow) sparkNow.textContent = bandwidth > 8e7 ? '≥ 80 Mbps' : core.formatBitrate(bandwidth);
        var box = resizeCanvas(spark);
        var ctx = box.ctx;
        ctx.clearRect(0, 0, box.w, box.h);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
        ctx.fillRect(0, 0, box.w, box.h);
        var pts = core.sparkline(samples, box.w - 16, box.h - 16);
        if (pts.length < 2) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '12px sans-serif';
            ctx.fillText('带宽曲线会在开始下载后出现', 12, 28);
            return;
        }
        ctx.beginPath();
        pts.forEach(function (p, i) {
            var x = 8 + p.x;
            var y = 8 + p.y;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#2dd4bf';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    function drawTimeline(state) {
        if (!timeline) return;
        var box = resizeCanvas(timeline);
        var ctx = box.ctx;
        ctx.clearRect(0, 0, box.w, box.h);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.fillRect(0, 0, box.w, box.h);
        var frags = (window.StreamPlay && window.StreamPlay.getFrags) ? window.StreamPlay.getFrags() : [];
        var media = frags.filter(function (f) { return f.type !== 'audio' && f.type !== 'subtitle'; });
        if (!media.length) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '13px sans-serif';
            ctx.fillText('分片下载后会排在这条时间线上，颜色区分画质', 12, 36);
            if (tlMeta) tlMeta.textContent = '';
            return;
        }
        var start = media[0].start;
        var end = media[0].start + media[0].duration;
        media.forEach(function (f) {
            if (f.start < start) start = f.start;
            if (f.start + f.duration > end) end = f.start + f.duration;
        });
        if (state && isFinite(state.currentTime)) {
            end = Math.max(end, state.currentTime);
        }
        if (state && state.live && state.liveEdge != null && isFinite(state.currentTime)) {
            end = Math.max(end, state.currentTime + state.liveEdge);
        }
        var bars = core.layoutSegments(media, box.w - 16, start, Math.max(end, start + 0.001));
        var laneH = 28;
        bars.forEach(function (b, i) {
            var frag = media[i];
            var y = 16 + ((frag.level || 0) % 3) * (laneH + 6);
            ctx.fillStyle = core.LEVEL_COLORS[(frag.level || 0) % core.LEVEL_COLORS.length];
            ctx.globalAlpha = 0.9;
            ctx.fillRect(8 + b.x, y, Math.max(2, b.w - 1), laneH);
            ctx.globalAlpha = 1;
        });
        if (state && isFinite(state.currentTime) && end > start) {
            var px = 8 + ((state.currentTime - start) / (end - start)) * (box.w - 16);
            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(px, 8);
            ctx.lineTo(px, box.h - 8);
            ctx.stroke();
        }
        if (tlMeta) {
            var last = media[media.length - 1];
            tlMeta.textContent = '已下载 ' + media.length + ' 个视频分片 · 最近一段 ' +
                (last.duration ? last.duration.toFixed(2) + ' 秒' : '—') +
                ' · ' + core.formatBytes(last.bytes) +
                (last.loadMs ? ' · 用时 ' + Math.round(last.loadMs) + ' ms' : '');
        }
        if (tlLegend && state && state.levels) {
            tlLegend.replaceChildren();
            state.levels.forEach(function (lvl) {
                var chip = document.createElement('span');
                chip.className = 'tl-chip';
                var i = document.createElement('i');
                i.style.background = core.LEVEL_COLORS[lvl.index % core.LEVEL_COLORS.length];
                chip.appendChild(i);
                chip.appendChild(document.createTextNode(lvl.height ? (lvl.height + 'p') : ('档 ' + (lvl.index + 1))));
                tlLegend.appendChild(chip);
            });
        }
    }

    function renderErrors(focus) {
        var errors = (window.StreamPlay && window.StreamPlay.getErrors) ? window.StreamPlay.getErrors() : [];
        if (adviceEl) {
            adviceEl.replaceChildren();
            if (!errors.length) {
                var p = document.createElement('p');
                p.className = 'pane-empty';
                p.textContent = '还没有报错。如果画面停住，原因和下一步会写在这里，而不是只留一句「播放失败」。';
                adviceEl.appendChild(p);
            } else {
                var top = errors[0];
                var card = document.createElement('article');
                card.className = 'advice ' + (top.severity === 'warn' ? 'is-warn' : 'is-bad');
                var h = document.createElement('h3');
                h.textContent = top.title;
                var cause = document.createElement('p');
                cause.textContent = top.cause;
                card.appendChild(h);
                card.appendChild(cause);
                if (top.steps && top.steps.length) {
                    var ol = document.createElement('ol');
                    top.steps.forEach(function (step) {
                        var li = document.createElement('li');
                        li.textContent = step;
                        ol.appendChild(li);
                    });
                    card.appendChild(ol);
                }
                adviceEl.appendChild(card);
            }
        }
        if (errorLogEl) {
            errorLogEl.replaceChildren();
            errors.forEach(function (err) {
                var li = document.createElement('li');
                li.textContent = err.title + (err.details ? ' · ' + err.details : '');
                errorLogEl.appendChild(li);
            });
        }
        if (focus) show('diagnose');
    }

    function draw() {
        var state = (window.StreamPlay && window.StreamPlay.state) ? window.StreamPlay.state() : null;
        renderMetrics(state);
        renderVariants(state);
        drawSpark(state && state.bandwidth);
        drawTimeline(state);
        var errors = (window.StreamPlay && window.StreamPlay.getErrors) ? window.StreamPlay.getErrors() : [];
        if (errors.length !== seenError) {
            seenError = errors.length;
            renderErrors(false);
        }
    }

    function touch(opts) {
        draw();
        renderErrors(!!(opts && opts.focus));
        if (opts && opts.focus) seenError = ((window.StreamPlay && window.StreamPlay.getErrors) ? window.StreamPlay.getErrors() : []).length;
    }

    window.StreamBench = { show: show, touch: touch };

    var statsBtn = document.getElementById('c-stats');
    if (statsBtn) {
        statsBtn.addEventListener('click', function (e) {
            e.stopImmediatePropagation();
            show('quality');
        }, true);
    }
    var diagBtn = document.getElementById('c-diag');
    if (diagBtn) {
        diagBtn.addEventListener('click', function () {
            show('diagnose');
        });
    }

    window.addEventListener('resize', draw);
    setInterval(draw, 1000);
    draw();
    renderErrors(false);
    if (window.StreamPlay && window.StreamPlay.consumeFocus && window.StreamPlay.consumeFocus()) {
        show('diagnose');
    }
})();

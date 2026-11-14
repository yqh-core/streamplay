/* ==========================================================================
   StreamPlay 流影 - 播放逻辑
   --------------------------------------------------------------------------
   设计要点：
   1. 双引擎：m3u8 用 hls.js，mp4 等格式走浏览器原生播放
   2. 自动降级：原生播放失败时，若浏览器支持 MSE 则自动改用 hls.js 重试
   3. 有限重试：同一地址最多尝试 3 次，失败必然收敛到明确报错，不会无限重试
   4. 全程本地依赖：仅依赖 ../libs/hls.min.js，不请求任何外网 CDN
   5. 兼容旧接口：保留全局 play() 方法，便于 iframe / 控制台直接调用
   ========================================================================== */

(function () {
    'use strict';

    var video = document.getElementById('player');
    var input = document.getElementById('url');
    var btn = document.getElementById('play-btn');
    var tip = document.getElementById('tip');

    if (!video || !input || !btn) {
        return;
    }

    var hls = null;          // 当前 hls.js 实例
    var currentUrl = '';     // 当前正在播放的地址

    /* ------------------------------------------------------------ 提示条 */
    function showTip(msg, type) {
        if (!tip) {
            return;
        }
        tip.textContent = msg;
        tip.className = 'tip is-visible is-' + (type || 'info');
    }

    function hideTip() {
        if (!tip) {
            return;
        }
        tip.className = 'tip';
        tip.textContent = '';
    }

    /* ------------------------------------------------------------ 工具方法 */
    function clearRetryTimer() {
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
    }

    function releaseHls() {
        clearRetryTimer();
        if (hls) {
            try {
                hls.destroy();
            } catch (e) {
                /* 忽略销毁异常 */
            }
            hls = null;
        }
    }

    function isHlsUrl(url) {
        return /\.m3u8(\?|#|$)/i.test(url);
    }

    /* 明确的非 HLS 容器格式。这类地址加载失败就是真的失败了 ——
       再拿 hls.js 去解析一个 mp4 只会白等 3 次重试，最后还报个不相关的错。 */
    function isPlainMediaFile(url) {
        return /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|flv|avi|wmv)(\?|#|$)/i.test(url);
    }

    function nativeHlsSupported() {
        return !!video.canPlayType('application/vnd.apple.mpegurl');
    }

    function hlsJsAvailable() {
        return !!(window.Hls && typeof window.Hls.isSupported === 'function' && window.Hls.isSupported());
    }

    function safePlay() {
        var p = video.play();
        if (p && typeof p.catch === 'function') {
            /* 浏览器自动播放策略可能拦截，静默处理，用户可手动点击播放 */
            p.catch(function () { });
        }
    }

    /* ------------------------------------------------------------ hls.js 加载 */
    var MAX_ATTEMPTS = 3;    // 同一地址最多尝试 3 次（首次 + 2 次重试），保证失败必然收敛
    var attempts = 0;        // 当前地址已尝试次数
    var retryTimer = null;   // 重试定时器

    function loadWithHls(url) {
        releaseHls();

        var mediaRetry = 0;

        hls = new window.Hls({
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: 30
        });

        hls.loadSource(url);
        hls.attachMedia(video);

        hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
            attempts = 0;          // 清单解析成功，重置重试计数
            populateLevels();
            safePlay();
        });

        hls.on(window.Hls.Events.LEVEL_SWITCHED, function () {
            if (qualitySel && hls) qualitySel.value = String(hls.currentLevel);
            syncStats();
        });

        hls.on(window.Hls.Events.ERROR, function (evt, data) {
            if (!data || !data.fatal) {
                return;
            }

            /* 媒体错误：先用引擎自带机制恢复，限 2 次 */
            if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && mediaRetry < 2) {
                mediaRetry++;
                showTip('媒体流解析异常，正在恢复（' + mediaRetry + '/2）…', 'warn');
                try {
                    hls.recoverMediaError();
                    return;
                } catch (e) {
                    /* 落到统一失败处理 */
                }
            }

            handleFatal(url);
        });
    }

    /* ------------------------------------------------------- 统一失败处理 */
    /* 注意：manifest 404 这类致命错误，hls.js 的 startLoad() 不会重新发起请求，
       必须重建实例才有意义。因此这里做应用层的有界重试，避免卡在“正在重试”不动。 */
    function handleFatal(url) {
        releaseHls();

        if (attempts < MAX_ATTEMPTS) {
            attempts++;
            showTip('连接失败，正在重试（' + attempts + '/' + MAX_ATTEMPTS + '）…', 'warn');
            retryTimer = setTimeout(function () {
                retryTimer = null;
                loadWithHls(url);
            }, 1200);
            return;
        }

        attempts = 0;
        showTip('播放失败：地址不可达，或该地址不允许跨域访问。请确认该地址能在浏览器中直接打开。', 'error');
    }

    /* ------------------------------------------------------------ 主入口 */
    function play(rawUrl) {
        var url = String(rawUrl === undefined || rawUrl === null ? input.value : rawUrl).trim();

        if (!url) {
            showTip('请先输入播放地址', 'warn');
            input.focus();
            return;
        }

        /* 用户只填了 example.com/xxx.m3u8 这类裸域名时，自动补协议头 */
        if (!/^(https?:)?\/\//i.test(url) && !/^\/[^/]/.test(url) && !/^\.\//.test(url)) {
            if (/^[\w-]+(\.[\w-]+)+\//.test(url)) {
                url = 'https://' + url;
            }
        }

        input.value = url;
        currentUrl = url;
        attempts = 0;          // 新地址重新计数
        recordRecent(url);
        hideTip();
        releaseHls();

        video.removeAttribute('src');
        video.load();

        showTip('正在加载：' + url, 'info');

        if (isHlsUrl(url)) {
            if (hlsJsAvailable()) {
                loadWithHls(url);
            } else if (nativeHlsSupported()) {
                /* Safari / iOS Safari 原生支持 HLS */
                video.src = url;
                safePlay();
            } else {
                showTip('当前浏览器不支持 HLS 播放，建议使用 Chrome / Edge / Firefox。', 'error');
            }
        } else {
            /* mp4 等浏览器原生支持的格式 */
            video.src = url;
            safePlay();
        }
    }

    /* ------------------------------------------------------------ 事件绑定 */
    btn.addEventListener('click', function () {
        play();
    });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
            e.preventDefault();
            play();
        }
    });

    /* 示例流快捷按钮：一键填入地址并开始播放 */
    var demoBtns = document.querySelectorAll('.demo-btn');
    Array.prototype.forEach.call(demoBtns, function (el) {
        el.addEventListener('click', function () {
            var url = el.getAttribute('data-url');
            if (url) {
                input.value = url;
                play(url);
            }
        });
    });

    /* 原生播放失败时，自动降级到 hls.js 重试一次 */
    video.addEventListener('error', function () {
        /* 已由 hls.js 接管，或尚无播放地址，交给各自的错误处理 */
        if (hls || !currentUrl) {
            return;
        }

        /* 地址本身是 m3u8，说明引擎已选对，此处只报告失败 */
        if (isHlsUrl(currentUrl)) {
            showTip('播放失败：m3u8 地址不可达，或该地址不允许跨域访问。', 'error');
            return;
        }

        /* mp4 这类明确格式：直接给结论，不要再拿 HLS 引擎兜一圈 */
        if (isPlainMediaFile(currentUrl)) {
            showTip('播放失败：地址不可达，或该格式不受当前浏览器支持（建议用 mp4 / webm）。', 'error');
            return;
        }

        if (hlsJsAvailable()) {
            showTip('原生播放失败，已切换 HLS 引擎重试…', 'warn');
            attempts = 0;
            loadWithHls(currentUrl);
        } else {
            showTip('播放失败：地址不可达或该格式不受浏览器支持。', 'error');
        }
    });

    /* 真正开始播放后收起提示条 */
    video.addEventListener('playing', function () {
        if (tip && tip.classList.contains('is-info')) {
            hideTip();
        }
    });

    /* ------------------------------------------------------------ 自定义控制条 */
    /* 对标 video.js / hls.js：播放/暂停、进度+缓冲、音量、速度、HLS 画质、画中画、
       全屏、快捷键、实时统计。控制条常驻可见（不自动隐藏），所有控件即时生效。 */
    var controls = document.getElementById('controls');
    var shell = document.querySelector('.player-shell');
    var bigPlay = document.getElementById('big-play');
    var cPlay = document.getElementById('c-play');
    var cMute = document.getElementById('c-mute');
    var cPip = document.getElementById('c-pip');
    var cFull = document.getElementById('c-full');
    var seek = document.getElementById('seek');
    var bufferTrack = document.getElementById('buffer-track');
    var vol = document.getElementById('vol');
    var rateSel = document.getElementById('rate');
    var qualitySel = document.getElementById('quality');
    var curEl = document.getElementById('cur');
    var durEl = document.getElementById('dur');
    var statsEl = document.getElementById('stats');
    var seeking = false;

    function fmtTime(s) {
        if (!isFinite(s) || s < 0) s = 0;
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = Math.floor(s % 60);
        var mm = (h > 0 && m < 10 ? '0' : '') + m;
        var ss = (sec < 10 ? '0' : '') + sec;
        return (h > 0 ? h + ':' : '') + mm + ':' + ss;
    }

    function syncPlayIcon() {
        var paused = video.paused;
        if (cPlay) cPlay.textContent = paused ? '▶' : '⏸';
        if (bigPlay) bigPlay.style.display = paused ? 'flex' : 'none';
    }

    function togglePlay() {
        if (video.paused) { safePlay(); } else { video.pause(); }
    }

    function syncVolume() {
        if (vol) vol.value = String(video.muted ? 0 : video.volume);
        if (cMute) cMute.textContent = (video.muted || video.volume === 0) ? '🔇' : '🔊';
    }

    function syncTime() {
        if (curEl) curEl.textContent = fmtTime(video.currentTime);
        if (durEl) durEl.textContent = fmtTime(video.duration);
        if (seek && !seeking) {
            var pct = video.duration > 0 ? (video.currentTime / video.duration) * 100 : 0;
            seek.value = String(pct);
        }
    }

    function syncBuffer() {
        if (!bufferTrack) return;
        try {
            if (video.buffered.length > 0 && video.duration > 0) {
                var end = video.buffered.end(video.buffered.length - 1);
                bufferTrack.style.width = Math.min(100, (end / video.duration) * 100) + '%';
            }
        } catch (e) { /* 缓冲区间暂不可读 */ }
    }

    function syncStats() {
        if (!statsEl) return;
        var parts = [];
        if (hls && hls.levels && hls.levels.length) {
            var lvl = hls.levels[hls.currentLevel];
            if (lvl) parts.push('画质 ' + (lvl.height ? lvl.height + 'p' : Math.round(lvl.bitrate / 1000) + 'kbps'));
            parts.push(hls.currentLevel === -1 ? '自动切换' : '手动锁定');
        }
        parts.push('速度 ' + video.playbackRate + '×');
        if (video.buffered.length > 0) {
            try {
                var buf = Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime);
                parts.push('缓冲 ' + buf.toFixed(1) + 's');
            } catch (e) { /* ignore */ }
        }
        statsEl.textContent = parts.join(' · ');
    }

    /* HLS 画质选项：从 hls.levels 填充（自动 + 各档），手动选择锁定档位。 */
    function populateLevels() {
        if (!qualitySel) return;
        if (!hls || !hls.levels || !hls.levels.length) {
            qualitySel.innerHTML = '<option value="-1">自动</option>';
            qualitySel.disabled = true;
            return;
        }
        qualitySel.disabled = false;
        var html = '<option value="-1">自动</option>';
        hls.levels.forEach(function (lvl, i) {
            var label = lvl.height ? lvl.height + 'p' : Math.round(lvl.bitrate / 1000) + 'kbps';
            if (lvl.bitrate && lvl.height) label += ' (' + Math.round(lvl.bitrate / 1000) + 'kbps)';
            html += '<option value="' + i + '">' + label + '</option>';
        });
        qualitySel.innerHTML = html;
        qualitySel.value = String(hls.currentLevel);
    }

    if (controls) {
        if (cPlay) cPlay.addEventListener('click', togglePlay);
        if (bigPlay) bigPlay.addEventListener('click', togglePlay);
        video.addEventListener('click', togglePlay);
        video.addEventListener('play', syncPlayIcon);
        video.addEventListener('pause', syncPlayIcon);
        video.addEventListener('timeupdate', function () { syncTime(); syncStats(); });
        video.addEventListener('durationchange', syncTime);
        video.addEventListener('progress', syncBuffer);
        video.addEventListener('volumechange', syncVolume);
        video.addEventListener('ratechange', function () {
            if (rateSel) rateSel.value = String(video.playbackRate);
            syncStats();
        });
        video.addEventListener('loadedmetadata', function () { syncTime(); syncPlayIcon(); syncVolume(); });

        if (seek) {
            seek.addEventListener('input', function () {
                seeking = true;
                if (video.duration > 0) {
                    video.currentTime = (Number(seek.value) / 100) * video.duration;
                }
                if (curEl) curEl.textContent = fmtTime(video.currentTime);
            });
            seek.addEventListener('change', function () { seeking = false; });
        }
        if (vol) {
            vol.addEventListener('input', function () {
                video.volume = Number(vol.value);
                video.muted = Number(vol.value) === 0;
            });
        }
        if (cMute) cMute.addEventListener('click', function () { video.muted = !video.muted; });
        if (rateSel) rateSel.addEventListener('change', function () { video.playbackRate = Number(rateSel.value); });
        if (qualitySel) qualitySel.addEventListener('change', function () {
            if (hls) { hls.currentLevel = Number(qualitySel.value); syncStats(); }
        });
        if (cPip) cPip.addEventListener('click', function () {
            if (document.pictureInPictureElement) {
                document.exitPictureInPicture().catch(function () { });
            } else if (video.requestPictureInPicture) {
                video.requestPictureInPicture().catch(function () { showTip('当前浏览器或视频不支持画中画', 'warn'); });
            } else {
                showTip('当前浏览器不支持画中画', 'warn');
            }
        });
        if (cFull) cFull.addEventListener('click', function () {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(function () { });
            } else if (shell && shell.requestFullscreen) {
                shell.requestFullscreen().catch(function () { });
            }
        });

        /* 快捷键：输入框/下拉聚焦时不拦截，避免打断地址输入与选择。 */
        document.addEventListener('keydown', function (e) {
            var tag = (e.target && e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            switch (e.key) {
                case ' ': case 'k': e.preventDefault(); togglePlay(); break;
                case 'ArrowLeft': e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); break;
                case 'ArrowRight': e.preventDefault(); video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); break;
                case 'j': video.currentTime = Math.max(0, video.currentTime - 10); break;
                case 'l': video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); break;
                case 'ArrowUp': e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); video.muted = false; break;
                case 'ArrowDown': e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); break;
                case 'm': video.muted = !video.muted; break;
                case 'f': if (cFull) cFull.click(); break;
                default: break;
            }
        });

        syncPlayIcon(); syncVolume(); syncTime();
    }

    /* ------------------------------------------------------------ 深链支持 */
    /* 页面地址带 ?url=xxx 时自动填充并加载，便于 iframe 嵌入 */
    function readUrlParam() {
        var m = /[?&]url=([^&]*)/.exec(window.location.search);
        if (!m) {
            return '';
        }
        try {
            return decodeURIComponent(m[1]);
        } catch (e) {
            return m[1];
        }
    }

    var deepUrl = readUrlParam();
    if (deepUrl) {
        input.value = deepUrl;
        play(deepUrl);
    }

    /* ------------------------------------------------------------ 帧截图 */
    /* 把当前帧画到 canvas 导出 PNG。跨域视频会污染 canvas，捕获异常并如实提示。 */
    var cSnap = document.getElementById('c-snap');
    if (cSnap) {
        cSnap.addEventListener('click', function () {
            if (!video.videoWidth) { showTip('还没有画面，先播放视频再截图', 'warn'); return; }
            try {
                var canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(function (blob) {
                    if (!blob) { showTip('截图失败：画面受跨域保护，无法导出', 'error'); return; }
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'streamplay-' + fmtTime(video.currentTime).replace(/:/g, '-') + '.png';
                    a.click();
                    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
                    showTip('已截图当前帧并下载', 'info');
                }, 'image/png');
            } catch (e) {
                showTip('截图失败：画面受跨域保护（CORS），无法导出', 'error');
            }
        });
    }

    /* ------------------------------------------------------------ 字幕加载 */
    /* .vtt 直接挂 track；.srt 浏览器不原生支持，先转成 VTT 再用 blob 挂载。 */
    var subUrl = document.getElementById('sub-url');
    var subLoad = document.getElementById('sub-load');
    var subOff = document.getElementById('sub-off');
    var subNote = document.getElementById('sub-note');
    var subTrackEl = null;
    var subBlobUrl = null;

    function srtToVtt(srt) {
        var body = srt.replace(/\r+/g, '').trim();
        // 时间轴逗号毫秒 → 点毫秒；去掉序号行
        body = body.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        body = body.replace(/^\d+\s*$/gm, '');
        return 'WEBVTT\n\n' + body + '\n';
    }

    function clearSubtitle() {
        if (subTrackEl) { subTrackEl.remove(); subTrackEl = null; }
        if (subBlobUrl) { URL.revokeObjectURL(subBlobUrl); subBlobUrl = null; }
        var tracks = video.querySelectorAll('track[data-sp-sub]');
        Array.prototype.forEach.call(tracks, function (t) { t.remove(); });
        if (video.textTracks) {
            for (var i = 0; i < video.textTracks.length; i++) { video.textTracks[i].mode = 'disabled'; }
        }
    }

    function attachTrack(src, label) {
        clearSubtitle();
        subTrackEl = document.createElement('track');
        subTrackEl.kind = 'subtitles';
        subTrackEl.label = label || '字幕';
        subTrackEl.srclang = 'zh';
        subTrackEl.default = true;
        subTrackEl.setAttribute('data-sp-sub', '1');
        subTrackEl.src = src;
        video.appendChild(subTrackEl);
        // 挂载后启用第一条字幕轨
        setTimeout(function () {
            if (video.textTracks && video.textTracks.length) {
                video.textTracks[video.textTracks.length - 1].mode = 'showing';
            }
        }, 300);
    }

    function loadSubtitle() {
        if (!subUrl) return;
        var url = subUrl.value.trim();
        if (!url) { if (subNote) subNote.textContent = '请先粘贴字幕地址'; return; }
        if (!/^(https?:)?\/\//i.test(url)) url = 'https://' + url;
        var isSrt = /\.srt(\?|#|$)/i.test(url);
        if (subNote) subNote.textContent = '正在加载字幕…';
        if (isSrt) {
            fetch(url).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            }).then(function (text) {
                subBlobUrl = URL.createObjectURL(new Blob([srtToVtt(text)], { type: 'text/vtt' }));
                attachTrack(subBlobUrl, '字幕（SRT 转换）');
                if (subNote) subNote.textContent = '字幕已加载（SRT 已转为 VTT）';
            }).catch(function (e) {
                if (subNote) subNote.textContent = '字幕加载失败：' + e.message + '（跨域字幕需对方允许 CORS）';
            });
        } else {
            attachTrack(url, '字幕');
            if (subNote) subNote.textContent = '字幕已加载，请在字幕菜单中确认轨道';
        }
    }

    if (subLoad) subLoad.addEventListener('click', loadSubtitle);
    if (subUrl) subUrl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); loadSubtitle(); } });
    if (subOff) subOff.addEventListener('click', function () {
        clearSubtitle();
        if (subNote) subNote.textContent = '字幕已关闭';
    });

    /* ------------------------------------------------------------ 最近播放 */
    /* 仅存本机 localStorage，不上传。去重、上限 12、点击重播、单条删除、清空。 */
    var RECENT_KEY = 'streamplay:recent';
    var RECENT_MAX = 12;
    var recentList = document.getElementById('recent-list');
    var recentEmpty = document.getElementById('recent-empty');
    var recentCount = document.getElementById('recent-count');
    var recentClear = document.getElementById('recent-clear');

    function readRecent() {
        try {
            var arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
            return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === 'string'; }) : [];
        } catch (e) { return []; }
    }

    function writeRecent(arr) {
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(arr)); } catch (e) { /* 隐私模式可能禁写 */ }
    }

    function renderRecent() {
        if (!recentList) return;
        var arr = readRecent();
        recentList.innerHTML = '';
        if (recentCount) recentCount.textContent = String(arr.length);
        if (recentEmpty) recentEmpty.style.display = arr.length ? 'none' : 'block';
        arr.forEach(function (url) {
            var li = document.createElement('li');
            li.className = 'recent-item';
            var link = document.createElement('button');
            link.type = 'button';
            link.className = 'recent-link';
            link.title = url;
            link.textContent = url;
            link.addEventListener('click', function () { input.value = url; play(url); });
            var del = document.createElement('button');
            del.type = 'button';
            del.className = 'recent-del';
            del.setAttribute('aria-label', '删除这条记录');
            del.textContent = '✕';
            del.addEventListener('click', function () {
                writeRecent(readRecent().filter(function (x) { return x !== url; }));
                renderRecent();
            });
            li.appendChild(link);
            li.appendChild(del);
            recentList.appendChild(li);
        });
    }

    function recordRecent(url) {
        if (!url) return;
        var arr = readRecent().filter(function (x) { return x !== url; });
        arr.unshift(url);
        writeRecent(arr.slice(0, RECENT_MAX));
        renderRecent();
    }

    if (recentClear) recentClear.addEventListener('click', function () {
        writeRecent([]);
        renderRecent();
    });
    renderRecent();

    /* ------------------------------------------------------------ 对外接口 */
    /* 兼容原版全局 play() 调用方式 */
    window.play = play;
    window.StreamPlay = {
        play: play,
        stop: function () {
            releaseHls();
            video.pause();
            video.removeAttribute('src');
            video.load();
            hideTip();
        }
    };
})();

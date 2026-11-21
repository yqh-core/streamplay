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

        hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, function () {
            populateAudioTracks();
        });

        hls.on(window.Hls.Events.AUDIO_TRACK_SWITCHED, function () {
            if (audioSel && hls) audioSel.value = String(hls.audioTrack);
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
        showRetry();
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
        clearLoop();
        syncNowPlaying();
        renderQueue();
        hideResume();
        hideRetry();
        hideSpin();
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
            showRetry();
            return;
        }

        /* mp4 这类明确格式：直接给结论，不要再拿 HLS 引擎兜一圈 */
        if (isPlainMediaFile(currentUrl)) {
            showTip('播放失败：地址不可达，或该格式不受当前浏览器支持（建议用 mp4 / webm）。', 'error');
            showRetry();
            return;
        }

        if (hlsJsAvailable()) {
            showTip('原生播放失败，已切换 HLS 引擎重试…', 'warn');
            attempts = 0;
            loadWithHls(currentUrl);
        } else {
            showTip('播放失败：地址不可达或该格式不受浏览器支持。', 'error');
            showRetry();
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

    /* A-B 循环状态 */
    var loopA = null;
    var loopB = null;
    var loopActive = false;
    var cLoopA = document.getElementById('c-loop-a');
    var cLoopB = document.getElementById('c-loop-b');

    /* 音轨选择 + 正在播放条 */
    var audioSel = document.getElementById('audio');
    var nowPlaying = document.getElementById('now-playing');
    var npUrl = document.getElementById('np-url');
    var npEq = document.getElementById('np-eq');

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
        if (hls && hls.bandwidthEstimate) {
            parts.push('带宽 ' + (hls.bandwidthEstimate / 1e6).toFixed(1) + 'Mbps');
        }
        if (video.getVideoPlaybackQuality) {
            var q = video.getVideoPlaybackQuality();
            if (q && q.totalVideoFrames) {
                parts.push('丢帧 ' + q.droppedVideoFrames + '/' + q.totalVideoFrames);
            }
        }
        if (loopActive) parts.push('A-B 循环 ' + fmtTime(loopA) + '–' + fmtTime(loopB));
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

    /* HLS 音轨选项：从 hls.audioTracks 填充，切换 hls.audioTrack。 */
    function populateAudioTracks() {
        if (!audioSel) return;
        if (!hls || !hls.audioTracks || !hls.audioTracks.length) {
            audioSel.innerHTML = '<option value="-1">默认</option>';
            audioSel.disabled = true;
            return;
        }
        audioSel.disabled = false;
        var html = '';
        hls.audioTracks.forEach(function (t, i) {
            var label = t.name || t.lang || ('音轨 ' + (i + 1));
            if (t.lang && t.name) label = t.name + ' (' + t.lang + ')';
            html += '<option value="' + i + '">' + label + '</option>';
        });
        audioSel.innerHTML = html;
        audioSel.value = String(hls.audioTrack);
    }

    /* A-B 循环：A 设起点，B 设终点并启用；timeupdate 到达 B 跳回 A。 */
    function clearLoop() {
        loopA = null; loopB = null; loopActive = false;
        if (cLoopA) cLoopA.classList.remove('active');
        if (cLoopB) cLoopB.classList.remove('active');
    }
    function setLoopA() {
        loopA = video.currentTime;
        loopB = null; loopActive = false;
        if (cLoopA) { cLoopA.classList.add('active'); cLoopA.title = '起点 A = ' + fmtTime(loopA) + '（再点清除）'; }
        if (cLoopB) cLoopB.classList.remove('active');
        showTip('循环起点 A = ' + fmtTime(loopA) + '，再按 B 设终点', 'info');
        syncStats();
    }
    function setLoopB() {
        if (loopA === null) { showTip('请先按 A 设定循环起点', 'warn'); return; }
        if (video.currentTime <= loopA) { showTip('终点 B 必须晚于起点 A', 'warn'); return; }
        loopB = video.currentTime;
        loopActive = true;
        if (cLoopB) { cLoopB.classList.add('active'); cLoopB.title = '终点 B = ' + fmtTime(loopB) + '（再点清除）'; }
        showTip('A-B 循环已启用：' + fmtTime(loopA) + ' → ' + fmtTime(loopB), 'info');
        syncStats();
    }
    if (cLoopA) cLoopA.addEventListener('click', function () {
        if (loopA !== null && !loopActive && cLoopA.classList.contains('active') && loopB === null) { clearLoop(); showTip('循环已清除', 'info'); syncStats(); return; }
        if (loopActive) { clearLoop(); showTip('循环已清除', 'info'); syncStats(); return; }
        setLoopA();
    });
    if (cLoopB) cLoopB.addEventListener('click', function () {
        if (loopActive) { clearLoop(); showTip('循环已清除', 'info'); syncStats(); return; }
        setLoopB();
    });
    video.addEventListener('timeupdate', function () {
        if (loopActive && loopB !== null && video.currentTime >= loopB) {
            video.currentTime = loopA;
        }
    });

    /* 正在播放条：显示当前地址，播放时均衡器动画。 */
    function syncNowPlaying() {
        if (!nowPlaying) return;
        if (currentUrl) {
            nowPlaying.hidden = false;
            if (npUrl) { npUrl.textContent = currentUrl; npUrl.title = currentUrl; }
        } else {
            nowPlaying.hidden = true;
        }
        if (npEq) npEq.classList.toggle('playing', !video.paused);
    }
    video.addEventListener('play', syncNowPlaying);
    video.addEventListener('pause', syncNowPlaying);
    video.addEventListener('emptied', syncNowPlaying);

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
        if (audioSel) audioSel.addEventListener('change', function () {
            if (hls) { hls.audioTrack = Number(audioSel.value); }
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

    /* ------------------------------------------------------------ 第四轮：专业播放生命周期 */
    /* 对标 video.js / Plyr / YouTube 的招牌体验：断点续播、带时间点分享/深链、
       缓冲转圈、进度悬停预览、影院宽屏、失败重试。全部本地实现，进度只存本机。 */
    var bufferSpin = document.getElementById('buffer-spin');
    var retryOverlay = document.getElementById('retry-overlay');
    var resumeBar = document.getElementById('resume-bar');
    var resumeText = document.getElementById('resume-text');
    var resumeGo = document.getElementById('resume-go');
    var resumeDismiss = document.getElementById('resume-dismiss');
    var seekRow = document.getElementById('seek-row');
    var seekTip = document.getElementById('seek-tip');
    var cShare = document.getElementById('c-share');
    var cTheater = document.getElementById('c-theater');

    /* —— 缓冲转圈：waiting/loadstart 显示，playing/canplay/pause/emptied/error 隐藏 —— */
    function showSpin() { if (bufferSpin && currentUrl) bufferSpin.hidden = false; }
    function hideSpin() { if (bufferSpin) bufferSpin.hidden = true; }
    video.addEventListener('waiting', showSpin);
    video.addEventListener('loadstart', showSpin);
    video.addEventListener('playing', hideSpin);
    video.addEventListener('canplay', hideSpin);
    video.addEventListener('pause', hideSpin);
    video.addEventListener('emptied', hideSpin);
    video.addEventListener('error', hideSpin);

    /* —— 进度悬停预览：鼠标在进度条上移动时，浮出该位置对应的时间 —— */
    if (seekRow && seekTip) {
        seekRow.addEventListener('mousemove', function (e) {
            if (!(video.duration > 0) || !isFinite(video.duration)) { seekTip.hidden = true; return; }
            var rect = seekRow.getBoundingClientRect();
            var x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
            var pct = rect.width > 0 ? x / rect.width : 0;
            seekTip.textContent = fmtTime(pct * video.duration);
            seekTip.style.left = Math.min(Math.max(x, 24), Math.max(24, rect.width - 24)) + 'px';
            seekTip.hidden = false;
        });
        seekRow.addEventListener('mouseleave', function () { seekTip.hidden = true; });
    }

    /* —— 断点续播：进度按地址存本机 localStorage，再次打开提示「继续播放」 —— */
    var PROGRESS_KEY = 'streamplay:progress';
    var PROGRESS_MAX = 50;
    var resumeTarget = null;
    var lastSave = 0;

    function readProgress() {
        try {
            var o = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
            return (o && typeof o === 'object') ? o : {};
        } catch (e) { return {}; }
    }
    function writeProgress(o) { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(o)); } catch (e) { /* 隐私模式禁写 */ } }
    function saveProgress() {
        if (!currentUrl || !isFinite(video.duration) || !(video.duration > 0) || !isFinite(video.currentTime)) return;
        var t = video.currentTime;
        var o = readProgress();
        /* 接近开头/结尾不记，避免无意义续播 */
        if (t < 5 || t > video.duration - 10) {
            if (o[currentUrl]) { delete o[currentUrl]; writeProgress(o); }
            return;
        }
        o[currentUrl] = { t: t, d: video.duration, ts: Date.now() };
        var keys = Object.keys(o);
        if (keys.length > PROGRESS_MAX) {
            keys.sort(function (a, b) { return (o[a].ts || 0) - (o[b].ts || 0); });
            keys.slice(0, keys.length - PROGRESS_MAX).forEach(function (k) { delete o[k]; });
        }
        writeProgress(o);
    }
    function hideResume() { if (resumeBar) resumeBar.hidden = true; resumeTarget = null; }
    function offerResume() {
        if (!resumeBar || !currentUrl) return;
        var rec = readProgress()[currentUrl];
        if (rec && rec.t > 5 && isFinite(video.duration) && video.duration > 0 && rec.t < video.duration - 10) {
            resumeTarget = rec.t;
            if (resumeText) resumeText.textContent = '上次看到 ' + fmtTime(rec.t);
            resumeBar.hidden = false;
        } else {
            hideResume();
        }
    }
    video.addEventListener('timeupdate', function () {
        var now = Date.now();
        if (now - lastSave > 4000) { lastSave = now; saveProgress(); }
    });
    video.addEventListener('pause', saveProgress);
    window.addEventListener('pagehide', saveProgress);
    if (resumeGo) resumeGo.addEventListener('click', function () {
        if (resumeTarget !== null) { video.currentTime = resumeTarget; safePlay(); }
        hideResume();
    });
    if (resumeDismiss) resumeDismiss.addEventListener('click', function () {
        if (currentUrl) { var o = readProgress(); delete o[currentUrl]; writeProgress(o); }
        video.currentTime = 0;
        hideResume();
    });

    /* —— 带时间点深链 ?t=秒数：优先于续播，加载后跳到指定时间 —— */
    function readTimeParam() {
        var m = /[?&]t=([^&]*)/.exec(window.location.search);
        if (!m) return null;
        var n = Number(decodeURIComponent(m[1]));
        return (isFinite(n) && n >= 0) ? n : null;
    }
    var startTime = readTimeParam();
    var startApplied = false;
    video.addEventListener('loadedmetadata', function () {
        if (startTime !== null && !startApplied && video.duration > 0) {
            startApplied = true;
            video.currentTime = Math.min(startTime, Math.max(0, video.duration - 1));
            hideResume();
            showTip('已从 ' + fmtTime(video.currentTime) + ' 开始播放', 'info');
            return;
        }
        offerResume();
    });

    /* —— 失败重试遮罩：致命失败后给出明确的手动重试入口 —— */
    function showRetry() { if (retryOverlay && currentUrl) retryOverlay.hidden = false; }
    function hideRetry() { if (retryOverlay) retryOverlay.hidden = true; }
    if (retryOverlay) retryOverlay.addEventListener('click', function () {
        hideRetry();
        if (currentUrl) play(currentUrl);
    });
    video.addEventListener('playing', hideRetry);
    video.addEventListener('loadstart', hideRetry);

    /* —— 分享：复制 ?url=地址&t=当前秒数 链接（clipboard + execCommand 降级） —— */
    function legacyCopy(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (e) { return false; }
    }
    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
        }
        return Promise.resolve(legacyCopy(text));
    }
    if (cShare) cShare.addEventListener('click', function () {
        if (!currentUrl) { showTip('先播放一个视频，再复制分享链接', 'warn'); return; }
        var t = Math.floor(video.currentTime || 0);
        var link = window.location.origin + window.location.pathname + '?url=' + encodeURIComponent(currentUrl) + '&t=' + t;
        copyText(link).then(function (ok) {
            if (ok) showTip('已复制分享链接（从 ' + fmtTime(t) + ' 开始）', 'info');
            else showTip('复制失败，请手动复制地址栏链接', 'error');
        });
    });

    /* —— 影院宽屏：切换 body.sp-theater，主区放宽到 1280px，画面更大 —— */
    if (cTheater) cTheater.addEventListener('click', function () {
        var on = document.body.classList.toggle('sp-theater');
        cTheater.classList.toggle('active', on);
        cTheater.title = on ? '退出影院模式' : '影院宽屏模式';
        showTip(on ? '影院宽屏模式已开启' : '已退出影院宽屏模式', 'info');
    });

    /* ------------------------------------------------------------ 第五轮：专业辅助与诊断 */
    /* 对标 YouTube / video.js：详细统计面板（Stats for nerds）、快捷键帮助、播放诊断、字幕样式定制。 */
    var cStats = document.getElementById('c-stats');
    var statsPanel = document.getElementById('stats-panel');
    var statsGrid = document.getElementById('stats-grid');
    var statsClose = document.getElementById('stats-close');
    var cHelp = document.getElementById('c-help');
    var helpModal = document.getElementById('help-modal');
    var helpClose = document.getElementById('help-close');
    var cDiag = document.getElementById('c-diag');
    var diagModal = document.getElementById('diag-modal');
    var diagClose = document.getElementById('diag-close');
    var diagBody = document.getElementById('diag-body');
    var diagRun = document.getElementById('diag-run');
    var statsTimer = null;

    function esc(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    /* —— 详细统计面板：分辨率/编码/带宽/缓冲/丢帧/网络，打开时每秒刷新 —— */
    function renderStatsPanel() {
        if (!statsGrid) return;
        var rows = [];
        rows.push(['分辨率', video.videoWidth ? video.videoWidth + '×' + video.videoHeight : '—']);
        if (hls && hls.levels && hls.levels.length) {
            var idx = hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel;
            var lvl = hls.levels[idx];
            if (lvl) {
                rows.push(['画质档位', (lvl.height ? lvl.height + 'p' : '—') + ' @ ' + Math.round(lvl.bitrate / 1000) + ' kbps']);
                var codecs = (lvl.attrs && lvl.attrs.CODECS) || lvl.codecSet || '';
                if (codecs) rows.push(['编码', codecs]);
            }
            rows.push(['码率切换', hls.autoLevelEnabled ? '自动' : '手动锁定']);
            if (hls.bandwidthEstimate) rows.push(['估算带宽', (hls.bandwidthEstimate / 1e6).toFixed(2) + ' Mbps']);
        }
        rows.push(['播放速度', video.playbackRate + '×']);
        rows.push(['当前 / 总长', fmtTime(video.currentTime) + ' / ' + fmtTime(video.duration)]);
        if (video.buffered.length > 0) {
            try { rows.push(['缓冲健康', Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime).toFixed(1) + ' s']); } catch (e) { /* ignore */ }
        }
        if (video.getVideoPlaybackQuality) {
            var q = video.getVideoPlaybackQuality();
            if (q && q.totalVideoFrames) rows.push(['丢帧', q.droppedVideoFrames + ' / ' + q.totalVideoFrames]);
        }
        if (navigator.connection && navigator.connection.effectiveType) rows.push(['网络类型', navigator.connection.effectiveType]);
        rows.push(['播放引擎', hls ? 'hls.js (MSE)' : '原生 HTML5']);
        statsGrid.innerHTML = rows.map(function (r) {
            return '<div class="sp-row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
        }).join('');
    }
    function openStats() {
        if (!statsPanel) return;
        statsPanel.hidden = false;
        if (cStats) cStats.classList.add('active');
        renderStatsPanel();
        statsTimer = setInterval(renderStatsPanel, 1000);
    }
    function closeStats() {
        if (statsPanel) statsPanel.hidden = true;
        if (cStats) cStats.classList.remove('active');
        if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    }
    if (cStats) cStats.addEventListener('click', function () { statsPanel.hidden ? openStats() : closeStats(); });
    if (statsClose) statsClose.addEventListener('click', closeStats);

    /* —— 快捷键帮助弹窗 —— */
    function openHelp() { if (helpModal) helpModal.hidden = false; }
    function closeHelp() { if (helpModal) helpModal.hidden = true; }
    if (cHelp) cHelp.addEventListener('click', openHelp);
    if (helpClose) helpClose.addEventListener('click', closeHelp);
    if (helpModal) helpModal.addEventListener('click', function (e) { if (e.target === helpModal) closeHelp(); });

    /* —— 播放诊断：MSE/hls.js/解码/网络/地址可达性，逐项给结论 —— */
    function diagRow(state, label, detail) {
        var cls = state === null ? 'neutral' : (state ? 'ok' : 'bad');
        var ico = state === null ? '•' : (state ? '✓' : '✗');
        return '<div class="diag-row ' + cls + '"><span class="diag-ico">' + ico + '</span><span class="diag-label">' + esc(label) + '</span><span class="diag-detail">' + esc(detail) + '</span></div>';
    }
    function runDiag() {
        if (!diagBody) return;
        var rows = [];
        var mse = typeof window.MediaSource !== 'undefined';
        rows.push(diagRow(mse, 'MSE 支持', mse ? 'MediaSource 可用' : '浏览器不支持 MediaSource'));
        var hlsOk = !!(window.Hls && window.Hls.isSupported && window.Hls.isSupported());
        rows.push(diagRow(hlsOk, 'hls.js 引擎', hlsOk ? '可用（MSE 转封装）' : '不可用'));
        var nativeHls = !!video.canPlayType('application/vnd.apple.mpegurl');
        rows.push(diagRow(nativeHls ? true : null, '原生 HLS', nativeHls ? '支持（Safari 系）' : '不支持（依赖 hls.js）'));
        var h264 = !!video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
        rows.push(diagRow(h264, 'H.264 / AAC 解码', h264 ? '支持' : '不支持'));
        var vp9 = !!video.canPlayType('video/webm; codecs="vp9, opus"');
        rows.push(diagRow(vp9 ? true : null, 'WebM / VP9 解码', vp9 ? '支持' : '不支持（mp4 仍可播）'));
        rows.push(diagRow(navigator.onLine, '网络连接', navigator.onLine ? '在线' : '离线'));
        if (navigator.connection && navigator.connection.effectiveType) {
            rows.push(diagRow(null, '网络类型', navigator.connection.effectiveType + (navigator.connection.downlink ? ' · 约 ' + navigator.connection.downlink + ' Mbps' : '')));
        }
        var urlRow = currentUrl ? diagRow(null, '地址可达性', '检测中…') : diagRow(null, '地址可达性', '尚未播放任何地址');
        diagBody.innerHTML = rows.join('') + '<div id="diag-url">' + urlRow + '</div>';
        if (currentUrl) {
            fetch(currentUrl, { method: 'HEAD', mode: 'cors', cache: 'no-store' }).then(function (r) {
                var el = document.getElementById('diag-url');
                if (el) el.innerHTML = diagRow(r.ok, '地址可达性', 'HTTP ' + r.status + (r.ok ? ' · 可达 · 允许跨域' : ' · 响应异常'));
            }).catch(function () {
                var el = document.getElementById('diag-url');
                var msg = !navigator.onLine ? '当前离线' : '不可达或不允许跨域（CORS）；请在浏览器新标签直接打开该地址验证';
                if (el) el.innerHTML = diagRow(false, '地址可达性', msg);
            });
        }
    }
    function openDiag() { if (diagModal) { diagModal.hidden = false; runDiag(); } }
    function closeDiag() { if (diagModal) diagModal.hidden = true; }
    if (cDiag) cDiag.addEventListener('click', openDiag);
    if (diagClose) diagClose.addEventListener('click', closeDiag);
    if (diagRun) diagRun.addEventListener('click', runDiag);
    if (diagModal) diagModal.addEventListener('click', function (e) { if (e.target === diagModal) closeDiag(); });

    /* —— 字幕样式定制：动态写入 #player::cue 规则（字号/颜色/背景） —— */
    var cueSize = document.getElementById('cue-size');
    var cueColor = document.getElementById('cue-color');
    var cueBg = document.getElementById('cue-bg');
    var cueStyleEl = document.getElementById('sp-cue-style');
    if (!cueStyleEl) {
        cueStyleEl = document.createElement('style');
        cueStyleEl.id = 'sp-cue-style';
        document.head.appendChild(cueStyleEl);
    }
    function applyCueStyle() {
        var size = cueSize ? cueSize.value : '100';
        var color = cueColor ? cueColor.value : '#ffffff';
        var bg = cueBg ? cueBg.value : 'rgba(0,0,0,0.6)';
        cueStyleEl.textContent = '#player::cue{font-size:' + size + '%;color:' + color + ';background:' + bg + ';}';
    }
    if (cueSize) cueSize.addEventListener('change', applyCueStyle);
    if (cueColor) cueColor.addEventListener('change', applyCueStyle);
    if (cueBg) cueBg.addEventListener('change', applyCueStyle);
    applyCueStyle();

    /* —— ? 打开帮助；Esc 关闭弹窗 —— */
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeHelp(); closeDiag(); return; }
        var tag = (e.target && e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable) return;
        if (e.key === '?') { e.preventDefault(); openHelp(); }
    });

    /* ------------------------------------------------------------ 第六轮：迷你播放器 + 播放队列 */
    /* 对标 YouTube / Plyr：滚出画面自动悬浮迷你播放器；播放队列自动连播/上下首/循环整片。 */
    var shellEl = document.querySelector('.player-shell');
    var cMini = document.getElementById('c-mini');
    var miniSpacer = document.getElementById('mini-spacer');
    var miniPlay = document.getElementById('mini-play');
    var miniTitle = document.getElementById('mini-title');
    var miniExpand = document.getElementById('mini-expand');
    var miniClose = document.getElementById('mini-close');
    var isMini = false;
    var miniManual = false;

    function syncMiniPlay() {
        if (miniPlay) miniPlay.textContent = video.paused ? '▶' : '⏸';
        if (miniTitle && currentUrl) miniTitle.textContent = currentUrl;
    }
    function enterMini() {
        if (isMini || !shellEl) return;
        isMini = true;
        /* 用占位块撑住原高度，避免 shell 脱离文档流后下方内容跳动 */
        if (miniSpacer) { miniSpacer.style.height = shellEl.offsetHeight + 'px'; miniSpacer.hidden = false; }
        shellEl.classList.add('is-mini');
        syncMiniPlay();
    }
    function exitMini() {
        if (!isMini || !shellEl) return;
        isMini = false;
        shellEl.classList.remove('is-mini');
        if (miniSpacer) { miniSpacer.hidden = true; miniSpacer.style.height = ''; }
    }
    if (cMini) cMini.addEventListener('click', function () {
        if (isMini) { miniManual = false; exitMini(); }
        else { miniManual = true; enterMini(); }
    });
    if (miniPlay) miniPlay.addEventListener('click', function () { togglePlay(); syncMiniPlay(); });
    if (miniExpand) miniExpand.addEventListener('click', function () { miniManual = false; exitMini(); });
    if (miniClose) miniClose.addEventListener('click', function () { miniManual = false; exitMini(); video.pause(); });
    video.addEventListener('play', syncMiniPlay);
    video.addEventListener('pause', syncMiniPlay);
    /* 滚动自动悬浮：以 now-playing 条为哨兵（它不随 shell 悬浮移动，避免反馈环）。
       手动迷你（miniManual）时不自动还原，交由 ⤢/✕ 控制。 */
    if ('IntersectionObserver' in window && nowPlaying) {
        var miniIO = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting && !video.paused && currentUrl && !isMini) { enterMini(); }
                else if (en.isIntersecting && isMini && !miniManual) { exitMini(); }
            });
        }, { threshold: 0 });
        miniIO.observe(nowPlaying);
    }

    /* —— 播放队列：增删播/上下首/自动连播/循环整片，仅存本机 —— */
    var QUEUE_KEY = 'streamplay:queue';
    var QUEUE_PREF_KEY = 'streamplay:queuepref';
    var queueUrl = document.getElementById('queue-url');
    var queueAdd = document.getElementById('queue-add');
    var queuePrev = document.getElementById('queue-prev');
    var queueNext = document.getElementById('queue-next');
    var queueClear = document.getElementById('queue-clear');
    var queueList = document.getElementById('queue-list');
    var queueCount = document.getElementById('queue-count');
    var queueEmpty = document.getElementById('queue-empty');
    var queueAuto = document.getElementById('queue-auto');
    var queueRepeat = document.getElementById('queue-repeat');

    function readQueue() {
        try {
            var arr = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
            return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === 'string'; }) : [];
        } catch (e) { return []; }
    }
    function writeQueue(arr) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(arr)); } catch (e) { /* 隐私模式禁写 */ } }
    function renderQueue() {
        if (!queueList) return;
        var arr = readQueue();
        queueList.innerHTML = '';
        if (queueCount) queueCount.textContent = String(arr.length);
        if (queueEmpty) queueEmpty.style.display = arr.length ? 'none' : 'block';
        arr.forEach(function (url, i) {
            var li = document.createElement('li');
            li.className = 'queue-item' + (url === currentUrl ? ' current' : '');
            var idx = document.createElement('span');
            idx.className = 'queue-idx';
            idx.textContent = url === currentUrl ? '▶' : String(i + 1);
            var link = document.createElement('button');
            link.type = 'button';
            link.className = 'queue-link';
            link.title = url;
            link.textContent = url;
            link.addEventListener('click', function () { play(url); });
            var del = document.createElement('button');
            del.type = 'button';
            del.className = 'queue-del';
            del.setAttribute('aria-label', '从队列移除');
            del.textContent = '✕';
            del.addEventListener('click', function () {
                writeQueue(readQueue().filter(function (x) { return x !== url; }));
                renderQueue();
            });
            li.appendChild(idx);
            li.appendChild(link);
            li.appendChild(del);
            queueList.appendChild(li);
        });
    }
    function addToQueue(raw) {
        var url = String(raw === undefined || raw === null ? (queueUrl ? queueUrl.value : '') : raw).trim();
        if (!url) { showTip('请先输入要加入队列的地址', 'warn'); return; }
        if (!/^(https?:)?\/\//i.test(url) && /^[\w-]+(\.[\w-]+)+\//.test(url)) url = 'https://' + url;
        var arr = readQueue();
        if (arr.indexOf(url) < 0) { arr.push(url); writeQueue(arr); }
        if (queueUrl) queueUrl.value = '';
        renderQueue();
        showTip('已加入队列（共 ' + readQueue().length + ' 首）', 'info');
    }
    function queueStep(delta) {
        var arr = readQueue();
        if (!arr.length) { showTip('队列为空，先添加地址', 'warn'); return; }
        var idx = arr.indexOf(currentUrl);
        var next = idx < 0 ? (delta > 0 ? 0 : arr.length - 1) : idx + delta;
        if (next < 0 || next >= arr.length) { showTip(delta > 0 ? '已是最后一首' : '已是第一首', 'info'); return; }
        play(arr[next]);
    }
    if (queueAdd) queueAdd.addEventListener('click', function () { addToQueue(); });
    if (queueUrl) queueUrl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addToQueue(); } });
    if (queuePrev) queuePrev.addEventListener('click', function () { queueStep(-1); });
    if (queueNext) queueNext.addEventListener('click', function () { queueStep(1); });
    if (queueClear) queueClear.addEventListener('click', function () { writeQueue([]); renderQueue(); });
    /* 自动连播：播完取队列下一首（循环整片由 video.loop 原生处理，ended 不触发） */
    video.addEventListener('ended', function () {
        if (video.loop) return;
        if (queueAuto && queueAuto.checked) {
            var arr = readQueue();
            var idx = arr.indexOf(currentUrl);
            if (idx >= 0 && idx < arr.length - 1) play(arr[idx + 1]);
        }
    });
    /* 偏好持久化 */
    function readPref() { try { return JSON.parse(localStorage.getItem(QUEUE_PREF_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function savePref() {
        try { localStorage.setItem(QUEUE_PREF_KEY, JSON.stringify({ auto: queueAuto ? queueAuto.checked : false, repeat: queueRepeat ? queueRepeat.checked : false })); } catch (e) { /* ignore */ }
    }
    if (queueAuto) queueAuto.addEventListener('change', function () { savePref(); showTip(queueAuto.checked ? '自动连播已开启' : '自动连播已关闭', 'info'); });
    if (queueRepeat) queueRepeat.addEventListener('change', function () { video.loop = queueRepeat.checked; savePref(); showTip(queueRepeat.checked ? '循环整片已开启' : '循环整片已关闭', 'info'); });
    var pref = readPref();
    if (queueAuto) queueAuto.checked = !!pref.auto;
    if (queueRepeat) { queueRepeat.checked = !!pref.repeat; video.loop = !!pref.repeat; }
    renderQueue();

    /* ------------------------------------------------------------ M3U8 清单分析（对标 LivePlayer Analyzer） */
    /* 纯前端 fetch + 解析：master 列变体/音轨/字幕组，media 列分片/时长/直播态/加密。
       清单内容是第三方数据，所有渲染走 textContent/DOM API，绝不 innerHTML 拼接。 */
    var maUrl = document.getElementById('ma-url');
    var maRun = document.getElementById('ma-run');
    var maUseCurrent = document.getElementById('ma-use-current');
    var maStatus = document.getElementById('ma-status');
    var maResult = document.getElementById('ma-result');
    var maSeq = 0;

    function maSetStatus(msg, kind) {
        if (!maStatus) return;
        maStatus.textContent = msg;
        maStatus.className = 'ma-status' + (kind ? ' is-' + kind : '');
    }

    function resolveUrl(uri, base) {
        try { return new URL(uri, base).href; } catch (e) { return uri; }
    }

    /* Parser is a separately tested production module loaded before this file.
       容错：解析模块可能因网络/部分部署/immutable 长缓存命中坏文件而未加载成功。
       这里只做安全探测，绝不在顶层无保护解引用 window.StreamPlayM3U8Parser——
       否则模块缺失会让整个播放器 IIFE 中止（把分析功能故障扩大成整播放器崩溃）。
       模块缺失时不返回“看似正常的空解析”，只在 analyzeManifest 入口明确降级。 */
    var m3u8ParserReady = !!(window.StreamPlayM3U8Parser
        && typeof window.StreamPlayM3U8Parser.parseManifest === 'function');
    var parseManifest = m3u8ParserReady ? window.StreamPlayM3U8Parser.parseManifest : null;

    function fmtDuration(sec) {
        if (!isFinite(sec) || sec <= 0) return '—';
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
        return (h ? h + ':' : '') + (h && m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function maChip(label, value) {
        var span = document.createElement('span');
        span.className = 'ma-chip';
        var b = document.createElement('strong');
        b.textContent = value;
        span.appendChild(b);
        span.appendChild(document.createTextNode(' ' + label));
        return span;
    }

    function maTable(headers, rows) {
        var wrap = document.createElement('div');
        wrap.className = 'ma-tablewrap';
        var table = document.createElement('table');
        table.className = 'ma-table';
        var thead = document.createElement('thead');
        var hr = document.createElement('tr');
        headers.forEach(function (h) {
            var th = document.createElement('th');
            th.textContent = h;
            hr.appendChild(th);
        });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = document.createElement('tbody');
        rows.forEach(function (r) {
            var tr = document.createElement('tr');
            r.forEach(function (c) {
                var td = document.createElement('td');
                td.textContent = c;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
    }

    function maSection(title) {
        var p = document.createElement('p');
        p.className = 'ma-section';
        var b = document.createElement('strong');
        b.textContent = title;
        p.appendChild(b);
        return p;
    }

    function renderMediaInfo(info, container, labelPrefix) {
        var chips = document.createElement('div');
        chips.className = 'ma-chips';
        chips.appendChild(maChip('类型', info.endList ? 'VOD 点播' : 'LIVE 直播'));
        if (info.version) chips.appendChild(maChip('HLS 版本', info.version));
        if (info.targetDuration) chips.appendChild(maChip('目标分片时长', info.targetDuration + 's'));
        chips.appendChild(maChip('分片数', String(info.segments.length)));
        if (info.totalDuration > 0) chips.appendChild(maChip('总时长', fmtDuration(info.totalDuration)));
        chips.appendChild(maChip('加密', info.encrypted ? info.keyMethod : '无'));
        if (info.discontinuities) chips.appendChild(maChip('不连续点', String(info.discontinuities)));
        container.appendChild(chips);
        if (info.segments.length) {
            var durs = info.segments.map(function (s) { return s.duration; }).filter(function (d) { return d > 0; });
            if (durs.length) {
                var sum = durs.reduce(function (a, b) { return a + b; }, 0);
                container.appendChild(maSection((labelPrefix || '') + '分片时长：最短 ' + Math.min.apply(null, durs).toFixed(2) + 's · 最长 ' + Math.max.apply(null, durs).toFixed(2) + 's · 平均 ' + (sum / durs.length).toFixed(2) + 's'));
            }
            var details = document.createElement('details');
            details.className = 'ma-raw';
            var summary = document.createElement('summary');
            summary.textContent = '分片列表（' + info.segments.length + ' 条，点击展开）';
            details.appendChild(summary);
            var ol = document.createElement('ol');
            ol.className = 'ma-seglist';
            info.segments.slice(0, 200).forEach(function (s) {
                var li = document.createElement('li');
                li.textContent = s.duration.toFixed(2) + 's — ' + s.uri;
                ol.appendChild(li);
            });
            if (info.segments.length > 200) {
                var more = document.createElement('li');
                more.textContent = '… 其余 ' + (info.segments.length - 200) + ' 条省略';
                ol.appendChild(more);
            }
            details.appendChild(ol);
            container.appendChild(details);
        }
        if (info.initSegment) {
            container.appendChild(maSection('初始化分片：' + info.initSegment));
        }
    }

    function renderManifest(info, text, baseUrl, container) {
        var headChips = document.createElement('div');
        headChips.className = 'ma-chips';
        headChips.appendChild(maChip(info.isMaster ? 'Master 主清单' : 'Media 媒体清单', info.isMaster ? '多码率' : '单码率'));
        container.appendChild(headChips);
        if (info.isMaster) {
            container.appendChild(maSection('变体流（' + info.variants.length + ' 条）'));
            container.appendChild(maTable(
                ['#', '分辨率', '带宽', '帧率', '编码', '音轨组', '字幕组', 'URI'],
                info.variants.map(function (v, i) {
                    var bw = parseInt(v.BANDWIDTH || '0', 10);
                    return [String(i + 1), v.RESOLUTION || '—',
                        bw ? (bw / 1000000).toFixed(2) + ' Mbps' : '—',
                        v['FRAME-RATE'] || '—', v.CODECS || '—',
                        v.AUDIO || '—', v.SUBTITLES || '—', v.uri || '—'];
                })
            ));
            if (info.media.length) {
                container.appendChild(maSection('音轨 / 字幕组（' + info.media.length + ' 条）'));
                container.appendChild(maTable(
                    ['类型', '组 ID', '名称', '语言', '默认', 'URI'],
                    info.media.map(function (m) {
                        return [m.TYPE || '—', m['GROUP-ID'] || '—', m.NAME || '—',
                            m.LANGUAGE || '—', m.DEFAULT || '—', m.URI || '（内嵌）'];
                    })
                ));
            }
            /* 自动抓第一个变体的媒体清单，给出分片级信息（CORS 失败如实报告） */
            if (info.variants.length && info.variants[0].uri) {
                var firstUri = info.variants[0].uri;
                var sub = document.createElement('div');
                sub.className = 'ma-sub';
                container.appendChild(sub);
                maSetStatus('正在分析首个变体的媒体清单…', 'info');
                fetchText(firstUri, 15000).then(function (r) {
                    var child = parseManifest(r.text, firstUri);
                    var title = maSection('首个变体的媒体清单');
                    sub.appendChild(title);
                    renderMediaInfo(child, sub, '');
                    maSetStatus('分析完成：master + 首个变体媒体清单', 'ok');
                }).catch(function (e) {
                    sub.appendChild(maSection('首个变体媒体清单获取失败：' + e.message + '（变体表仍可用）'));
                    maSetStatus('分析完成：master 变体表可用；首个变体媒体清单不可读', 'warn');
                });
            }
        } else {
            renderMediaInfo(info, container, '');
        }
        /* 原文折叠 + 复制 */
        var raw = document.createElement('details');
        raw.className = 'ma-raw';
        var rawSum = document.createElement('summary');
        rawSum.textContent = '清单原文（' + text.length + ' 字符，点击展开）';
        raw.appendChild(rawSum);
        var pre = document.createElement('pre');
        pre.className = 'ma-pre';
        pre.textContent = text;
        raw.appendChild(pre);
        var copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'mini-btn';
        copyBtn.textContent = '复制原文';
        copyBtn.addEventListener('click', function () {
            copyText(text).then(function (ok) {
                copyBtn.textContent = ok ? '已复制 ✓' : '复制失败';
                setTimeout(function () { copyBtn.textContent = '复制原文'; }, 2000);
            });
        });
        raw.appendChild(copyBtn);
        container.appendChild(raw);
    }

    function fetchText(url, timeoutMs) {
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
        return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (resp) {
            if (timer) clearTimeout(timer);
            if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + resp.statusText);
            return resp.text().then(function (text) { return { text: text, resp: resp }; });
        }).catch(function (e) {
            if (timer) clearTimeout(timer);
            if (e && e.name === 'AbortError') throw new Error('请求超时（' + (timeoutMs / 1000) + 's）');
            if (e instanceof TypeError) throw new Error('网络请求失败：地址不可达或对方不允许跨域（CORS）');
            throw e;
        });
    }

    function analyzeManifest() {
        if (!maUrl || !maResult) return;
        if (!m3u8ParserReady) {
            maSetStatus('M3U8 清单分析暂不可用：解析模块未能加载；播放与其他功能不受影响，请刷新页面重试。', 'error');
            return;
        }
        var url = maUrl.value.trim();
        if (!url) { maSetStatus('请先输入 m3u8 地址', 'warn'); return; }
        if (!/^https?:\/\//i.test(url)) { maSetStatus('地址必须以 http:// 或 https:// 开头', 'warn'); return; }
        var seq = ++maSeq;
        maResult.innerHTML = '';
        maSetStatus('正在获取清单…', 'info');
        if (maRun) maRun.disabled = true;
        fetchText(url, 15000).then(function (r) {
            if (seq !== maSeq) return;
            var text = r.text;
            if (text.trim().indexOf('#EXTM3U') !== 0) {
                maSetStatus('内容不是 M3U8 清单（缺少 #EXTM3U 头）——可能是 HTML 错误页或媒体文件', 'error');
                return;
            }
            var info = parseManifest(text, url);
            renderManifest(info, text, url, maResult);
            if (!info.isMaster) maSetStatus('分析完成', 'ok');
        }).catch(function (e) {
            if (seq !== maSeq) return;
            maSetStatus('分析失败：' + e.message, 'error');
        }).finally(function () {
            if (seq === maSeq && maRun) maRun.disabled = false;
        });
    }

    if (maRun) maRun.addEventListener('click', analyzeManifest);
    if (maUrl) maUrl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); analyzeManifest(); } });
    if (maUseCurrent) maUseCurrent.addEventListener('click', function () {
        if (maUrl) { maUrl.value = input.value.trim(); analyzeManifest(); }
    });
    if (maUrl && !maUrl.value) maUrl.value = input.value.trim();

    /* ------------------------------------------------------------ 嵌入代码生成器（对标 LivePlayer Embed Builder） */
    var embUrl = document.getElementById('emb-url');
    var embWidth = document.getElementById('emb-width');
    var embHeight = document.getElementById('emb-height');
    var embT = document.getElementById('emb-t');
    var embAutoplay = document.getElementById('emb-autoplay');
    var embMuted = document.getElementById('emb-muted');
    var embCode = document.getElementById('emb-code');
    var embCopy = document.getElementById('emb-copy');
    var embPreview = document.getElementById('emb-preview');
    var embNote = document.getElementById('emb-note');
    var EMBED_ORIGIN = 'https://play.digdevbox.com';

    function buildEmbedSrc(origin) {
        var url = embUrl ? embUrl.value.trim() : '';
        if (!url) return '';
        var src = origin + '/?url=' + encodeURIComponent(url);
        var t = embT ? parseInt(embT.value, 10) : 0;
        if (t > 0) src += '&t=' + t;
        if (embAutoplay && embAutoplay.checked) {
            src += '&autoplay=1';
            /* 浏览器自动播放策略：有声自动播放基本会被拦，静音才可靠 */
            if (embMuted && embMuted.checked) src += '&muted=1';
        }
        return src;
    }

    function refreshEmbed() {
        if (!embCode) return;
        var url = embUrl ? embUrl.value.trim() : '';
        if (!url) {
            embCode.textContent = '（先填写播放地址）';
            if (embPreview) embPreview.removeAttribute('src');
            return;
        }
        var w = embWidth && embWidth.value.trim() ? embWidth.value.trim() : '100%';
        var h = embHeight && embHeight.value.trim() ? embHeight.value.trim() : '480';
        var src = buildEmbedSrc(EMBED_ORIGIN);
        embCode.textContent = '<iframe src="' + src + '" width="' + w + '" height="' + h + '" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
        if (embNote) {
            embNote.textContent = embAutoplay && embAutoplay.checked && !(embMuted && embMuted.checked)
                ? '注意：多数浏览器会拦截有声自动播放，建议勾选「静音」。'
                : '预览使用当前站点地址；复制的代码指向正式域名 play.digdevbox.com。';
        }
        /* 预览用当前 origin（本地测试也能播），尺寸缩放到容器内 */
        if (embPreview) {
            var previewSrc = buildEmbedSrc((window.location.origin + window.location.pathname.replace(/index\.html$/, '')).replace(/\/$/, ''));
            embPreview.src = previewSrc;
            var ph = Math.min(parseInt(h, 10) || 480, 260);
            embPreview.style.height = ph + 'px';
        }
    }

    var embTimer = null;
    function scheduleEmbed() {
        if (embTimer) clearTimeout(embTimer);
        embTimer = setTimeout(refreshEmbed, 400);
    }
    [embUrl, embWidth, embHeight, embT].forEach(function (el) {
        if (el) el.addEventListener('input', scheduleEmbed);
    });
    [embAutoplay, embMuted].forEach(function (el) {
        if (el) el.addEventListener('change', refreshEmbed);
    });
    if (embAutoplay) embAutoplay.addEventListener('change', function () {
        if (embAutoplay.checked && embMuted) embMuted.checked = true;
        refreshEmbed();
    });
    if (embCopy) embCopy.addEventListener('click', function () {
        copyText(embCode.textContent).then(function (ok) {
            showTip(ok ? '已复制嵌入代码' : '复制失败，请手动选择代码复制', ok ? 'info' : 'error');
        });
    });
    var embUseCurrent = document.getElementById('emb-use-current');
    if (embUseCurrent) embUseCurrent.addEventListener('click', function () {
        if (embUrl) { embUrl.value = input.value.trim(); refreshEmbed(); }
    });
    if (embUrl && !embUrl.value) embUrl.value = input.value.trim();
    refreshEmbed();

    /* ------------------------------------------------------------ 深链自动播放/静音（嵌入场景） */
    /* ?autoplay=1&muted=1：静音自动播放（浏览器策略下唯一可靠的自动播放形态）。
       deepUrl 的 play() 本身就会尝试起播；这里只补 muted 语义与未起播时的兜底。 */
    (function () {
        var qs = window.location.search;
        var muted = /[?&]muted=1/.test(qs);
        var autoplay = /[?&]autoplay=1/.test(qs);
        if (muted) { video.muted = true; syncVolume(); }
        if (autoplay && deepUrl) {
            video.addEventListener('canplay', function onCanPlay() {
                video.removeEventListener('canplay', onCanPlay);
                safePlay();
            });
        }
    })();

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

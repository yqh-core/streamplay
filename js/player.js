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
            safePlay();
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

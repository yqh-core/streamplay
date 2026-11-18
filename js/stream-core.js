/* StreamPlay 纯函数：地址分类、清单解析、报错说明、分享/嵌入、时间线几何。
   浏览器与 Node 测试共用。不碰网络，不碰 DOM。 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.StreamCore = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var LEVEL_COLORS = ['#2dd4bf', '#38bdf8', '#a78bfa', '#fbbf24', '#fb7185', '#4ade80', '#f97316', '#e879f9'];

    function normalizeUrl(raw) {
        var url = String(raw == null ? '' : raw).trim();
        if (!url) return '';
        if (/^https?:\/\//i.test(url)) return url;
        if (/^\/\//.test(url)) return 'https:' + url;
        if (/^\//.test(url) || /^\.\//.test(url)) return url;
        if (/^[\w-]+(\.[\w-]+)+(\/|:|$)/.test(url)) return 'https://' + url;
        return url;
    }

    function classifySource(url) {
        var u = String(url || '').trim().split('#')[0];
        if (/\.mpd(\?|$)/i.test(u)) return 'dash';
        if (/\.m3u8(\?|$)/i.test(u)) return 'hls';
        if (/\.(mp4|m4v|webm|ogv|ogg|mov)(\?|$)/i.test(u)) return 'file';
        return 'unknown';
    }

    function resolveUrl(uri, base) {
        try {
            return new URL(uri, base).href;
        } catch (e) {
            return uri;
        }
    }

    function parseAttrs(s) {
        var out = {};
        var re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
        var m;
        while ((m = re.exec(String(s || ''))) !== null) {
            out[m[1]] = m[2].replace(/^"|"$/g, '');
        }
        return out;
    }

    function parseM3u8(text, baseUrl) {
        var src = String(text || '').replace(/^\uFEFF/, '');
        var lines = src.split(/\r?\n/);
        var info = {
            valid: false,
            isMaster: false,
            version: '',
            targetDuration: 0,
            mediaSequence: 0,
            playlistType: '',
            endList: false,
            variants: [],
            media: [],
            segments: [],
            totalDuration: 0,
            encrypted: false,
            keyMethod: '',
            initSegment: '',
            discontinuities: 0
        };
        var pendingVariant = null;
        var pendingExtinf = 0;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            if (line.indexOf('#EXTM3U') === 0) {
                info.valid = true;
                continue;
            }
            if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
                info.isMaster = true;
                pendingVariant = parseAttrs(line.slice('#EXT-X-STREAM-INF:'.length));
            } else if (line.indexOf('#EXT-X-MEDIA:') === 0) {
                info.media.push(parseAttrs(line.slice('#EXT-X-MEDIA:'.length)));
            } else if (line.indexOf('#EXT-X-VERSION:') === 0) {
                info.version = line.slice('#EXT-X-VERSION:'.length).trim();
            } else if (line.indexOf('#EXT-X-TARGETDURATION:') === 0) {
                info.targetDuration = parseFloat(line.slice('#EXT-X-TARGETDURATION:'.length)) || 0;
            } else if (line.indexOf('#EXT-X-MEDIA-SEQUENCE:') === 0) {
                info.mediaSequence = parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length), 10) || 0;
            } else if (line.indexOf('#EXT-X-PLAYLIST-TYPE:') === 0) {
                info.playlistType = line.slice('#EXT-X-PLAYLIST-TYPE:'.length).trim();
            } else if (line === '#EXT-X-ENDLIST') {
                info.endList = true;
            } else if (line.indexOf('#EXT-X-KEY:') === 0) {
                var keyAttrs = parseAttrs(line.slice('#EXT-X-KEY:'.length));
                if (keyAttrs.METHOD && keyAttrs.METHOD !== 'NONE') {
                    info.encrypted = true;
                    info.keyMethod = keyAttrs.METHOD;
                }
            } else if (line.indexOf('#EXT-X-MAP:') === 0) {
                var mapAttrs = parseAttrs(line.slice('#EXT-X-MAP:'.length));
                if (mapAttrs.URI) info.initSegment = resolveUrl(mapAttrs.URI, baseUrl);
            } else if (line === '#EXT-X-DISCONTINUITY') {
                info.discontinuities++;
            } else if (line.indexOf('#EXTINF:') === 0) {
                pendingExtinf = parseFloat(line.slice('#EXTINF:'.length)) || 0;
            } else if (line.charAt(0) !== '#') {
                if (pendingVariant) {
                    pendingVariant.uri = resolveUrl(line, baseUrl);
                    info.variants.push(pendingVariant);
                    pendingVariant = null;
                } else if (!info.isMaster) {
                    info.segments.push({ duration: pendingExtinf, uri: resolveUrl(line, baseUrl) });
                    info.totalDuration += pendingExtinf;
                    pendingExtinf = 0;
                }
            }
        }
        return info;
    }

    function decodeXml(s) {
        return String(s || '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');
    }

    function parseXmlAttrs(head) {
        var out = {};
        var re = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
        var m;
        while ((m = re.exec(String(head || ''))) !== null) {
            out[m[1]] = decodeXml(m[2]);
        }
        return out;
    }

    function parseMpd(xml, baseUrl) {
        var text = String(xml || '').replace(/^\uFEFF/, '');
        var reps = [];
        var sets = text.split(/<AdaptationSet\b/i).slice(1);
        sets.forEach(function (chunk) {
            var gt = chunk.indexOf('>');
            var setAttrs = parseXmlAttrs(gt >= 0 ? chunk.slice(0, gt) : chunk);
            var body = gt >= 0 ? chunk.slice(gt + 1) : chunk;
            var repChunks = body.split(/<Representation\b/i).slice(1);
            repChunks.forEach(function (rc) {
                var rgt = rc.indexOf('>');
                var attrs = parseXmlAttrs(rgt >= 0 ? rc.slice(0, rgt) : rc);
                var base = '';
                var bm = rc.match(/<BaseURL[^>]*>([^<]*)<\/BaseURL>/i);
                if (bm) base = resolveUrl(decodeXml(bm[1].trim()), baseUrl);
                var mime = attrs.mimeType || setAttrs.mimeType || '';
                var contentType = attrs.contentType || setAttrs.contentType || '';
                if (!contentType && mime.indexOf('audio') === 0) contentType = 'audio';
                if (!contentType && mime.indexOf('video') === 0) contentType = 'video';
                reps.push({
                    id: attrs.id || '',
                    bandwidth: parseInt(attrs.bandwidth || '0', 10) || 0,
                    width: parseInt(attrs.width || setAttrs.width || '0', 10) || 0,
                    height: parseInt(attrs.height || setAttrs.height || '0', 10) || 0,
                    codecs: attrs.codecs || setAttrs.codecs || '',
                    mimeType: mime,
                    contentType: contentType || 'unknown',
                    baseUrl: base
                });
            });
        });
        var typeM = text.match(/\btype\s*=\s*"(static|dynamic)"/i);
        var durM = text.match(/\bmediaPresentationDuration\s*=\s*"([^"]+)"/i);
        return {
            isMpd: /<MPD[\s>]/i.test(text),
            type: typeM ? typeM[1].toLowerCase() : '',
            duration: durM ? durM[1] : '',
            representations: reps
        };
    }

    function pack(title, cause, steps, extra) {
        var o = extra || {};
        return {
            title: title,
            cause: cause,
            steps: steps,
            severity: o.severity || 'error',
            retry: o.retry !== false,
            details: o.details || '',
            httpCode: o.httpCode == null || !isFinite(Number(o.httpCode)) ? null : Number(o.httpCode)
        };
    }

    function explainPlaybackError(input) {
        var d = input || {};
        var details = String(d.details || '');
        var protocol = d.protocol || 'hls';
        var code = d.httpCode;
        if ((code == null || code === '') && d.response && d.response.code != null) code = d.response.code;
        var codeNum = Number(code);
        var http = isFinite(codeNum) ? codeNum : null;
        var base = { details: details, httpCode: http };

        if (protocol === 'dash') {
            var dashCode = Number(d.code);
            if (dashCode === 11 || dashCode === 12 || dashCode === 19) {
                return pack('DASH 清单没有下载下来', '浏览器没有拿到可用的 MPD。地址、网络或跨域，三者里通常有一个。', [
                    '用新标签打开这个 .mpd，确认看到的是 XML，不是登录页或 404。',
                    '源站要允许跨域（Access-Control-Allow-Origin），清单和分片都要。',
                    '页面是 https 时，请用 https 地址。'
                ], Object.assign({ retry: http !== 404, severity: 'error' }, base, { details: 'dash-' + dashCode }));
            }
            if (dashCode === 10) {
                return pack('这份 MPD 解析不了', '文件下载到了，但不是播放器能读的 DASH 清单。常见情况是返回了 HTML 错误页。', [
                    '看响应正文是不是以 <MPD 开头。',
                    '确认没有被鉴权页或网关改写。'
                ], Object.assign({ retry: false }, base, { details: 'dash-10' }));
            }
            if (dashCode === 17 || dashCode === 18) {
                return pack('DASH 分片下载失败', '清单读到了，但某一段媒体没有拉下来。', [
                    '在清单表里核对 Representation 的地址。',
                    '分片响应同样要带跨域头。'
                ], Object.assign({ retry: true }, base, { details: 'dash-' + dashCode }));
            }
            if (dashCode === 20 || dashCode === 23) {
                return pack('浏览器不接受这段媒体', '分片或编码无法送进 MediaSource。H.264 + AAC 最稳妥。', [
                    '换一条 H.264 的清晰流试一下。',
                    '若清单要求加密密钥系统，本站不播放 DRM。'
                ], Object.assign({ retry: false }, base, { details: 'dash-' + dashCode }));
            }
            if (dashCode === 24 || (dashCode >= 107 && dashCode <= 114)) {
                return pack('这条 DASH 流带 DRM', '它要浏览器的密钥系统（Widevine、PlayReady 等）。这里只播放不加密或仅清单可见的流，不会绕过版权保护。', [
                    '向源站要一条不加密的测试地址。',
                    '加密流请用签发方自己的播放器。'
                ], Object.assign({ retry: false, severity: 'error' }, base, { details: 'dash-drm' }));
            }
            return pack('DASH 播放停住了', d.message ? String(d.message) : '引擎没有给出更具体的原因。', [
                '先换页面上的 DASH 样例，确认浏览器能播。',
                '再看诊断里的跨域和编码两项。'
            ], Object.assign({ retry: true }, base, { details: details || 'dash' }));
        }

        if (details === 'native-file') {
            return pack('这个文件没有播起来', '浏览器直接播放失败。地址打不开，或容器/编码不受支持。', [
                '优先用 H.264 + AAC 的 mp4，或 webm。',
                '用新标签打开地址，看是下载文件还是报错页。'
            ], Object.assign({ retry: false }, base));
        }

        switch (details) {
            case 'manifestLoadError':
            case 'manifestLoadTimeOut':
                if (http === 404) {
                    return pack('找不到这份清单', '源站返回 404。路径或查询参数和服务器对不上，也可能是直播已经结束。', [
                        '把地址和源站后台的发布地址逐字对一下。',
                        '带 token、过期时间的地址失效后会直接 404，需要重新签发。'
                    ], Object.assign({ retry: false }, base));
                }
                if (http === 401 || http === 403) {
                    return pack('源站拒绝了这次访问', 'HTTP ' + http + '。多半是鉴权、防盗链或 Referer 限制，播放器改不了这件事。', [
                        '确认 token 还在有效期内。',
                        '如果源站校验 Referer，需要在源站放行 play.digdevbox.com，或在你们自己的页面里播放。'
                    ], Object.assign({ retry: false }, base));
                }
                if (http == null || http === 0) {
                    return pack('浏览器没有拿到清单', '请求没有返回 HTTP 状态。最常见是源站没开跨域，其次是域名不通、证书错误，或当前离线。', [
                        '先用新标签打开这个地址。文本都打不开的话，先修地址或网络。',
                        '文本能打开、播放器不行，就给 m3u8 和分片都加上 Access-Control-Allow-Origin。',
                        'https 页面不能去拉 http 流。'
                    ], Object.assign({ retry: true }, base));
                }
                return pack('清单加载失败', '源站返回了 HTTP ' + http + '。', [
                    '看这个状态码在源站代表什么。',
                    '5xx 可以过一会儿再试；4xx 需要改地址或权限。'
                ], Object.assign({ retry: http >= 500 }, base));
            case 'manifestParsingError':
                return pack('这不是一份可播放的 m3u8', '内容下载到了，但解析失败。常见是一份 HTML 错误页、登录墙，或文件被截断。', [
                    '响应应以 #EXTM3U 开头。',
                    '如果前面有空行或 HTML，源站需要直接返回播放列表。'
                ], Object.assign({ retry: false }, base));
            case 'manifestIncompatibleCodecsError':
            case 'bufferAddCodecError':
                return pack('当前浏览器解不了这个编码', '清单里的编码和这台浏览器对不上。桌面 Chrome 上 H.265/HEVC 经常会失败或黑屏。', [
                    '用 H.264 + AAC 再出一条流。',
                    '可以换 Safari 对照；它的 HEVC 支持通常更好。',
                    '杜比或 AC-3 音轨也会被不少浏览器拒绝。'
                ], Object.assign({ retry: false }, base));
            case 'levelLoadError':
            case 'levelLoadTimeOut':
            case 'levelEmptyError':
                return pack('某一档画质的子清单失败了', '主清单已经读到，但其中一档的媒体播放列表没有拉下来，或是空的。', [
                    '打开「清单」，看变体表里的 URI 能否单独访问。',
                    '子清单也要允许跨域。',
                    '可以先在画质菜单里锁到另一档。'
                ], Object.assign({ retry: details !== 'levelEmptyError' }, base));
            case 'fragLoadError':
            case 'fragLoadTimeOut':
                return pack('分片没有下载下来', '播放列表是好的，但具体的视频分片失败了。直播里常见原因是分片已经滚出窗口。', [
                    '看「分片时间线」缺的是哪一段。',
                    '单独打开分片地址，确认文件存在且响应带跨域头。',
                    '直播请重新打开页面，对齐最新的播放窗口。'
                ], Object.assign({ retry: true }, base));
            case 'keyLoadError':
            case 'keyLoadTimeOut':
            case 'fragDecryptError':
                return pack('密钥没有到手，画面解不开', '清单声明了加密。密钥地址失败，或密钥和分片对不上。这里不会绕过 DRM。', [
                    'AES-128 且密钥地址允许跨域时，可以正常播。',
                    'FairPlay、Widevine、PlayReady 需要商业播放器和授权，本站不支持。',
                    '核对 EXT-X-KEY 的 URI 能否在浏览器里直接打开。'
                ], Object.assign({ retry: false }, base));
            case 'fragParsingError':
                return pack('分片内容读不懂', '下载到的字节不是完整的音视频分片，可能被网关换成了错误页。', [
                    '看分片响应的 Content-Type 和文件大小是否正常。',
                    'fMP4 流确认媒体清单里有 EXT-X-MAP。'
                ], Object.assign({ retry: false }, base));
            case 'bufferAppendError':
                return pack('分片进不了缓冲区', '分片下载到了，但和清单对不上，或缺少初始化段。', [
                    'fMP4 的每个媒体清单都应有 EXT-X-MAP。',
                    '不连续点太多时，源站需要把切片对齐。'
                ], Object.assign({ retry: true }, base));
            case 'bufferStalledError':
                return pack('缓冲暂时不够', '下载速度跟不上播放，画面停一下是在等下一段。这不一定是坏流。', [
                    '把画质锁到更低的一档。',
                    '看带宽曲线是不是刚好掉下去。',
                    '直播可以关掉低延迟，给缓冲多留几秒。'
                ], Object.assign({ retry: true, severity: 'warn' }, base));
            case 'bufferSeekOverHole':
                return pack('时间线上有一段空洞', '播放头跳过了没有数据的位置，直播不连续时会这样。', [
                    '偶尔一次会自动续上。',
                    '如果一直跳，让源站检查分片序号是否连续。'
                ], Object.assign({ retry: true, severity: 'warn' }, base));
            case 'bufferFullError':
                return pack('缓冲区满了', '前面的数据还堆着，新分片暂时进不去。一般会自己恢复。', [
                    '拖一下进度，或暂停几秒再播。'
                ], Object.assign({ retry: true, severity: 'warn' }, base));
            default:
                return pack(
                    '播放没有继续',
                    details ? ('引擎报告：' + details) : '没有更具体的错误码。',
                    [
                        '先点一条页面上的公开样例，确认这台浏览器能播。',
                        '再看「诊断」里的跨域和编码。'
                    ],
                    Object.assign({ retry: true, severity: d.fatal === false ? 'warn' : 'error' }, base)
                );
        }
    }

    function assertHttpMedia(mediaUrl) {
        var media = String(mediaUrl || '').trim();
        if (!/^https?:\/\//i.test(media)) {
            throw new Error('播放地址需要以 http:// 或 https:// 开头');
        }
        return media;
    }

    function buildShareUrl(opts) {
        var o = opts || {};
        var origin = String(o.origin || '').replace(/\/$/, '');
        var path = o.pathname || '/';
        if (path.charAt(0) !== '/') path = '/' + path;
        var media = assertHttpMedia(o.mediaUrl);
        var url = origin + path + '?url=' + encodeURIComponent(media);
        var t = Number(o.timeSec);
        if (isFinite(t) && t > 0) url += '&t=' + Math.floor(t);
        if (o.autoplay) {
            url += '&autoplay=1';
            if (o.muted) url += '&muted=1';
        } else if (o.muted) {
            url += '&muted=1';
        }
        return url;
    }

    function escapeAttr(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function buildEmbedCode(opts) {
        var o = opts || {};
        var src = buildShareUrl({
            origin: o.origin || 'https://play.digdevbox.com',
            pathname: '/',
            mediaUrl: o.mediaUrl,
            timeSec: o.timeSec,
            autoplay: !!o.autoplay,
            muted: !!o.muted
        });
        var width = String(o.width == null || o.width === '' ? '100%' : o.width).trim();
        var height = String(o.height == null || o.height === '' ? '480' : o.height).trim();
        return '<iframe src="' + escapeAttr(src) + '" width="' + escapeAttr(width) + '" height="' + escapeAttr(height) + '" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
    }

    function formatBitrate(bps) {
        var n = Number(bps);
        if (!isFinite(n) || n <= 0) return '—';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + ' Mbps';
        if (n >= 1e3) return Math.round(n / 1e3) + ' kbps';
        return Math.round(n) + ' bps';
    }

    function formatBytes(n) {
        var v = Number(n);
        if (!isFinite(v) || v < 0) return '—';
        if (v < 1024) return Math.round(v) + ' B';
        if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
        return (v / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function formatTime(s) {
        if (!isFinite(s) || s < 0) s = 0;
        s = Math.floor(s);
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        var mm = (h > 0 && m < 10 ? '0' : '') + m;
        var ss = (sec < 10 ? '0' : '') + sec;
        return (h > 0 ? h + ':' : '') + mm + ':' + ss;
    }

    function bufferAhead(currentTime, ranges) {
        var t = Number(currentTime);
        if (!isFinite(t)) t = 0;
        var ahead = 0;
        (ranges || []).forEach(function (r) {
            var start = Number(r.start);
            var end = Number(r.end);
            if (!isFinite(start) || !isFinite(end)) return;
            if (t >= start - 0.05 && t <= end) ahead = Math.max(ahead, end - t);
        });
        return Math.max(0, ahead);
    }

    function layoutSegments(segments, width, domainStart, domainEnd) {
        var w = Math.max(1, Number(width) || 1);
        var start0 = Number(domainStart) || 0;
        var end0 = Number(domainEnd);
        if (!isFinite(end0) || end0 <= start0) end0 = start0 + 0.001;
        var span = end0 - start0;
        return (segments || []).map(function (s) {
            var start = Number(s.start) || 0;
            var dur = Math.max(0, Number(s.duration) || 0);
            return {
                x: ((start - start0) / span) * w,
                w: Math.max(dur > 0 ? 1 : 0, (dur / span) * w),
                level: Number(s.level) || 0,
                start: start,
                duration: dur,
                type: s.type || 'main'
            };
        });
    }

    function sparkline(samples, width, height) {
        var w = Math.max(2, Number(width) || 2);
        var h = Math.max(2, Number(height) || 2);
        var vals = (samples || []).map(function (n) { return Number(n); }).filter(function (n) { return isFinite(n) && n >= 0; });
        if (!vals.length) return [];
        var min = Math.min.apply(null, vals);
        var max = Math.max.apply(null, vals);
        if (max === min) { max = min + 1; }
        return vals.map(function (v, i) {
            var x = vals.length === 1 ? w / 2 : (i / (vals.length - 1)) * (w - 1);
            var y = h - 1 - ((v - min) / (max - min)) * (h - 2);
            return { x: x, y: y, v: v };
        });
    }

    return {
        LEVEL_COLORS: LEVEL_COLORS,
        normalizeUrl: normalizeUrl,
        classifySource: classifySource,
        resolveUrl: resolveUrl,
        parseAttrs: parseAttrs,
        parseM3u8: parseM3u8,
        parseMpd: parseMpd,
        explainPlaybackError: explainPlaybackError,
        buildShareUrl: buildShareUrl,
        buildEmbedCode: buildEmbedCode,
        formatBitrate: formatBitrate,
        formatBytes: formatBytes,
        formatTime: formatTime,
        bufferAhead: bufferAhead,
        layoutSegments: layoutSegments,
        sparkline: sparkline
    };
});

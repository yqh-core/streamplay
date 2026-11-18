import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../js/stream-core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha8 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 8);

const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="中文",LANGUAGE="zh",DEFAULT=NO,URI="zh.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",FRAME-RATE=30,AUDIO="aac",SUBTITLES="subs"
mid/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.42c01e,mp4a.40.2",AUDIO="aac"
low/index.m3u8
`;

const MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:4
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-KEY:METHOD=AES-128,URI="https://example.com/key.bin"
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.0,
seg0.m4s
#EXT-X-DISCONTINUITY
#EXTINF:4.0,
seg1.m4s
#EXTINF:5.5,
seg2.m4s
#EXT-X-ENDLIST
`;

const MPD = `<?xml version="1.0"?>
<MPD type="static" mediaPresentationDuration="PT30S">
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video" codecs="avc1.4d401f">
      <Representation id="v1" bandwidth="800000" width="640" height="360">
        <BaseURL>v360.mp4</BaseURL>
      </Representation>
      <Representation id="v2" bandwidth="2500000" width="1280" height="720" codecs="avc1.64001f">
        <BaseURL>v720.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" contentType="audio">
      <Representation id="a1" bandwidth="128000" codecs="mp4a.40.2">
        <BaseURL>a.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

test('classify and normalize stream urls', () => {
    assert.equal(core.classifySource('https://cdn.example/a.m3u8?token=1'), 'hls');
    assert.equal(core.classifySource('https://cdn.example/a.mpd'), 'dash');
    assert.equal(core.classifySource('https://cdn.example/a.mp4#t=1'), 'file');
    assert.equal(core.classifySource('https://cdn.example/live'), 'unknown');
    assert.equal(core.normalizeUrl('cdn.example/a.m3u8'), 'https://cdn.example/a.m3u8');
    assert.equal(core.normalizeUrl('//cdn.example/a.mpd'), 'https://cdn.example/a.mpd');
});

test('parse master playlist variants and rendition groups', () => {
    const info = core.parseM3u8(MASTER, 'https://cdn.example/live/master.m3u8');
    assert.equal(info.valid, true);
    assert.equal(info.isMaster, true);
    assert.equal(info.variants.length, 2);
    assert.equal(info.variants[0].BANDWIDTH, '2500000');
    assert.equal(info.variants[0].RESOLUTION, '1280x720');
    assert.equal(info.variants[0]['FRAME-RATE'], '30');
    assert.equal(info.variants[0].AUDIO, 'aac');
    assert.equal(info.variants[0].uri, 'https://cdn.example/live/mid/index.m3u8');
    assert.equal(info.variants[1].uri, 'https://cdn.example/live/low/index.m3u8');
    assert.equal(info.media.length, 2);
    assert.equal(info.media[0].TYPE, 'AUDIO');
    assert.equal(info.media[1].NAME, '中文');
});

test('parse media playlist segments, encryption, init map', () => {
    const info = core.parseM3u8(MEDIA, 'https://cdn.example/v/');
    assert.equal(info.isMaster, false);
    assert.equal(info.version, '3');
    assert.equal(info.targetDuration, 6);
    assert.equal(info.mediaSequence, 4);
    assert.equal(info.playlistType, 'VOD');
    assert.equal(info.endList, true);
    assert.equal(info.encrypted, true);
    assert.equal(info.keyMethod, 'AES-128');
    assert.equal(info.initSegment, 'https://cdn.example/v/init.mp4');
    assert.equal(info.discontinuities, 1);
    assert.equal(info.segments.length, 3);
    assert.equal(info.segments[2].uri, 'https://cdn.example/v/seg2.m4s');
    assert.ok(Math.abs(info.totalDuration - 15.5) < 0.01);
});

test('parse MPD representations and resolve base urls', () => {
    const mpd = core.parseMpd(MPD, 'https://cdn.example/dash/manifest.mpd');
    assert.equal(mpd.isMpd, true);
    assert.equal(mpd.type, 'static');
    assert.equal(mpd.duration, 'PT30S');
    assert.equal(mpd.representations.length, 3);
    assert.equal(mpd.representations[0].height, 360);
    assert.equal(mpd.representations[0].bandwidth, 800000);
    assert.equal(mpd.representations[0].codecs, 'avc1.4d401f');
    assert.equal(mpd.representations[0].baseUrl, 'https://cdn.example/dash/v360.mp4');
    assert.equal(mpd.representations[1].codecs, 'avc1.64001f');
    assert.equal(mpd.representations[2].contentType, 'audio');
});

test('error advice names a cause and a next step', () => {
    const cors = core.explainPlaybackError({ details: 'manifestLoadError', httpCode: 0, fatal: true });
    assert.match(cors.title, /没有拿到清单/);
    assert.ok(cors.steps.length >= 2);
    assert.equal(cors.retry, true);
    assert.match(cors.steps.join(' '), /Access-Control-Allow-Origin/);

    const missing = core.explainPlaybackError({ details: 'manifestLoadError', httpCode: 404 });
    assert.equal(missing.retry, false);
    assert.match(missing.title, /找不到/);

    const denied = core.explainPlaybackError({ details: 'manifestLoadError', httpCode: 403 });
    assert.equal(denied.retry, false);
    assert.match(denied.cause, /403/);

    const parse = core.explainPlaybackError({ details: 'manifestParsingError' });
    assert.equal(parse.retry, false);
    assert.match(parse.cause, /HTML|截断|解析/);

    const stall = core.explainPlaybackError({ details: 'bufferStalledError', fatal: false });
    assert.equal(stall.severity, 'warn');
    assert.match(stall.steps[0], /画质/);

    const key = core.explainPlaybackError({ details: 'keyLoadError' });
    assert.match(key.cause + key.steps.join(''), /DRM|AES-128/);
    assert.equal(key.retry, false);

    const codec = core.explainPlaybackError({ details: 'bufferAddCodecError' });
    assert.match(codec.steps.join(' '), /H\.264/);

    const dashDrm = core.explainPlaybackError({ protocol: 'dash', code: 112 });
    assert.equal(dashDrm.retry, false);
    assert.match(dashDrm.title, /DRM/);

    const dashLoad = core.explainPlaybackError({ protocol: 'dash', code: 11 });
    assert.match(dashLoad.title, /清单/);

    const frag = core.explainPlaybackError({ details: 'fragLoadError', httpCode: 0 });
    assert.match(frag.steps.join(' '), /分片时间线/);
});

test('share links encode query characters and embed stays muted for autoplay', () => {
    const share = core.buildShareUrl({
        origin: 'https://play.digdevbox.com',
        pathname: '/',
        mediaUrl: 'https://cdn.example/a.m3u8?token=ab&exp=1',
        timeSec: 12.8
    });
    assert.equal(share, 'https://play.digdevbox.com/?url=' + encodeURIComponent('https://cdn.example/a.m3u8?token=ab&exp=1') + '&t=12');
    assert.doesNotMatch(share.split('url=')[1], /&exp=/);

    const code = core.buildEmbedCode({
        mediaUrl: 'https://cdn.example/a.mpd',
        width: '100%',
        height: 360,
        autoplay: true,
        muted: true,
        timeSec: 0
    });
    assert.match(code, /allowfullscreen/);
    assert.match(code, /muted=1/);
    assert.match(code, /autoplay=1/);
    assert.doesNotMatch(code, /<script/i);

    assert.throws(() => core.buildShareUrl({ origin: 'https://play.digdevbox.com', mediaUrl: 'javascript:alert(1)' }));
});

test('timeline layout, buffer and bitrate formatting', () => {
    const bars = core.layoutSegments([
        { start: 0, duration: 4, level: 0 },
        { start: 4, duration: 4, level: 1 }
    ], 200, 0, 8);
    assert.equal(bars.length, 2);
    assert.ok(Math.abs(bars[0].w - 100) < 0.01);
    assert.ok(Math.abs(bars[1].x - 100) < 0.01);
    assert.equal(bars[1].level, 1);

    assert.equal(core.bufferAhead(10, [{ start: 0, end: 8 }, { start: 9.9, end: 16 }]).toFixed(1), '6.0');
    assert.equal(core.formatBitrate(2500000), '2.50 Mbps');
    assert.equal(core.formatBitrate(0), '—');
    assert.equal(core.formatTime(65), '1:05');

    const line = core.sparkline([1, 2, 3], 10, 10);
    assert.equal(line.length, 3);
    assert.ok(line[2].y < line[0].y);
});

test('vendored dash.js url in the player matches the file hash', () => {
    const hash = sha8(join(ROOT, 'libs/dash.all.min.js'));
    const player = readFileSync(join(ROOT, 'js/player.js'), 'utf8');
    assert.match(player, new RegExp('libs/dash\\.all\\.min\\.js\\?v=' + hash));
    assert.match(readFileSync(join(ROOT, 'libs/dash.js.LICENSE.txt'), 'utf8'), /BSD/);
});

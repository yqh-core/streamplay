#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/m3u8-parser.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(source, { window, URL, parseFloat, parseInt }, { filename: 'js/m3u8-parser.js' });
const parseManifest = window.StreamPlayM3U8Parser.parseManifest;

const master = parseManifest([
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="audio/en.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"',
  'video/720p.m3u8'
].join('\n'), 'https://cdn.example.test/master.m3u8');
assert.equal(master.isMaster, true);
assert.equal(master.version, '7');
assert.equal(master.media.length, 1);
assert.equal(master.variants.length, 1);
assert.equal(master.variants[0].BANDWIDTH, '1280000');
assert.equal(master.variants[0].CODECS, 'avc1.640028,mp4a.40.2', 'quoted comma-bearing CODECS attribute must remain intact');
assert.equal(master.variants[0].uri, 'https://cdn.example.test/video/720p.m3u8');

const vod = parseManifest([
  '#EXTM3U',
  '#EXT-X-TARGETDURATION:6',
  '#EXT-X-MEDIA-SEQUENCE:42',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXTINF:5.5,',
  'seg-42.ts',
  '#EXTINF:6,',
  'seg-43.ts',
  '#EXT-X-ENDLIST'
].join('\r\n'), 'https://cdn.example.test/live/index.m3u8');
assert.equal(vod.targetDuration, 6);
assert.equal(vod.mediaSequence, 42);
assert.equal(vod.playlistType, 'VOD');
assert.equal(vod.endList, true);
assert.equal(vod.segments.length, 2);
assert.equal(vod.segments[0].uri, 'https://cdn.example.test/live/seg-42.ts');
assert.equal(vod.totalDuration, 11.5);

for (const kind of ['VOD', 'LIVE', 'EVENT']) {
  const parsed = parseManifest('#EXTM3U\n#EXT-X-PLAYLIST-TYPE:' + kind, 'https://example.test/list.m3u8');
  assert.equal(parsed.playlistType, kind);
}
const empty = parseManifest('#EXTM3U\n#EXT-X-TARGETDURATION:\n#EXT-X-MEDIA-SEQUENCE:\n#EXT-X-PLAYLIST-TYPE:', 'https://example.test/a.m3u8');
assert.equal(empty.targetDuration, 0);
assert.equal(empty.mediaSequence, 0);
assert.equal(empty.playlistType, '');
const missing = parseManifest('#EXTM3U', 'https://example.test/a.m3u8');
assert.equal(missing.targetDuration, 0);
assert.equal(missing.mediaSequence, 0);
assert.equal(missing.playlistType, '');
const invalid = parseManifest(null, 'https://example.test/a.m3u8');
assert.equal(invalid.segments.length, 0);
assert.equal(invalid.variants.length, 0);

const encrypted = parseManifest('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"', 'https://example.test/a.m3u8');
assert.equal(encrypted.encrypted, true);
assert.equal(encrypted.keyMethod, 'AES-128');
const clear = parseManifest('#EXTM3U\n#EXT-X-KEY:METHOD=NONE', 'https://example.test/a.m3u8');
assert.equal(clear.encrypted, false);
assert.equal(clear.keyMethod, '');

console.log('PASS: production M3U8 parser — master/media, offsets, CRLF, VOD/LIVE/EVENT, empty/missing/invalid input, encryption marker');

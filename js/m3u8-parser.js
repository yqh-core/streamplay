/* StreamPlay M3U8 manifest parser. Shared by the browser player and Node regression tests. */
(function (root) {
  'use strict';

  function resolveUrl(uri, base) {
    try { return new URL(uri, base).href; } catch (e) { return uri; }
  }

  /* 属性列表解析：KEY=VALUE,KEY2="带,逗号",RESOLUTION=1280x720 */
  function parseAttrs(s) {
      var out = {};
      var re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
      var m;
      while ((m = re.exec(s)) !== null) {
          out[m[1]] = m[2].replace(/^"|"$/g, '');
      }
      return out;
  }

  function parseManifest(text, baseUrl) {
      var lines = (typeof text === 'string' ? text : '').split(/\r?\n/);
      var info = {
          isMaster: false, version: '', targetDuration: 0, mediaSequence: 0,
          playlistType: '', endList: false, variants: [], media: [],
          segments: [], totalDuration: 0, encrypted: false, keyMethod: '',
          initSegment: '', discontinuities: 0
      };
      var pendingVariant = null;
      var pendingExtinf = 0;
      for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
              info.isMaster = true;
              pendingVariant = parseAttrs(line.slice(18));
          } else if (line.indexOf('#EXT-X-MEDIA:') === 0) {
              info.media.push(parseAttrs(line.slice(13)));
          } else if (line.indexOf('#EXT-X-VERSION:') === 0) {
              info.version = line.slice(15);
          } else if (line.indexOf('#EXT-X-TARGETDURATION:') === 0) {
              info.targetDuration = parseFloat(line.slice('#EXT-X-TARGETDURATION:'.length)) || 0;
          } else if (line.indexOf('#EXT-X-MEDIA-SEQUENCE:') === 0) {
              info.mediaSequence = parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length), 10) || 0;
          } else if (line.indexOf('#EXT-X-PLAYLIST-TYPE:') === 0) {
              info.playlistType = line.slice('#EXT-X-PLAYLIST-TYPE:'.length);
          } else if (line.indexOf('#EXT-X-ENDLIST') === 0) {
              info.endList = true;
          } else if (line.indexOf('#EXT-X-KEY:') === 0) {
              var keyAttrs = parseAttrs(line.slice(11));
              if (keyAttrs.METHOD && keyAttrs.METHOD !== 'NONE') {
                  info.encrypted = true;
                  info.keyMethod = keyAttrs.METHOD;
              }
          } else if (line.indexOf('#EXT-X-MAP:') === 0) {
              var mapAttrs = parseAttrs(line.slice(11));
              if (mapAttrs.URI) info.initSegment = resolveUrl(mapAttrs.URI, baseUrl);
          } else if (line.indexOf('#EXT-X-DISCONTINUITY') === 0) {
              info.discontinuities++;
          } else if (line.indexOf('#EXTINF:') === 0) {
              pendingExtinf = parseFloat(line.slice(8)) || 0;
          } else if (line[0] !== '#') {
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


  root.StreamPlayM3U8Parser = Object.freeze({ parseManifest: parseManifest });
}(window));

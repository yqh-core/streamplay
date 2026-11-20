# StreamPlay US/EU SEO keyword map — 2026-11-20

Research baseline from the repository's English pages and sitemap. Candidate phrases are not search-volume claims. No new URLs are proposed in this pass.

## Positioning and limits

StreamPlay is a browser-based M3U8/HLS and MP4 player with playlist inspection, embed generation and troubleshooting guidance. The browser still depends on source-host CORS, codecs, authentication and DRM rules. Do not imply the player bypasses them or supports DRM-protected playback.

## Verified canonical inventory

The source sitemap lists 10 canonical URLs:
- https://play.digdevbox.com/
- https://play.digdevbox.com/m3u8-player/
- https://play.digdevbox.com/docs/
- https://play.digdevbox.com/guides/
- https://play.digdevbox.com/faq/
- https://play.digdevbox.com/about/
- https://play.digdevbox.com/contact/
- https://play.digdevbox.com/copyright/
- https://play.digdevbox.com/privacy/
- https://play.digdevbox.com/terms/

The five search-intent pages below have unique English title, description, canonical and H1 in source.

## Keyword-to-page map

| Priority | Canonical | Primary phrase | Supporting candidate phrases | Content action |
|---|---|---|---|---|
| P0 | /m3u8-player/ | M3U8 player | online M3U8 player; HLS player online; play M3U8 URL; HLS video player; MP4 URL player | Make this the primary conversion landing page. Explain paste URL → play, supported formats, master vs media playlist, and browser limitations. |
| P0 | / | M3U8 & HLS player | free HLS player; online stream player; M3U8 stream tester; embed HLS player | Keep homepage as product overview. Link prominently to player landing, guides, docs and FAQ. Avoid competing with /m3u8-player/ for the exact same page title intent. |
| P1 | /guides/ | how to play an M3U8 URL | how to embed M3U8 player; HLS playback troubleshooting; test HLS stream; M3U8 player tutorial | Add distinct task walkthroughs and link each to the player. Keep instructions aligned with the live UI and actual query parameter behavior. |
| P1 | /docs/ | HLS M3U8 documentation | M3U8 playlist tags; HLS master playlist; EXT-X tags; MPEG-TS vs fMP4; HLS CORS | Structure reference content by playlist/tag/segment concept. Link to troubleshooting guide and player. No unsupported claims about analyzing DRM or decrypting streams. |
| P1 | /faq/ | M3U8 player not working | HLS CORS error; HLS codec not supported; autoplay blocked; M3U8 403; iframe HLS player | Use concise cause → test → remedy answers. State that the source host controls CORS/auth and browser codec support. |
| P2 | /guides/ + /docs/ | HLS playlist analyzer | M3U8 master playlist analyzer; inspect HLS variants; HLS media playlist; EXT-X-STREAM-INF | Keep only if the live product exposes the corresponding playlist inspection; use screenshots/examples from real test manifests. Do not create a duplicate analyzer URL without a distinct workflow. |
| P2 | /guides/ | embed M3U8 player | iframe HLS player; embed M3U8 stream; HLS player iframe code | Provide a copyable, URL-encoded iframe example. Explain that embedding does not bypass CORS, authentication or DRM. |

## Internal-link plan

- Homepage → /m3u8-player/ as primary task CTA; homepage → /guides/, /docs/, /faq/ as support.
- /m3u8-player/ → /guides/ for setup and troubleshooting; → /faq/ for common browser errors; → /docs/ for playlist semantics.
- /guides/ → player CTA for each task; → docs for technical terms; → FAQ for failure paths.
- /docs/ → guides for practical testing; → player for hands-on playback.
- /faq/ answers should link to the exact relevant guide/docs section, not just the homepage.

## Technical/content release checks

1. Crawl all 10 sitemap URLs and confirm HTTP 200, indexability, self-canonical and unique title/description/H1.
2. Ensure no sitemap URL redirects to a different canonical or returns thin/empty content.
3. Check language alternates for the /zh/ pages; confirm reciprocal hreflang and canonical strategy before changing multilingual metadata.
4. Validate the iframe example with a permitted public test stream and confirm query encoding.
5. Validate master/media playlist examples and HLS tags against sample manifests.
6. Check links and anchors between player, guide, docs and FAQ; no orphaned search-intent page.
7. Pull GSC/Bing PageStats and QueryStats for play.digdevbox.com before/after; source metadata and sitemap do not prove indexing or traffic.

## Evidence boundaries

Inspected on 2026-11-20: README.md, sitemap.xml, index.html, m3u8-player/index.html, docs/index.html, faq/index.html and guides/index.html. The exact current titles/descriptions/H1s are in those source files. No StreamPlay-specific GSC/Bing export is included in this pass; all phrase expansions are candidate intent variants, not validated volume.

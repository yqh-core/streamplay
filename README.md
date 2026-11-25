# StreamPlay — M3U8 / HLS Player and Stream Inspector

**Production site:** https://play.digdevbox.com  
**Repository:** https://github.com/yqh-core/streamplay  
**Portfolio status:** MAINTAIN / selective growth — prioritize reliability and improvements to existing playback and inspection workflows; do not expand scope without evidence.

StreamPlay is a static, browser-based player for HLS/M3U8 streams and browser-supported media such as MP4. It uses a locally hosted hls.js build for browsers that need Media Source Extensions and native playback where the browser supports it. The product also provides stream-inspection and embed-oriented workflows; confirm exact current UI behavior before documenting new capabilities.

## Core behavior

- Accept an HLS/M3U8 or supported media URL and attempt browser playback.
- Use hls.js for browsers without native HLS playback; use native playback where available.
- Surface actionable errors for network, CORS, codec and unsupported-format cases.
- Support URL-driven playback for embed/deep-link workflows.
- Keep the playback runtime's libraries local to the repository rather than relying on a third-party player CDN.

Playback is subject to browser codec support, source availability and the media server's CORS policy. StreamPlay cannot override a remote server's CORS restrictions or make unsupported codecs playable.

## Local development

The repository is a static site and no root `package.json` was found in the handoff check. There is no npm build step documented. From the repository root, run:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/`. Test using a stream URL you are authorized to access. Some sources will not play locally if their server blocks cross-origin browser requests.

## Release and CI model

The workflow at `.github/workflows/deploy-cloudflare-pages.yml` documents the intended release separation:

- `verify` runs on pushes and pull requests. It checks required site files and local asset references, then assembles the static `dist/` artifact.
- The workflow's Wrangler `deploy` job is manual (`workflow_dispatch`) for explicitly selected branch environments.
- The workflow comments document Cloudflare Pages Git integration as the normal main-branch production and PR-preview path. Verify the live Cloudflare project configuration before relying on that assumption.

Do not enable two independent production deployment paths that can overwrite one another. Do not store Cloudflare tokens in documentation or source files.

## Maintainer checks

- [ ] Confirm the change improves an existing playback, inspection, embed, accessibility or reliability workflow.
- [ ] Check the existing issue/PR and current branch before editing.
- [ ] Verify required files and every local asset reference.
- [ ] Test HLS and MP4 paths in supported browsers; include a CORS-blocked and unsupported-codec case.
- [ ] Check deep-link/embed behavior and error recovery.
- [ ] Check desktop and mobile layout, including iOS inline playback behavior where applicable.
- [ ] Verify analytics consent and inspect relevant Network requests when privacy behavior changes.
- [ ] Record exact commit, workflow job steps, Preview URL and production verification separately.

## Important boundaries

- A passing static-file verification is not a browser playback test.
- A workflow success is not production verification; inspect each job's steps and tested commit SHA.
- A Preview deployment is not the production domain.
- A successful playback of one test stream does not prove all third-party streams are supported.
- Current production status must be verified against the exact deployed commit and real browser behavior.

## Documentation note

The previous README contained extensive Chinese-language deployment walkthroughs and historical Cloudflare limits that can become stale. This version keeps the operationally important architecture and workflow boundaries concise; consult the workflow file and current Cloudflare owner configuration for live release details.
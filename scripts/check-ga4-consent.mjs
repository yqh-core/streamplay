import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = 'G-2Y9T6LFG5W';
const htmlFiles = [
  'index.html',
  'm3u8-player/index.html',
  'about.html',
  'contact.html',
  'copyright.html',
  'docs.html',
  'faq.html',
  'guides.html',
  'privacy.html',
  'terms.html',
];
const failures = [];
for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  if (!html.includes('/analytics-consent.js')) failures.push(file + ': missing consent script');
  if (html.includes('googletagmanager.com/gtag/js')) failures.push(file + ': GA4 must not be loaded directly before consent');
}
const script = fs.readFileSync(path.join(root, 'analytics-consent.js'), 'utf8');
const checks = [
  ['correct StreamPlay Measurement ID', new RegExp(id)],
  ['explicit consent storage', /localStorage\.setItem\(CONSENT_KEY, value\)/],
  ['analytics denied by default', /analytics_storage:\\s*'denied'/],
  ['query string excluded', /location\.origin \+ location\.pathname/],
  ['noindex page view blocked', /isNoindexPage\(\)/],
  ['duplicate route views blocked', /path === lastPage/],
  ['automatic page_view disabled', /send_page_view:\\s*false/],
  ['Google Analytics-specific consent labels', /Accept Google Analytics[\\s\\S]*Reject Google Analytics/],
  ['stream URLs and playback content excluded', /never send M3U8\/MP4 stream URLs, playback content, or URL query parameters/],
];
for (const [label, pattern] of checks) if (!pattern.test(script)) failures.push('analytics-consent.js: ' + label);
const privacy = fs.readFileSync(path.join(root, 'privacy.html'), 'utf8');
for (const term of ['Google Analytics 4', 'M3U8 / MP4', '不会发出 GA4 请求', 'Privacy choices']) {
  if (!privacy.includes(term)) failures.push('privacy.html: missing disclosure ' + term);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('[GA4 consent] PASS: all ten public HTML pages, correct ID, opt-in gate, safe URL and privacy disclosure');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const faq = html.match(
  /<details>\s*<summary>Why does a stream fail to load or keep buffering\?<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/i,
);
assert.ok(faq, 'visible playback troubleshooting FAQ must exist');

const answerHtml = faq[1];
const guideLinks = [...answerHtml.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
assert.equal(guideLinks.length, 1, 'visible answer must contain exactly one guide link');
assert.equal(
  guideLinks[0][1],
  'https://notes.digdevbox.com/posts/m3u8-hls-cors-troubleshooting',
  'visible answer must point to the canonical HLS troubleshooting guide',
);
assert.equal(guideLinks[0][2].replace(/<[^>]+>/g, '').trim(), 'HLS troubleshooting guide');

const visibleText = answerHtml
  .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const jsonLdScripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]
  .map((match) => JSON.parse(match[1]));
const faqPage = jsonLdScripts.find((item) => item['@type'] === 'FAQPage');
assert.ok(faqPage, 'FAQPage JSON-LD must exist');
const question = faqPage.mainEntity?.find(
  (item) => item.name === 'Why does a stream fail to load or keep buffering?',
);
assert.ok(question, 'FAQPage JSON-LD must include the playback troubleshooting question');
assert.equal(
  question.acceptedAnswer.text,
  visibleText,
  'FAQPage answer must match the visible FAQ answer text',
);
assert.equal((visibleText.match(/step-by-step checklist/g) || []).length, 1);
assert.ok(!visibleText.includes('step-by-step browser checklist'));

console.log('[copy-quality] PASS: one guide link, no repeated instruction, visible FAQ and FAQPage answer match');

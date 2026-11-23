import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const index = readFileSync('index.html', 'utf8');
const player = readFileSync('js/player.js', 'utf8');
const runtime = readFileSync('js/dd-i18n.js', 'utf8');
const en = JSON.parse(readFileSync('locales/en.json', 'utf8'));
const zh = JSON.parse(readFileSync('locales/zh.json', 'utf8'));

const dataMatch = index.match(/<script id="dd-i18n-data">window\.DD_I18N_DATA = ([\s\S]*?);<\/script>/);
assert.ok(dataMatch, 'index.html must embed locale data before runtime execution');
const embedded = JSON.parse(dataMatch[1]);
assert.deepEqual(embedded.en, en, 'embedded English locale must exactly match locales/en.json');
assert.deepEqual(embedded.zh, zh, 'embedded Chinese locale must exactly match locales/zh.json');

const dataAt = index.indexOf('id="dd-i18n-data"');
const runtimeAt = index.indexOf('js/dd-i18n.js');
assert.ok(dataAt >= 0 && runtimeAt > dataAt, 'locale payload must precede the shared runtime');
assert.match(index, /<script defer src="\.\/js\/dd-i18n\.js\?v=[a-f0-9]{8}"><\/script>/);
assert.match(index, /id="dd-lang-toggle"/, 'language toggle must exist for the shared runtime');

const keys = [...player.matchAll(/maT\(\s*['"](ma\.[^'"]+)['"]/g)].map((match) => match[1]);
assert.ok(keys.length >= 40, 'expected the analyzer to use the shared locale dictionary');
for (const key of new Set(keys)) {
  assert.equal(typeof en[key], 'string', 'missing English key: ' + key);
  assert.ok(en[key].trim(), 'empty English key: ' + key);
  assert.equal(typeof zh[key], 'string', 'missing Chinese key: ' + key);
  assert.ok(zh[key].trim(), 'empty Chinese key: ' + key);
}
const analyzer = player.slice(player.indexOf('/* ------------------------------------------------------------ M3U8 清单分析'), player.indexOf('/* ------------------------------------------------------------ 嵌入代码生成器'));
assert.doesNotMatch(analyzer, /maSetStatus\(\s*['"][^'"]*[\u4e00-\u9fff]/, 'analyzer status messages must use translation keys');
assert.doesNotMatch(analyzer, /maChip\(\s*['"][^'"]*[\u4e00-\u9fff]/, 'analyzer chips must use translation keys');
assert.doesNotMatch(analyzer, /maSection\(\s*['"][^'"]*[\u4e00-\u9fff]/, 'analyzer sections must use translation keys');

function runLocale(languages, storedLocale) {
  let toggleHandler = null;
  let stored = storedLocale || null;
  const button = {
    textContent: '',
    attributes: {},
    addEventListener(type, handler) { if (type === 'click') toggleHandler = handler; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const root = {
    attributes: { 'data-i18n-page': 'home' },
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const context = {
    window: { DD_I18N_DATA: embedded },
    navigator: { languages, language: languages[0] || 'en' },
    localStorage: {
      getItem() { return stored; },
      setItem(_key, value) { stored = value; }
    },
    document: {
      documentElement: root,
      querySelectorAll() { return []; },
      querySelector() { return null; },
      getElementById(id) { return id === 'dd-lang-toggle' ? button : null; }
    }
  };
  vm.runInNewContext(runtime, context);
  return { api: context.window.DD_I18N, button, getStored: () => stored, getToggle: () => toggleHandler, root };
}

const english = runLocale(['en-US'], null);
assert.equal(english.api.locale, 'en');
assert.equal(english.api.t('ma.type'), 'Type');
assert.equal(english.root.attributes.lang, 'en');

const chinese = runLocale(['zh-CN'], null);
assert.equal(chinese.api.locale, 'zh');
assert.equal(chinese.api.t('ma.type'), '类型');
assert.equal(chinese.root.attributes.lang, 'zh-CN');

const savedChoice = runLocale(['zh-CN'], 'en');
assert.equal(savedChoice.api.locale, 'en', 'saved language choice must override browser language');
savedChoice.getToggle()();
assert.equal(savedChoice.api.locale, 'zh', 'language toggle must switch to Chinese');
assert.equal(savedChoice.getStored(), 'zh', 'language toggle must persist the choice');

console.log('[m3u8-i18n] PASS: embedded locale parity, key coverage, shared runtime, EN/ZH detection, persisted choice and toggle');

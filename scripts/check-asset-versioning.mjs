#!/usr/bin/env node
/**
 * 静态资源版本串门禁（G-ASSET-VER）
 *
 * 判什么：_headers 已把 /js/*.js 与 /libs/*.js 设成 max-age=31536000, immutable。
 * 长缓存只有在「内容变 → URL 变」时才安全，所以每个被 HTML 引用的这些资源**必须**带 ?v=<内容哈希前8位>，
 * 且版本串必须等于该文件当前真实哈希。改了文件忘 bump 版本 = 回访用户拿旧内容一年，这条必须判红。
 *
 * 退出码：0 = 全部合规；1 = 有不合规（逐条列出）；2 = UNDECIDED（找不到 HTML / 找不到资源文件，
 * 属环境或路径问题，**不得**当成"检查通过"）。
 *
 * 自带证伪：`--falsify` 在内存里造三类坏样本（缺版本串 / 版本串过期 / 资源文件不存在），
 * 断言每一条都能被判红；任一判绿即本门禁是摆设 → exit 1。不写盘、不碰真实文件。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LONG_CACHE_PREFIXES = ['/js/', '/libs/'];

const sha8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);

/**
 * 脚本自身异常 → exit 2（UNDECIDED），绝不混进 exit 1（FAIL）。
 * 否则「门禁写崩了」和「门禁查出问题」在 CI 里长得一模一样，
 * 前者会让人去修站点，后者才该修代码。
 */
process.on('uncaughtException', (e) => {
  console.error('UNDECIDED(exit 2)：门禁脚本自身异常，本次结果不可信 —— ' + e.message);
  process.exit(2);
});

/** 核心检查：接收 root 与「读文件」函数，便于 --falsify 用内存夹具复用同一条逻辑 */
function check(root, read) {
  const problems = [];
  let checked = 0;
  const htmls = readdirSync(root).filter((f) => f.endsWith('.html'));
  if (!htmls.length) return { fatal: '仓库根目录找不到任何 .html —— 扫描覆盖自证失败，不得判过', problems: [], checked: 0 };
  for (const f of htmls) {
    const raw = read(join(root, f));
    // read() 返回 Buffer（资源要按字节算哈希），HTML 必须先转字符串再 matchAll。
    // 首版直接对 Buffer 调 matchAll → TypeError 崩溃，而崩溃的退出码是 1，
    // 看起来像"判红"、其实是脚本坏了 —— 脚本异常必须走 UNDECIDED(2)，不能混进 FAIL(1)。
    const t = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw ?? '');
    for (const m of t.matchAll(/(?:src|href)="([^"]*?\.(?:js|css))(?:\?v=([0-9a-zA-Z]+))?"/g)) {
      const raw = m[1];
      // 排除绝对 URL：致谢链接 https://github.com/video-dev/hls.js 以 .js 结尾，
      // 首版把它当站内资源要求版本串 → 假红。只查本站路径。
      if (/^https?:\/\//i.test(raw) || /^\/\//.test(raw)) continue;
      const rel = raw.replace(/^(\.\/|\/)/, '').split('?')[0];
      // 括号是必需的：`'/' + rel.startsWith(p)` 会被解析成 `'/' + (rel.startsWith(p))`，
      // 结果恒为真值字符串，导致门禁把所有 js/css 引用都当长缓存路径查（首版就踩了）。
      if (!LONG_CACHE_PREFIXES.some((p) => ('/' + rel).startsWith(p))) continue;
      if (!existsSync(join(root, rel))) { problems.push(`${f}: 引用 ${raw} 但资源文件不存在`); continue; }
      checked++;
      const ver = m[2];
      if (!ver) { problems.push(`${f}: ${rel} 缺 ?v= 版本串，却落在长缓存路径下`); continue; }
      const want = sha8(read(join(root, rel)));
      if (ver !== want) problems.push(`${f}: ${rel} 版本串 ${ver} ≠ 当前内容哈希 ${want}（改了文件忘 bump）`);
    }
  }
  if (checked === 0) return { fatal: '长缓存路径下扫到 0 个资源引用 —— 判据空转，不得判过', problems, checked };
  return { fatal: null, problems, checked, htmlCount: htmls.length };
}

const readBuf = (p) => { try { return readFileSync(p); } catch { return null; } };

if (process.argv.includes('--falsify')) {
  console.log('=== G-ASSET-VER 证伪自检（内存夹具，不写盘）===');
  const realHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
  if (!/player\.js\?v=/.test(realHtml)) { console.error('真实 index.html 里没有已版本化的引用，夹具无从构造 → UNDECIDED'); process.exit(2); }
  const good = realHtml;
  const cases = [
    ['缺版本串', good.replace(/(player\.js)\?v=[0-9a-f]+/g, '$1'), true],
    ['版本串过期', good.replace(/(player\.js)\?v=[0-9a-f]+/g, '$1?v=deadbeef'), true],
    ['资源文件不存在', good.replace(/(player\.js)\?v=[0-9a-f]+/g, 'js/__no_such__.js?v=11111111'), true],
    ['合规对照组（原样）', good, false],
  ];
  let allGood = true;
  for (const [name, html, expectRed] of cases) {
    const fakeRoot = ROOT;
    const res = check(fakeRoot, (p) => (p.endsWith('.html') && p.includes('index.html') ? Buffer.from(html, 'utf8') : readBuf(p)));
    const red = res.problems.length > 0;
    const ok = red === expectRed;
    if (!ok) allGood = false;
    console.log(`  ${ok ? '✓' : '✗'} ${name} → 期望 ${expectRed ? '判红' : '判绿'}，实际 ${red ? '判红' : '判绿'}${red ? '（' + res.problems[0].slice(0, 62) + '）' : ''}`);
  }
  console.log(allGood ? '\nG-ASSET-VER 自检：正反例均符合预期' : '\nG-ASSET-VER 自检：存在判据空转，门禁不可信');
  process.exit(allGood ? 0 : 1);
}

const res = check(ROOT, readBuf);
if (res.fatal) { console.error('UNDECIDED(exit 2)：' + res.fatal); process.exit(2); }
if (res.problems.length) {
  console.error(`G-ASSET-VER FAIL：${res.problems.length} 项（已核 ${res.checked} 个长缓存路径引用 / ${res.htmlCount} 个 HTML）`);
  for (const p of res.problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log(`G-ASSET-VER PASS：${res.checked} 个长缓存路径引用的 ?v= 全部等于当前内容哈希（扫 ${res.htmlCount} 个 HTML）`);
process.exit(0);

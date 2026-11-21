# PR #25 Second Review — Final（2026-11-21）

审查对象：PR #25（head `0cfa15235b1fcc291535a280ede09d971b69392d`）的 parser-load 容错修复。
本文件回应第二轮独立 Review 的 CONDITIONAL PASS 缺口，逐项给出证据、命令、结果与合并建议。

## 一、第二轮 Review 提出的缺口 → 处置

| 缺口 | 处置 | 证据 |
|---|---|---|
| 测试相对路径错（提交位置跑不起来） | **已修**：测试改为位置无关解析器，候选 `../js/player.js` → `./player.fixed.js` → `./player.js` | 见下「二」两处运行 |
| 执行命令与实际存放不符 | **已修**：头注释改为「可从 scripts/ 或证据目录运行」，并打印实际读取来源 | 运行输出首行 |
| 缺「非函数 parseManifest」场景 | **已加**：场景 D（`parseManifest:'oops'`） | 门禁日志 |
| Proxy 过宽 / 无真实 DOM | **已补真实浏览器核查**：正常路径 + 降级路径，控制台无异常 | `real-browser-verification.md` |
| 无法从证据分支独立核 player.js 哈希 | **已闭合**：证据目录自含 `player.fixed.js`，其 SHA-256 前 8 = `29656d3f` = `index.fixed.html` 的 `?v=` | 见下「三」 |
| 七条门禁未独立复测 | **已复跑**：修正后的测试在内，7 条全 exit 0，留完整输出 | `pr25-fix-gates.log` |

## 二、测试可复现性（两个位置均 exit 0）
- 从 `scripts/`（修复工作树）：解析到 `../js/player.js`，A/B/C/D 干净加载 + B' 反证抛 TypeError → PASS。
- 从 `review-evidence/pr25-second-review/`（提交位置）：解析到 `./player.fixed.js`，同样 4 场景 + 反证 → PASS。
- 命令：`node test-player-parser-guard.mjs`（证据目录内）或 `node scripts/test-player-parser-guard.mjs`（仓库根）。

## 三、资源版本一致性（自证）
- `player.fixed.js` 的 SHA-256 前 8 位 = `29656d3f`。
- `index.fixed.html` 引用 `./js/player.js?v=29656d3f`。
- 二者一致；且 `check-asset-versioning.mjs`（含 `--falsify`）exit 0。
- 加载顺序：`m3u8-parser.js?v=aefd3495` 在 `player.js?v=29656d3f` 之前。

## 四、逐项审查结果与风险

| 审查项 | 结果 | 风险 |
|---|---|---|
| 完整调用路径（1231 探测 / 1366 二级 / 1420 早退 / 1438 主解析） | 通过：无绕过入口保护的调用 | 低 |
| 容错实现（安全探测 + 局部降级，不返回假空结果） | 通过 | 低 |
| 故障模拟可信度（缺脚本/缺对象/缺方法/非函数 + 反证） | 通过，含真实浏览器降级验证 | 低 |
| 测试可复现性（提交位置可独立运行） | 通过（本轮修正后） | 低 |
| 正常功能静态 + 真实浏览器加载 | 通过（页面加载 + parseManifest 输出正确） | 低至中 |
| 资源版本一致 | 通过（自证哈希匹配） | 低 |
| 七条门禁 | 全部 exit 0 | 低 |

## 五、仍属未验证（不冒充已通过）
- 「4 个 check_suite 独立对象」逐项审计：git/本通道取不到，属另一会话经 GitHub API 范畴。
- 真实远程流的播放启动 + CORS + 设备兼容：留作合并后的生产验收门禁。

## 六、最终合并建议
- 证据复现缺口已全部闭合；修复方案与实现经两轮独立 Review + 本地 7 门禁 + 真实浏览器正常/降级验证，**判定 PASS（证据复现已通过）**。
- 但**修复目前只在证据分支 `review/pr25-independent-review-20261121`，PR #25 实际代码仍是未保护的旧引用**。合并前须先把这处容错改动落到 PR #25（独立授权动作）。
- 建议顺序：① 将容错修复（player.js 两处 + index.html 版本串 + 新测试）落到 PR #25 head 并复跑 CI；② 合并后做生产播放/CORS/设备验收；③ 更新 Issue #23 与总账。
- 治理边界：本轮未改 main、未改 PR #25、未转 Ready、未合并、未部署。

# PR #25 修复 — 真实浏览器核查记录（2026-11-21）

补强第二轮 Review 指出的「Proxy 桩过宽 / 无真实 DOM」缺口。用本地静态服务（127.0.0.1，端口 8791）+ 真实 Chrome 只读加载，仅读取、不点改状态按钮。

## 1. 正常路径（index.html，parser 在场）
- 控制台错误（过滤 parseManifest / TypeError / StreamPlayM3U8Parser / Uncaught）：**无**。
- MAIN world 求值：
  ```json
  {"parserGlobal":"object","methodType":"function","maRunBtn":true,"maUrlInput":true,
   "targetDuration":6,"mediaSequence":42,"playlistType":"VOD"}
  ```
- 结论：真实浏览器里共享 parser 正常加载、player.js IIFE 完成、`parseManifest` 输出正确、分析 UI 就位。

## 2. 降级路径（degrade-no-parser.html = index.html 去掉 m3u8-parser.js 那一行）
- 控制台错误（同上过滤）：**无** —— 证明加守卫后，缺 parser 不再让 player.js 顶层抛 `Cannot read properties of undefined (reading 'parseManifest')`、不再中止整个 IIFE。
- MAIN world 求值（并点击分析按钮）：
  ```json
  {"parserGlobal":"undefined","playerVideoEl":true,"playBtn":true,"clickedAnalyze":true,
   "statusText":"M3U8 清单分析暂不可用：解析模块未能加载；播放与其他功能不受影响，请刷新页面重试。"}
  ```
- 结论：parser 缺失时，播放器其他功能（video/play 控件）仍在，分析入口按设计**局部降级并给明确诊断**，未整体崩溃。

## 3. 仍属未覆盖（如实标注，留给合并后生产门禁）
- 真实 m3u8 流的**实际播放启动 + CORS + 设备兼容**：本核查只验证页面加载与解析模块接线，未对真实远程流做播放验收。该项属合并后的生产验收门禁，不在本轮。
- 降级页 `degrade-no-parser.html` 为一次性测试产物，**未纳入提交**，核查后已从工作树删除。

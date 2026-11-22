# PR #25 剩余技术门禁验收记录（2026-11-21 · 第二轮技术验证）

范围：Cursor check_suite、多真实流源、桌面浏览器矩阵、移动设备矩阵。全部在 yqh 授权内（不涉及 Draft→Ready、合并、部署）。
测试代码：与 PR head f8030c1 逐字节一致的本地检出（Cloudflare 预览 URL 被 302 重定向到生产，预览构建不可达——沿用 real-stream-playback-verification.md 的限定，本地代码验证 ≠ 预览环境验证）。

## 1. Cursor check_suite → 已消解
- GitHub PR merge box 官方判定：**All checks have passed（1 skipped + 3 successful checks）**。
- checks 页与 merge box 均无排队/awaiting 项；先前报告的「Cursor queued」已消解（或本就不是阻断项）。
- 唯一 skipped = Cloudflare publish job（符合未授权不发布边界）。"No conflicts with base branch"。

## 2. 多真实流源（分析面板，5 源 / 3+ CDN 厂商 / 2 种分片结构）
| 流源 | 结构 | 结果 |
|---|---|---|
| test-streams.mux.dev/x36xhzz | TS 多码率 | ✅ 5 变体（上轮已测） |
| test-streams.mux.dev/tos_ismc | fMP4/CMAF + EXT-X-MEDIA 音轨/TTML 字幕 | ✅ 1 变体 + 3 组，自动抓取子清单 |
| stream.mux.com（Fastly 边缘） | TS 多码率 | ✅ 5 变体，跨 CDN 域 URI 解析正确 |
| demo.unified-streaming.com tears-of-steel | TS 多码率 | ✅ 7 变体（首测遇间歇性 CORS 头缺失→app 优雅诊断「网络请求失败…CORS」，重试成功；外部 CDN 边缘不一致，非 app 缺陷） |
| devstreaming-cdn.apple.com bipbop | TS 多码率 | ✅ 24 变体（最复杂 master）解析正确 |

负例验证：CORS 失败路径给出明确诊断、不崩溃、不返回假空结果（与容错设计一致）。

## 3. 播放（真实流，muted 自动播放）
- x36xhzz（TS）：currentTime 0 → 9.701s ✅
- tos_ismc（fMP4，含 init segment 路径）：currentTime 0 → 1.229s ✅
- 两流 MediaSource 挂载正常、readyState=4、err=null；控制台 error/fail/CORS/Uncaught 零记录。

## 4. 桌面浏览器矩阵（实际可测范围，如实记录）
- Chrome：✅（以上全部测试）
- Firefox：本机未安装 → 未能测试
- Safari：Windows 无 Safari → 不可测（需 macOS/iOS）
- Edge：本机已安装（Program Files 下 msedge.exe）但无自动化通道 → 未测试（同为 Chromium 内核，风险低于 WebKit 引擎，但不冒充已测）

## 5. 移动设备矩阵（实际可测范围）
- 无 Android/iOS 真机。以同源 375px 视口仿真（iframe）替代：scrollWidth=361 ≤ 375 **无横向溢出**；player/play-btn/ma-url/ma-run 全部可见。
- **这是 Chrome 视口仿真，非真机、非 WebKit 引擎**——只能证明响应式布局与控件可达性，不能证明 iOS Safari 行为。

## 6. 结论与最终门禁清单
- **已闭合**：Cursor suite、5 源多 CDN 分析、TS+fMP4 双结构真实播放、移动视口布局、CORS 正/负例路径。
- **仍未覆盖（发布前剩余）**：Firefox/Safari/Edge 真实浏览器验证、Android/iOS 真机验证、有声播放、LIVE 直播流。
- **Draft→Ready / 合并 / 部署**：独立授权事项，本轮零触碰。

# PR #25 真实流播放验收记录（2026-11-21）

## 环境限定（不得混淆）
- Cloudflare 预览 URL（分支别名与部署哈希 b50dd95e 两条）均被 302 重定向到生产 play.digdevbox.com，加载的是旧版 player.js（v=b86a37b6，无独立 parser 模块）——**预览构建无法从浏览器直接访问**。
- 故使用本地静态服务运行与 PR head f8030c1 **逐字节一致**的代码（player.js?v=29656d3f + m3u8-parser.js?v=aefd3495）验证。
- **本地代码验证 ≠ Cloudflare 预览环境验证。**

## 测试流
test-streams.mux.dev 上的 x36xhzz 公开测试流（真实远程 HLS，跨域）。

## 结果（全部 PASS）
| 项目 | 结果 | 证据 |
|---|---|---|
| 构建确认 | ✅ | player.js?v=29656d3f 在场、window.StreamPlayM3U8Parser 为 object、hls.js 就位 |
| 分析面板 | ✅ | 状态「分析完成：master + 首个变体媒体清单」；5 条变体的分辨率/带宽/编码/URI 全部正确 |
| 播放启动 | ✅ | hls.js 挂载 MediaSource（blob src）、readyState=4、duration=634.584s、err=null；muted+play 后 currentTime 从 0 前进到 9.701s（真实推进） |
| 跨域加载 | ✅ | 19 个 mux.dev 资源全部成功（7 个 m3u8 清单 + 12 个 ts 分片） |
| 控制台 | ✅ 零异常 | error/fail/denied/CORS/Uncaught/TypeError 无记录 |

## 结论
parser 模块化抽取 + 容错守卫**未破坏真实播放**；分析功能在真实远程清单上正确工作。播放管线（清单获取 → 分片跨域拉取 → MediaSource 缓冲 → 实际播放推进）端到端成立。

## 范围与未覆盖（不冒充已通过）
- 仅 1 条真实流（mux x36xhzz）、仅本机 Chrome、使用 muted 自动播放（Chrome 策略，有声播放需真实用户手势未测）。
- 其他浏览器/设备矩阵、更多流源的 CORS 行为未覆盖。
- 第三方 Cursor check_suite 终态未确认（queued，非阻断）。

## 治理
未改 PR 状态、未合并、未部署、main 未修改。Draft→Ready、合并、部署为独立授权事项。

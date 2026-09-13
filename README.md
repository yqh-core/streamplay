# StreamPlay 流影

一款纯前端的 m3u8 / HLS 在线播放器，基于 HTML5 `<video>` 与开源 [hls.js](https://github.com/video-dev/hls.js) 实现，同时兼容浏览器原生的 mp4 等格式。

无需安装插件、无需后端服务、无构建步骤，把目录丢到静态服务器上即可运行。

---

## 效果预览

本地启动后访问 `http://localhost:8080`。

---

## 特性

| 特性 | 说明 |
| --- | --- |
| 零外部依赖 | 不加载任何第三方 CDN，hls.js 已本地化；CDN 故障或内网环境同样可用 |
| 双引擎自动切换 | m3u8 走 hls.js；mp4 等走浏览器原生播放；原生失败自动降级到 hls.js 重试 |
| 深链播放 | 支持 `?url=` 参数指定地址，便于 iframe 嵌入 |
| 移动端适配 | 响应式布局，支持 iOS 行内播放 `playsinline` |
| 错误可见 | 加载中 / 网络异常 / 跨域受限 / 格式不支持均有明确提示，不会静默失败 |
| 无 License 依赖 | 不依赖任何需要授权或域名绑定的商业播放器 SDK |

---

## 目录结构

```
streamplay/
├── index.html          主页面（播放入口）
├── about.html          关于页（技术说明 / 排查手册）
├── css/
│   └── style.css       样式表（CSS 变量 + Flex，无 UI 框架）
├── js/
│   └── player.js       播放逻辑（双引擎、错误处理、深链解析）
├── libs/
│   └── hls.min.js      HLS 播放内核（本地部署，1.5.17）
└── images/
    ├── ic-play.png     播放按钮图标
    ├── logo.png        站标
    └── logo.ico        favicon
```

全站仅 2 个 JS 文件，均无构建依赖。

---

## 部署步骤

### 方式一：任意静态服务器

把整个目录上传到网站根目录，访问 `index.html` 即可。无需配置任何后端。

### 方式二：Nginx

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/streamplay;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 方式三：本地预览

```bash
# Python 3
python -m http.server 8080

# Node.js
npx serve -l 8080
```

然后打开 `http://localhost:8080`。

---

## 使用说明

1. 在输入框粘贴 m3u8 / HLS / mp4 播放地址
2. 点击「播放」按钮，或直接按 <kbd>Enter</kbd> 回车

### iframe 嵌入

在页面地址后拼接 `?url=` 参数即可自动加载播放：

```html
<iframe src="https://你的域名/?url=https://example.com/index.m3u8"
        width="100%" height="480" frameborder="0" allowfullscreen></iframe>
```

### 控制台 / 脚本调用

```javascript
// 播放指定地址
window.play('https://example.com/index.m3u8');

// 停止播放
window.StreamPlay.stop();
```

---

## 与原始版本的差异

本项目基于开源项目 `m3u8player` 改造，功能保持一致，主要做了以下调整：

| 项目 | 原始版本 | 当前版本 |
| --- | --- | --- |
| 播放内核 | 腾讯云 TCPlayer 5.1.0 | hls.js 1.5.17（本地） |
| License 授权 | 必须申请并绑定域名，否则不可用 | 无需任何授权 |
| 外部依赖 | jQuery + Bootstrap + social-share + TCPlayer CDN，共 4 个 CDN | 0 个，全部本地化 |
| 播放格式 | 依赖 TCPlayer 支持范围 | m3u8 / HLS / mp4 等原生格式 |
| 错误处理 | 失败时无任何反馈 | 分场景明确提示，网络/媒体错误自动重试 |
| 文件组织 | 样式与脚本内联在 HTML 中 | 拆分为 `css/` 与 `js/` |
| 死链 | 导航指向不存在的 `about.html` | 已补全 |
| 无效文件 | `js/zh_CN.js`（TinyMCE 语言包，与播放器无关，16KB） | 已移除 |

**功能保持不变**：输入地址 → 播放 → 支持嵌入，行为与原始版本一致。

---

## 踩坑记录

| 坑 | 现象 | 原因与处理 |
| --- | --- | --- |
| TCPlayer 必须配置 License | 播放器初始化后无法播放，控制台报 license 相关错误 | TCPlayer 自 5.0.0 起 `licenseUrl` 为必传项，且要绑定授权域名。已改用 hls.js 彻底规避 |
| 现代浏览器不原生支持 HLS | Chrome 直接给 `<video>` 赋 m3u8 地址时无反应或报错 | Chrome / Firefox / Edge 需通过 MSE 播放 HLS，必须引入 hls.js；Safari 原生支持，所以代码做了双分支判断 |
| 跨域拉流被拦截 | 提示网络错误，控制台出现 CORS 报错 | 播放器只能被动接受，需在流媒体服务器侧配置 `Access-Control-Allow-Origin` |
| H.265 无法播放 | 黑屏、无报错，只有音频或完全无画面 | 浏览器对 HEVC 支持极差，播放器要求 H.264 编码 |
| `href="/"` 部署到子目录后 404 | 部署到 `https://domain.com/player/` 时导航失效 | 原来用的是根路径写死的绝对地址，已改为 `./` 相对路径 |
| CDN 抽风导致页面白屏 | 某个 CDN 域名不可达时脚本加载失败 | 已全部改为本地资源，不再依赖外网 |

---

## 常见问题排查

| 现象 | 排查方向 |
| --- | --- |
| 页面能打开但点击播放无反应 | 打开浏览器控制台看是否有 JS 报错；确认 `libs/hls.min.js` 是否上传完整 |
| 提示「请先输入播放地址」 | 输入框为空，填入地址后重试 |
| 一直停留在「正在加载」 | 用新标签页直接打开该 m3u8 地址，确认地址本身可访问 |
| 提示「跨域被拦截」 | 流媒体服务器需配置 `Access-Control-Allow-Origin`，前端无法绕过 |
| 黑屏但无任何提示 | 大概率是 H.265/HEVC 编码，或 TS 分片本身损坏 |
| 移动端不能自动播放 | 浏览器自动播放策略限制，点击播放按钮即可 |
| 部署后样式丢失 | 检查 `css/style.css`、`js/player.js`、`libs/hls.min.js` 是否一并上传 |

---

## 关键命令速查

```bash
# 本地启动预览
python -m http.server 8080

# 验证 hls.js 是否完整（应输出 1.5.17）
grep -o "1\.5\.17" libs/hls.min.js | head -1

# 检查目录完整性
ls -R .

# 部署到服务器（示例）
scp -r ./streamplay/* root@your-server:/var/www/streamplay/
```

---

## 免责声明

本项目仅提供播放技术演示，不存储、不制作、不分发任何音视频内容。
请确保你拥有所播放内容的合法授权，因使用本项目产生的任何法律责任由使用者自行承担。

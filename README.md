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
│   └── hls.min.js      HLS 播放内核（本地部署，1.7.3）
├── images/
│   ├── ic-play.png     播放按钮图标
│   ├── logo.png        站标
│   └── logo.ico        favicon
├── .github/
│   └── workflows/
│       └── deploy-cloudflare-pages.yml   自动部署流水线
├── .gitattributes      换行符规范化（强制 LF，防 CI 踩坑）
└── .gitignore
```

站点运行只需要前 6 项共 8 个文件；`.github/`、`.gitattributes`、`.gitignore`、`README.md` 是工程文件，不会进部署产物。

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

## 部署到 Cloudflare Pages

站点是纯静态的，全部文件加起来约 620 KB / 8 个文件，远低于 Cloudflare 的限制。

### 限制速查

| 项目 | 限制 |
| --- | --- |
| 仪表盘拖拽 / 上传 ZIP（Direct Upload） | **1,000 个文件** |
| Wrangler CLI 上传 | 20,000 个文件（付费版 100,000） |
| 单文件大小 | 25 MiB |
| 免费版 Workers/Pages 请求数 | 100,000 次/天 |

本项目实际 8 个文件、最大单文件 413 KB，毫无压力。

### 选型指南

四种部署方式从简到繁排：

| 方式 | 适合谁 | CI/CD | 配置成本 | 重建成本 |
|---|---|---|---|---|
| 仪表盘拖拽 ZIP | 一次性发布 / 不写代码的人 | 无 | 1 分钟 | 每次都要手动拖 |
| **Cloudflare 控制台 Git 集成（推荐）** | **希望 push 即部署的所有人** | **自动** | **一次性配置 5 分钟** | **几乎为零（push 即可）** |
| GitHub Actions + Wrangler | 需要在 CI 里做额外操作（如多产物、构建步骤、通知） | 自动 | 需 2 个 Secret + 维护 YAML | 改动要本地提交 |
| 本地 Wrangler CLI | 不便绑定 GitHub 账号的场景 | 无 | 首次 `wrangler login` | 每次手动跑命令 |

**Git 集成是绝大多数项目的最佳选择**：push 即生产，PR 自动出预览环境，零密钥管理。

### 方式一：仪表盘拖拽（最快上手）

1. 打开 Cloudflare 控制台 → **Workers & Pages** → **Create application** → **Get started** → **Drag and drop your files**
2. 把整个项目目录（或打包好的 ZIP）拖进去，填个项目名
3. 点 **Deploy**

> 拖拽时不要上传 `README.md`、`.github/` 等工程文件，它们会被公开访问。只拖
> `index.html`、`about.html`、`css/`、`js/`、`libs/`、`images/` 即可。
>
> **注意**：`index.html` 必须在压缩包的**根目录**，不能套一层文件夹，否则站点打开是个文件列表。
>
> ⚠️ **拖拽创建的项目之后无法转为 Git 集成**。一旦打算走 CI/CD，必须删项目重建。

### 方式二：Cloudflare 控制台 Git 集成（推荐）

> 完整的部署自动化，**推荐**。push 到 `main` → 自动生产部署；开 PR → 自动出预览环境，
> 链接贴在 PR 评论里可以直接预览改动。配置只需 5 分钟，以后再也不用管。

#### 1. 在 Cloudflare 控制台创建项目

1. **Workers & Pages** → **Create application** → **Pages** → **Get started** → **Connect to Git**
2. 选 **GitHub**，授权 Cloudflare 访问你的 GitHub 账号
3. 选 **yqh-core/streamplay** 仓库
4. **Project name**：填一个二级域名前缀（比如 `streamplay`）。

   > ⚠️ **区分「项目名」和「子域名」**：`pages.dev` 二级域名是全局唯一的，被占用时
   > Cloudflare 只给**子域名**加随机后缀，**项目名不变**。例如本项目填的是 `streamplay`，
   > 项目名就一直是 `streamplay`，但子域名是 `streamplay-ey1.pages.dev`。
   > API 里这是两个字段（`name` / `subdomain`），千万别拿域名反推项目名。
5. **Production branch**：`main`
6. **Build settings**（关键）：
   | 项 | 填写 |
   |---|---|
   | Framework preset | **None** |
   | Build command | **留空** |
   | Build output directory | **`/`**（仓库根目录） |
   | Root directory | **留空** |
7. 点 **Save and Deploy**

首次构建会立刻触发一次（约 30 秒）。成功后访问 `https://<项目名>.pages.dev`。

#### 2. 配置 PR 预览环境（可选但强烈推荐）

1. 项目创建后进 **Settings** → **Builds** → **Configure page builds**
2. 开启 **Preview deployments**（默认就开）
3. 开启 **Branch deployments** 控制哪些分支自动部署（建议全部关闭，只留 main 生产）

之后每次开 PR，Cloudflare 会在 PR 评论里贴出预览链接，方便评审。

#### 3. 日常使用

```bash
git add -A
git commit -m "feat: 新增 XXX"
git push origin main       # → 自动部署到生产环境
git push origin feature/x  # → 自动部署到 <分支名>.<项目名>.pages.dev
```

完全无需任何密钥 —— Cloudflare 走的是 OAuth 授权，Secrets 存在 Cloudflare 后端。

#### 4. 自定义域名

项目 → **Custom domains** → **Set up a custom domain** → 填你的域名 → Cloudflare 自动改 DNS（前提是该域名已托管在 Cloudflare）。

### 方式三：GitHub Actions + Wrangler

如果你需要在 CI 里做额外操作（生成不同产物、加通知、跨云部署等），保留本仓库的
`.github/workflows/deploy-cloudflare-pages.yml` 即可。流水线分两个 job：

> ⚠️ **本项目已启用方式二的 Git 集成**。为避免两套部署同时写生产环境、互相覆盖，
> 下面的 `deploy` job 默认**不运行**，只在手动 `workflow_dispatch` 时发布。
> 日常 push / PR 只跑 `verify` 做质量校验，发布由 Cloudflare 负责。

1. **校验并组装产物** —— 检查必需文件是否齐全、页面引用的本地资源是否都存在、
   文件数与单文件体积是否超出 Cloudflare 限制，然后生成 `dist/`。
2. **发布** —— 确认 Pages 项目存在（**刻意不自动创建**：项目名写错时静默建个新项目，
   部署看着成功却上了另一个域名，是最难排查的一类问题，所以这里选择直接失败），再用 Wrangler 上传 `dist/`。

#### 需要配置的仓库 Secrets

在 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** 中添加：

| Secret | 说明 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API 令牌，权限需含 **Account → Cloudflare Pages / Workers → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID，在控制台右侧栏或 URL 中可见 |

API Token 申请：Cloudflare 控制台 → **My Profile** → **API Tokens** → **Create Token** →
选用 **Edit Cloudflare Workers** 模板即可。

#### 触发与目标

| 触发条件 | 行为 | 访问地址 |
| --- | --- | --- |
| push 到 `main` | 只校验，不发布（由 Git 集成发布） | — |
| 提交 Pull Request | 只校验，不发布（由 Git 集成发预览） | — |
| 手动触发（可指定分支） | 用 Wrangler 发布到对应分支环境 | `https://<分支名>.<项目名>.pages.dev` |

#### 项目名

由 workflow 顶部的 `env.CF_PROJECT` 控制，当前值为 **`streamplay`**，
对应线上子域名 `https://streamplay-ey1.pages.dev`。

> **项目名 ≠ 子域名**：`streamplay.pages.dev` 已被他人占用，Cloudflare 只给子域名加了
> `-ey1` 后缀，项目名仍是 `streamplay`。用 `npx wrangler pages project list` 查到的
> `name` 字段才是项目名 —— 填错会部署到一个全新的空项目上（流水线刻意不自动创建，
> 宁可在这里失败）。
>
> 环境地址规则：`main` 分支 → `https://<子域名>.pages.dev`；
> 其他分支 → `https://<分支名>.<子域名>.pages.dev`。

### 方式四：本地用 Wrangler 部署

```bash
npx wrangler login
npx wrangler pages project create streamplay --production-branch=main
npx wrangler pages deploy . --project-name=streamplay
```

> 直接部署当前目录时，`README.md` 也会被上传。想避免，先把站点文件复制到临时目录再部署。

---

## 使用说明

页面打开后**输入框已预填一个可用的测试流地址**，直接点右侧「播放」按钮即可看到画面；
也可以点输入框下方的「测试流」快捷按钮一键体验。播放自己的视频：

1. 在输入框粘贴 m3u8 / HLS / mp4 播放地址
2. 点击「播放」按钮，或直接按 <kbd>Enter</kbd> 回车

地址栏支持相对路径、绝对 URL；只填 `example.com/xxx.m3u8` 这种裸域名时会自动补上 `https://`。

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
| 播放内核 | 腾讯云 TCPlayer 5.1.0 | hls.js 1.7.3（本地） |
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
| 输入框留空导致「不知道怎么播」 | 用户打开页面只看到一个空输入框，不知道该填什么 | 改造时把原版预填的示例地址删掉了，这是纯粹的自伤。已恢复预填，并补上三步说明和示例流按钮 |
| Windows 提交 CRLF 会让 CI 挂掉 | GitHub Actions 的 `run:` 块带上 `\r`，Linux runner 报 `$'\r': command not found` | 加 `.gitattributes` 强制 LF 作防护。**另注**：用 `grep -c $'\r'` 检查换行符是不可靠的（会被当成字母 `r` 匹配），要用 `od -c` 或按字节统计 |
| Windows 上 `git https` 报 `unable to access` | curl/git 走 Windows schannel 证书校验，本机 `CRYPT_E_NO_REVOCATION_CHECK`（吊销检查失败） | 全局配置 `git config --global http.sslBackend schannel`，作用是显式让 git 走 schannel 后端（默认会因其他配置触发 openssl 分支，从而撞上吊销检查）。curl 单独配 `~/.curlrc` 加 `ssl-no-revoke` |
| 本机 hosts 劫持导致 GitHub 全家桶 0.0.0.0:443 无法访问 | 浏览器能开（信任过 Steam++ 根证书），但命令行 / GitHub Actions 全部失败 | 这是 Steam++「网络加速」把 27 个 GitHub 域名指到 `127.0.0.1`，再由本地反代用**自签证书**做 MITM。修复方法：编辑 `C:\Windows\System32\drivers\etc\hosts`，注释掉 `# Steam++ Start … # Steam++ End` 那一整块；或者在 Steam++ 控制台里关掉 GitHub 加速。备份 `D:\work\_hosts-backup\hosts.backup-*` 可还原 |

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

# 验证 hls.js 是否完整（应输出 1.7.3）
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

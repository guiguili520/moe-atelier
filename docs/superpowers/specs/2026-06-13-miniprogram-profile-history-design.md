# 设计文档：小程序「我的」个人中心 + 7 天本地历史

- 日期：2026-06-13
- 范围：`platforms/wechat-miniprogram/`（微信小程序端）
- 状态：已与用户确认，待生成实现计划

## 1. 背景与目标

次元绘图小程序端目前是**纯前端**应用：没有任何账号 / 后端体系，直接用用户自己的 API Key 调用 OpenAI/Gemini 出图；生成结果以 base64/远程 URL 形式存在 `localStorage`（`ciyuan-huitu-results`，上限 30 条）。

用户希望新增一个用户界面，让用户能够：
1. **登录**（展示个人身份）；
2. 查看**个人信息**；
3. 查看**历史生成的图片**，且历史**有效期只有 7 天**。

### 已确认的关键决策（来自需求澄清）

| 维度 | 决策 |
|---|---|
| 架构 | **纯本地，无后端**。不引入服务器、不做微信 openid 登录。 |
| 导航 | 新增底部 **tabBar：广场 / 我的**。设置、个人信息、历史都归入「我的」。 |
| 登录 | **轻登录**：用微信「头像昵称填写」能力让用户填本地资料；不强制登录，生图随时可用。 |
| 历史存储 | **落地到本机文件（`USER_DATA_PATH`）+ localStorage 索引**，规避 10MB localStorage 上限和 OpenAI 临时 URL 过期问题。 |

### 重要约束（已核实）

- 微信 `localStorage` 总量上限 **10MB**：不能把 base64 大图存进去 → 图片走文件系统，localStorage 只存轻量索引。
- OpenAI 图片接口常返回**约 1 小时过期的临时 URL**：要留 7 天必须 `wx.downloadFile` 落地保存。
- 微信原生 `tabBar` 的图标只接受**本地 PNG/JPG**（不支持 SVG/字体）：v1 采用**纯文字 tabBar**，零图标资源。
- `app.json` 已是 `"style": "v2"`；新页面延续既有粉棕主题（`#ff9eb5` / `#5d4037` / `#8d6e63` / `#fff9fa`）。
- 本地"登录"**不是安全鉴权**（用户清缓存即丢失），仅用于个性化展示。

### 本设计明确*不做*（YAGNI / 超出范围）

- 不做微信 openid / 真实账号 / 服务端鉴权。
- 不做云端历史、跨设备同步、服务端 7 天 TTL。
- 不做独立「历史」页（历史直接嵌入「我的」页）。
- 不做 tabBar 图标资源（先纯文字）。
- 不强制登录后才能生图。

## 2. 架构总览

全部改动在小程序前端完成，零服务器依赖。

- 底部 `tabBar` 两个 tab：**广场**（现有 `pages/index/index`）、**我的**（新增 `pages/profile/profile`）。
- 「登录」= 本地资料（头像 + 昵称），存 localStorage + 头像文件落 `USER_DATA_PATH`。
- 历史图片：生成后落地为本机文件，`localStorage` 仅保存索引数组；满 7 天自动清理（删文件 + 删索引）。
- 新增两个工具模块：`utils/history.js`、`utils/profile.js`，页面只通过它们的接口读写，互不耦合。

## 3. 组件与文件清单

### 3.1 新增：`utils/history.js`（历史存储模块）

职责：把生成图持久化到本机文件，并维护一个轻量索引；提供 7 天清理。

存储键：`HISTORY_KEY = 'ciyuan-huitu-history'`，值为索引数组：
```
[{ id, filePath, title, prompt, promptId, apiFormat, createdAt }]
```
（`createdAt` 为毫秒时间戳；`filePath` 指向 `USER_DATA_PATH` 下的文件。）

常量：`HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000`；`HISTORY_MAX = 200`（安全上限）。

接口：
- `addHistoryImage({ src, title, prompt, promptId, apiFormat })` → `Promise<entry|null>`
  - `src` 为 `data:image/...;base64,...`：用 `wx.getFileSystemManager().writeFile` 写入 `USER_DATA_PATH`（复用 `index.js` 现有 `dataUrlToTempFile` 思路，但用稳定文件名 `history-{createdAt}-{rand}.{ext}`）。
  - `src` 为远程 URL：`wx.downloadFile` 下载后将 `tempFilePath` 复制/保存到 `USER_DATA_PATH`。
  - 成功 → 在索引头部插入新条目并 `setStorageSync`；返回条目。失败 → 返回 `null`（不抛错，调用方仅记录失败）。
  - 写入后若超过 `HISTORY_MAX`，删除最旧的（连同文件）。
- `loadHistory()` → `entry[]`：内部先 `pruneExpired()`，返回有效条目（按 `createdAt` 倒序）。
- `pruneExpired()` → `entry[]`：删除 `createdAt < Date.now() - HISTORY_TTL_MS` 的条目（删文件 + 删索引），并剔除文件已不存在的脏索引（用 `accessSync`/`statSync` 校验）；写回并返回保留列表。
- `removeHistoryImage(id)`（可选，供历史项删除）。

> 文件删除/写入统一用 `wx.getFileSystemManager()` 的同步/异步 API；删除失败只记日志，不影响索引清理。

### 3.2 新增：`utils/profile.js`（本地资料 + 统计）

存储键：`PROFILE_KEY = 'ciyuan-huitu-profile'`（`{ avatar, nickname, createdAt }`，`avatar` 为 `USER_DATA_PATH` 下的持久文件路径）；`STATS_KEY = 'ciyuan-huitu-stats'`（`{ totalGenerated }`）。

接口：
- `loadProfile()` → `{ avatar, nickname, createdAt } | null`。
- `saveProfile({ avatar, nickname })`：若传入 `avatar` 为临时路径，先复制到 `USER_DATA_PATH` 持久化再存。
- `clearProfile()`：退出登录，清 `PROFILE_KEY`（可一并删头像文件）。
- `incrementGenerated()`：`totalGenerated += 1` 并写回（在每次成功生成时调用）。
- `getStats()` → `{ totalGenerated, favorites, history7d }`：
  - `totalGenerated` 来自 `STATS_KEY`；
  - `favorites` = `wx.getStorageSync('ciyuan-huitu-favorites').length`；
  - `history7d` = `history.loadHistory().length`。

### 3.3 新增页面：`pages/profile/profile.{wxml,wxss,js,json}`（我的）

布局（粉棕主题，复用现有视觉语言）：
1. **资料头部**：未登录 → 灰头像占位 + 「点击登录」按钮（触发头像昵称填写）；已登录 → 头像 + 昵称 + 编辑入口。
2. **统计卡**：三格——累计生成 / 收藏 / 7 天历史。
3. **历史区**：标题「最近 7 天作品」+ 缩略图网格（读 `history.loadHistory()`）。点击 → `wx.previewImage`（复用首页预览/保存逻辑）。空态文案：「7 天内还没有作品，去广场生成吧」。
4. **菜单**：「生成配置」（`navigateTo` 到 config）、「退出登录」（已登录时显示，确认后 `clearProfile`）。

登录交互（微信头像昵称填写能力）：
- 头像：`<button open-type="chooseAvatar" bindchooseavatar="onChooseAvatar">`，回调拿 `e.detail.avatarUrl`（临时路径）→ `saveProfile` 持久化。
- 昵称：`<input type="nickname" bindblur/bindconfirm>` → `saveProfile`。
- 这两个控件可放在一个内联的"登录/编辑资料"区块或弹层；v1 用内联区块即可。

页面生命周期：`onShow` 调用 `history.pruneExpired()` 后刷新资料、统计、历史（保证从广场切回时数据最新）。

`profile.json`：`{ "navigationBarTitleText": "我的" }`。

### 3.4 改：`pages/index/index.js`

- `startGenerate` 成功分支：对每张解析出的图调用 `history.addHistoryImage({ src, title, prompt: promptText, promptId: id, apiFormat })`，并调用 `profile.incrementGenerated()`。
- 「最近生成」面板（`resultImages`）改为读 `history.loadHistory()` 的前 N 条，`src` 用 `filePath`，替代当前把 base64 塞进 `RESULTS_KEY` 的做法（顺带修掉 localStorage 膨胀隐患）。
  - 迁移：移除/弃用 `RESULTS_KEY` 的写入；`onLoad/onShow` 改为从 history 读取最近若干条。
- 预览/保存逻辑（`previewImage`/`saveImage`）已支持本地文件路径，基本无需改动（文件路径直接可 `previewImage`/`saveImageToPhotosAlbum`）。

### 3.5 改：`app.js`

`onLaunch` 中调用 `require('./utils/history').pruneExpired()`，启动即清理过期历史（容错包 try/catch）。

### 3.6 改：`app.json`

- `pages` 数组加入 `"pages/profile/profile"`。
- 新增 `tabBar`（纯文字版）：
```json
"tabBar": {
  "color": "#8d6e63",
  "selectedColor": "#ff9eb5",
  "backgroundColor": "#fff9fa",
  "borderStyle": "white",
  "list": [
    { "pagePath": "pages/index/index", "text": "广场" },
    { "pagePath": "pages/profile/profile", "text": "我的" }
  ]
}
```
> 注：微信要求 tabBar 页 `pagePath` 指向的页面通过 tab 切换访问；`config` 页保持 `navigateTo` 子页，不进 tabBar。首页底部内边距需为 tabBar 预留空间（现有 `padding-bottom:140rpx` 基本够用，必要时微调）。

## 4. 数据流

```
生成成功(index.startGenerate)
  ├─ history.addHistoryImage()  → 写文件(USER_DATA_PATH) + 写索引(HISTORY_KEY)
  └─ profile.incrementGenerated() → STATS_KEY +1

首页「最近生成」 ─读─> history.loadHistory()(前N条)
「我的」页 onShow ─> history.pruneExpired() ─> 渲染 profile + getStats() + 历史网格
app.onLaunch ─> history.pruneExpired()
```
首页与「我的」共享同一份 history 索引，单一数据源。

## 5. 7 天有效期语义

- 有效期 = 自**生成时刻**（`createdAt`）起 `7×24h`。
- 清理时机：① `app.onLaunch`；② 进入「我的」页 `onShow`；③ 每次生成后（`addHistoryImage` 内部可顺带 prune）。
- 清理动作：删除本机文件 **且** 删除对应索引条目，避免脏数据；同时剔除文件已丢失的索引。

## 6. 错误处理与边界

- **写文件 / 下载失败**：`addHistoryImage` 返回 `null`，本次出图仍在会话内可见，仅不进历史；toast 轻提示，不阻断主流程。
- **`USER_DATA_PATH` 被系统回收**：`loadHistory`/`pruneExpired` 校验文件存在性，剔除失效索引；网格图加载失败显示占位。
- **头像临时路径失效**：`chooseAvatar` 的 `avatarUrl` 是临时文件，`saveProfile` 必须立即复制到 `USER_DATA_PATH` 再持久化。
- **localStorage 配额**：索引为纯文本、极小，不会触发 10MB 上限。
- **退出登录**：清 `PROFILE_KEY`（可删头像文件）；历史与统计是否一并清除——v1 **保留历史与统计**（它们与"登录"解耦，属于本机数据），仅清资料。

## 7. 测试与验证

无法在本机无头运行真机；验证方式：
1. `npm run miniapp:wechat:check` —— 结构校验（新页四件套齐全、`app.json` 合法）。
2. 微信开发者工具导入 `platforms/wechat-miniprogram`，清缓存 → 编译，手测：
   - tab 切换「广场 / 我的」正常。
   - 「我的」未登录 → 点击登录 → 选头像 + 填昵称 → 头像昵称持久化，重启仍在。
   - 在广场生成 → 「我的」历史出现该图、缩略图可预览/保存、「累计生成」+1、「7 天历史」计数正确。
   - 把某条历史的 `createdAt` 改成 8 天前（或临时调小 `HISTORY_TTL_MS`）→ 重启/进入「我的」→ 该条与其文件被清理。
   - 退出登录 → 资料清空、历史与统计保留。
3. 代码核查：`grep` 确认 `RESULTS_KEY` 写入已迁移到 history；首页「最近生成」读文件路径无 base64 塞 localStorage。

## 8. 涉及文件汇总

新增：
- `platforms/wechat-miniprogram/utils/history.js`
- `platforms/wechat-miniprogram/utils/profile.js`
- `platforms/wechat-miniprogram/pages/profile/profile.{wxml,wxss,js,json}`

修改：
- `platforms/wechat-miniprogram/app.json`（tabBar + pages）
- `platforms/wechat-miniprogram/app.js`（onLaunch 清理）
- `platforms/wechat-miniprogram/pages/index/index.js`（落地历史 + 计数 + 最近生成改读索引）
- `platforms/wechat-miniprogram/README.md`（同步说明，次要）

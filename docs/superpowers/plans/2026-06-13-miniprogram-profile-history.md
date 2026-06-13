# 小程序「我的」个人中心 + 7 天本地历史 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给微信小程序新增底部 tabBar(广场/我的)、本地轻登录(头像昵称)、以及落地到本机文件、满 7 天自动清理的生成历史。

**Architecture:** 纯前端、零后端。两个新工具模块 `utils/history.js`(图片落地+索引+清理) 与 `utils/profile.js`(本地资料+统计)，新页面 `pages/profile/profile`，并在 `app.json` 加 tabBar、`app.js` 启动清理、`index.js` 出图后落地历史。图片存 `wx.env.USER_DATA_PATH`，localStorage 只存轻量索引。

**Tech Stack:** 微信小程序原生 (WXML/WXSS/CommonJS JS)、`wx.getFileSystemManager`、`wx.downloadFile`、`open-type="chooseAvatar"` + `<input type="nickname">`。

> **测试说明（重要）：** 本仓库的小程序端**没有 JS 测试运行器**，且模块是 CommonJS 而根 `package.json` 为 `"type":"module"`，无法用 Node 直接 `require` 运行。遵循既有模式，验证方式为：① `node --check <file>` 做语法烟测（CJS 代码在 ESM 解析下语法合法，仅查语法）；② `npm run miniapp:wechat:check` 查页面结构与 `app.json`；③ 微信开发者工具手测（含"把 createdAt 改成 8 天前"验证过期清理）。**不引入测试框架**（YAGNI，且与"纯本地最快"目标一致）。

---

## File Structure

新增：
- `platforms/wechat-miniprogram/utils/history.js` — 历史图片落地、索引读写、7 天清理、上限控制。
- `platforms/wechat-miniprogram/utils/profile.js` — 本地资料(头像/昵称)、生成计数、统计聚合。
- `platforms/wechat-miniprogram/pages/profile/profile.{js,wxml,wxss,json}` — 「我的」页。

修改：
- `platforms/wechat-miniprogram/app.json` — 加 `pages/profile/profile` 与 `tabBar`。
- `platforms/wechat-miniprogram/app.js` — `onLaunch` 调 `pruneExpired()`。
- `platforms/wechat-miniprogram/pages/index/index.js` — 出图后落地历史 + 计数；「最近生成」改读历史索引；移除 `RESULTS_KEY` base64 写入。
- `platforms/wechat-miniprogram/README.md` — 同步说明（次要）。

---

## Task 1: 历史存储模块 `utils/history.js`

**Files:**
- Create: `platforms/wechat-miniprogram/utils/history.js`

- [ ] **Step 1: 写入完整模块**

Create `platforms/wechat-miniprogram/utils/history.js`:

```js
const HISTORY_KEY = 'ciyuan-huitu-history';
const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_MAX = 200;

const fsm = () => wx.getFileSystemManager();
const userDir = () => wx.env.USER_DATA_PATH;
const rand = () => Math.floor(Math.random() * 1e6);

const readIndex = () => {
  const raw = wx.getStorageSync(HISTORY_KEY);
  return Array.isArray(raw) ? raw : [];
};

const writeIndex = (list) => {
  wx.setStorageSync(HISTORY_KEY, list);
};

const fileExists = (filePath) => {
  if (!filePath) return false;
  try {
    fsm().accessSync(filePath);
    return true;
  } catch (e) {
    return false;
  }
};

const deleteFile = (filePath) => {
  if (!filePath || !String(filePath).startsWith(userDir())) return;
  try {
    fsm().unlinkSync(filePath);
  } catch (e) {
    // 文件可能已不存在，忽略
  }
};

const extFromMime = (mime) => {
  if (!mime) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  const part = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
  return part || 'png';
};

const saveDataUrl = (src, createdAt) => new Promise((resolve, reject) => {
  const matched = String(src).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!matched) {
    reject(new Error('not a data url'));
    return;
  }
  const ext = extFromMime(matched[1]);
  const filePath = `${userDir()}/history-${createdAt}-${rand()}.${ext}`;
  fsm().writeFile({
    filePath,
    data: matched[2],
    encoding: 'base64',
    success: () => resolve(filePath),
    fail: reject
  });
});

const saveRemoteUrl = (src, createdAt) => new Promise((resolve, reject) => {
  wx.downloadFile({
    url: src,
    success: (res) => {
      if (res.statusCode !== 200 || !res.tempFilePath) {
        reject(new Error(`download failed: ${res.statusCode}`));
        return;
      }
      const ext = (res.tempFilePath.match(/\.([a-z0-9]+)$/i) || [null, 'png'])[1];
      const filePath = `${userDir()}/history-${createdAt}-${rand()}.${ext}`;
      fsm().saveFile({
        tempFilePath: res.tempFilePath,
        filePath,
        success: (r) => resolve(r.savedFilePath || filePath),
        fail: reject
      });
    },
    fail: reject
  });
});

const pruneExpired = () => {
  const now = Date.now();
  const list = readIndex();
  let kept = [];
  list.forEach((entry) => {
    const valid = entry && typeof entry.createdAt === 'number';
    const expired = !valid || (now - entry.createdAt) > HISTORY_TTL_MS;
    const missing = !fileExists(entry && entry.filePath);
    if (expired || missing) {
      if (entry) deleteFile(entry.filePath);
    } else {
      kept.push(entry);
    }
  });
  kept.sort((a, b) => b.createdAt - a.createdAt);
  if (kept.length > HISTORY_MAX) {
    kept.splice(HISTORY_MAX).forEach((entry) => deleteFile(entry.filePath));
  }
  if (kept.length !== list.length) writeIndex(kept);
  return kept;
};

const loadHistory = () => pruneExpired();

const addHistoryImage = async ({ src, title, prompt, promptId, apiFormat }) => {
  const createdAt = Date.now();
  let filePath = '';
  try {
    if (String(src).startsWith('data:')) {
      filePath = await saveDataUrl(src, createdAt);
    } else if (/^https?:\/\//.test(String(src))) {
      filePath = await saveRemoteUrl(src, createdAt);
    } else {
      return null;
    }
  } catch (e) {
    return null;
  }
  const entry = {
    id: `${createdAt}-${rand()}`,
    filePath,
    title: title || '未命名',
    prompt: prompt || '',
    promptId: promptId || '',
    apiFormat: apiFormat || '',
    createdAt
  };
  const list = readIndex();
  list.unshift(entry);
  if (list.length > HISTORY_MAX) {
    list.splice(HISTORY_MAX).forEach((e) => deleteFile(e.filePath));
  }
  writeIndex(list);
  return entry;
};

const removeHistoryImage = (id) => {
  const next = [];
  readIndex().forEach((entry) => {
    if (entry.id === id) deleteFile(entry.filePath);
    else next.push(entry);
  });
  writeIndex(next);
  return next;
};

const clearHistory = () => {
  readIndex().forEach((entry) => deleteFile(entry.filePath));
  writeIndex([]);
};

module.exports = {
  HISTORY_KEY,
  HISTORY_TTL_MS,
  addHistoryImage,
  loadHistory,
  pruneExpired,
  removeHistoryImage,
  clearHistory
};
```

- [ ] **Step 2: 语法烟测**

Run: `node --check platforms/wechat-miniprogram/utils/history.js`
Expected: 无输出、退出码 0（语法正确）。

- [ ] **Step 3: 提交**

```bash
git add platforms/wechat-miniprogram/utils/history.js
git commit -m "feat(miniapp): 新增历史图片落地存储与7天清理模块"
```

---

## Task 2: 本地资料 + 统计模块 `utils/profile.js`

**Files:**
- Create: `platforms/wechat-miniprogram/utils/profile.js`
- 依赖：Task 1 的 `utils/history.js`

- [ ] **Step 1: 写入完整模块**

Create `platforms/wechat-miniprogram/utils/profile.js`:

```js
const history = require('./history');

const PROFILE_KEY = 'ciyuan-huitu-profile';
const STATS_KEY = 'ciyuan-huitu-stats';
const FAVORITES_KEY = 'ciyuan-huitu-favorites';

const fsm = () => wx.getFileSystemManager();
const userDir = () => wx.env.USER_DATA_PATH;

const loadProfile = () => {
  const raw = wx.getStorageSync(PROFILE_KEY);
  if (!raw || !raw.nickname) return null;
  return raw;
};

const persistAvatar = (avatarUrl) => {
  if (!avatarUrl) return '';
  if (String(avatarUrl).startsWith(userDir())) return avatarUrl;
  const ext = (String(avatarUrl).match(/\.([a-z0-9]+)$/i) || [null, 'png'])[1];
  const dest = `${userDir()}/avatar-${Date.now()}.${ext}`;
  try {
    const old = wx.getStorageSync(PROFILE_KEY);
    if (old && old.avatar && String(old.avatar).startsWith(userDir())) {
      try { fsm().unlinkSync(old.avatar); } catch (e) {}
    }
    fsm().copyFileSync(avatarUrl, dest);
    return dest;
  } catch (e) {
    return avatarUrl;
  }
};

const saveProfile = ({ avatar, nickname }) => {
  const current = wx.getStorageSync(PROFILE_KEY) || {};
  const next = {
    avatar: avatar !== undefined ? persistAvatar(avatar) : (current.avatar || ''),
    nickname: nickname !== undefined ? nickname : (current.nickname || ''),
    createdAt: current.createdAt || Date.now()
  };
  wx.setStorageSync(PROFILE_KEY, next);
  return next;
};

const clearProfile = () => {
  const current = wx.getStorageSync(PROFILE_KEY);
  if (current && current.avatar && String(current.avatar).startsWith(userDir())) {
    try { fsm().unlinkSync(current.avatar); } catch (e) {}
  }
  wx.removeStorageSync(PROFILE_KEY);
};

const incrementGenerated = (n) => {
  const stats = wx.getStorageSync(STATS_KEY) || { totalGenerated: 0 };
  stats.totalGenerated = (stats.totalGenerated || 0) + (n || 1);
  wx.setStorageSync(STATS_KEY, stats);
  return stats.totalGenerated;
};

const getStats = () => {
  const stats = wx.getStorageSync(STATS_KEY) || { totalGenerated: 0 };
  const favorites = wx.getStorageSync(FAVORITES_KEY) || [];
  return {
    totalGenerated: stats.totalGenerated || 0,
    favorites: Array.isArray(favorites) ? favorites.length : 0,
    history7d: history.loadHistory().length
  };
};

module.exports = {
  PROFILE_KEY,
  STATS_KEY,
  loadProfile,
  saveProfile,
  clearProfile,
  incrementGenerated,
  getStats
};
```

- [ ] **Step 2: 语法烟测**

Run: `node --check platforms/wechat-miniprogram/utils/profile.js`
Expected: 无输出、退出码 0。

- [ ] **Step 3: 提交**

```bash
git add platforms/wechat-miniprogram/utils/profile.js
git commit -m "feat(miniapp): 新增本地资料与统计聚合模块"
```

---

## Task 3: 「我的」页面 `pages/profile/profile.*`

**Files:**
- Create: `platforms/wechat-miniprogram/pages/profile/profile.js`
- Create: `platforms/wechat-miniprogram/pages/profile/profile.wxml`
- Create: `platforms/wechat-miniprogram/pages/profile/profile.wxss`
- Create: `platforms/wechat-miniprogram/pages/profile/profile.json`
- 依赖：Task 1、Task 2

- [ ] **Step 1: 写 `profile.js`**

Create `platforms/wechat-miniprogram/pages/profile/profile.js`:

```js
const { loadProfile, saveProfile, clearProfile, getStats } = require('../../utils/profile');
const { loadHistory } = require('../../utils/history');

const DAY = 24 * 60 * 60 * 1000;

const formatDate = (ts) => {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

Page({
  data: {
    profile: null,
    stats: { totalGenerated: 0, favorites: 0, history7d: 0 },
    history: [],
    editing: false,
    draftAvatar: '',
    draftNickname: '',
    joinDays: 0
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const profile = loadProfile();
    const history = loadHistory().map((item) => ({ ...item, dateLabel: formatDate(item.createdAt) }));
    const stats = getStats();
    const joinDays = profile ? Math.max(1, Math.floor((Date.now() - profile.createdAt) / DAY) + 1) : 0;
    this.setData({ profile, history, stats, joinDays });
  },

  startEdit() {
    const profile = loadProfile();
    this.setData({
      editing: true,
      draftAvatar: profile ? profile.avatar : '',
      draftNickname: profile ? profile.nickname : ''
    });
  },

  cancelEdit() {
    this.setData({ editing: false });
  },

  onChooseAvatar(event) {
    this.setData({ draftAvatar: event.detail.avatarUrl });
  },

  onNicknameInput(event) {
    this.setData({ draftNickname: event.detail.value });
  },

  saveEdit() {
    const nickname = String(this.data.draftNickname || '').trim();
    if (!nickname) {
      wx.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    saveProfile({ avatar: this.data.draftAvatar, nickname });
    this.setData({ editing: false });
    this.refresh();
    wx.showToast({ title: '已保存' });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '将清除本机头像和昵称，历史与统计保留。',
      success: (res) => {
        if (res.confirm) {
          clearProfile();
          this.refresh();
        }
      }
    });
  },

  goConfig() {
    wx.navigateTo({ url: '/pages/config/config' });
  },

  previewImage(event) {
    const src = event.currentTarget.dataset.src;
    if (!src) return;
    const urls = this.data.history.map((item) => item.filePath).filter(Boolean);
    wx.previewImage({ current: src, urls: urls.length ? urls : [src] });
  }
});
```

- [ ] **Step 2: 写 `profile.json`**

Create `platforms/wechat-miniprogram/pages/profile/profile.json`:

```json
{
  "navigationBarTitleText": "我的"
}
```

- [ ] **Step 3: 写 `profile.wxml`**

Create `platforms/wechat-miniprogram/pages/profile/profile.wxml`:

```xml
<view class="page">
  <view class="profile-head">
    <block wx:if="{{profile}}">
      <image class="avatar-img" src="{{profile.avatar}}" mode="aspectFill"></image>
      <view class="profile-meta">
        <view class="nickname">{{profile.nickname}}</view>
        <view class="join">已陪伴你 {{joinDays}} 天</view>
      </view>
      <view class="edit-btn" catchtap="startEdit">编辑</view>
    </block>
    <block wx:else>
      <view class="avatar-img placeholder">游</view>
      <view class="profile-meta">
        <view class="nickname">未登录</view>
        <view class="join">登录后可保存头像与昵称</view>
      </view>
      <view class="edit-btn primary" catchtap="startEdit">登录</view>
    </block>
  </view>

  <view wx:if="{{editing}}" class="edit-panel">
    <view class="edit-row">
      <text class="edit-label">头像</text>
      <button class="avatar-picker" open-type="chooseAvatar" bindchooseavatar="onChooseAvatar">
        <image wx:if="{{draftAvatar}}" class="avatar-preview" src="{{draftAvatar}}" mode="aspectFill"></image>
        <text wx:else class="avatar-preview-tip">选择头像</text>
      </button>
    </view>
    <view class="edit-row">
      <text class="edit-label">昵称</text>
      <input class="nickname-input" type="nickname" value="{{draftNickname}}" placeholder="点击填写昵称" bindinput="onNicknameInput" bindblur="onNicknameInput" />
    </view>
    <view class="edit-actions">
      <view class="edit-cancel" catchtap="cancelEdit">取消</view>
      <view class="edit-save" catchtap="saveEdit">保存</view>
    </view>
  </view>

  <view class="stats-card">
    <view class="stat">
      <view class="stat-num">{{stats.totalGenerated}}</view>
      <view class="stat-label">累计生成</view>
    </view>
    <view class="stat">
      <view class="stat-num">{{stats.favorites}}</view>
      <view class="stat-label">收藏</view>
    </view>
    <view class="stat">
      <view class="stat-num">{{stats.history7d}}</view>
      <view class="stat-label">7天作品</view>
    </view>
  </view>

  <view class="history-panel">
    <view class="panel-head">
      <view class="panel-kicker">最近 7 天</view>
      <view class="panel-title">我的作品</view>
    </view>
    <view wx:if="{{history.length > 0}}" class="history-grid">
      <block wx:for="{{history}}" wx:key="id">
        <view class="history-cell" data-src="{{item.filePath}}" bindtap="previewImage">
          <image class="history-img" src="{{item.filePath}}" mode="aspectFill"></image>
          <text class="history-date">{{item.dateLabel}}</text>
        </view>
      </block>
    </view>
    <view wx:else class="history-empty">7 天内还没有作品，去广场生成吧～</view>
  </view>

  <view class="menu-card">
    <view class="menu-item" catchtap="goConfig">
      <text>生成配置</text>
      <text class="menu-arrow">›</text>
    </view>
    <view wx:if="{{profile}}" class="menu-item danger" catchtap="logout">
      <text>退出登录</text>
    </view>
  </view>
</view>
```

- [ ] **Step 4: 写 `profile.wxss`**

Create `platforms/wechat-miniprogram/pages/profile/profile.wxss`:

```css
.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 24rpx 22rpx 56rpx;
  color: #5d4037;
  background-color: #fff9fa;
  background-image:
    radial-gradient(#ffe5ec 14%, transparent 16%),
    radial-gradient(#ffe5ec 14%, transparent 16%);
  background-size: 40rpx 40rpx;
  background-position: 0 0, 20rpx 20rpx;
}

.profile-head {
  display: flex;
  align-items: center;
  padding: 28rpx 24rpx;
  margin-bottom: 18rpx;
  border: 2rpx solid #ffe5ec;
  border-radius: 26rpx;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8rpx 24rpx rgba(255, 143, 171, 0.1);
}

.avatar-img {
  width: 96rpx;
  height: 96rpx;
  flex-shrink: 0;
  margin-right: 20rpx;
  border-radius: 50%;
  background: #ffe5ec;
}

.avatar-img.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 36rpx;
  font-weight: 900;
  background: #ffc2d1;
}

.profile-meta {
  flex: 1;
  min-width: 0;
}

.nickname {
  color: #5d4037;
  font-size: 34rpx;
  font-weight: 900;
}

.join {
  margin-top: 6rpx;
  color: #8d6e63;
  font-size: 23rpx;
  font-weight: 700;
}

.edit-btn {
  flex-shrink: 0;
  padding: 0 24rpx;
  height: 56rpx;
  border-radius: 999rpx;
  color: #8d6e63;
  font-size: 24rpx;
  font-weight: 900;
  line-height: 56rpx;
  background: #fff1f4;
}

.edit-btn.primary {
  color: #ffffff;
  background: #ff9eb5;
}

.edit-panel {
  padding: 24rpx;
  margin-bottom: 18rpx;
  border: 2rpx solid #ffe5ec;
  border-radius: 26rpx;
  background: rgba(255, 255, 255, 0.92);
}

.edit-row {
  display: flex;
  align-items: center;
  margin-bottom: 18rpx;
}

.edit-label {
  width: 96rpx;
  flex-shrink: 0;
  color: #8d6e63;
  font-size: 25rpx;
  font-weight: 900;
}

.avatar-picker {
  width: 96rpx;
  height: 96rpx;
  padding: 0;
  margin: 0;
  border-radius: 50%;
  overflow: hidden;
  background: #fff1f4;
}

.avatar-preview {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
}

.avatar-preview-tip {
  display: block;
  width: 96rpx;
  height: 96rpx;
  text-align: center;
  line-height: 96rpx;
  color: #8d6e63;
  font-size: 20rpx;
  font-weight: 800;
}

.nickname-input {
  flex: 1;
  height: 72rpx;
  padding: 0 22rpx;
  border: 2rpx solid #ffe5ec;
  border-radius: 16rpx;
  color: #5d4037;
  font-size: 26rpx;
  font-weight: 700;
  background: #ffffff;
}

.edit-actions {
  display: flex;
  margin-top: 6rpx;
}

.edit-cancel,
.edit-save {
  flex: 1;
  height: 72rpx;
  border-radius: 999rpx;
  text-align: center;
  font-size: 26rpx;
  font-weight: 900;
  line-height: 72rpx;
}

.edit-cancel {
  margin-right: 16rpx;
  color: #8d6e63;
  background: #fff1f4;
}

.edit-save {
  color: #ffffff;
  background: #ff9eb5;
}

.stats-card {
  display: flex;
  padding: 28rpx 0;
  margin-bottom: 18rpx;
  border: 2rpx solid #ffe5ec;
  border-radius: 26rpx;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8rpx 24rpx rgba(255, 143, 171, 0.1);
}

.stat {
  flex: 1;
  text-align: center;
}

.stat-num {
  color: #ff7a90;
  font-size: 40rpx;
  font-weight: 900;
}

.stat-label {
  margin-top: 6rpx;
  color: #8d6e63;
  font-size: 22rpx;
  font-weight: 800;
}

.history-panel {
  padding: 20rpx;
  margin-bottom: 18rpx;
  border: 2rpx solid #ffe5ec;
  border-radius: 26rpx;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8rpx 24rpx rgba(255, 143, 171, 0.1);
}

.panel-head {
  margin-bottom: 14rpx;
}

.panel-kicker {
  color: #ff9eb5;
  font-size: 22rpx;
  font-weight: 900;
}

.panel-title {
  margin-top: 4rpx;
  color: #5d4037;
  font-size: 28rpx;
  font-weight: 900;
}

.history-grid {
  display: flex;
  flex-wrap: wrap;
}

.history-cell {
  position: relative;
  width: 218rpx;
  height: 218rpx;
  margin: 0 9rpx 18rpx 0;
  border-radius: 18rpx;
  overflow: hidden;
  background: #ffe5ec;
}

.history-cell:nth-child(3n) {
  margin-right: 0;
}

.history-img {
  width: 100%;
  height: 100%;
}

.history-date {
  position: absolute;
  left: 8rpx;
  bottom: 8rpx;
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
  color: #ffffff;
  font-size: 18rpx;
  font-weight: 800;
  background: rgba(0, 0, 0, 0.32);
}

.history-empty {
  padding: 48rpx 0;
  text-align: center;
  color: #8d6e63;
  font-size: 24rpx;
  font-weight: 700;
}

.menu-card {
  border: 2rpx solid #ffe5ec;
  border-radius: 26rpx;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8rpx 24rpx rgba(255, 143, 171, 0.1);
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 24rpx;
  color: #5d4037;
  font-size: 27rpx;
  font-weight: 800;
  border-bottom: 2rpx solid #fff1f4;
}

.menu-item:last-child {
  border-bottom: 0;
}

.menu-item.danger {
  color: #ff5252;
  justify-content: center;
}

.menu-arrow {
  color: #ffc2d1;
  font-size: 32rpx;
}

button::after {
  border: 0;
}
```

- [ ] **Step 5: 语法烟测**

Run: `node --check platforms/wechat-miniprogram/pages/profile/profile.js`
Expected: 无输出、退出码 0。

- [ ] **Step 6: 提交**

```bash
git add platforms/wechat-miniprogram/pages/profile/
git commit -m "feat(miniapp): 新增「我的」页（登录/统计/7天历史）"
```

---

## Task 4: 注册页面 + tabBar + 启动清理

**Files:**
- Modify: `platforms/wechat-miniprogram/app.json`
- Modify: `platforms/wechat-miniprogram/app.js`
- 依赖：Task 3（profile 页四件套已存在，否则 `miniapp:wechat:check` 会失败）

- [ ] **Step 1: 改 `app.json`**

把 `pages` 数组改为（新增 profile）：

```json
  "pages": [
    "pages/index/index",
    "pages/profile/profile",
    "pages/config/config"
  ],
```

并在 `"sitemapLocation": "sitemap.json"` 之后、对象闭合 `}` 之前新增 `tabBar`（注意前一行补逗号）：

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

完整改后的 `app.json` 应为：

```json
{
  "pages": [
    "pages/index/index",
    "pages/profile/profile",
    "pages/config/config"
  ],
  "window": {
    "navigationBarTitleText": "次元绘图",
    "navigationBarBackgroundColor": "#FFF9FA",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#FFF9FA",
    "backgroundTextStyle": "dark"
  },
  "networkTimeout": {
    "request": 600000
  },
  "style": "v2",
  "sitemapLocation": "sitemap.json",
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
}
```

> 注：`tabBar.list` 第一项必须是首页 `pages/index/index`。`config` 不进 tabBar，仍由 `navigateTo` 进入。

- [ ] **Step 2: 改 `app.js`**

把整个 `app.js` 替换为：

```js
const { pruneExpired } = require('./utils/history');

App({
  globalData: {
    appName: '次元绘图'
  },

  onLaunch() {
    try {
      pruneExpired();
    } catch (e) {
      // 清理失败不影响启动
    }
  }
});
```

- [ ] **Step 3: 结构 + JSON 校验**

Run: `npm run miniapp:wechat:check`
Expected: 打印 `WeChat miniprogram ok: 3 page(s).`（页面数从 2 变 3，且 app.json 合法）。

- [ ] **Step 4: 语法烟测**

Run: `node --check platforms/wechat-miniprogram/app.js`
Expected: 无输出、退出码 0。

- [ ] **Step 5: 提交**

```bash
git add platforms/wechat-miniprogram/app.json platforms/wechat-miniprogram/app.js
git commit -m "feat(miniapp): 加底部 tabBar(广场/我的)与启动清理过期历史"
```

---

## Task 5: 首页出图落地历史 + 计数 + 最近生成改读索引

**Files:**
- Modify: `platforms/wechat-miniprogram/pages/index/index.js`
- 依赖：Task 1、Task 2

- [ ] **Step 1: 顶部引入模块**

在 `index.js` 顶部，现有两行 `require` 之后新增两行：

当前（约 1-2 行）：
```js
const { loadConfig } = require('../../utils/settings');
const { filterSafePrompts, flattenPromptData, hasReviewRiskContent } = require('../../utils/prompts');
```
改为：
```js
const { loadConfig } = require('../../utils/settings');
const { filterSafePrompts, flattenPromptData, hasReviewRiskContent } = require('../../utils/prompts');
const { addHistoryImage, loadHistory } = require('../../utils/history');
const { incrementGenerated } = require('../../utils/profile');
```

- [ ] **Step 2: 移除 RESULTS_KEY 常量**

删除该行（约第 5 行）：
```js
const RESULTS_KEY = 'ciyuan-huitu-results';
```

- [ ] **Step 3: 新增「最近生成」读取助手 + 改 onLoad/onShow**

在 `decorateVisiblePrompts` 之后（`Page({` 之前）新增助手函数：

```js
const RECENT_LIMIT = 12;

const mapHistoryToResults = () => loadHistory()
  .slice(0, RECENT_LIMIT)
  .map((item) => ({ id: item.id, src: item.filePath }));
```

把 `onLoad` 中：
```js
    const resultImages = wx.getStorageSync(RESULTS_KEY) || [];
```
改为：
```js
    const resultImages = mapHistoryToResults();
```

把 `onShow` 中：
```js
      resultImages: wx.getStorageSync(RESULTS_KEY) || []
```
改为：
```js
      resultImages: mapHistoryToResults()
```

- [ ] **Step 4: 改 `startGenerate` 的 success 落地逻辑**

当前 success 回调里的这段：
```js
        const resultImages = [...images, ...this.data.resultImages].slice(0, 30);
        wx.setStorageSync(RESULTS_KEY, resultImages);
        this.setData({ resultImages });
        wx.showToast({ title: '生成完成' });
```
改为：
```js
        Promise.all(images.map((image) => addHistoryImage({
          src: image.src,
          title,
          prompt: promptText,
          promptId: id,
          apiFormat: config.apiFormat
        }))).then((saved) => {
          if (saved.some(Boolean)) incrementGenerated(saved.filter(Boolean).length);
          this.setData({ resultImages: mapHistoryToResults() });
        });
        wx.showToast({ title: '生成完成' });
```

> 说明：`images` 形如 `{id, src, promptId, title, prompt}`（见 success 上文构造）；落地用其 `src`。`config` 在 `startGenerate` 顶部已 `const config = loadConfig()`，可直接用 `config.apiFormat`。

- [ ] **Step 5: 语法烟测 + 结构校验 + 残留检查**

Run: `node --check platforms/wechat-miniprogram/pages/index/index.js`
Expected: 无输出、退出码 0。

Run: `npm run miniapp:wechat:check`
Expected: `WeChat miniprogram ok: 3 page(s).`

Run: `grep -n "RESULTS_KEY" platforms/wechat-miniprogram/pages/index/index.js`
Expected: 无输出（RESULTS_KEY 已彻底移除）。

- [ ] **Step 6: 提交**

```bash
git add platforms/wechat-miniprogram/pages/index/index.js
git commit -m "feat(miniapp): 出图后落地7天历史并计数，最近生成改读索引"
```

---

## Task 6: README 同步（次要）

**Files:**
- Modify: `platforms/wechat-miniprogram/README.md`

- [ ] **Step 1: 在「支持」功能列表追加一条**

在 `- 独立配置页：...` 之后新增：
```markdown
- 「我的」个人中心：本地登录(头像昵称)、累计/收藏/7天作品统计
- 本地生成历史：图片存本机，满 7 天自动清理
```

- [ ] **Step 2: 在「注意」补充一条部署提示**

在「注意」段落末尾追加：
```markdown

若使用 OpenAI 等返回临时图片 URL 的接口，需在小程序后台把图片主机域名加入 **downloadFile 合法域名**，否则正式版无法把历史图片落地保存（开发工具勾选"不校验合法域名"时不受影响）。
```

- [ ] **Step 3: 提交**

```bash
git add platforms/wechat-miniprogram/README.md
git commit -m "docs(miniapp): README 同步个人中心与本地历史说明"
```

---

## 最终手测（微信开发者工具，无法在本机无头运行）

导入 `platforms/wechat-miniprogram`，**清缓存 → 编译**，逐项确认：

- [ ] 底部出现 tabBar「广场 / 我的」，切换正常；选中态为粉色 `#ff9eb5`。
- [ ] 「我的」未登录态：显示「游」占位头像 + 「未登录」+「登录」按钮。
- [ ] 点「登录/编辑」→ 选头像(chooseAvatar) + 填昵称(nickname) → 保存 → 头像昵称显示；**杀进程重进**仍在（持久化成功）。
- [ ] 在「广场」生成一张图 → 回「我的」：历史网格出现该图、可点开预览/保存；「累计生成」+1；「7天作品」计数 = 历史条数。
- [ ] 首页「最近生成」面板显示的是落地后的本机文件图（非 base64）。
- [ ] 过期清理：在开发者工具 Storage 面板把 `ciyuan-huitu-history` 中某条 `createdAt` 改成 8 天前（或临时把 `HISTORY_TTL_MS` 调成几秒）→ 重新编译/进入「我的」→ 该条及其文件被清掉、计数减少。
- [ ] 退出登录 → 头像昵称清空回未登录态；历史与统计仍在。
- [ ] 远程 URL 接口（如 OpenAI）：开发者工具勾「不校验合法域名」后，生成图能落地进历史（验证 downloadFile 路径）。

---

## Self-Review（已核对）

- **Spec 覆盖：** 登录(Task 3 chooseAvatar+nickname / profile.js)、个人信息(Task 3 统计卡 + getStats)、7天历史(Task 1 pruneExpired + Task 5 落地 + Task 4 启动清理)、tabBar 导航(Task 4)、首页集成(Task 5)、README(Task 6) —— 全部对应有任务。
- **占位扫描：** 无 TBD/TODO；每个写代码的步骤都给了完整代码。
- **类型/命名一致：** `addHistoryImage/loadHistory/pruneExpired`（history.js）、`loadProfile/saveProfile/clearProfile/incrementGenerated/getStats`（profile.js）在各调用处签名一致；索引条目字段 `{id,filePath,title,prompt,promptId,apiFormat,createdAt}` 全程一致；存储键 `ciyuan-huitu-history/profile/stats/favorites` 与现有 `index.js` 的 `FAVORITES_KEY` 一致。
- **顺序依赖：** Task 1→2→3→4（4 依赖 3 的页面文件存在，否则结构校验失败）→5→6，已在各 Task 标注依赖。

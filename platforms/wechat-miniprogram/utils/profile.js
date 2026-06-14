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
  if (/^https?:\/\//.test(String(avatarUrl))) return avatarUrl; // 远程头像直接存 URL
  if (String(avatarUrl).startsWith('/')) return avatarUrl; // 包内资源路径（/assets/...）直接存
  const old = wx.getStorageSync(PROFILE_KEY);
  const oldAvatar = (old && old.avatar) || '';
  const ext = (String(avatarUrl).match(/\.([a-z0-9]+)$/i) || [null, 'png'])[1];
  const dest = `${userDir()}/avatar-${Date.now()}.${ext}`;
  try {
    fsm().copyFileSync(avatarUrl, dest);
  } catch (e) {
    return oldAvatar; // 复制失败：保留旧头像，绝不写入会失效的临时路径
  }
  // 复制成功后再删旧头像
  if (oldAvatar && oldAvatar.startsWith(userDir()) && oldAvatar !== dest) {
    try { fsm().unlinkSync(oldAvatar); } catch (e) {}
  }
  return dest;
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

const readStats = () => {
  const raw = wx.getStorageSync(STATS_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { totalGenerated: 0 };
  return raw;
};

const incrementGenerated = (n) => {
  const stats = readStats();
  stats.totalGenerated = (stats.totalGenerated || 0) + (n || 1);
  wx.setStorageSync(STATS_KEY, stats);
  return stats.totalGenerated;
};

const getStats = () => {
  const stats = readStats();
  const favorites = wx.getStorageSync(FAVORITES_KEY) || [];
  return {
    totalGenerated: stats.totalGenerated || 0,
    favorites: Array.isArray(favorites) ? favorites.length : 0,
    history7d: history.countHistory()
  };
};

const CUTE_NICKNAMES = [
  '元气小画家', '次元绘师', '魔法绘师', '脑洞艺术家', '调色盘精灵',
  '梦境画手', '像素小可爱', '灵感收集者', '二次元画伯', '彩虹涂鸦家'
];
const AVATAR_COUNT = 6;

// 本地一键创建可爱身份（随机头像+昵称），不依赖 wx.getUserProfile（已废弃且常报错）。
const createDefaultProfile = () => {
  const name = CUTE_NICKNAMES[Math.floor(Math.random() * CUTE_NICKNAMES.length)];
  const nickname = `${name}${Math.floor(1000 + Math.random() * 9000)}`;
  const avatar = `/assets/avatars/avatar-${1 + Math.floor(Math.random() * AVATAR_COUNT)}.png`;
  return saveProfile({ avatar, nickname });
};

// 登录门禁：已登录直接放行；未登录弹确认框，一键创建本地可爱身份后放行。
const ensureLogin = (onOk) => {
  if (loadProfile()) {
    if (onOk) onOk();
    return;
  }
  wx.showModal({
    title: '一键登录',
    content: '登录后即可使用收藏、生成等功能，会随机分配一个可爱头像和昵称～',
    confirmText: '一键登录',
    success: (res) => {
      if (res.confirm) {
        createDefaultProfile();
        if (onOk) onOk();
      }
    }
  });
};

module.exports = {
  PROFILE_KEY,
  STATS_KEY,
  loadProfile,
  saveProfile,
  clearProfile,
  incrementGenerated,
  getStats,
  ensureLogin,
  createDefaultProfile
};

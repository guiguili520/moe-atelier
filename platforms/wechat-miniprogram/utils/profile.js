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
  if (/^https?:\/\//.test(String(avatarUrl))) return avatarUrl; // 远程头像（如微信返回）直接存 URL
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

// 登录门禁：已登录直接放行；未登录则拉起 getUserProfile，成功后保存并放行。
// 必须由点击手势的同步调用栈触发（getUserProfile 的手势要求）。
const ensureLogin = (onOk) => {
  if (loadProfile()) {
    if (onOk) onOk();
    return;
  }
  wx.getUserProfile({
    desc: '用于展示你的头像和昵称',
    success: (res) => {
      const info = res.userInfo || {};
      saveProfile({ avatar: info.avatarUrl || '', nickname: info.nickName || '微信用户' });
      if (onOk) onOk();
    },
    fail: () => wx.showToast({ title: '需登录后使用', icon: 'none' })
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
  ensureLogin
};

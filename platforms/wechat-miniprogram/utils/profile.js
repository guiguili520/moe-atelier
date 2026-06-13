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

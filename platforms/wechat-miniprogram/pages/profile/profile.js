const { loadProfile, saveProfile, clearProfile, getStats, createDefaultProfile } = require('../../utils/profile');
const { loadHistory } = require('../../utils/history');

const DAY = 24 * 60 * 60 * 1000;
const AVATAR_OPTIONS = [1, 2, 3, 4, 5, 6].map((n) => `/assets/avatars/avatar-${n}.png`);

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
    joinDays: 0,
    editing: false,
    draftNickname: '',
    draftAvatar: '',
    avatarOptions: AVATAR_OPTIONS
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const profile = loadProfile();
    const rawHistory = loadHistory();
    const stats = getStats();
    // 无变化（纯切 tab）就跳过重渲染，避免每次切到「我的」都重排历史网格。
    const sig = `${rawHistory.length}:${(rawHistory[0] && rawHistory[0].id) || ''}:${stats.totalGenerated}:${stats.favorites}:${profile ? profile.nickname + profile.avatar : 'guest'}`;
    if (sig === this._lastSig) return;
    this._lastSig = sig;
    const history = rawHistory.map((item) => ({ id: item.id, filePath: item.filePath, dateLabel: formatDate(item.createdAt) }));
    const joinDays = profile ? Math.max(1, Math.floor((Date.now() - profile.createdAt) / DAY) + 1) : 0;
    this.setData({ profile, history, stats, joinDays });
  },

  // 一键登录：本地生成随机可爱头像+昵称（不再用已废弃且报错的 getUserProfile）。
  login() {
    createDefaultProfile();
    this.refresh();
    wx.showToast({ title: '已登录' });
  },

  startEdit() {
    const profile = loadProfile();
    if (!profile) return;
    this.setData({
      editing: true,
      draftNickname: profile.nickname,
      draftAvatar: profile.avatar
    });
  },

  cancelEdit() {
    this.setData({ editing: false });
  },

  pickAvatar(event) {
    this.setData({ draftAvatar: event.currentTarget.dataset.src });
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
          this.setData({ editing: false });
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

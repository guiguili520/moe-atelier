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

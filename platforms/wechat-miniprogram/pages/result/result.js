Page({
  data: {
    images: [],
    current: 0,
    multi: false,
    statusBar: 20
  },

  onLoad() {
    const app = getApp();
    const images = (app.globalData && app.globalData.resultImages) || [];
    let statusBar = 20;
    try {
      const info = (wx.getWindowInfo && wx.getWindowInfo()) || (wx.getSystemInfoSync && wx.getSystemInfoSync()) || {};
      statusBar = info.statusBarHeight || 20;
    } catch (e) {}
    this.setData({ images, multi: images.length > 1, statusBar });
  },

  onSwiperChange(event) {
    this.setData({ current: event.detail.current });
  },

  currentPath() {
    const img = this.data.images[this.data.current];
    return img && img.filePath;
  },

  onLongPress() {
    const path = this.currentPath();
    if (!path) return;
    wx.showActionSheet({
      itemList: ['保存到相册', '分享图片'],
      success: (res) => {
        if (res.tapIndex === 0) this.saveToAlbum(path);
        else if (res.tapIndex === 1) this.shareImage(path);
      }
    });
  },

  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => wx.showToast({ title: '已保存到相册' }),
      fail: (err) => {
        if (String(err.errMsg || '').includes('auth') || String(err.errMsg || '').includes('deny')) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存到相册',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting(); }
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      }
    });
  },

  shareImage(filePath) {
    if (wx.showShareImageMenu) {
      wx.showShareImageMenu({
        path: filePath,
        fail: (err) => {
          if (!String(err.errMsg || '').includes('cancel')) {
            wx.showToast({ title: '分享失败', icon: 'none' });
          }
        }
      });
    } else {
      wx.showToast({ title: '当前微信版本不支持分享图片', icon: 'none' });
    }
  },

  back() {
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  }
});

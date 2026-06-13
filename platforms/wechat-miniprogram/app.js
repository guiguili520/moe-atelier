const { pruneExpired } = require('./utils/history');

App({
  globalData: {
    appName: '次元绘图',
    resultImages: []
  },

  onLaunch() {
    try {
      pruneExpired();
    } catch (e) {
      // 清理失败不影响启动
    }
  }
});

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
      if (res.statusCode < 200 || res.statusCode >= 300 || !res.tempFilePath) {
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

const isExpired = (entry, now) =>
  !entry || typeof entry.createdAt !== 'number' || (now - entry.createdAt) > HISTORY_TTL_MS;

// 轻量加载：仅按时间过滤，不做任何文件系统检查（页面渲染/onShow 热路径，避免同步 fs 卡顿）。
const loadHistory = () => {
  const now = Date.now();
  const list = readIndex();
  const kept = list.filter((entry) => !isExpired(entry, now));
  if (kept.length !== list.length) writeIndex(kept);
  return kept;
};

// 深度清理：时间 + 文件存在性 + 删文件 + 上限。开销大（同步 fs），仅 app.onLaunch 低频调用。
const pruneExpired = () => {
  const now = Date.now();
  const list = readIndex();
  const kept = [];
  list.forEach((entry) => {
    if (isExpired(entry, now) || !fileExists(entry.filePath)) {
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

// 轻量计数：只按时间过滤，不碰文件系统。
const countHistory = () => {
  const now = Date.now();
  return readIndex().filter((entry) => !isExpired(entry, now)).length;
};

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
  countHistory,
  pruneExpired,
  removeHistoryImage,
  clearHistory
};

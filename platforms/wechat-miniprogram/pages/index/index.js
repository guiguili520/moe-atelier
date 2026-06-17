const { loadConfig, PROXY_BASE } = require('../../utils/settings');
const { filterSafePrompts, flattenPromptData, hasReviewRiskContent } = require('../../utils/prompts');
const { addHistoryImage, loadHistory } = require('../../utils/history');
const { incrementGenerated, ensureLogin } = require('../../utils/profile');

const FAVORITES_KEY = 'ciyuan-huitu-favorites';
const PAGE_SIZE = 20;
const CUSTOM_GENERATE_ID = 'custom';
const GENERATE_TIMEOUT = 600000;

const GEN_TIPS = [
  '主人别急嘛，本小姐这就画好',
  '哼，画得这么认真，等下要夸我哦',
  '先喝杯茶，人家马上变给你看～',
  '笔尖在施魔法，不许偷看啦',
  '再等一下下，乖乖等我哦～',
  '马上就好，才不是为了你呢～'
];

const normalizeBaseUrl = (value) => String(value || '').replace(/\/+$/, '');

const resolveGenerateUrl = (config) => {
  const base = normalizeBaseUrl(config.apiUrl);
  if (config.apiFormat === 'gemini') {
    const hasVersion = /\/v\d+(beta|alpha)?(\/|$)/.test(base);
    const versioned = hasVersion ? base : `${base}/v1beta`;
    return `${versioned}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  }
  return `${base}/images/generations`;
};

const extractImages = (body, apiFormat) => {
  const images = [];
  const push = (src) => {
    if (typeof src === 'string' && src) images.push({ id: `${Date.now()}-${images.length}`, src });
  };

  if (apiFormat === 'gemini') {
    const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
    candidates.forEach((candidate) => {
      const parts = candidate?.content?.parts || [];
      parts.forEach((part) => {
        const data = part?.inlineData?.data || part?.inline_data?.data;
        const mime = part?.inlineData?.mimeType || part?.inline_data?.mime_type || 'image/png';
        if (data) push(`data:${mime};base64,${data}`);
        if (part?.fileData?.fileUri) push(part.fileData.fileUri);
      });
    });
    return images;
  }

  const data = Array.isArray(body?.data) ? body.data : [];
  data.forEach((item) => {
    if (item?.b64_json) push(`data:image/png;base64,${item.b64_json}`);
    if (item?.url) push(item.url);
  });
  return images;
};

const dataUrlToTempFile = (src) => new Promise((resolve, reject) => {
  const matched = String(src).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!matched) {
    resolve(src);
    return;
  }
  const mime = matched[1];
  const ext = mime.includes('jpeg') ? 'jpg' : (mime.split('/')[1] || 'png').replace(/\W/g, '');
  const filePath = `${wx.env.USER_DATA_PATH}/ciyuan-huitu-${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`;
  wx.getFileSystemManager().writeFile({
    filePath,
    data: matched[2],
    encoding: 'base64',
    success: () => resolve(filePath),
    fail: reject
  });
});

const buildRequest = (config, prompt) => {
  if (config.apiFormat === 'gemini') {
    return {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
    };
  }
  return {
    model: config.model,
    prompt,
    n: 1,
    size: config.size
  };
};

const decorateVisiblePrompts = (items) => items.map((item, index) => ({
  ...item,
  cardSide: index % 2 === 1 ? 'right' : ''
}));

const RECENT_LIMIT = 12;

const mapHistoryToResults = () => loadHistory()
  .slice(0, RECENT_LIMIT)
  .map((item) => ({ id: item.id, src: item.filePath }));

Page({
  data: {
    config: loadConfig(),
    promptSourceUrl: '',
    loadingPrompts: false,
    loading: true,
    promptError: '',
    visiblePrompts: [],
    hasMore: false,
    showEmpty: false,
    showGrid: false,
    categories: [],
    activeCategory: 'all',
    searchText: '',
    page: 1,
    favoriteIds: [],
    previewVisible: false,
    previewPrompt: null,
    previewPromptText: '',
    customPrompt: '',
    customReference: '',
    previewReference: '',
    generatingId: '',
    isGenerating: false,
    resultImages: [],
    genVisible: false,
    genPercent: 0,
    genTip: ''
  },

  onLoad() {
    // 大数组放实例属性，不进 data，避免 setData 序列化数百条记录导致卡顿。
    this._allPrompts = [];
    this._filteredPrompts = [];
    const config = loadConfig();
    const favoriteIds = wx.getStorageSync(FAVORITES_KEY) || [];
    const resultImages = mapHistoryToResults();
    this.setData({
      config,
      promptSourceUrl: config.promptSourceUrl,
      favoriteIds,
      resultImages
    });
    this.fetchPrompts();
  },

  onShow() {
    const app = getApp();
    if (app.globalData && app.globalData.pendingReference) {
      this.setData({ customReference: app.globalData.pendingReference });
      app.globalData.pendingReference = '';
    }
    // 首次进入：完整加载；tab 返回：只刷新「最近生成」，不重渲染整个网格（避免切 tab 卡顿）。
    if ((this._allPrompts || []).length === 0) {
      const config = loadConfig();
      this.setData({
        config,
        promptSourceUrl: config.promptSourceUrl,
        favoriteIds: wx.getStorageSync(FAVORITES_KEY) || [],
        resultImages: mapHistoryToResults()
      });
      if (!this.data.loadingPrompts) this.fetchPrompts();
    } else {
      this.setData({ resultImages: mapHistoryToResults() });
    }
  },

  onHide() {
    // 仅在生成中（曾隐藏 tabBar）才恢复，避免每次切 tab 都调用 showTabBar 造成卡顿。
    if (this.genTimer) {
      clearInterval(this.genTimer);
      this.genTimer = null;
      wx.showTabBar({ fail: () => {} });
    }
  },

  onUnload() {
    if (this.genTimer) { clearInterval(this.genTimer); this.genTimer = null; }
  },

  fetchPrompts() {
    const sourceUrl = this.data.config.promptSourceUrl;
    if (!sourceUrl) {
      this.setData({ promptError: '请先到配置页填写提示词数据源', showEmpty: false, showGrid: false, loading: false });
      return;
    }

    this.setData({ loadingPrompts: true, promptError: '', showEmpty: false, showGrid: false });
    wx.request({
      url: sourceUrl,
      method: 'GET',
      timeout: 30000,
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          this.setData({ promptError: `提示词加载失败：${res.statusCode}`, showEmpty: false, showGrid: false });
          return;
        }
        this._allPrompts = filterSafePrompts(flattenPromptData(res.data));
        this.setData({
          page: 1,
          activeCategory: 'all'
        });
        this.applyFilters();
      },
      fail: (err) => {
        this.setData({ promptError: err.errMsg || '提示词加载失败，请检查请求域名配置', showEmpty: false, showGrid: false });
      },
      complete: () => {
        this.setData({ loadingPrompts: false, loading: false });
      }
    });
  },

  buildCategories(prompts) {
    // 数据源真实可分维度只有 type（图生图/文生图）与 heat_score（热门排序）；
    // category 全是 gallery、tags 99% 是噪声，故用固定 chip 而非按 section 派生。
    const active = this.data.activeCategory;
    const favoriteSet = new Set(this.data.favoriteIds);
    const img2img = prompts.filter((item) => item.promptType === 'img2img').length;
    const txt2img = prompts.filter((item) => item.promptType === 'txt2img').length;
    const favCount = prompts.filter((item) => favoriteSet.has(item.id)).length;
    const list = [
      { id: 'all', label: '全部', count: prompts.length, active: active === 'all' },
      { id: 'hot', label: '热门', count: 0, active: active === 'hot' }, // 热门是排序非筛选，不显计数
      { id: 'img2img', label: '图生图', count: img2img, active: active === 'img2img' },
      { id: 'txt2img', label: '文生图', count: txt2img, active: active === 'txt2img' },
      { id: 'favorites', label: '收藏', count: favCount, active: active === 'favorites' }
    ];
    // 全部/热门/收藏 始终显示；图生图/文生图 仅在该类型有内容时显示。
    return list.filter((item) => item.count > 0 || ['all', 'hot', 'favorites'].includes(item.id));
  },

  applyFilters() {
    const allPrompts = this._allPrompts || [];
    const { activeCategory, searchText, favoriteIds, page } = this.data;
    const keyword = searchText.trim().toLowerCase();
    let filtered = allPrompts;
    if (activeCategory === 'favorites') {
      filtered = filtered.filter((item) => favoriteIds.includes(item.id));
    } else if (activeCategory === 'img2img') {
      filtered = filtered.filter((item) => item.promptType === 'img2img');
    } else if (activeCategory === 'txt2img') {
      filtered = filtered.filter((item) => item.promptType === 'txt2img');
    } else if (activeCategory === 'hot') {
      // 热门：全部内容按 heat_score 倒序（slice 避免改动原数组）
      filtered = filtered.slice().sort((a, b) => (b.heatScore || 0) - (a.heatScore || 0));
    }
    if (keyword) {
      filtered = filtered.filter((item) => [
        item.title,
        item.content,
        item.contributor,
        item.sectionTitle,
        ...(item.tags || [])
      ].join('\n').toLowerCase().includes(keyword));
    }

    const favoriteSet = new Set(favoriteIds);
    const withState = filtered.map((item) => ({
      ...item,
      favorite: favoriteSet.has(item.id),
      displayTags: (item.tags || []).slice(0, 3)
    }));
    this._filteredPrompts = withState;
    this.setData({
      categories: this.buildCategories(allPrompts),
      visiblePrompts: decorateVisiblePrompts(withState.slice(0, page * PAGE_SIZE)),
      hasMore: withState.length > page * PAGE_SIZE,
      showEmpty: withState.length === 0 && !this.data.promptError,
      showGrid: withState.length > 0
    });
  },

  handleSearchInput(event) {
    this.setData({ searchText: event.detail.value, page: 1 });
    this.applyFilters();
  },

  clearSearch() {
    this.setData({ searchText: '', page: 1 });
    this.applyFilters();
  },

  handleCategoryTap(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.id, page: 1 });
    this.applyFilters();
  },

  loadMore() {
    const nextPage = this.data.page + 1;
    const filtered = this._filteredPrompts || [];
    this.setData({
      page: nextPage,
      visiblePrompts: decorateVisiblePrompts(filtered.slice(0, nextPage * PAGE_SIZE)),
      hasMore: filtered.length > nextPage * PAGE_SIZE
    });
  },

  toggleFavorite(event) {
    const id = event.currentTarget.dataset.id;
    ensureLogin(() => {
      const favoriteIds = this.data.favoriteIds.includes(id)
        ? this.data.favoriteIds.filter((item) => item !== id)
        : [...this.data.favoriteIds, id];
      wx.setStorageSync(FAVORITES_KEY, favoriteIds);
      this.setData({ favoriteIds });
      this.applyFilters();
    });
  },

  openPreview(event) {
    const id = event.currentTarget.dataset.id;
    const prompt = (this._allPrompts || []).find((item) => item.id === id);
    if (!prompt) return;
    this.setData({
      previewVisible: true,
      previewPromptText: prompt.content,
      previewReference: '',
      previewPrompt: {
        ...prompt,
        favorite: this.data.favoriteIds.includes(prompt.id),
        displayTags: (prompt.tags || []).slice(0, 3)
      }
    });
  },

  closePreview() {
    this.setData({ previewVisible: false, previewPrompt: null, previewPromptText: '' });
  },

  goConfig() {
    wx.navigateTo({ url: '/pages/config/config' });
  },

  handleCustomPromptInput(event) {
    this.setData({ customPrompt: event.detail.value });
  },

  handlePreviewPromptInput(event) {
    this.setData({ previewPromptText: event.detail.value });
  },

  validatePromptText(promptText) {
    const text = String(promptText || '').trim();
    if (!text) {
      wx.showToast({ title: '请先输入提示词', icon: 'none' });
      return '';
    }
    if (hasReviewRiskContent(text)) {
      wx.showToast({ title: '提示词包含不适合发布的内容', icon: 'none' });
      return '';
    }
    return text;
  },

  generateCustomPrompt() {
    const promptText = this.validatePromptText(this.data.customPrompt);
    if (!promptText) return;
    ensureLogin(() => this.startGenerate({
      id: CUSTOM_GENERATE_ID,
      title: '自定义提示词',
      promptText,
      referenceImage: this.data.customReference
    }));
  },

  // 选参考图，data-target 指定写到哪个字段(customReference / previewReference)。
  chooseReference(event) {
    const target = (event && event.currentTarget && event.currentTarget.dataset.target) || 'customReference';
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        wx.compressImage({
          src: file.tempFilePath,
          quality: 75,
          success: (c) => this.readReference(c.tempFilePath, target),
          fail: () => this.readReference(file.tempFilePath, target)
        });
      },
      fail: () => {}
    });
  },

  readReference(path, target) {
    const key = target || 'customReference';
    const ext = (String(path).match(/\.([a-z0-9]+)$/i) || [null, 'png'])[1].toLowerCase();
    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
    try {
      const base64 = wx.getFileSystemManager().readFileSync(path, 'base64');
      this.setData({ [key]: `data:${mime};base64,${base64}` });
    } catch (e) {
      wx.showToast({ title: '读取参考图失败', icon: 'none' });
    }
  },

  removeReference(event) {
    const target = (event && event.currentTarget && event.currentTarget.dataset.target) || 'customReference';
    this.setData({ [target]: '' });
  },

  generateFromPrompt(event) {
    const id = event.currentTarget.dataset.id || this.data.previewPrompt?.id;
    const prompt = (this._allPrompts || []).find((item) => item.id === id) || this.data.previewPrompt;
    if (!prompt) return;
    const promptText = this.validatePromptText(this.data.previewPromptText || prompt.content);
    if (!promptText) return;
    ensureLogin(() => this.startGenerate({
      id: prompt.id,
      title: prompt.title,
      promptText,
      referenceImage: this.data.previewReference
    }));
  },

  startGenOverlay() {
    wx.hideTabBar({ fail: () => {} });
    this.setData({ genVisible: true, genPercent: 4, genTip: GEN_TIPS[0], previewVisible: false });
    let tick = 0;
    this.genTimer = setInterval(() => {
      tick += 1;
      const p = this.data.genPercent;
      const next = p < 95 ? p + Math.max(1, Math.round((95 - p) * 0.12)) : p;
      const patch = { genPercent: Math.min(95, next) };
      if (tick % 5 === 0) {
        let t = this.data.genTip;
        while (t === this.data.genTip) t = GEN_TIPS[Math.floor(Math.random() * GEN_TIPS.length)];
        patch.genTip = t;
      }
      this.setData(patch);
    }, 500);
  },

  stopGenOverlay() {
    if (this.genTimer) { clearInterval(this.genTimer); this.genTimer = null; }
    this.setData({ genVisible: false, genPercent: 0, previewVisible: false });
    wx.showTabBar({ fail: () => {} });
  },

  finishGenAndGo() {
    if (this.genTimer) { clearInterval(this.genTimer); this.genTimer = null; }
    this.setData({ genPercent: 100 });
    setTimeout(() => {
      this.setData({ genVisible: false, genPercent: 0, previewVisible: false });
      wx.showTabBar({ fail: () => {} });
      wx.navigateTo({ url: '/pages/result/result' });
    }, 320);
  },

  noop() {},

  startGenerate({ id, title, promptText, referenceImage }) {
    if (this.data.isGenerating) {
      wx.showToast({ title: '上一张还在生成中', icon: 'none' });
      return;
    }
    const config = loadConfig();
    if (!config.apiKey || !config.model) {
      wx.showToast({ title: '请先完成配置', icon: 'none' });
      wx.navigateTo({ url: '/pages/config/config' });
      return;
    }

    const payload = {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      apiFormat: config.apiFormat,
      model: config.model,
      prompt: promptText,
      size: config.size,
      // 以下三项 OpenAI 专属，代理端按格式决定是否透传（Gemini 忽略）。
      quality: config.quality,
      outputFormat: config.outputFormat,
      background: config.background
    };
    if (referenceImage) payload.image = referenceImage;
    this.setData({ generatingId: id, isGenerating: true });
    this.startGenOverlay();
    wx.request({
      url: `${PROXY_BASE}/api/proxy/generate`,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: payload,
      timeout: GENERATE_TIMEOUT,
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = res.data?.error || res.data?.message || `请求失败：${res.statusCode}`;
          this.stopGenOverlay();
          wx.showToast({ title: message, icon: 'none' });
          return;
        }
        const list = Array.isArray(res.data && res.data.images) ? res.data.images : [];
        const images = list.map((src, i) => ({ id: `${Date.now()}-${i}`, src, promptId: id, title, prompt: promptText }));
        if (!images.length) {
          this.stopGenOverlay();
          wx.showToast({ title: '没有解析到图片', icon: 'none' });
          return;
        }
        Promise.all(images.map((image) => addHistoryImage({
          src: image.src,
          title,
          prompt: promptText,
          promptId: id,
          apiFormat: config.apiFormat
        }))).then((saved) => {
          const ok = saved.filter(Boolean);
          if (!ok.length) {
            this.stopGenOverlay();
            wx.showToast({ title: '保存失败', icon: 'none' });
            return;
          }
          incrementGenerated(ok.length);
          // 自定义生图成功后清空提示词与参考图，避免残留到下一次。
          const cleared = id === CUSTOM_GENERATE_ID ? { customPrompt: '', customReference: '' } : {};
          this.setData({ resultImages: mapHistoryToResults(), ...cleared });
          getApp().globalData.resultImages = ok.map((e) => ({ id: e.id, filePath: e.filePath, title: e.title }));
          this.finishGenAndGo();
        }).catch(() => {
          this.stopGenOverlay();
          wx.showToast({ title: '保存失败', icon: 'none' });
        });
      },
      fail: (err) => {
        this.stopGenOverlay();
        wx.showToast({ title: err.errMsg || '请求失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ generatingId: '', isGenerating: false });
      }
    });
  },

  previewImage(event) {
    const current = event.currentTarget.dataset.src;
    dataUrlToTempFile(current)
      .then((filePath) => {
        const isTemp = filePath !== current && String(filePath).startsWith(wx.env.USER_DATA_PATH);
        wx.previewImage({
          current: filePath,
          urls: [filePath],
          complete: () => {
            if (isTemp) {
              try { wx.getFileSystemManager().unlinkSync(filePath); } catch (e) {}
            }
          }
        });
      })
      .catch(() => wx.showToast({ title: '预览失败', icon: 'none' }));
  },

  saveImage(event) {
    const src = event.currentTarget.dataset.src;
    wx.showLoading({ title: '保存中' });
    if (String(src).startsWith('data:')) {
      dataUrlToTempFile(src)
        .then((filePath) => {
          wx.saveImageToPhotosAlbum({
            filePath,
            success: () => wx.showToast({ title: '已保存' }),
            fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
          });
        })
        .catch(() => wx.showToast({ title: '保存失败', icon: 'none' }))
        .finally(() => wx.hideLoading());
      return;
    }
    wx.downloadFile({
      url: src,
      success: (res) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: '已保存' }),
          fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
        });
      },
      fail: () => wx.showToast({ title: '下载失败', icon: 'none' }),
      complete: () => wx.hideLoading()
    });
  }
});

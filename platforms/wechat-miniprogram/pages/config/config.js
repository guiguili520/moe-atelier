const {
  FORMAT_OPTIONS,
  SIZE_OPTIONS,
  getFormatIndex,
  getSizeIndex,
  loadConfig,
  saveConfig,
  PROXY_BASE
} = require('../../utils/settings');
const { ensureLogin } = require('../../utils/profile');

// 生图模型名称关键词（接口列表不返回能力，只能按名称启发式筛选）。
const IMAGE_MODEL_KEYWORDS = [
  'image', 'dall-e', 'dalle', 'gpt-image', 'flux', 'imagen', 'stable-diffusion',
  'sdxl', 'sd3', 'seedream', 'kolors', 'wanx', 'cogview', 'ideogram', 'recraft',
  'grok-2-image', 'hidream', 'qwen-image'
];

const normalizeBaseUrl = (value) => String(value || '').replace(/\/+$/, '');

const uniqueStrings = (list) => {
  const seen = {};
  const out = [];
  list.forEach((item) => {
    const v = String(item || '').trim();
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  });
  return out;
};

Page({
  data: {
    config: loadConfig(),
    formatOptions: FORMAT_OPTIONS,
    sizeOptions: SIZE_OPTIONS,
    formatIndex: 0,
    sizeIndex: 0,
    models: [],
    allModels: [],
    loadingModels: false,
    showAllModels: false,
    dirty: false
  },

  onLoad() {
    this.syncConfig();
  },

  onShow() {
    this.syncConfig();
  },

  onUnload() {
    if (this.fetchTimer) { clearTimeout(this.fetchTimer); this.fetchTimer = null; }
  },

  syncConfig() {
    const config = loadConfig();
    this.setData({
      config,
      formatIndex: getFormatIndex(config.apiFormat),
      sizeIndex: getSizeIndex(config.size),
      dirty: false
    });
  },

  // 仅改本地 data，不落盘；点「保存配置」才写入。
  patch(next) {
    const config = { ...this.data.config, ...next };
    this.setData({
      config,
      formatIndex: getFormatIndex(config.apiFormat),
      sizeIndex: getSizeIndex(config.size),
      dirty: true
    });
  },

  handleFormatChange(event) {
    const formatIndex = Number(event.detail.value);
    const apiFormat = FORMAT_OPTIONS[formatIndex].value;
    const preset = apiFormat === 'gemini'
      ? { apiUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.0-flash-preview-image-generation' }
      : { apiUrl: 'https://api.openai.com/v1', model: 'gpt-image-1' };
    this.patch({ apiFormat, ...preset });
    this.setData({ models: [], allModels: [] });
    this.scheduleFetchModels();
  },

  handleSizeChange(event) {
    const sizeIndex = Number(event.detail.value);
    this.patch({ size: SIZE_OPTIONS[sizeIndex].value });
  },

  handleApiUrlInput(event) {
    this.patch({ apiUrl: event.detail.value });
    this.scheduleFetchModels();
  },

  handleApiKeyInput(event) {
    this.patch({ apiKey: event.detail.value });
    this.scheduleFetchModels();
  },

  handleModelInput(event) {
    this.patch({ model: event.detail.value });
  },

  handleModelPick(event) {
    const model = this.data.models[Number(event.detail.value)];
    if (model) this.patch({ model });
  },

  applyModelFilter(list, showAll) {
    const all = showAll === undefined ? this.data.showAllModels : showAll;
    if (all) return list;
    const filtered = list.filter((id) => {
      const lower = String(id).toLowerCase();
      return IMAGE_MODEL_KEYWORDS.some((kw) => lower.includes(kw));
    });
    return filtered.length ? filtered : list; // 过滤后为空则回退全量，避免一个都选不了
  },

  toggleShowAll() {
    const showAllModels = !this.data.showAllModels;
    this.setData({ showAllModels, models: this.applyModelFilter(this.data.allModels, showAllModels) });
  },

  scheduleFetchModels() {
    if (this.fetchTimer) clearTimeout(this.fetchTimer);
    this.fetchTimer = setTimeout(() => {
      this.fetchTimer = null;
      this.fetchModels();
    }, 800);
  },

  refreshModels() {
    this.fetchModels();
  },

  fetchModels() {
    const { apiUrl, apiKey, apiFormat } = this.data.config;
    if (!apiUrl || !apiKey) return;
    this.setData({ loadingModels: true });
    wx.request({
      url: `${PROXY_BASE}/api/proxy/models`,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: { apiUrl, apiKey, apiFormat },
      timeout: 20000,
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          this.setData({ loadingModels: false });
          return;
        }
        const allModels = uniqueStrings(Array.isArray(res.data && res.data.models) ? res.data.models : []);
        this.setData({
          allModels,
          models: this.applyModelFilter(allModels),
          loadingModels: false
        });
      },
      fail: () => {
        this.setData({ loadingModels: false });
      }
    });
  },

  saveAll() {
    ensureLogin(() => {
      saveConfig(this.data.config);
      this.setData({ dirty: false });
      wx.showToast({ title: '已保存' });
    });
  }
});

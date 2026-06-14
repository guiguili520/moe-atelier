const STORAGE_KEY = 'ciyuan-huitu-miniprogram-config';
const LEGACY_STORAGE_KEY = 'dream-atelier-miniprogram-config';

const FORMAT_OPTIONS = [
  { label: 'OpenAI 兼容', value: 'openai' },
  { label: 'Gemini', value: 'gemini' }
];

const SIZE_OPTIONS = [
  { label: '方图', value: '1024x1024', desc: '头像 / 正方形作品' },
  { label: '竖图', value: '1024x1536', desc: '海报 / 手机壁纸' },
  { label: '横图', value: '1536x1024', desc: '封面 / 场景插画' }
];

const DEFAULT_CONFIG = {
  apiFormat: 'openai',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-image-1',
  size: '1024x1024',
  promptSourceUrl: 'https://moe.guiguili.cloud/api/prompt-manager'
};

// 小程序所有请求必须走白名单 HTTPS 域名；生图/取模型经此中转代理转发到用户自定义 API。
const PROXY_BASE = 'https://moe.guiguili.cloud';

const loadConfig = () => {
  const stored = wx.getStorageSync(STORAGE_KEY) || wx.getStorageSync(LEGACY_STORAGE_KEY);
  const merged = stored ? { ...DEFAULT_CONFIG, ...stored } : { ...DEFAULT_CONFIG };
  // 提示词广场数据源在小程序端不开放给用户修改，强制锁定为默认源（忽略历史存储/入参）。
  merged.promptSourceUrl = DEFAULT_CONFIG.promptSourceUrl;
  return merged;
};

const saveConfig = (next) => {
  const config = { ...loadConfig(), ...next };
  // 在 spread 之后再次锁定，防止任何 next 入参覆盖提示词源。
  config.promptSourceUrl = DEFAULT_CONFIG.promptSourceUrl;
  wx.setStorageSync(STORAGE_KEY, config);
  return config;
};

const getFormatIndex = (apiFormat) => Math.max(0, FORMAT_OPTIONS.findIndex((item) => item.value === apiFormat));

const getSizeIndex = (size) => Math.max(0, SIZE_OPTIONS.findIndex((item) => item.value === size));

module.exports = {
  DEFAULT_CONFIG,
  FORMAT_OPTIONS,
  SIZE_OPTIONS,
  PROXY_BASE,
  getFormatIndex,
  getSizeIndex,
  loadConfig,
  saveConfig
};

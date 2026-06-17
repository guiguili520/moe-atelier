const STORAGE_KEY = 'ciyuan-huitu-miniprogram-config';
const LEGACY_STORAGE_KEY = 'dream-atelier-miniprogram-config';

const FORMAT_OPTIONS = [
  { label: 'OpenAI 兼容', value: 'openai' },
  { label: 'Gemini', value: 'gemini' }
];

const SIZE_OPTIONS = [
  { label: '方图', value: '1024x1024', desc: '头像 / 正方形作品' },
  { label: '竖图', value: '1024x1536', desc: '海报 / 手机壁纸' },
  { label: '横图', value: '1536x1024', desc: '封面 / 场景插画' },
  { label: '自动', value: 'auto', desc: '由模型自动决定' }
];

// 以下三项为 OpenAI gpt-image-1 专属参数，Gemini 不使用（配置页仅 OpenAI 格式显示）。
const QUALITY_OPTIONS = [
  { label: '高', value: 'high', desc: '细节最佳 / 更慢' },
  { label: '中', value: 'medium', desc: '均衡' },
  { label: '低', value: 'low', desc: '更快更省' },
  { label: '自动', value: 'auto', desc: '由模型决定' }
];

const OUTPUT_FORMAT_OPTIONS = [
  { label: 'PNG', value: 'png', desc: '无损 / 支持透明' },
  { label: 'JPEG', value: 'jpeg', desc: '体积小 / 不透明' },
  { label: 'WEBP', value: 'webp', desc: '小体积 / 支持透明' }
];

const BACKGROUND_OPTIONS = [
  { label: '自动', value: 'auto', desc: '由模型决定' },
  { label: '透明', value: 'transparent', desc: '需 PNG / WEBP' },
  { label: '不透明', value: 'opaque', desc: '实心背景' }
];

const DEFAULT_CONFIG = {
  apiFormat: 'openai',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-image-1',
  size: '1024x1024',
  quality: 'high',
  outputFormat: 'png',
  background: 'auto',
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

const getQualityIndex = (quality) => Math.max(0, QUALITY_OPTIONS.findIndex((item) => item.value === quality));

const getOutputFormatIndex = (format) => Math.max(0, OUTPUT_FORMAT_OPTIONS.findIndex((item) => item.value === format));

const getBackgroundIndex = (background) => Math.max(0, BACKGROUND_OPTIONS.findIndex((item) => item.value === background));

module.exports = {
  DEFAULT_CONFIG,
  FORMAT_OPTIONS,
  SIZE_OPTIONS,
  QUALITY_OPTIONS,
  OUTPUT_FORMAT_OPTIONS,
  BACKGROUND_OPTIONS,
  PROXY_BASE,
  getFormatIndex,
  getSizeIndex,
  getQualityIndex,
  getOutputFormatIndex,
  getBackgroundIndex,
  loadConfig,
  saveConfig
};

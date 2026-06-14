const REVIEW_RISK_KEYWORDS = [
  'nsfw', 'nfsw', 'r18', 'r-18', '18+', '18禁',
  '色情', '情色', '黄色', '涉黄', '成人向', '成人内容', '黄图', '黄漫', '黄片',
  '裸露', '暴露', '走光', '裸体', '全裸', '半裸', '赤裸', '裸身', '露点', '露乳', '露胸', '露私处',
  '性感', '性欲', '性暗示', '性冲动', '性癖', '性爱', '性交', '做爱', '性行为', '性姿势', '性器',
  '私处', '阴茎', '阴道', '龟头', '睾丸', '乳头', '乳晕', '乳房', '巨乳', '爆乳',
  '口交', '肛交', '手交', '足交', '自慰', '手淫', '高潮', '射精', '精液', '内射', '颜射', '潮吹',
  '淫', '淫乱', '淫荡', '淫纹', '发情', '春药', '调教', '凌辱', '强奸', '轮奸', '无码', '无修正',
  '暴力', '血腥', '血液', '流血', '出血', '鲜血', '血迹', '血泊', '肢解', '断肢', '断头',
  '尸体', '尸', '死亡', '杀死', '杀戮', '屠杀', '虐杀', '自杀', '伤口', '内脏', '骷髅', '颅骨',
  '枪', '枪械', '手枪', '步枪', '狙击', '刀', '刀剑', '匕首', '武器', '爆炸', '炸弹',
  '战争', '战斗', '恐怖', '猎奇', '惊悚', '恐吓',
  '政治', '政党', '政府', '领导人', '国家主席', '总统', '首相', '议会', '选举', '投票', '游行',
  '示威', '抗议', '革命', '独裁', '政变', '国旗', '党旗', '共产党', '民主党', '共和党',
  '习近平', '拜登', '特朗普', '普京', '泽连斯基',
  'エロ', 'セックス', '乳首', 'パンツ'
];

const REVIEW_RISK_PATTERNS = [
  /\b(?:nsfw|nfsw|r-?18|18\+|xxx|porn(?:o|ographic)?|hentai|ecchi|ahegao)\b/i,
  /\b(?:erotic|sexy|sex|sexual|lust|desire|nude|nudity|naked|topless|bottomless|onlyfans)\b/i,
  /\b(?:lingerie|panties|underwear|nipples?|areolas?|breasts?|boobs?|cleavage)\b/i,
  /\b(?:pussy|vagina|penis|cock|dick|cum|semen|ejaculat(?:e|ion)|orgasm)\b/i,
  /\b(?:masturbat(?:e|ion)|blowjob|handjob|anal|rape|molest(?:ed|ation)?|bdsm|bondage|shibari)\b/i,
  /\b(?:violence|violent|gore|gory|bloody|blood|corpse|dead body|suicide|murder|kill(?:ing)?|massacre)\b/i,
  /\b(?:gun|pistol|rifle|sniper|knife|weapon|bomb|explosion|war|battle|terror(?:ism|ist)?)\b/i,
  /\b(?:politic(?:al|s)?|government|president|election|protest|revolution|dictator|coup|flag)\b/i
];

const normalizeText = (value) => String(value || '').normalize('NFKC').toLowerCase();

const hasReviewRiskContent = (value) => {
  const normalized = normalizeText(value);
  return REVIEW_RISK_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)))
    || REVIEW_RISK_PATTERNS.some((pattern) => pattern.test(normalized));
};

const getTimestamp = (id, createdAt) => {
  if (typeof createdAt === 'number' && !Number.isNaN(createdAt)) return createdAt;
  if (typeof createdAt === 'string') {
    const time = Date.parse(createdAt.replace(/\.(\d{3})\d+/, '.$1'));
    if (!Number.isNaN(time)) return time;
  }
  const value = String(id || '');
  if (/^\d{13}$/.test(value)) return Number(value);
  if (value.startsWith('imported-') || value.startsWith('u-')) {
    const part = value.split('-')[1];
    if (/^\d{13}$/.test(part)) return Number(part);
  }
  return 0;
};

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const normalizeRefs = (refs) => {
  if (!Array.isArray(refs)) return [];
  return refs
    .map((ref) => {
      if (!ref || typeof ref !== 'object') return '';
      if (typeof ref.file_path === 'string' && !ref.file_path.includes('{{')) return ref.file_path;
      return '';
    })
    .filter(Boolean);
};

const compactContent = (content) => String(content || '').trim().replace(/\s+/g, ' ');

const normalizeSectionTitle = (title) => {
  const normalized = normalizeText(title);
  if (!normalized || normalized === 'sfw' || normalized === 'safe' || normalized === '安全') return '精选';
  return title;
};

const normalizeDisplayTag = (tag) => {
  const normalized = normalizeText(tag);
  if (normalized === 'sfw' || normalized === 'safe' || normalized === '安全') return '精选';
  return tag;
};

const buildPromptItem = (raw, section, index) => {
  const id = String(raw.id || `prompt-${section.id}-${index}`);
  const createdAt = getTimestamp(id, raw.createdAt || raw.created_at);
  const image = raw.file_path || raw.thumbnail_path || raw.image || '';
  const images = Array.isArray(raw.images) ? raw.images : (image ? [image] : []);
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag) => typeof tag === 'string' && tag).map(normalizeDisplayTag)
    : [];
  const content = compactContent(raw.content || raw.prompt || '');
  const item = {
    id,
    title: raw.title || `未命名-${index + 1}`,
    content,
    summary: content.length > 78 ? `${content.slice(0, 78)}...` : content,
    notes: raw.notes || raw.description || '',
    contributor: raw.contributor || raw.author || '匿名',
    tags,
    sectionId: section.id,
    sectionTitle: normalizeSectionTitle(section.title),
    images,
    image: images[0] || '',
    refs: Array.isArray(raw.refs) ? (typeof raw.refs[0] === 'string' ? raw.refs : normalizeRefs(raw.refs)) : [],
    createdAt,
    dateLabel: formatDate(createdAt),
    isNew: createdAt ? Date.now() - createdAt <= 48 * 60 * 60 * 1000 : false
  };
  return item;
};

const flattenPromptData = (payload) => {
  if (Array.isArray(payload?.data)) {
    return payload.data.map((item, index) => buildPromptItem(item, { id: 'prompt-manager', title: '精选' }, index));
  }
  if (Array.isArray(payload?.sections)) {
    return payload.sections.flatMap((section) => {
      const prompts = Array.isArray(section.prompts) ? section.prompts : [];
      return prompts.map((item, index) => buildPromptItem(item, section, index));
    });
  }
  return [];
};

const filterSafePrompts = (prompts) => prompts.filter((prompt) => {
  const text = [
    prompt.title,
    prompt.content,
    prompt.notes,
    prompt.contributor,
    prompt.sectionTitle,
    ...(prompt.tags || [])
  ].join('\n');
  return !hasReviewRiskContent(text);
});

module.exports = {
  filterSafePrompts,
  flattenPromptData,
  hasReviewRiskContent
};

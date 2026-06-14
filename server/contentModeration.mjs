const REVIEW_RISK_KEYWORDS = [
  'nsfw', 'nfsw', 'r18', 'r-18', '18+', '18禁',
  '色情', '情色', '成人向', '成人内容', '成人漫画', '成人游戏', '黄图', '黄漫', '黄片',
  '黄色', '涉黄', '一丝不挂', '裸露', '暴露', '走光', '裸体', '全裸', '半裸', '赤裸', '裸身', '裸女', '裸男', '裸胸', '裸臀',
  '露点', '露乳', '露胸', '露私处', '私处', '阴部', '阴茎', '阴道', '龟头', '睾丸',
  '乳头', '乳晕', '乳房', '乳交', '胸部特写', '巨乳', '爆乳',
  '内衣', '情趣内衣', '蕾丝内衣', '丁字裤', '内裤', '胖次',
  '性欲', '性暗示', '性冲动', '性癖', '性感', '挑逗', '诱惑', '媚惑', '性爱', '性交', '做爱', '性行为', '性姿势', '性器',
  '口交', '肛交', '手交', '足交', '自慰', '手淫', '高潮', '射精', '精液', '内射', '颜射', '潮吹',
  '淫', '淫乱', '淫荡', '淫纹', '发情', '春药', '调教', '凌辱', '强奸', '轮奸',
  '捆绑', '拘束', '束缚', '绳缚', '女奴', '羞辱', '无码', '无修正',
  '暴力', '血腥', '血液', '流血', '出血', '鲜血', '血迹', '血泊', '肢解', '断肢', '断头',
  '尸体', '尸', '死亡', '杀死', '杀戮', '屠杀', '虐杀', '自杀', '伤口', '内脏', '骷髅', '颅骨',
  '枪', '枪械', '手枪', '步枪', '狙击', '刀', '刀剑', '匕首', '武器', '爆炸', '炸弹',
  '战争', '战斗', '恐怖', '猎奇', '惊悚', '恐吓',
  '政治', '政党', '政府', '领导人', '国家主席', '总统', '首相', '议会', '选举', '投票', '游行',
  '示威', '抗议', '革命', '独裁', '政变', '国旗', '党旗', '共产党', '民主党', '共和党',
  '习近平', '拜登', '特朗普', '普京', '泽连斯基',
  'エロ', 'セックス', '乳首', 'パンツ'
]

const REVIEW_RISK_PATTERNS = [
  /\b(?:nsfw|nfsw|r-?18|18\+|xxx|porn(?:o|ographic)?|hentai|ecchi|ahegao)\b/i,
  /\b(?:erotic|sexy|sex|sexual|lust|desire|nude|nudity|naked|topless|bottomless|onlyfans)\b/i,
  /\b(?:lingerie|panties|underwear|nipples?|areolas?|breasts?|boobs?|cleavage)\b/i,
  /\b(?:pussy|vagina|penis|cock|dick|cum|semen|ejaculat(?:e|ion)|orgasm)\b/i,
  /\b(?:masturbat(?:e|ion)|blowjob|handjob|anal|rape|molest(?:ed|ation)?|bdsm|bondage|shibari)\b/i,
  /\b(?:violence|violent|gore|gory|bloody|blood|corpse|dead body|suicide|murder|kill(?:ing)?|massacre)\b/i,
  /\b(?:gun|pistol|rifle|sniper|knife|weapon|bomb|explosion|war|battle|terror(?:ism|ist)?)\b/i,
  /\b(?:politic(?:al|s)?|government|president|election|protest|revolution|dictator|coup|flag)\b/i,
]

const normalizeModerationText = (value) => String(value || '').normalize('NFKC').toLowerCase()

export const hasReviewRiskKeyword = (value) => {
  if (!value) return false
  const normalized = normalizeModerationText(value)
  return REVIEW_RISK_KEYWORDS.some((keyword) => normalized.includes(normalizeModerationText(keyword)))
    || REVIEW_RISK_PATTERNS.some((pattern) => pattern.test(normalized))
}

const getPromptManagerModerationText = (item) => {
  if (!item || typeof item !== 'object') return ''
  const tags = Array.isArray(item.tags) ? item.tags : []
  return [
    item.title,
    item.prompt,
    item.description,
    item.author,
    ...tags,
  ].filter((value) => typeof value === 'string' && value.length > 0).join('\n')
}

export const filterPromptManagerPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
    return payload
  }
  return {
    ...payload,
    data: payload.data.filter((item) => !hasReviewRiskKeyword(getPromptManagerModerationText(item))),
  }
}

// 微信小程序专用中转代理：小程序只允许请求白名单 HTTPS 域名，无法直连用户自定义 API。
// 这里在服务端复制小程序的生图 / 取模型逻辑（与直连行为一致），转发到用户配置的任意 API。

const normalizeBaseUrl = (value) => String(value || '').replace(/\/+$/, '')

const extFromMime = (mime) => {
  if (!mime) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  return (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png'
}

const parseImageDataUrl = (dataUrl) => {
  const m = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  return m ? { mime: m[1], base64: m[2] } : null
}

// 轻量 SSRF 防护：拒绝回环 / 内网 / 云元数据等目标（按字面 host，不做 DNS 解析）。
const assertSafeTarget = (urlStr) => {
  let host
  try {
    host = new URL(urlStr).hostname.toLowerCase()
  } catch {
    throw new Error('无效的 API 地址')
  }
  const blocked =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  if (blocked) throw new Error('目标地址不被允许')
}

const resolveGenerateUrl = (config) => {
  const base = normalizeBaseUrl(config.apiUrl)
  if (config.apiFormat === 'gemini') {
    const hasVersion = /\/v\d+(beta|alpha)?(\/|$)/.test(base)
    const versioned = hasVersion ? base : `${base}/v1beta`
    return `${versioned}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`
  }
  return `${base}/images/generations`
}

const buildRequest = (config, prompt, image) => {
  if (config.apiFormat === 'gemini') {
    const parts = [{ text: prompt }]
    if (image) parts.push({ inlineData: { mimeType: image.mime, data: image.base64 } })
    return {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }
  }
  return { model: config.model, prompt, n: 1, size: config.size }
}

const extractImages = (body, apiFormat) => {
  const images = []
  const push = (src) => {
    if (typeof src === 'string' && src) images.push(src)
  }
  if (apiFormat === 'gemini') {
    const candidates = Array.isArray(body?.candidates) ? body.candidates : []
    candidates.forEach((candidate) => {
      const parts = candidate?.content?.parts || []
      parts.forEach((part) => {
        const data = part?.inlineData?.data || part?.inline_data?.data
        const mime = part?.inlineData?.mimeType || part?.inline_data?.mime_type || 'image/png'
        if (data) push(`data:${mime};base64,${data}`)
        if (part?.fileData?.fileUri) push(part.fileData.fileUri)
      })
    })
    return images
  }
  const data = Array.isArray(body?.data) ? body.data : []
  data.forEach((item) => {
    if (item?.b64_json) push(`data:image/png;base64,${item.b64_json}`)
    if (item?.url) push(item.url)
  })
  return images
}

// 远程 url 图片在服务端拉成 base64，小程序就无需 downloadFile 任意图床。
const toBase64 = async (src) => {
  if (typeof src !== 'string' || src.startsWith('data:')) return src
  if (!/^https?:\/\//.test(src)) return src
  assertSafeTarget(src)
  const resp = await fetch(src, { headers: { Connection: 'close' } })
  if (!resp.ok) throw new Error(`下载图片失败: ${resp.status}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  const mime = resp.headers.get('content-type') || 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

const parseJsonSafe = (text) => {
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

export const proxyGenerate = async ({ apiUrl, apiKey, apiFormat, model, prompt, size, image }) => {
  if (!apiUrl || !apiKey || !model) throw new Error('缺少 apiUrl/apiKey/model')
  if (!prompt) throw new Error('缺少提示词')
  const config = {
    apiUrl,
    apiKey,
    apiFormat: apiFormat || 'openai',
    model,
    size: size || '1024x1024',
  }
  const img = image ? parseImageDataUrl(image) : null
  if (image && !img) throw new Error('参考图格式不正确')

  let resp
  if (config.apiFormat !== 'gemini' && img) {
    // OpenAI 图生图：走 /images/edits 的 multipart/form-data
    const base = normalizeBaseUrl(config.apiUrl)
    const hasVersion = /\/v\d+(beta|alpha)?(\/|$)/.test(base)
    const editsUrl = hasVersion ? `${base}/images/edits` : `${base}/v1/images/edits`
    assertSafeTarget(editsUrl)
    const fd = new FormData()
    fd.append('model', config.model)
    fd.append('prompt', prompt)
    fd.append('size', config.size)
    fd.append('n', '1')
    fd.append('image', new Blob([Buffer.from(img.base64, 'base64')], { type: img.mime }), `image.${extFromMime(img.mime)}`)
    resp = await fetch(editsUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: fd,
    })
  } else {
    const url = resolveGenerateUrl(config)
    assertSafeTarget(url)
    const headers = { 'content-type': 'application/json' }
    if (config.apiFormat === 'openai') headers.Authorization = `Bearer ${config.apiKey}`
    resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildRequest(config, prompt, img)),
    })
  }
  const text = await resp.text()
  const body = parseJsonSafe(text)
  if (!resp.ok) {
    throw new Error(body?.error?.message || body?.message || text || `HTTP ${resp.status}`)
  }
  const raw = extractImages(body, config.apiFormat)
  if (!raw.length) throw new Error('没有解析到图片')
  const images = []
  for (const src of raw) {
    images.push(await toBase64(src))
  }
  return { images }
}

export const proxyModels = async ({ apiUrl, apiKey, apiFormat }) => {
  if (!apiUrl || !apiKey) throw new Error('缺少 apiUrl/apiKey')
  const base = normalizeBaseUrl(apiUrl)
  const hasVersion = /\/v\d+(beta|alpha)?(\/|$)/.test(base)
  let url = ''
  const headers = {}
  if (apiFormat === 'gemini') {
    const verBase = hasVersion ? base : `${base}/v1beta`
    const host = base.split('/')[2] || ''
    if (host === 'generativelanguage.googleapis.com') {
      url = `${verBase}/models?key=${encodeURIComponent(apiKey)}`
    } else {
      url = `${verBase}/models`
      headers.Authorization = `Bearer ${apiKey}`
    }
  } else {
    url = hasVersion ? `${base}/models` : `${base}/v1/models`
    headers.Authorization = `Bearer ${apiKey}`
  }
  assertSafeTarget(url)

  const resp = await fetch(url, { method: 'GET', headers })
  const text = await resp.text()
  const body = parseJsonSafe(text)
  if (!resp.ok) {
    throw new Error(body?.error?.message || body?.message || text || `HTTP ${resp.status}`)
  }
  const rawList = Array.isArray(body.data)
    ? body.data
    : (Array.isArray(body.models) ? body.models : [])
  const seen = new Set()
  const models = []
  rawList.forEach((m) => {
    const v = String((m && (m.id || m.name)) || '').replace(/^models\//, '').trim()
    if (v && !seen.has(v)) {
      seen.add(v)
      models.push(v)
    }
  })
  return { models }
}

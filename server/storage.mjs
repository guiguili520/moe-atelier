import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import {
  backendCollectionPath,
  backendDbPath,
  backendStatePath,
  backendTasksDir,
  serverDataDir,
  DEFAULT_BACKEND_CONFIG,
  DEFAULT_CONCURRENCY,
  DEFAULT_GLOBAL_STATS,
  DEFAULT_TASK_STATS,
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
  pickFormatConfig,
} from './config.mjs'
import { broadcastSseEvent } from './sse.mjs'

fs.mkdirSync(serverDataDir, { recursive: true })

const db = new Database(backendDbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS app_kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)

const KV_STATE = 'backend_state'
const KV_COLLECTION = 'backend_collection'
const KV_JSON_MIGRATION = 'json_migration_v1'

const parseJson = (raw, fallback) => {
  try {
    if (typeof raw !== 'string' || !raw.trim()) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

const readJsonFileSync = (filePath, fallback) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return parseJson(raw, fallback)
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback
    if (err && err.name === 'SyntaxError') {
      console.warn(`Invalid JSON file, fallback to defaults: ${filePath}`, err)
      return fallback
    }
    throw err
  }
}

const getKv = (key, fallback) => {
  const row = db.prepare('SELECT value FROM app_kv WHERE key = ?').get(key)
  if (!row) return fallback
  return parseJson(row.value, fallback)
}

const setKv = (key, value) => {
  db.prepare(`
    INSERT INTO app_kv (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), Date.now())
}

const coerceString = (value) => (typeof value === 'string' ? value : '')

const stripBackendTokenFromUrl = (value = '') => {
  if (!value.includes('/api/backend/image/')) return value
  return value.replace(/[?&]token=[^&]+/g, '').replace(/[?&]$/, '')
}

const sanitizeCollectionItem = (value) => {
  if (!value || typeof value !== 'object') return null
  const raw = value
  const id = coerceString(raw.id)
  if (!id) return null
  const prompt = coerceString(raw.prompt)
  const taskId = coerceString(raw.taskId)
  const timestamp =
    typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp)
      ? raw.timestamp
      : Date.now()
  const image =
    typeof raw.image === 'string' ? stripBackendTokenFromUrl(raw.image) : undefined
  const localKey = typeof raw.localKey === 'string' ? raw.localKey : undefined
  const sourceSignature =
    typeof raw.sourceSignature === 'string' ? raw.sourceSignature : undefined
  const item = { id, prompt, taskId, timestamp }
  if (image) item.image = image
  if (localKey) item.localKey = localKey
  if (sourceSignature) item.sourceSignature = sourceSignature
  return item
}

const normalizeCollectionPayload = (payload) => {
  if (!Array.isArray(payload)) return []
  const items = []
  const seen = new Set()
  payload.forEach((entry) => {
    const item = sanitizeCollectionItem(entry)
    if (!item) return
    if (seen.has(item.id)) return
    seen.add(item.id)
    items.push(item)
  })
  return items
}

export const clampNumber = (value, min, max, fallback) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export const normalizeConcurrency = (value, fallback = DEFAULT_CONCURRENCY) =>
  clampNumber(value, MIN_CONCURRENCY, MAX_CONCURRENCY, fallback)

export const createDefaultTaskState = () => ({
  version: 1,
  prompt: '',
  concurrency: DEFAULT_CONCURRENCY,
  enableSound: true,
  results: [],
  uploads: [],
  stats: { ...DEFAULT_TASK_STATS },
})

const normalizeBackendState = (data) => {
  const config = { ...DEFAULT_BACKEND_CONFIG, ...(data?.config || {}) }
  const rawFormatMap = data?.configByFormat
  const configByFormat =
    rawFormatMap && typeof rawFormatMap === 'object' && !Array.isArray(rawFormatMap)
      ? { ...rawFormatMap }
      : {}
  const apiFormat =
    config.apiFormat === 'gemini' || config.apiFormat === 'vertex'
      ? config.apiFormat
      : 'openai'
  config.apiFormat = apiFormat
  if (!configByFormat[apiFormat]) {
    configByFormat[apiFormat] = pickFormatConfig(config)
  }
  return {
    config,
    configByFormat,
    tasksOrder: Array.isArray(data?.tasksOrder) ? data.tasksOrder : [],
    globalStats: { ...DEFAULT_GLOBAL_STATS, ...(data?.globalStats || {}) },
  }
}

const normalizeTaskState = (data) => {
  if (!data) return null
  return {
    ...createDefaultTaskState(),
    ...data,
    concurrency: normalizeConcurrency(data?.concurrency),
    stats: { ...DEFAULT_TASK_STATS, ...(data?.stats || {}) },
    results: Array.isArray(data?.results) ? data.results : [],
    uploads: Array.isArray(data?.uploads) ? data.uploads : [],
  }
}

const insertTask = db.prepare(`
  INSERT INTO tasks (id, state, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    state = excluded.state,
    updated_at = excluded.updated_at
`)

const migrateJsonFiles = () => {
  if (getKv(KV_JSON_MIGRATION, false)) return

  const migrate = db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM app_kv WHERE key = ?').get(KV_STATE)) {
      const state = readJsonFileSync(backendStatePath, null)
      if (state) setKv(KV_STATE, normalizeBackendState(state))
    }

    if (!db.prepare('SELECT 1 FROM app_kv WHERE key = ?').get(KV_COLLECTION)) {
      const collection = readJsonFileSync(backendCollectionPath, null)
      if (collection) setKv(KV_COLLECTION, normalizeCollectionPayload(collection))
    }

    let entries = []
    try {
      entries = fs.readdirSync(backendTasksDir, { withFileTypes: true })
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err
    }

    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .forEach((entry) => {
        const taskId = path.basename(entry.name, '.json')
        const exists = db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(taskId)
        if (exists) return
        const data = readJsonFileSync(path.join(backendTasksDir, entry.name), null)
        const state = normalizeTaskState(data)
        if (state) insertTask.run(taskId, JSON.stringify(state), Date.now())
      })

    setKv(KV_JSON_MIGRATION, {
      migratedAt: new Date().toISOString(),
      source: 'server-data json files',
    })
  })

  migrate()
}

migrateJsonFiles()

export const loadBackendState = async () =>
  normalizeBackendState(getKv(KV_STATE, null))

export const saveBackendState = async (state) => {
  const next = normalizeBackendState(state)
  setKv(KV_STATE, next)
  broadcastSseEvent('state', next)
}

export const loadBackendCollection = async () =>
  normalizeCollectionPayload(getKv(KV_COLLECTION, []))

export const saveBackendCollection = async (items) => {
  setKv(KV_COLLECTION, normalizeCollectionPayload(items))
}

export const listBackendTaskIds = async () =>
  db.prepare('SELECT id FROM tasks ORDER BY updated_at ASC').all().map((row) => row.id)

export const loadTaskState = async (taskId) => {
  const row = db.prepare('SELECT state FROM tasks WHERE id = ?').get(taskId)
  return normalizeTaskState(parseJson(row?.state, null))
}

export const saveTaskState = async (taskId, state) => {
  const next = normalizeTaskState(state) || createDefaultTaskState()
  insertTask.run(taskId, JSON.stringify(next), Date.now())
  broadcastSseEvent('task', { taskId, state: next })
}

export const deleteTaskState = async (taskId) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
}

export const normalizeCollectionPayloadForSave = normalizeCollectionPayload

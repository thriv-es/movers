import { TEXT_MODEL, VISION_MODEL } from './ai'

export type AiRole = 'chat' | 'price' | 'vision'
export type AiBackend = 'gateway' | 'binding'
export interface AiSelection {
  backend: AiBackend
  model: string
}
export interface AiSettings {
  revision: number
  roles: Record<AiRole, AiSelection>
}

interface ModelOption {
  model: string
  label: string
  caveat?: string
}

const TEXT_OPTIONS: readonly ModelOption[] = [
  { model: TEXT_MODEL, label: 'Llama 3.3 70B (default)' },
  {
    model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
    label: 'Llama 3.1 8B (fast)',
    caveat: 'Tried for chat; could not follow the session-block prompt (hallucinated the whole script).',
  },
]

export const MODEL_CATALOG: Record<AiRole, readonly ModelOption[]> = {
  chat: [
    ...TEXT_OPTIONS,
    {
      model: '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
      label: 'DeepSeek V4.1 Flash',
      caveat: 'Paid Workers AI access required; optional Chat model.',
    },
  ],
  price: TEXT_OPTIONS,
  vision: [{ model: VISION_MODEL, label: 'Llama 3.2 11B Vision (default)' }],
}

export const DEFAULT_ROLES: Record<AiRole, AiSelection> = {
  chat: { backend: 'gateway', model: TEXT_MODEL },
  price: { backend: 'gateway', model: TEXT_MODEL },
  vision: { backend: 'gateway', model: VISION_MODEL },
}

const ROLES: readonly AiRole[] = ['chat', 'price', 'vision']

function validateSelection(input: unknown, role: AiRole): AiSelection {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`Invalid ${role} selection`)
  const selection = input as Record<string, unknown>
  if (Object.keys(selection).length !== 2 || !Object.hasOwn(selection, 'backend') || !Object.hasOwn(selection, 'model'))
    throw new Error(`Invalid ${role} selection`)
  if (selection.backend !== 'gateway' && selection.backend !== 'binding') throw new Error(`Invalid ${role} backend`)
  if (typeof selection.model !== 'string' || !MODEL_CATALOG[role].some(({ model }) => model === selection.model)) {
    throw new Error(`Invalid ${role} model`)
  }
  return { backend: selection.backend, model: selection.model }
}

export function validateRoles(input: unknown): Record<AiRole, AiSelection> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid AI roles')
  const roles = input as Record<string, unknown>
  if (Object.keys(roles).length !== ROLES.length || !ROLES.every((role) => Object.hasOwn(roles, role))) {
    throw new Error('Invalid AI roles')
  }
  return {
    chat: validateSelection(roles.chat, 'chat'),
    price: validateSelection(roles.price, 'price'),
    vision: validateSelection(roles.vision, 'vision'),
  }
}

interface AiSettingsRow {
  revision: number
  roles_json: string
}

export async function readSavedAiSettings(db: D1Database): Promise<AiSettings | null> {
  const row = await db.prepare('SELECT revision, roles_json FROM ai_settings WHERE id = 1').first<AiSettingsRow>()
  if (!row) return null
  const roles = validateRoles(JSON.parse(row.roles_json))
  return row.revision === 0 ? null : { revision: row.revision, roles }
}

export async function readAiSettings(db: D1Database): Promise<AiSettings> {
  return (await readSavedAiSettings(db)) ?? { revision: 0, roles: DEFAULT_ROLES }
}

export async function updateAiSettings(
  db: D1Database,
  expectedRevision: number,
  roles: unknown,
): Promise<AiSettings | null> {
  const validated = validateRoles(roles)
  if (expectedRevision === 0) {
    await db
      .prepare('INSERT OR IGNORE INTO ai_settings (id, revision, roles_json) VALUES (1, 0, ?)')
      .bind(JSON.stringify(DEFAULT_ROLES))
      .run()
  }
  const result = await db
    .prepare('UPDATE ai_settings SET roles_json = ?, revision = revision + 1 WHERE id = 1 AND revision = ?')
    .bind(JSON.stringify(validated), expectedRevision)
    .run()
  if (result.meta.changes !== 1) return null
  return readAiSettings(db)
}

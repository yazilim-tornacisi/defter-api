import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { constants, createCipheriv, createDecipheriv, createHmac, privateDecrypt, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { pool } from './db.js'
import { badRequest, forbidden, unauthorized } from './utils.js'
import { PRIVATE_KEY_PEM, PUBLIC_KEY_PEM } from './crypto-keys.js'

const OAEP_OPTIONS = { key: PRIVATE_KEY_PEM, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string
    user?: { id: string; email: string; username: string; is_admin: boolean; is_developer: boolean; banned_at: string | null }
  }
}

const SECRET = process.env.AUTH_SECRET ?? 'dev-secret-change-me'
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 gün

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pw, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(pw, salt, 64)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function signToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS }),
  ).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyToken(token: string): string | null {
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = createHmac('sha256', SECRET).update(payload).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      uid?: string
      exp?: number
    }
    if (!data.uid || typeof data.exp !== 'number' || data.exp < Date.now()) return null
    return data.uid
  } catch {
    return null
  }
}

export function extractUserId(req: FastifyRequest): string | null {
  return req.userId ?? null
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  const uid = token ? verifyToken(token) : null
  if (!uid) return unauthorized(reply)

  const { rows } = await pool.query<{ id: string; email: string; username: string; is_admin: boolean; is_developer: boolean; banned_at: string | null }>(
    'SELECT id, email, username, is_admin, is_developer, banned_at FROM users WHERE id = $1',
    [uid],
  )
  const user = rows[0]
  if (!user) return unauthorized(reply)
  if (user.banned_at) return reply.code(403).send({ error: 'Hesabınız engellendi' })

  req.userId = uid
  req.user = user
  return undefined
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (!req.user?.is_admin) return forbidden(reply, 'Yalnızca yönetici')
  return undefined
}

export async function requireDev(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (!req.user?.is_developer) return forbidden(reply, 'Yalnızca geliştirici')
  return undefined
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/

type UserRow = { id: string; email: string; username: string; password: string; is_admin: boolean; is_developer: boolean; banned_at: string | null }

function toPublicUser(row: { id: string; email: string; username: string; is_admin: boolean; is_developer?: boolean }) {
  return { id: row.id, email: row.email, username: row.username, isAdmin: row.is_admin, isDeveloper: row.is_developer === true }
}

type EncPayload = { wrappedKey?: string; iv?: string; data?: string }

// Giriş/kayıt gövdesini çözer. İstemci bilgileri AES-GCM ile şifreler ve
// AES anahtarını sunucunun RSA genel anahtarıyla sarar; burada açılır.
// Geriye uyumluluk için `enc` yoksa düz metin gövde de kabul edilir.
function decryptPayload(body: Record<string, unknown>): Record<string, unknown> {
  const enc = body.enc as EncPayload | undefined
  if (!enc || !enc.wrappedKey || !enc.iv || !enc.data) return body
  try {
    const wrappedKey = Buffer.from(enc.wrappedKey, 'base64')
    const iv = Buffer.from(enc.iv, 'base64')
    const ciphertext = Buffer.from(enc.data, 'base64')
    const aesKey = privateDecrypt(OAEP_OPTIONS, wrappedKey)
    const decipher = createDecipheriv('aes-128-gcm', aesKey, iv)
    const authTag = ciphertext.subarray(ciphertext.length - 16)
    decipher.setAuthTag(authTag)
    const payload = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()])
    return JSON.parse(payload.toString('utf8')) as Record<string, unknown>
  } catch {
    throw Object.assign(new Error('Şifrelenmiş veri çözülemedi'), { statusCode: 400 })
  }
}

function logLogin(input: {
  userId: string | null
  identifier: string
  success: boolean
  ip: string | null
  userAgent: string | null
}): Promise<void> {
  return pool
    .query('INSERT INTO auth_logs (user_id, identifier, success, ip, user_agent) VALUES ($1, $2, $3, $4, $5)', [
      input.userId,
      input.identifier,
      input.success,
      input.ip,
      input.userAgent,
    ])
    .then(() => undefined)
    .catch((err) => {
      console.error('auth log insert failed', err)
    })
}

function reqMeta(req: FastifyRequest): { ip: string | null; ua: string | null } {
  return { ip: req.ip ?? null, ua: (req.headers['user-agent'] as string | undefined) ?? null }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/public-key', async () => ({ publicKey: PUBLIC_KEY_PEM }))

  app.post('/register', async (req, reply) => {
    const body = decryptPayload(req.body as Record<string, unknown>)
    const { username, email, password } = body as { username?: string; email?: string; password?: string }
    const cleanEmail = email?.trim().toLowerCase()
    const cleanUsername = username?.trim()
    if (!cleanUsername || !USERNAME_RE.test(cleanUsername)) {
      return badRequest(reply, 'Username must be 3-20 characters (letters, numbers, underscore)')
    }
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) return badRequest(reply, 'Valid email is required')
    if (!password || password.length < 8) return badRequest(reply, 'Password must be at least 8 characters')

    const exists = await pool.query(
      'SELECT 1 FROM users WHERE email = $1 OR lower(username) = lower($2)',
      [cleanEmail, cleanUsername],
    )
    if (exists.rowCount) return badRequest(reply, 'Email or username already in use')

    const { rows } = await pool.query<UserRow>(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, email, username, is_admin, is_developer',
      [cleanUsername, cleanEmail, hashPassword(password)],
    )
    const user = rows[0]
    const { ip, ua } = reqMeta(req)
    void logLogin({ userId: user.id, identifier: cleanEmail, success: true, ip, userAgent: ua })
    return reply.code(201).send({ token: signToken(user.id), user: toPublicUser(user) })
  })

  app.post('/login', async (req, reply) => {
    const body = decryptPayload(req.body as Record<string, unknown>)
    const { email, password } = body as { email?: string; password?: string }
    const identifier = email?.trim().toLowerCase()
    const { ip, ua } = reqMeta(req)

    if (!identifier || !password) {
      if (identifier) void logLogin({ userId: null, identifier, success: false, ip, userAgent: ua })
      return badRequest(reply, 'Email or username and password are required')
    }

    const { rows } = await pool.query<UserRow>(
      'SELECT id, email, username, password, is_admin, is_developer, banned_at FROM users WHERE email = $1 OR lower(username) = $1',
      [identifier],
    )
    const user = rows[0]
    if (!user || !verifyPassword(password, user.password)) {
      void logLogin({ userId: user?.id ?? null, identifier, success: false, ip, userAgent: ua })
      return unauthorized(reply, 'Invalid email/username or password')
    }
    if (user.banned_at) {
      void logLogin({ userId: user.id, identifier, success: false, ip, userAgent: ua })
      return reply.code(403).send({ error: 'Hesabınız engellendi' })
    }
    void logLogin({ userId: user.id, identifier, success: true, ip, userAgent: ua })
    return { token: signToken(user.id), user: toPublicUser(user) }
  })

  app.get('/me', { preValidation: requireAuth }, async (req, reply) => {
    const { rows } = await pool.query<UserRow>('SELECT id, email, username, is_admin, is_developer FROM users WHERE id = $1', [req.userId])
    if (!rows.length) return unauthorized(reply)
    return { user: toPublicUser(rows[0]) }
  })

  // Kullanıcının kendi giriş kayıtları
  app.get('/me/logs', { preValidation: requireAuth }, async (req) => {
    const { rows } = await pool.query(
      `SELECT id, identifier, success, ip::text AS ip, user_agent, created_at
       FROM auth_logs WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.userId],
    )
    return rows.map((r) => ({
      id: r.id,
      identifier: r.identifier,
      success: r.success,
      ip: r.ip,
      userAgent: r.user_agent,
      createdAt: r.created_at,
    }))
  })

  app.patch('/me/password', { preValidation: requireAuth }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string }
    if (!currentPassword || !newPassword) return badRequest(reply, 'Mevcut ve yeni parola gereklidir')
    if (newPassword.length < 8) return badRequest(reply, 'Parola en az 8 karakter olmalıdır')

    const { rows } = await pool.query<UserRow>('SELECT password FROM users WHERE id = $1', [req.userId])
    if (!rows.length) return unauthorized(reply)
    if (!verifyPassword(currentPassword, rows[0].password)) {
      return badRequest(reply, 'Mevcut parola hatalı')
    }
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(newPassword), req.userId])
    return { updated: true }
  })
}
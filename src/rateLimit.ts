import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getRedis } from './redis.js'
import { pool } from './db.js'

// Her endpoint için pencere ve limitler
// Genel API: 120 istek/dk/IP, hassas endpointler daha sıkı
type Limit = { windowMs: number; max: number }
const LIMITS: Record<string, Limit> = {
  'POST /api/auth/login': { windowMs: 60_000, max: 8 },
  'POST /api/auth/register': { windowMs: 60_000, max: 5 },
  'POST /api/auth/pair/start': { windowMs: 60_000, max: 10 },
  'GET /api/auth/pair/wait': { windowMs: 60_000, max: 30 },
  'POST /api/auth/pair/approve': { windowMs: 60_000, max: 20 },
  'GET /api/auth/pair/info': { windowMs: 60_000, max: 30 },
  'POST /api/auth/me/password': { windowMs: 60_000, max: 5 },
  'POST /api/friends/request': { windowMs: 60_000, max: 15 },
}
const DEFAULT_LIMIT: Limit = { windowMs: 60_000, max: 120 }

function routeKey(req: FastifyRequest): string {
  const pat = req.routeOptions?.url
  const route = pat ? pat.slice(0, 200) : req.url.split('?')[0].slice(0, 200)
  return `${req.method} ${route}`
}

function limitFor(key: string): Limit {
  return LIMITS[key] ?? DEFAULT_LIMIT
}

// ---- Memory fallback (Redis yoksa) ----
type MemEntry = { count: number; resetAt: number }
const memStore = new Map<string, MemEntry>()
function memCheck(ip: string, key: string, lim: Limit): { allowed: boolean; remaining: number; resetMs: number } {
  const winId = Math.floor(Date.now() / lim.windowMs)
  const memKey = `mem:${ip}:${key}:${winId}`
  const now = Date.now()
  let e = memStore.get(memKey)
  if (!e || now >= e.resetAt) {
    e = { count: 1, resetAt: (winId + 1) * lim.windowMs }
    memStore.set(memKey, e)
    // Eski pencereleri temizle (en fazla 2000 anahtar tut, LRU değil basit)
    if (memStore.size > 4000) {
      const toDel: string[] = []
      for (const [k, v] of memStore) if (now >= v.resetAt) toDel.push(k)
      toDel.forEach((k) => memStore.delete(k))
      if (memStore.size > 4000) {
        // Hala fazlaysa en eskileri sil
        let i = 0
        for (const k of memStore.keys()) {
          if (i++ > 1000) break
          memStore.delete(k)
        }
      }
    }
    return { allowed: true, remaining: lim.max - 1, resetMs: e.resetAt - now }
  }
  e.count++
  const allowed = e.count <= lim.max
  return { allowed, remaining: Math.max(0, lim.max - e.count), resetMs: e.resetAt - now }
}

// ---- Redis fixed-window ----
async function redisCheck(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  ip: string,
  key: string,
  lim: Limit,
): Promise<{ allowed: boolean; remaining: number; resetMs: number } | null> {
  const winId = Math.floor(Date.now() / lim.windowMs)
  const redisKey = `rl:${ip}:${key}:${winId}`
  const ttlSec = Math.ceil(lim.windowMs / 1000)
  try {
    // Lua: INCR ve PTTL atomik değil ama ayrı TTL seti yeterli; INCR sonrası TTL -1 ise EXPIRE
    const count = (await redis.incr(redisKey)) as unknown as number
    if (count === 1) {
      await redis.expire(redisKey, ttlSec)
    }
    // Kalan TTL'yi al
    const ttl = await redis.ttl(redisKey)
    const resetMs = ttl > 0 ? ttl * 1000 : lim.windowMs
    const allowed = count <= lim.max
    return { allowed, remaining: Math.max(0, lim.max - count), resetMs }
  } catch {
    return null // Redis hatası -> memory fallback'e düş
  }
}

// ---- Blok metrikleri (günlük) ----
const routeBlockBuf = new Map<string, number>() // key: `${day}|${method}|${route}`
const ipBlockBuf = new Map<string, number>() // key: `${day}|${ip}`

function recordBlock(ip: string | null, method: string, route: string): void {
  const day = new Date().toISOString().slice(0, 10) // YYYY-MM-DD UTC
  const rk = `${day}|${method}|${route}`
  routeBlockBuf.set(rk, (routeBlockBuf.get(rk) ?? 0) + 1)
  if (ip) {
    const ik = `${day}|${ip}`
    ipBlockBuf.set(ik, (ipBlockBuf.get(ik) ?? 0) + 1)
  }
}

async function flushBlocks(): Promise<void> {
  if (routeBlockBuf.size === 0 && ipBlockBuf.size === 0) return
  const routes = [...routeBlockBuf.entries()]
  const ips = [...ipBlockBuf.entries()]
  routeBlockBuf.clear()
  ipBlockBuf.clear()
  try {
    if (routes.length) {
      const days = routes.map(([k]) => k.split('|')[0])
      const methods = routes.map(([k]) => k.split('|')[1])
      const rts = routes.map(([k]) => k.split('|')[2])
      const counts = routes.map(([, v]) => v)
      await pool.query(
        `INSERT INTO rate_limit_daily (day, method, route, count)
         SELECT d::date, m, r, c
         FROM UNNEST($1::date[], $2::text[], $3::text[], $4::bigint[]) AS t(d,m,r,c)
         ON CONFLICT (day, method, route) DO UPDATE SET count = rate_limit_daily.count + excluded.count`,
        [days, methods, rts, counts],
      )
    }
    if (ips.length) {
      const days = ips.map(([k]) => k.split('|')[0])
      const addrs = ips.map(([k]) => k.split('|')[1])
      const counts = ips.map(([, v]) => v)
      await pool.query(
        `INSERT INTO rate_limit_ip_daily (day, ip, count)
         SELECT d::date, ip::inet, c
         FROM UNNEST($1::date[], $2::text[], $3::bigint[]) AS t(d,ip,c)
         ON CONFLICT (day, ip) DO UPDATE SET count = rate_limit_ip_daily.count + excluded.count`,
        [days, addrs, counts],
      )
    }
  } catch (err) {
    console.error('[rateLimit] flush failed', err)
  }
}

let flushTimer: ReturnType<typeof setInterval> | null = null
function ensureFlushTimer(): void {
  if (flushTimer) return
  flushTimer = setInterval(() => void flushBlocks(), 30_000)
  flushTimer.unref?.()
}

export function attachRateLimit(app: FastifyInstance): void {
  ensureFlushTimer()

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    // Sadece API isteklerini sınırla
    if (!req.url.startsWith('/api')) return
    if (req.url.startsWith('/api/health')) return

    const ip = (req.ip ?? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? 'unknown').slice(0, 64)
    const key = routeKey(req)
    const lim = limitFor(key)

    let result: { allowed: boolean; remaining: number; resetMs: number } | null = null

    const redis = getRedis()
    if (redis) {
      result = await redisCheck(redis, ip, key, lim)
    }
    if (!result) {
      result = memCheck(ip, key, lim)
    }

    // Header'lar her zaman
    reply.header('X-RateLimit-Limit', String(lim.max))
    reply.header('X-RateLimit-Remaining', String(result.remaining))
    reply.header('X-RateLimit-Reset', String(Math.ceil(result.resetMs / 1000)))

    if (!result.allowed) {
      recordBlock(ip === 'unknown' ? null : ip, req.method, key.slice(key.indexOf(' ') + 1))
      const retrySec = Math.ceil(result.resetMs / 1000)
      reply.header('Retry-After', String(retrySec))
      return reply.code(429).send({
        error: `Çok fazla istek — ${Math.ceil(lim.windowMs / 1000)} saniye içinde en fazla ${lim.max} istek. ${retrySec} sn sonra tekrar deneyin.`,
        retryAfter: retrySec,
      })
    }
  })
}

export function getRateLimitConfig(): { defaults: Limit; overrides: Record<string, Limit> } {
  return { defaults: DEFAULT_LIMIT, overrides: { ...LIMITS } }
}

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { pool } from './db.js'

// API metrikleri: (method, route, gün) başına çağrı sayısı.
// Her istekte DB'ye yazmak yerine bellekte biriktirilir ve periyodik flush edilir.
const FLUSH_INTERVAL_MS = 30_000

type Key = string // `${method} ${route}`
const buffer = new Map<Key, number>()
let timer: ReturnType<typeof setInterval> | null = null

function routePattern(req: FastifyRequest): string {
  const url = req.routeOptions?.url
  if (!url) return 'unmatched'
  return url.length > 200 ? url.slice(0, 200) : url
}

export function recordRequest(req: FastifyRequest): void {
  if (!req.url.startsWith('/api')) return
  const key = `${req.method} ${routePattern(req)}`
  buffer.set(key, (buffer.get(key) ?? 0) + 1)
}

async function flush(): Promise<void> {
  if (buffer.size === 0) return
  const entries = [...buffer.entries()]
  buffer.clear()
  try {
    await pool.query(
      `INSERT INTO endpoint_metrics (method, route, day, count)
       SELECT m, r, CURRENT_DATE, c
       FROM UNNEST($1::text[], $2::text[], $3::bigint[]) AS t(m, r, c)
       ON CONFLICT (method, route, day) DO UPDATE SET count = endpoint_metrics.count + excluded.count`,
      [
        entries.map(([k]) => k.slice(0, k.indexOf(' '))),
        entries.map(([k]) => k.slice(k.indexOf(' ') + 1)),
        entries.map(([, v]) => v),
      ],
    )
  } catch (err) {
    console.error('metric flush failed', err)
  }
}

export function attachMetrics(app: FastifyInstance): void {
  app.addHook('onResponse', async (req) => {
    recordRequest(req)
  })

  if (timer) return
  timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS)
  timer.unref?.()
}

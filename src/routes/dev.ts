import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth, requireDev } from '../auth.js'
import { getRateLimitConfig } from '../rateLimit.js'

const DAY_SERIES_DAYS = 30

// Günlük seri: boş günleri de 0 olarak üretir (grafik için kesintisiz dizi)
async function dailySeries(sql: string, params: unknown[]): Promise<{ day: string; views: number }[]> {
  const { rows } = await pool.query<{ day: string; count: number }>(sql, params)
  const map = new Map(rows.map((r) => [String(r.day).slice(0, 10), Number(r.count)]))
  const out: { day: string; views: number }[] = []
  const today = new Date()
  for (let i = DAY_SERIES_DAYS - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out.push({ day: key, views: map.get(key) ?? 0 })
  }
  return out
}

export async function devRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preValidation', requireAuth)
  app.addHook('preValidation', requireDev)

  app.get('/metrics', async () => {
    const [
      users,
      notes,
      shares,
      friendships,
      apiTotals,
      dailyUsers,
      dailyNotes,
      dailyCalls,
      endpoints,
      rlTotals,
      rlDaily,
      rlTopRoutes,
      rlTopIps,
    ] = await Promise.all([
      pool.query<{ c: number }>('SELECT count(*)::int AS c FROM users'),
      pool.query<{ c: number }>('SELECT count(*)::int AS c FROM notes'),
      pool.query<{ c: number }>('SELECT count(*)::int AS c FROM notes WHERE share_token IS NOT NULL'),
      pool.query<{ c: number }>("SELECT count(*)::int AS c FROM friendships WHERE status = 'accepted'"),
      pool.query<{ calls: string; endpoints: string }>(
        'SELECT COALESCE(sum(count), 0)::text AS calls, count(DISTINCT (method || \' \' || route))::text AS endpoints FROM endpoint_metrics',
      ),
      dailySeries(
        `SELECT to_char(created_at, 'YYYY-MM-DD') AS day, count(*)::int AS count
           FROM users
           WHERE created_at >= now() - ($1::int * interval '1 day')
           GROUP BY day ORDER BY day`,
        [DAY_SERIES_DAYS],
      ),
      dailySeries(
        `SELECT to_char(created_at, 'YYYY-MM-DD') AS day, count(*)::int AS count
           FROM notes
           WHERE created_at >= now() - ($1::int * interval '1 day')
           GROUP BY day ORDER BY day`,
        [DAY_SERIES_DAYS],
      ),
      dailySeries(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, sum(count)::int AS count
           FROM endpoint_metrics
           WHERE day >= CURRENT_DATE - ($1::int * interval '1 day')
           GROUP BY day ORDER BY day`,
        [DAY_SERIES_DAYS],
      ),
      pool.query<{ method: string; route: string; total: string }>(
        `SELECT method, route, sum(count)::text AS total
           FROM endpoint_metrics
           GROUP BY method, route
           ORDER BY sum(count) DESC
           LIMIT 200`,
      ),
      pool.query<{ total: string; today: string }>(
        `SELECT COALESCE(sum(count),0)::text AS total,
                COALESCE(sum(CASE WHEN day = CURRENT_DATE THEN count ELSE 0 END),0)::text AS today
         FROM rate_limit_daily`,
      ),
      dailySeries(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, sum(count)::int AS count
         FROM rate_limit_daily
         WHERE day >= CURRENT_DATE - ($1::int * interval '1 day')
         GROUP BY day ORDER BY day`,
        [DAY_SERIES_DAYS],
      ),
      pool.query<{ method: string; route: string; total: string }>(
        `SELECT method, route, sum(count)::text AS total
         FROM rate_limit_daily
         GROUP BY method, route
         ORDER BY sum(count) DESC
         LIMIT 20`,
      ),
      pool.query<{ ip: string; total: string }>(
        `SELECT ip::text AS ip, sum(count)::text AS total
         FROM rate_limit_ip_daily
         GROUP BY ip
         ORDER BY sum(count) DESC
         LIMIT 20`,
      ),
    ])

    const rlCfg = getRateLimitConfig()

    return {
      totals: {
        users: users.rows[0].c,
        notes: notes.rows[0].c,
        publicShares: shares.rows[0].c,
        friendships: friendships.rows[0].c,
        apiCalls: Number(apiTotals.rows[0].calls),
        endpointCount: Number(apiTotals.rows[0].endpoints),
      },
      daily: {
        users: dailyUsers,
        notes: dailyNotes,
        apiCalls: dailyCalls,
      },
      endpoints: endpoints.rows.map((r) => ({ method: r.method, route: r.route, count: Number(r.total) })),
      rateLimit: {
        totalBlocked: Number(rlTotals.rows[0]?.total ?? 0),
        todayBlocked: Number(rlTotals.rows[0]?.today ?? 0),
        dailyBlocked: rlDaily,
        topBlockedRoutes: rlTopRoutes.rows.map((r) => ({ method: r.method, route: r.route, count: Number(r.total) })),
        topBlockedIps: rlTopIps.rows.map((r) => ({ ip: r.ip, count: Number(r.total) })),
        config: { defaults: rlCfg.defaults, overrides: rlCfg.overrides },
      },
    }
  })
}

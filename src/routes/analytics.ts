import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { notFound } from '../utils.js'
import { requireAuth } from '../auth.js'

// Kullanıcının kendi genel paylaşımlı notlarının görüntülenme analizi
export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preValidation', requireAuth)

  function me(req: { userId?: unknown }): string {
    return req.userId as string
  }

  // Özet: toplam istatistikler + not başına + son 30 günün günlük serisi
  app.get('/analytics', async (req) => {
    const userId = me(req)
    const [summaryRes, notesRes, dailyRes, todayRes] = await Promise.all([
      pool.query(
        `SELECT
          count(sv.id)::int AS total_views,
          count(DISTINCT sv.ip)::int AS total_unique_ips
         FROM notes n
         JOIN share_views sv ON sv.note_id = n.id
         WHERE n.user_id = $1 AND n.share_token IS NOT NULL`,
        [userId],
      ),
      pool.query(
        `SELECT n.id, n.title, n.share_token,
          count(sv.id)::int AS view_count,
          count(DISTINCT sv.ip)::int AS unique_ip_count,
          min(sv.viewed_at) AS first_view_at,
          max(sv.viewed_at) AS last_view_at
         FROM notes n
         LEFT JOIN share_views sv ON sv.note_id = n.id
         WHERE n.user_id = $1 AND n.share_token IS NOT NULL
         GROUP BY n.id
         ORDER BY view_count DESC, n.updated_at DESC`,
        [userId],
      ),
      pool.query(
        `SELECT (date_trunc('day', sv.viewed_at))::date AS day, count(*)::int AS views
         FROM share_views sv
         JOIN notes n ON n.id = sv.note_id
         WHERE n.user_id = $1 AND n.share_token IS NOT NULL
           AND sv.viewed_at >= now() - interval '29 days'
         GROUP BY day
         ORDER BY day`,
        [userId],
      ),
      pool.query(
        `SELECT count(*)::int AS today_views
         FROM share_views sv
         JOIN notes n ON n.id = sv.note_id
         WHERE n.user_id = $1 AND n.share_token IS NOT NULL
           AND sv.viewed_at >= (now() AT TIME ZONE 'UTC')::date`,
        [userId],
      ),
    ])

    return {
      totalViews: summaryRes.rows[0].total_views,
      totalUniqueIps: summaryRes.rows[0].total_unique_ips,
      todayViews: todayRes.rows[0].today_views,
      notes: notesRes.rows.map((r) => ({
        noteId: r.id,
        title: r.title,
        viewCount: r.view_count,
        uniqueIpCount: r.unique_ip_count,
        firstViewAt: r.first_view_at,
        lastViewAt: r.last_view_at,
      })),
      daily: dailyRes.rows.map((r) => ({ day: r.day, views: r.views })),
    }
  })

  // Tek bir paylaşımlı notun günlük serisi (varsayılan son 30 gün)
  app.get('/analytics/notes/:id/daily', async (req, reply) => {
    const { id } = req.params as { id: string }
    const days = Math.min(Math.max(Number((req.query as { days?: string }).days ?? 30) || 30, 1), 365)

    const { rows } = await pool.query(
      `SELECT 1 FROM notes WHERE id = $1 AND user_id = $2 AND share_token IS NOT NULL`,
      [id, me(req)],
    )
    if (!rows.length) return notFound(reply, 'Paylaşımlı not bulunamadı')

    const daily = await pool.query(
      `SELECT (date_trunc('day', viewed_at))::date AS day, count(*)::int AS views
       FROM share_views
       WHERE note_id = $1 AND viewed_at >= now() - ($2::int * interval '1 day')
       GROUP BY day
       ORDER BY day`,
      [id, days],
    )
    return daily.rows.map((r) => ({ day: r.day, views: r.views }))
  })
}
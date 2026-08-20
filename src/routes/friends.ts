import type { FastifyInstance, FastifyRequest } from 'fastify'
import { pool } from '../db.js'
import { badRequest, notFound, forbidden } from '../utils.js'
import { requireAuth } from '../auth.js'

function userId(req: FastifyRequest): string {
  return req.userId as string
}

export async function friendsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preValidation', requireAuth)

  // Kullanıcı arama (arkadaş eklemek için). Kendisi hariç; e-posta açıklanmaz.
  app.get('/search', async (req, reply) => {
    const q = ((req.query as { q?: string }).q ?? '').trim().toLowerCase()
    if (q.length < 2) return badRequest(reply, 'Search must be at least 2 characters')
    const me = userId(req)

    const { rows } = await pool.query(
      `SELECT u.id, u.username,
        CASE
          WHEN f.id IS NULL THEN 'none'
          WHEN f.status = 'pending' AND f.requester_id = $1 THEN 'pending_outgoing'
          WHEN f.status = 'pending' AND f.addressee_id = $1 THEN 'pending_incoming'
          ELSE 'friends'
        END AS friendship
       FROM users u
       LEFT JOIN friendships f ON (
         (f.requester_id = u.id AND f.addressee_id = $1) OR
         (f.addressee_id = u.id AND f.requester_id = $1)
       )
       WHERE u.id <> $1 AND u.username ILIKE $2
       ORDER BY u.username
       LIMIT 20`,
      [me, `%${q}%`],
    )
    return rows
  })

  // Onaylanmış arkadaşlar
  app.get('/', async (req) => {
    const me = userId(req)
    const { rows } = await pool.query(
      `SELECT f.id AS friendship_id, u.id AS user_id, u.username, f.created_at
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
       ORDER BY u.username`,
      [me],
    )
    return rows.map((r) => ({
      id: r.friendship_id,
      userId: r.user_id,
      username: r.username,
      since: r.created_at,
    }))
  })

  // Bekleyen istekler: gelen + giden
  app.get('/requests', async (req) => {
    const me = userId(req)
    const [incoming, outgoing] = await Promise.all([
      pool.query(
        `SELECT f.id, u.id AS user_id, u.username, f.created_at
         FROM friendships f JOIN users u ON u.id = f.requester_id
         WHERE f.addressee_id = $1 AND f.status = 'pending'
         ORDER BY f.created_at DESC`,
        [me],
      ),
      pool.query(
        `SELECT f.id, u.id AS user_id, u.username, f.created_at
         FROM friendships f JOIN users u ON u.id = f.addressee_id
         WHERE f.requester_id = $1 AND f.status = 'pending'
         ORDER BY f.created_at DESC`,
        [me],
      ),
    ])
    const map = (r: { id: string; user_id: string; username: string; created_at: string }) => ({
      id: r.id,
      user: { id: r.user_id, username: r.username },
      createdAt: r.created_at,
    })
    return { incoming: incoming.rows.map(map), outgoing: outgoing.rows.map(map) }
  })

  // Arkadaşlık isteği gönder
  app.post('/request', async (req, reply) => {
    const { userId: targetId } = req.body as { userId?: string }
    const me = userId(req)
    if (!targetId) return badRequest(reply, 'userId is required')
    if (targetId === me) return badRequest(reply, 'You cannot add yourself')

    const target = await pool.query('SELECT 1 FROM users WHERE id = $1', [targetId])
    if (!target.rowCount) return notFound(reply, 'User not found')

    const existing = await pool.query(
      `SELECT id, status, requester_id FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
      [me, targetId],
    )
    if (existing.rowCount) {
      const row = existing.rows[0]
      if (row.status === 'accepted') return badRequest(reply, 'Already friends')
      if (row.requester_id === me) return badRequest(reply, 'Request already sent')
      // Karşı taraf daha önce istek göndermiş: otomatik kabul et
      await pool.query(
        `UPDATE friendships SET status = 'accepted', updated_at = now() WHERE id = $1`,
        [row.id],
      )
      return { accepted: true }
    }

    const { rows } = await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2) RETURNING id`,
      [me, targetId],
    )
    return reply.code(201).send({ id: rows[0].id, accepted: false })
  })

  // Gelen isteği kabul et
  app.post('/:id/accept', async (req, reply) => {
    const me = userId(req)
    const { id } = req.params as { id: string }
    const { rows } = await pool.query(
      `UPDATE friendships SET status = 'accepted', updated_at = now()
       WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
       RETURNING id`,
      [id, me],
    )
    if (!rows.length) return notFound(reply, 'Request not found')
    return { id: rows[0].id }
  })

  // İsteği reddet / iptal et
  app.post('/:id/decline', async (req, reply) => {
    const me = userId(req)
    const { id } = req.params as { id: string }
    const { rows } = await pool.query(
      `DELETE FROM friendships
       WHERE id = $1 AND status = 'pending' AND (requester_id = $2 OR addressee_id = $2)
       RETURNING id`,
      [id, me],
    )
    if (!rows.length) return notFound(reply, 'Request not found')
    return reply.code(204).send()
  })

  // Arkadaşlığı bitir
  app.delete('/:id', async (req, reply) => {
    const me = userId(req)
    const { id } = req.params as { id: string }
    const { rows } = await pool.query(
      `DELETE FROM friendships
       WHERE id = $1 AND status = 'accepted' AND (requester_id = $2 OR addressee_id = $2)
       RETURNING id`,
      [id, me],
    )
    if (!rows.length) return notFound(reply, 'Friendship not found')
    return reply.code(204).send()
  })
}

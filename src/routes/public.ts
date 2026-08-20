import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { notFound } from '../utils.js'

// Herkese açık not sayfası: /share/:token (kimlik doğrulama gerektirmez)
export async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/share/:token', async (req, reply) => {
    const { token } = req.params as { token: string }
    const { rows } = await pool.query(
      `SELECT n.id, n.title, n.content, n.created_at, n.updated_at,
        (SELECT u.username FROM users u WHERE u.id = n.user_id) AS username
       FROM notes n WHERE n.share_token = $1`,
      [token],
    )
    if (!rows.length) return notFound(reply)
    const r = rows[0]
    return {
      id: r.id,
      title: r.title,
      content: r.content,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      username: r.username,
    }
  })
}

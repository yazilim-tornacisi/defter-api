import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { badRequest, notFound } from '../utils.js'
import { requireAuth } from '../auth.js'

export async function tagsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preValidation', requireAuth)

  app.get('/', async (req) => {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.created_at,
         (SELECT COUNT(*) FROM note_tags nt WHERE nt.tag_id = t.id)::int AS note_count
       FROM tags t
       WHERE t.user_id = $1
       ORDER BY t.name`,
      [req.userId],
    )
    return rows.map(mapTag)
  })

  app.post('/', async (req, reply) => {
    const { name } = req.body as { name?: string }
    const clean = name?.trim()
    if (!clean) return badRequest(reply, 'Name is required')

    try {
      const { rows } = await pool.query(
        'INSERT INTO tags (name, user_id) VALUES ($1, $2) RETURNING id, name, created_at',
        [clean, req.userId],
      )
      return reply.code(201).send({ ...mapTag(rows[0]), noteCount: 0 })
    } catch {
      return badRequest(reply, 'Tag already exists')
    }
  })

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await pool.query('DELETE FROM tags WHERE id = $1 AND user_id = $2 RETURNING id', [
      id,
      req.userId,
    ])
    if (!rows.length) return notFound(reply)
    return reply.code(204).send()
  })
}

function mapTag(row: { id: string; name: string; created_at: string; note_count?: number }) {
  return { id: row.id, name: row.name, createdAt: row.created_at, noteCount: row.note_count ?? 0 }
}
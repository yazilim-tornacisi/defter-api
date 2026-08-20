import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { badRequest, notFound } from '../utils.js'
import { requireAuth } from '../auth.js'

export async function foldersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preValidation', requireAuth)

  app.get('/', async (req) => {
    const { rows } = await pool.query(
      `SELECT f.id, f.name, f.created_at,
         (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id)::int AS note_count
       FROM folders f
       WHERE f.user_id = $1
       ORDER BY f.name`,
      [req.userId],
    )
    return rows.map(mapFolder)
  })

  app.post('/', async (req, reply) => {
    const { name } = req.body as { name?: string }
    const clean = name?.trim()
    if (!clean) return badRequest(reply, 'Name is required')

    const { rows } = await pool.query(
      'INSERT INTO folders (name, user_id) VALUES ($1, $2) RETURNING id, name, created_at',
      [clean, req.userId],
    )
    return reply.code(201).send({ ...mapFolder(rows[0]), noteCount: 0 })
  })

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { name } = req.body as { name?: string }
    const clean = name?.trim()
    if (!clean) return badRequest(reply, 'Name is required')

    const { rows } = await pool.query(
      'UPDATE folders SET name = $1, updated_at = now() WHERE id = $2 AND user_id = $3 RETURNING id, name, created_at',
      [clean, id, req.userId],
    )
    if (!rows.length) return notFound(reply)
    return mapFolder(rows[0])
  })

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await pool.query('DELETE FROM folders WHERE id = $1 AND user_id = $2 RETURNING id', [
      id,
      req.userId,
    ])
    if (!rows.length) return notFound(reply)
    return reply.code(204).send()
  })
}

function mapFolder(row: { id: string; name: string; created_at: string; note_count?: number }) {
  return { id: row.id, name: row.name, createdAt: row.created_at, noteCount: row.note_count ?? 0 }
}
import type { FastifyInstance, FastifyReply } from 'fastify'
import { pool } from '../db.js'
import { badRequest, notFound } from '../utils.js'
import { hashPassword, requireAdmin, requireAuth } from '../auth.js'
import { getGlobalLimits, LIMIT_BOUNDS, sanitizePositiveInt } from '../limits.js'

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preValidation', requireAuth)
  app.addHook('preValidation', requireAdmin)

  // Tüm kullanıcılar: not ve arkadaş sayıları ile birlikte
  app.get('/users', async () => {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.email, u.is_admin, u.banned_at, u.created_at,
        u.max_notes, u.max_note_chars,
        (SELECT count(*)::int FROM notes n WHERE n.user_id = u.id) AS note_count,
        (SELECT count(*)::int FROM friendships f
          WHERE f.status = 'accepted' AND (f.requester_id = u.id OR f.addressee_id = u.id)) AS friend_count
       FROM users u
       ORDER BY u.created_at DESC`,
    )
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      isAdmin: r.is_admin,
      bannedAt: r.banned_at,
      createdAt: r.created_at,
      noteCount: r.note_count,
      friendCount: r.friend_count,
      maxNotes: r.max_notes,
      maxNoteChars: r.max_note_chars,
    }))
  })

  // Tüm notlar (sahibi + paylaşım bilgileri ile birlikte)
  app.get('/notes', async (req) => {
    const q = ((req.query as { q?: string }).q ?? '').trim()
    const { rows } = await pool.query(
      `SELECT n.id, n.title, n.content, n.is_pinned, n.created_at, n.updated_at, n.share_token,
        u.id AS user_id, u.username, u.banned_at,
        (SELECT count(*)::int FROM share_views sv WHERE sv.note_id = n.id) AS view_count,
        COALESCE(
          json_agg(json_build_object('username', su.username, 'permission', ns.permission))
            FILTER (WHERE ns.id IS NOT NULL),
          '[]'::json
        ) AS shared_with
       FROM notes n
       JOIN users u ON u.id = n.user_id
       LEFT JOIN note_shares ns ON ns.note_id = n.id
       LEFT JOIN users su ON su.id = ns.user_id
       WHERE ($1 = '' OR n.title ILIKE $2 OR n.content ILIKE $2)
       GROUP BY n.id, u.id
       ORDER BY n.updated_at DESC
       LIMIT 300`,
      [q, `%${q}%`],
    )
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      isPinned: r.is_pinned,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      userId: r.user_id,
      username: r.username,
      userBanned: !!r.banned_at,
      publicShared: r.share_token !== null,
      viewCount: r.view_count,
      sharedWith: r.shared_with,
    }))
  })

  // Tek kullanıcı detayı: bilgiler + notlar + arkadaşlar
  app.get('/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const user = await getUser(reply, id)
    if (!user) return

    const [notesRes, friendsRes] = await Promise.all([
      pool.query(
        `SELECT n.id, n.title, n.content, n.is_pinned, n.created_at, n.updated_at, n.share_token,
          (SELECT count(*)::int FROM share_views sv WHERE sv.note_id = n.id) AS view_count,
          (SELECT min(sv.viewed_at) FROM share_views sv WHERE sv.note_id = n.id) AS first_view_at,
          (SELECT max(sv.viewed_at) FROM share_views sv WHERE sv.note_id = n.id) AS last_view_at,
          (SELECT count(DISTINCT sv.ip)::int FROM share_views sv WHERE sv.note_id = n.id) AS unique_ip_count,
          COALESCE(
            json_agg(json_build_object('username', su.username, 'permission', ns.permission))
              FILTER (WHERE ns.id IS NOT NULL),
            '[]'::json
          ) AS shared_with
         FROM notes n
         LEFT JOIN note_shares ns ON ns.note_id = n.id
         LEFT JOIN users su ON su.id = ns.user_id
         WHERE n.user_id = $1
         GROUP BY n.id
         ORDER BY n.updated_at DESC`,
        [id],
      ),
      pool.query(
        `SELECT u.id AS user_id, u.username, f.created_at AS since
         FROM friendships f JOIN users u
           ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
         WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
         ORDER BY u.username`,
        [id],
      ),
    ])

    const notes = notesRes.rows.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      isPinned: n.is_pinned,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
      publicShared: n.share_token !== null,
      sharedWith: n.shared_with,
    }))
    const publicShares = notesRes.rows
      .filter((n) => n.share_token !== null)
      .map((n) => ({
        noteId: n.id,
        title: n.title,
        shareToken: n.share_token,
        viewCount: n.view_count,
        uniqueIpCount: n.unique_ip_count,
        firstViewAt: n.first_view_at,
        lastViewAt: n.last_view_at,
      }))
      .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))

    return {
      user,
      notes,
      publicShares,
      friends: friendsRes.rows.map((f) => ({ userId: f.user_id, username: f.username, since: f.since })),
    }
  })

  // Bir genel paylaşımlı notun son görüntülenme kayıtları
  app.get('/notes/:id/views', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await pool.query(
      `SELECT id, viewed_at, ip::text AS ip, user_agent
       FROM share_views WHERE note_id = $1
       ORDER BY viewed_at DESC
       LIMIT 50`,
      [id],
    )
    return rows.map((r) => ({
      id: r.id,
      viewedAt: r.viewed_at,
      ip: r.ip,
      userAgent: r.user_agent,
    }))
  })

  // Kullanıcıyı engelle
  app.patch('/users/:id/ban', async (req, reply) => {
    const { id } = req.params as { id: string }
    const me = req.userId as string
    if (id === me) return badRequest(reply, 'Kendinizi engelleyemezsiniz')

    const { rows } = await pool.query(
      `UPDATE users SET banned_at = now() WHERE id = $1 AND is_admin = false RETURNING id`,
      [id],
    )
    if (!rows.length) {
      const admin = await pool.query('SELECT 1 FROM users WHERE id = $1', [id])
      if (!admin.rowCount) return notFound(reply, 'User not found')
      return badRequest(reply, 'Başka bir yönetici engellenemez')
    }
    return reply.code(200).send({ banned: true })
  })

  // Engeli kaldır
  app.patch('/users/:id/unban', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await pool.query(
      `UPDATE users SET banned_at = NULL WHERE id = $1 RETURNING id`,
      [id],
    )
    if (!rows.length) return notFound(reply, 'User not found')
    return reply.code(200).send({ banned: false })
  })

  // Kullanıcının parolasını sıfırla
  app.post('/users/:id/reset-password', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { newPassword } = req.body as { newPassword?: string }
    if (!newPassword || newPassword.length < 8) return badRequest(reply, 'Parola en az 8 karakter olmalıdır')

    const { rows } = await pool.query(
      `UPDATE users SET password = $1 WHERE id = $2 AND is_admin = false RETURNING id`,
      [hashPassword(newPassword), id],
    )
    if (!rows.length) {
      const exists = await pool.query('SELECT 1 FROM users WHERE id = $1', [id])
      if (!exists.rowCount) return notFound(reply, 'User not found')
      return badRequest(reply, 'Yönetici parolası sıfırlanamaz')
    }
    return { reset: true }
  })

  // Kullanıcıyı yönetici yap / yöneticiliğini kaldır
  app.patch('/users/:id/role', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { isAdmin } = req.body as { isAdmin?: boolean }
    const me = req.userId as string
    if (typeof isAdmin !== 'boolean') return badRequest(reply, 'isAdmin is required')
    if (id === me) return badRequest(reply, 'Kendi rolünüzü değiştiremezsiniz')

    const { rows } = await pool.query('SELECT is_admin, banned_at FROM users WHERE id = $1', [id])
    if (!rows.length) return notFound(reply, 'User not found')
    if (isAdmin && rows[0].banned_at) return badRequest(reply, 'Engelli kullanıcı yönetici yapılamaz')
    if (!isAdmin && rows[0].is_admin) {
      const admins = await pool.query('SELECT count(*)::int AS c FROM users WHERE is_admin = true')
      if (admins.rows[0].c <= 1) return badRequest(reply, 'Son yöneticinin yetkisi kaldırılamaz')
    }

    await pool.query('UPDATE users SET is_admin = $1 WHERE id = $2', [isAdmin, id])
    return { isAdmin }
  })

  // Tüm giriş kayıtları (filtre + sayfalama)
  app.get('/logs', async (req) => {
    const query = req.query as { q?: string; success?: string; limit?: string; offset?: string }
    const q = (query.q ?? '').trim()
    const success = query.success === 'true' ? true : query.success === 'false' ? false : null
    const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 200)
    const offset = Math.max(Number(query.offset ?? 0) || 0, 0)

    const { rows } = await pool.query(
      `SELECT l.id, l.user_id, u.username, u.email, l.identifier, l.success,
        l.ip::text AS ip, l.user_agent, l.created_at
       FROM auth_logs l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE ($1 = '' OR l.identifier ILIKE $2 OR u.username ILIKE $2 OR u.email ILIKE $2)
         AND ($3::boolean IS NULL OR l.success = $3)
       ORDER BY l.created_at DESC
       LIMIT $4 OFFSET $5`,
      [q, `%${q}%`, success, limit, offset],
    )
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username ?? null,
      email: r.email ?? null,
      identifier: r.identifier,
      success: r.success,
      ip: r.ip,
      userAgent: r.user_agent,
      createdAt: r.created_at,
    }))
  })

  // Bir kullanıcının belirli bir notunu sil
  app.delete('/users/:userId/notes/:noteId', async (req, reply) => {
    const { userId, noteId } = req.params as { userId: string; noteId: string }
    const { rows } = await pool.query(
      `DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id`,
      [noteId, userId],
    )
    if (!rows.length) return notFound(reply, 'Note not found')
    return reply.code(204).send()
  })

  // Herhangi bir notu sil (sahibine bakmaksızın)
  app.delete('/notes/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await pool.query(`DELETE FROM notes WHERE id = $1 RETURNING id`, [id])
    if (!rows.length) return notFound(reply, 'Note not found')
    return reply.code(204).send()
  })

  // Genel (varsayılan) kullanıcı limitlerini getir
  app.get('/settings', async () => {
    return getGlobalLimits()
  })

  // Genel limitleri güncelle (tüm kullanıcıları etkiler; kişisel override'lar önceliklidir)
  app.patch('/settings', async (req, reply) => {
    const body = req.body as { maxNotesPerUser?: unknown; maxNoteContentLength?: unknown }
    const updates: [string, number][] = []
    if (body.maxNotesPerUser !== undefined) {
      const n = sanitizePositiveInt(body.maxNotesPerUser, LIMIT_BOUNDS.maxNotes.min, LIMIT_BOUNDS.maxNotes.max)
      if (n === null) return badRequest(reply, 'Geçersiz not sayısı limiti')
      updates.push(['max_notes_per_user', n])
    }
    if (body.maxNoteContentLength !== undefined) {
      const n = sanitizePositiveInt(body.maxNoteContentLength, LIMIT_BOUNDS.maxNoteChars.min, LIMIT_BOUNDS.maxNoteChars.max)
      if (n === null) return badRequest(reply, 'Geçersiz içerik uzunluğu limiti')
      updates.push(['max_note_content_length', n])
    }
    if (!updates.length) return badRequest(reply, 'Güncellenecek limit yok')

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const [key, value] of updates) {
        await client.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, String(value)],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    return getGlobalLimits()
  })

  // Tek kullanıcının kişisel limit override'larını ayarla (null = genel varsayılanı kullan)
  app.patch('/users/:id/limits', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as { maxNotes?: unknown; maxNoteChars?: unknown }
    const sets: string[] = []
    const params: unknown[] = []
    const p = (v: unknown) => {
      params.push(v)
      return `$${params.length}`
    }

    if (body.maxNotes !== undefined) {
      if (body.maxNotes === null) sets.push('max_notes = NULL')
      else {
        const n = sanitizePositiveInt(body.maxNotes, LIMIT_BOUNDS.maxNotes.min, LIMIT_BOUNDS.maxNotes.max)
        if (n === null) return badRequest(reply, 'Geçersiz not sayısı limiti')
        sets.push(`max_notes = ${p(n)}`)
      }
    }
    if (body.maxNoteChars !== undefined) {
      if (body.maxNoteChars === null) sets.push('max_note_chars = NULL')
      else {
        const n = sanitizePositiveInt(body.maxNoteChars, LIMIT_BOUNDS.maxNoteChars.min, LIMIT_BOUNDS.maxNoteChars.max)
        if (n === null) return badRequest(reply, 'Geçersiz içerik uzunluğu limiti')
        sets.push(`max_note_chars = ${p(n)}`)
      }
    }
    if (!sets.length) return badRequest(reply, 'Güncellenecek limit yok')

    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = ${p(id)} RETURNING max_notes, max_note_chars`,
      params,
    )
    if (!rows.length) return notFound(reply, 'User not found')
    return { maxNotes: rows[0].max_notes, maxNoteChars: rows[0].max_note_chars }
  })
}

async function getUser(reply: FastifyReply, id: string) {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.email, u.is_admin, u.banned_at, u.created_at,
      u.max_notes, u.max_note_chars,
      (SELECT count(*)::int FROM notes n WHERE n.user_id = u.id) AS note_count,
      (SELECT count(*)::int FROM friendships f
        WHERE f.status = 'accepted' AND (f.requester_id = u.id OR f.addressee_id = u.id)) AS friend_count
     FROM users u WHERE u.id = $1`,
    [id],
  )
  if (!rows.length) {
    notFound(reply, 'User not found')
    return null
  }
  const r = rows[0]
  return {
    id: r.id,
    username: r.username,
    email: r.email,
    isAdmin: r.is_admin,
    bannedAt: r.banned_at,
    createdAt: r.created_at,
    noteCount: r.note_count,
    friendCount: r.friend_count,
    maxNotes: r.max_notes,
    maxNoteChars: r.max_note_chars,
  }
}
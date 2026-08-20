import { WebSocketServer } from 'ws'
import type { Server } from 'node:http'
import { setupWSConnection } from 'y-websocket/bin/utils'
import { verifyToken } from './auth.js'
import { pool } from './db.js'

async function hasNoteAccess(noteId: string, uid: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM notes n
     LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.user_id = $2
     WHERE n.id = $1 AND (n.user_id = $2 OR ns.note_id IS NOT NULL)`,
    [noteId, uid],
  )
  return rows.length > 0
}

export function attachCollabServer(server: Server): void {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    let url: URL
    try {
      url = new URL(request.url ?? '', 'http://localhost')
    } catch {
      socket.destroy()
      return
    }

    if (!url.pathname.startsWith('/api/collab')) {
      socket.destroy()
      return
    }

    const token = url.searchParams.get('token')
    const noteId = url.searchParams.get('note')
    const uid = token ? verifyToken(token) : null

    if (!uid || !noteId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    // Erişim kontrolü tamamlanana kadar upgrade'i bekle
    isUserActive(uid)
      .then((active) => {
        if (!active) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
          socket.destroy()
          return null
        }
        return hasNoteAccess(noteId, uid)
      })
      .then((ok) => {
        if (ok === null) return
        if (!ok) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
          socket.destroy()
          return
        }
        wss.handleUpgrade(request, socket, head, (conn) => {
          setupWSConnection(conn, request, { docName: `note:${noteId}` })
        })
      })
      .catch(() => {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
        socket.destroy()
      })
  })
}

async function isUserActive(uid: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT banned_at FROM users WHERE id = $1', [uid])
  if (!rows.length) return false
  return !rows[0].banned_at
}

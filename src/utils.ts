import type { FastifyReply } from 'fastify'

type NoteRow = {
  id: string
  title: string
  content: string
  folder_id: string | null
  folder_name: string | null
  is_pinned: boolean
  created_at: string
  updated_at: string
  share_token?: string | null
  tags: { id: string; name: string }[] | string
  permission?: string
  shared_by_username?: string | null
}

export function mapNote(row: NoteRow) {
  const tags = Array.isArray(row.tags) ? row.tags : []
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    folderId: row.folder_id,
    folderName: row.folder_name,
    isPinned: row.is_pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags,
    permission: row.permission ?? 'owner',
    sharedByUsername: row.shared_by_username ?? null,
    shareToken: row.permission === 'owner' ? row.share_token ?? null : null,
  }
}

export function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: message })
}

export function notFound(reply: FastifyReply, message = 'Not found'): FastifyReply {
  return reply.code(404).send({ error: message })
}

export function unauthorized(reply: FastifyReply, message = 'Unauthorized'): FastifyReply {
  return reply.code(401).send({ error: message })
}

export function forbidden(reply: FastifyReply, message = 'Forbidden'): FastifyReply {
  return reply.code(403).send({ error: message })
}
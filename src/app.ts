import Fastify from 'fastify'
import cors from '@fastify/cors'
import { notesRoutes } from './routes/notes.js'
import { foldersRoutes } from './routes/folders.js'
import { tagsRoutes } from './routes/tags.js'
import { authRoutes } from './auth.js'
import { friendsRoutes } from './routes/friends.js'
import { adminRoutes } from './routes/admin.js'
import { publicRoutes } from './routes/public.js'

export function buildApp() {
  const app = Fastify({ logger: true, trustProxy: true })

  app.register(cors, { origin: true })

  app.get('/api/health', async () => ({ ok: true }))

  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(friendsRoutes, { prefix: '/api/friends' })
  app.register(adminRoutes, { prefix: '/api/admin' })
  app.register(notesRoutes, { prefix: '/api/notes' })
  app.register(publicRoutes, { prefix: '/api' })
  app.register(foldersRoutes, { prefix: '/api/folders' })
  app.register(tagsRoutes, { prefix: '/api/tags' })

  return app
}
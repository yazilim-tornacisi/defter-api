import 'dotenv/config'
import { buildApp } from './app.js'
import { runMigrations } from './migrate.js'
import { attachCollabServer } from './collab.js'

const port = Number(process.env.PORT ?? 4000)
const host = process.env.HOST ?? '0.0.0.0'

async function main(): Promise<void> {
  await runMigrations()
  const app = buildApp()
  await app.ready()
  attachCollabServer(app.server)
  await app.listen({ port, host })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
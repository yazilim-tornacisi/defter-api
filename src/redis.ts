import { Redis } from 'ioredis'

let client: Redis | null = null
let warned = false

function parseConfig(): { host: string; port: number; password?: string } | null {
  // Kullanıcının verdiği format: REDIS_HOST=213.238.180.233:6379 REDIS_PASS=...
  // Ayrıca REDIS_URL, REDIS_HOST/REDIS_PORT/REDIS_PASSWORD varyasyonlarını da destekle
  const url = process.env.REDIS_URL
  if (url) return null // ioredis url ile ayrıca ele alınacak

  let host = process.env.REDIS_HOST?.trim()
  let portStr = process.env.REDIS_PORT?.trim()
  let pass = process.env.REDIS_PASS ?? process.env.REDIS_PASSWORD

  // REDIS_HOST içinde ":port" varsa ayır (örn: 213.238.180.233:6379)
  if (host && host.includes(':')) {
    const idx = host.lastIndexOf(':')
    const h = host.slice(0, idx).trim()
    const p = host.slice(idx + 1).trim()
    host = h
    if (!portStr && p) portStr = p
  }

  if (!host) return null

  const port = portStr ? parseInt(portStr, 10) : 6379
  if (!Number.isFinite(port)) return null

  return { host, port, password: pass?.trim() || undefined }
}

export function getRedis(): Redis | null {
  if (client) return client

  const url = process.env.REDIS_URL?.trim()
  if (url) {
    try {
      client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
      })
      client.on('error', (err: Error) => {
        if (!warned) {
          console.warn('[redis] connection error, falling back to memory:', err.message)
          warned = true
        }
      })
      // Bağlantıyı arka planda dene, hata olsa bile memory fallback devreye girer
      client.connect().catch(() => {})
      return client
    } catch {
      return null
    }
  }

  const cfg = parseConfig()
  if (!cfg) return null

  try {
    client = new Redis({
      host: cfg.host,
      port: cfg.port,
      password: cfg.password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      connectTimeout: 3000,
    })
    client.on('error', (err: Error) => {
      if (!warned) {
        console.warn('[redis] connection error, falling back to memory:', err.message)
        warned = true
      }
    })
    client.connect().catch(() => {})
    return client
  } catch {
    return null
  }
}

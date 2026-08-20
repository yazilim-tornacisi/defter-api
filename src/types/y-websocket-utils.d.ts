declare module 'y-websocket/bin/utils' {
  import type { IncomingMessage } from 'node:http'
  export function setupWSConnection(
    conn: any,
    req: IncomingMessage,
    opts?: { docName?: string; gc?: boolean },
  ): void
}

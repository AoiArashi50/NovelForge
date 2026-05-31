import type { Context as HonoContext } from "hono"
import { getDb } from "./queries/connection"

export function createContext(c: HonoContext) {
  return {
    db: getDb(),
    req: c.req,
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>

import "dotenv/config"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { serveStatic } from "@hono/node-server/serve-static"
import { readFileSync } from "fs"
import { appRouter } from "./router"
import { createContext } from "./context"
import uploadApp from "./routers/upload"

const app = new Hono()

app.use("/*", cors({ origin: "*" }))

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: () => createContext(c),
  })
})

app.route("/api/upload", uploadApp)

app.get("/api/health", (c) => c.json({ status: "ok" }))

app.use("/*", serveStatic({ root: "./dist/public/" }))

app.get("/*", (c) => c.html(readFileSync("./dist/public/index.html", "utf-8")))

export default app

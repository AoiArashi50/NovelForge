import { pathToFileURL } from "url"

const baseDir = pathToFileURL(process.cwd() + "/").href

const aliases = {
  "@db/": new URL("dist/db/", baseDir),
  "@contracts/": new URL("dist/contracts/", baseDir),
}

async function tryResolve(url, context, nextResolve) {
  try {
    return await nextResolve(url, context)
  } catch {
    if (!url.endsWith(".js") && !url.endsWith(".json") && !url.endsWith(".mjs")) {
      try {
        return await nextResolve(url + ".js", context)
      } catch {
        try {
          return await nextResolve(url + "/index.js", context)
        } catch {}
      }
    }
    throw new Error(`Cannot resolve ${url}`)
  }
}

export async function resolve(specifier, context, nextResolve) {
  for (const [prefix, replacement] of Object.entries(aliases)) {
    if (specifier.startsWith(prefix)) {
      const resolved = new URL(specifier.slice(prefix.length), replacement).href
      return { url: resolved + ".js", shortCircuit: true }
    }
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return tryResolve(specifier, context, nextResolve)
  }

  return nextResolve(specifier, context)
}

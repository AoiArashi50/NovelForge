import { z } from "zod"

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
  EMBEDDING_BASE_URL: z.string().default("https://api.openai.com/v1"),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSION: z.coerce.number().default(1536),
})

export const env = envSchema.parse(process.env)

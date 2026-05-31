# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source
COPY . .

# Build frontend (Vite bundle to dist/public/)
RUN npm run build

# Compile backend TypeScript to dist/ (boot.js, etc.)
RUN npx tsc -b tsconfig.server.json

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/loader.mjs ./loader.mjs

# Environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "--experimental-loader", "./loader.mjs", "dist/api/server.js"]

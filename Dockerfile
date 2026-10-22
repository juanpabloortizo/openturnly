# syntax=docker/dockerfile:1

FROM node:26-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/

# --- Build the web app (needs all dev dependencies) ---
FROM base AS build
RUN npm ci
COPY . .
RUN npm run build

# --- Only what the server needs at runtime ---
FROM base AS server-deps
# better-auth lists react, vitest, drizzle-kit… as optional peers. Since other workspaces
# use them, the lockfile marks them "devOptional", so skip optional and peer packages too.
RUN npm ci --omit=dev --omit=optional --omit=peer --workspace=@openturnly/server \
  # npm may keep some packages next to the workspace (altcha-lib, for its optional peers).
  && mkdir -p apps/server/node_modules

# --- Runtime: Node runs the TypeScript sources directly (type stripping) ---
FROM node:26-alpine
ENV NODE_ENV=production \
  DATA_DIR=/data \
  PORT=3000
WORKDIR /app

COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/core ./packages/core
COPY apps/server ./apps/server
COPY --from=server-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/server/src/index.ts"]

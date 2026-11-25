# syntax=docker/dockerfile:1.7
# API image. Build context: repository root.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/worker/package.json apps/worker/
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/prisma apps/backend/prisma
COPY apps/backend/prisma.config.mjs apps/backend/
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --workspace packages/shared --workspace apps/backend --include-workspace-root=false --ignore-scripts \
 && npm run db:generate -w apps/backend \
 && npm prune --omit=dev --workspace packages/shared --workspace apps/backend --include-workspace-root=false --ignore-scripts \
 && npm cache clean --force

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared packages/shared
COPY apps/backend apps/backend
WORKDIR /app/apps/backend
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1
CMD ["node", "src/server.js"]

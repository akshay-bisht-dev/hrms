# syntax=docker/dockerfile:1.7
# SPA built with Vite, served by unprivileged Nginx that also proxies /api and /health to the API.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/worker/package.json apps/worker/
COPY apps/frontend/package.json apps/frontend/
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --workspace apps/frontend --include-workspace-root=false --ignore-scripts
COPY apps/frontend apps/frontend
RUN npm run build -w apps/frontend

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY infrastructure/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infrastructure/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 8080

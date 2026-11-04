# SnapClaim backend: the Node server in mock mode by default ($0, no keys).
# Live mode: pass MOCK_MODE=0 plus META_API_KEY / BASETEN_API_KEY at run time
# (docker compose reads them from .env). Keys are never baked into the image.
FROM node:22-alpine AS backend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY backend ./backend
COPY src ./src
COPY fixtures ./fixtures
COPY eval ./eval
ENV PORT=8787 NODE_ENV=production
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/v1/health || exit 1
CMD ["node", "--experimental-strip-types", "--no-warnings", "backend/server.ts"]

# React app (what snapclaim.pages.dev serves), built and served by nginx.
FROM node:22-alpine AS web-build
WORKDIR /repo
# Root dev deps too: react/ resolves @types/node from the repo root, as in a checkout.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY react/package.json react/package-lock.json ./react/
RUN npm --prefix react ci --ignore-scripts
COPY src ./src
COPY react ./react
RUN npm --prefix react run build

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /repo/react/dist /usr/share/nginx/html
EXPOSE 8080

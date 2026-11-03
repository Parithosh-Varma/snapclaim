# SnapClaim backend — Node 22, no build step (TypeScript runs via
# --experimental-strip-types; engines require node >= 22.18).
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install production deps first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App code: API backend + shared engine it imports.
COPY backend ./backend
COPY src ./src
COPY eval ./eval
COPY migrations ./migrations
COPY meta.config.json ./
COPY package.json ./

EXPOSE 8787
ENV PORT=8787 MOCK_MODE=1 SPEND_GUARD_USD=5

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--experimental-strip-types", "--no-warnings", "backend/server.ts"]

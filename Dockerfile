FROM node:22-slim AS build

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV MICROSERVICES_TELEMETRY=0

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/README.md ./README.md
COPY --from=build /app/server.json ./server.json
COPY --from=build /app/dist ./dist

USER node
ENTRYPOINT ["node"]
CMD ["dist/index.js"]

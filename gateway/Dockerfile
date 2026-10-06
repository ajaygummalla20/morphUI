FROM node:22.22-alpine AS build

WORKDIR /app
# Preserve ESM compilation for shared modules outside the Gateway package.
COPY package.json ./package.json
COPY gateway/package.json gateway/package-lock.json ./gateway/
RUN cd gateway && npm ci --ignore-scripts \
    && ln -s /app/gateway/node_modules /app/node_modules
COPY gateway/tsconfig.json ./gateway/tsconfig.json
COPY gateway/src ./gateway/src
COPY lib/gateway/contract.ts ./lib/gateway/contract.ts
COPY lib/catalog/semantic.ts ./lib/catalog/semantic.ts
RUN cd gateway && npm run build

FROM node:22.22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S morph && adduser -S -G morph -u 10001 morph
COPY gateway/package.json gateway/package-lock.json ./gateway/
RUN cd gateway && npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/gateway/dist ./gateway/dist
COPY gateway/config/policy.example.json ./gateway/config/policy.json
USER morph
WORKDIR /app/gateway
EXPOSE 8788
CMD ["node", "dist/gateway/src/server.js"]

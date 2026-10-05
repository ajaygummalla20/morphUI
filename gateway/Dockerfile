FROM node:22.22-alpine AS build

WORKDIR /app
COPY gateway/package.json gateway/package-lock.json ./gateway/
RUN cd gateway && npm ci
COPY gateway/tsconfig.json ./gateway/tsconfig.json
COPY gateway/src ./gateway/src
COPY lib/gateway/contract.ts ./lib/gateway/contract.ts
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

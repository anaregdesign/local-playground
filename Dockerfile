FROM node:22-alpine AS base
WORKDIR /app

FROM base AS dependencies
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

FROM dependencies AS build
COPY . .
RUN npm run build \
  && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
CMD ["npm", "run", "start"]

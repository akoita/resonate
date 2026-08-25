# ---- Stage 1: Dependencies ----
FROM node:24-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS deps

WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json package-lock.json .npmrc ./
RUN npm install -g npm@11.14.1
RUN npm ci --ignore-scripts && \
    for package in \
      node_modules/@prisma/engines \
      node_modules/prisma \
      node_modules/@prisma/client \
      node_modules/bufferutil \
      node_modules/cpu-features \
      node_modules/fsevents \
      node_modules/msgpackr-extract \
      node_modules/ssh2 \
      node_modules/utf-8-validate; do \
      if [ -f "${package}/package.json" ]; then \
        npm rebuild --offline --ignore-scripts=false --foreground-scripts -- "file:./${package}"; \
      fi; \
    done

# ---- Stage 2: Build ----
FROM deps AS build

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN ./node_modules/.bin/prisma generate

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Stage 3: Production Dependencies ----
FROM build AS prod-deps

RUN npm prune --omit=dev

# ---- Stage 4: Production Runtime ----
FROM node:24-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

WORKDIR /app

# openssl for Prisma; ffmpeg for stem_mix draft rendering (#1189)
RUN apt-get update -y && apt-get install -y openssl ffmpeg && rm -rf /var/lib/apt/lists/*

# Copy production dependencies, Prisma schema, and generated client.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY package.json package-lock.json .npmrc ./

# Copy compiled output
COPY --from=build /app/dist ./dist

# Sample-data fixture assets (Show campaign artist/hero/gallery images) so the
# `fixtures:shows:prod` seed can run from this image as a one-off Cloud Run Job.
# Only used when explicitly invoked with ALLOW_SAMPLE_SHOW_FIXTURES=true.
COPY fixtures ./fixtures

# Create uploads directory
RUN mkdir -p /app/uploads/stems && chown -R node:node /app/uploads

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER node

# Run migrations then start
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]

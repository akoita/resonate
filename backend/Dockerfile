# ---- Stage 1: Dependencies ----
FROM node:26-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS deps

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

# Copy source and build. The type check needs about 2.7 GB of heap, above
# Node's default on the image builder's machine, so the limit is set here (the
# build stage only; the runtime image is unaffected).
COPY tsconfig.json ./
COPY src ./src
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

# ---- Stage 3: Production Dependencies ----
FROM build AS prod-deps

RUN npm prune --omit=dev

# ---- Stage 4: audiowmark (remix render mark, #2573) ----
# Built from the pinned upstream release and checked against its digest. It is
# a separate GPL-3.0-or-later program the backend runs like ffmpeg; see NOTICE
# and docs/rfc/remix-watermarking.md ("Licence").
FROM node:26-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS audiowmark

ARG AUDIOWMARK_VERSION=0.6.5
ARG AUDIOWMARK_SHA256=12dd0232e47f29521c91d9d642183b3ca4145be61d353c4dc6d1c6cd7c388a4b

RUN apt-get update -y && apt-get install -y --no-install-recommends \
      ca-certificates curl zstd build-essential pkg-config \
      libfftw3-dev libsndfile1-dev libgcrypt20-dev libzita-resampler-dev libmpg123-dev \
      libavcodec-dev libavformat-dev libavutil-dev libswresample-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN curl -fsSL -o audiowmark.tar.zst \
      "https://github.com/swesterfeld/audiowmark/releases/download/${AUDIOWMARK_VERSION}/audiowmark-${AUDIOWMARK_VERSION}.tar.zst" \
    && echo "${AUDIOWMARK_SHA256}  audiowmark.tar.zst" | sha256sum -c - \
    && tar --zstd -xf audiowmark.tar.zst --strip-components=1 \
    && ./configure --prefix=/opt/audiowmark \
    && make -j"$(nproc)" \
    && make install \
    && strip /opt/audiowmark/bin/audiowmark \
    && mkdir -p /opt/audiowmark/share/doc/audiowmark \
    && cp COPYING /opt/audiowmark/share/doc/audiowmark/COPYING \
    && printf 'audiowmark %s, GPL-3.0-or-later.\nSource: https://github.com/swesterfeld/audiowmark/releases/tag/%s\n' \
         "${AUDIOWMARK_VERSION}" "${AUDIOWMARK_VERSION}" \
         > /opt/audiowmark/share/doc/audiowmark/SOURCE

# ---- Stage 5: Production Runtime ----
FROM node:26-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec

WORKDIR /app

# openssl for Prisma; ffmpeg for stem_mix draft rendering (#1189); the shared
# libraries audiowmark needs beyond what ffmpeg already brings.
RUN apt-get update -y && apt-get install -y openssl ffmpeg \
      libfftw3-single3 libsndfile1 libgcrypt20 libzita-resampler1 libmpg123-0t64 \
    && rm -rf /var/lib/apt/lists/*

# The remix render mark (#2573). The backend finds it on PATH
# (REMIX_WATERMARK_BIN defaults to `audiowmark`). The build fails here if the
# binary cannot start, so an image never ships with a mark that cannot run.
COPY --from=audiowmark /opt/audiowmark/bin/audiowmark /usr/local/bin/audiowmark
COPY --from=audiowmark /opt/audiowmark/share/doc/audiowmark /usr/share/doc/audiowmark
RUN audiowmark --version
# The mark check undoes pitch and tempo changes with ffmpeg's rubberband
# filter (#2614). Fail the build if this ffmpeg was built without it.
RUN ffmpeg -hide_banner -filters | grep -q ' rubberband '

# Copy production dependencies, Prisma schema, and generated client.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY package.json package-lock.json .npmrc ./

# Copy compiled output
COPY --from=build /app/dist ./dist

# Vendored runtime assets: the pinned Signalsmith Stretch WASM for Remix
# Studio tempo/key renders (#1898), resolved as ../../../assets from
# dist/modules/remix and sha256-checked at load.
COPY assets ./assets

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

# ---- Stage 1: Dependencies ----
FROM node:20-slim AS deps

WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json package-lock.json .npmrc ./
RUN npm install -g npm@11.14.1
RUN npm ci

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
FROM node:20-slim

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy production dependencies, Prisma schema, and generated client.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY package.json package-lock.json .npmrc ./

# Copy compiled output
COPY --from=build /app/dist ./dist

# Create uploads directory
RUN mkdir -p /app/uploads/stems && chown -R node:node /app/uploads

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER node

# Run migrations then start
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]

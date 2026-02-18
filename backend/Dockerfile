# ---- Stage 1: Build ----
FROM node:20-slim AS build

WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Stage 2: Production Runtime ----
FROM node:20-slim

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy Prisma schema + generated client (needed at runtime)
COPY prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

# Copy compiled output
COPY --from=build /app/dist ./dist

# Create uploads directory
RUN mkdir -p /app/uploads/stems && chown -R node:node /app/uploads

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER node

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

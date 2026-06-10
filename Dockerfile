FROM node:20-alpine

# Install corepack for pnpm support
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

# Copy dependency files first (for layer caching)
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

# Install all dependencies (devDeps needed for build)
RUN pnpm install --frozen-lockfile

# Copy source files
COPY . .

# Build (vite frontend + esbuild server)
RUN NODE_ENV=production pnpm run build

# Expose server port
EXPOSE 3000

# Start production server
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

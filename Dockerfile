# Build stage for client
FROM node:20-alpine AS client-builder

WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./
COPY package*.json ../

# Install dependencies
RUN npm install

# Copy client source
COPY client/ ./
COPY shared/ ../shared/

# Build client
RUN npm run build

# Build stage for server
FROM node:20-alpine AS server-builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY server/package*.json ./server/
COPY shared/package*.json ./shared/

# Install dependencies
RUN npm install

# Copy source
COPY server/ ./server/
COPY shared/ ./shared/

# Build server and shared
WORKDIR /app/shared
RUN npm run build

WORKDIR /app/server
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install puppeteer dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set puppeteer environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy package files
COPY package*.json ./
COPY server/package*.json ./server/
COPY shared/package*.json ./shared/

# Install production dependencies only
RUN npm install --production

# Copy built files
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=server-builder /app/shared/dist ./shared/dist
COPY --from=client-builder /app/client/dist ./client/dist

# Create directories
RUN mkdir -p /app/data /app/uploads /app/documents

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/requireagent.db \
    UPLOAD_DIR=/app/uploads \
    DOCUMENTS_DIR=/app/documents

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start server
WORKDIR /app/server
CMD ["node", "dist/index.js"]

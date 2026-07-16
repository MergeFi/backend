# ==========================================
# Stage 1: Base image
# ==========================================
FROM node:24-alpine AS base

# Install libc6-compat for compatibility with native modules on Alpine
RUN apk add --no-cache libc6-compat

WORKDIR /usr/src/app

# ==========================================
# Stage 2: Development dependencies and environment
# ==========================================
FROM base AS development

# Copy configuration files for dependency installation
COPY package*.json ./

# Install ALL dependencies (including devDependencies)
RUN npm ci

# Copy the rest of the application files
COPY . .

# Set default port and run watch mode for development
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# ==========================================
# Stage 3: Build the application
# ==========================================
FROM base AS builder

COPY package*.json ./

# Copy all node_modules from development stage to compile typescript
COPY --from=development /usr/src/app/node_modules ./node_modules
COPY . .

# Build the production files (calls nest build)
RUN npm run build

# ==========================================
# Stage 4: Production dependencies
# ==========================================
FROM base AS prod-deps

COPY package*.json ./

# Clean installation of production-only dependencies
RUN npm ci --omit=dev

# ==========================================
# Stage 5: Production runner
# ==========================================
FROM base AS runner

# Configure environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Set ownership of the work directory to the non-root 'node' user
RUN chown -R node:node /usr/src/app

# Use the non-root node user for security compliance
USER node

# Copy package files and production node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=prod-deps /usr/src/app/node_modules ./node_modules

# Copy the built main application bundle
COPY --chown=node:node --from=builder /usr/src/app/dist ./dist

# Expose the default NestJS port
EXPOSE 3000

# Run the production bundle
CMD ["node", "dist/main.js"]

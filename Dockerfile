# Stage 1: build the client library (no native deps needed)
FROM node:22-alpine AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app/client
COPY client/package.json ./
RUN pnpm install --ignore-scripts
COPY tsconfig.base.json /app/
COPY client/tsconfig.json ./
COPY client/src/ ./src/
RUN pnpm run build

# Stage 2: runtime
FROM node:22-alpine
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
# Copy workspace root files so pnpm can resolve the lockfile and workspace:* deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY client/package.json ./client/
COPY discord-bot/package.json ./discord-bot/
# Remove prepare so pnpm does not try to compile the client again
RUN npm pkg delete scripts.prepare --prefix client
COPY --from=builder /app/client/dist ./client/dist
# Install only discord-bot and its deps (skips foundry devDeps etc.)
RUN pnpm install --frozen-lockfile --filter discord-foundry-bot...
COPY discord-bot/src/ ./discord-bot/src/
WORKDIR /app/discord-bot
CMD ["pnpm", "start"]
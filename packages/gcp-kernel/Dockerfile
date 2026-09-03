FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.json ./
RUN pnpm install --frozen-lockfile --filter @gadgets/gcp-kernel...
ENV PORT=8080
EXPOSE 8080
CMD ["pnpm", "--filter", "@gadgets/gcp-kernel", "start"]

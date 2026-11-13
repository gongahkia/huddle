FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json NOTICE ./
COPY packages ./packages
COPY apps ./apps
COPY examples ./examples
COPY scripts ./scripts
RUN pnpm build && pnpm check:bundle

FROM node:24.21.0-bookworm-slim AS runtime
WORKDIR /app
RUN corepack enable && mkdir /data && chown node:node /data
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=build /app/dist/server.js /app/dist/cli.js ./dist/
COPY --from=build /app/dist/public ./dist/public
COPY NOTICE ./NOTICE
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 HUDDLE_DATABASE=/data/huddle.sqlite
EXPOSE 4310
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:4310/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","dist/server.js"]

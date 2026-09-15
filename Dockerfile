# ---------- 阶段1：构建前端 ----------
FROM node:22-bookworm-slim AS webbuild
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 阶段2：安装后端生产依赖（纯 JS，无原生编译） ----------
FROM node:22-bookworm-slim AS serverdeps
WORKDIR /server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- 阶段3：运行时（非 root + 健康检查） ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=8080 \
    DATA_DIR=/app/data \
    STATIC_DIR=/app/public
WORKDIR /app
RUN groupadd -r rehab && useradd -r -g rehab rehab \
  && mkdir -p /app/data && chown -R rehab:rehab /app
COPY --from=serverdeps /server/node_modules /app/server/node_modules
COPY server/package.json /app/server/package.json
COPY server/src /app/server/src
COPY --from=webbuild /web/dist /app/public
USER rehab
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]

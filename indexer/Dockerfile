FROM node:22-alpine

# 安装 Python 和构建工具（better-sqlite3 原生模块需要）
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 安装依赖
COPY indexer/package.json indexer/package-lock.json* ./
RUN npm ci --omit=dev || npm ci

# 复制源码
COPY indexer/index.js ./

RUN apk del python3 make g++


# 环境变量
ENV PKGM_USERS_DIR=/workspace/project/PKGM/users
ENV WEB_HOST=pkgm-web
ENV WEB_PORT=3001
ENV INDEXER_PORT=3004
ENV NODE_ENV=production

EXPOSE 3004

CMD ["node", "index.js"]

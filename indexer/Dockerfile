FROM node:22-alpine

WORKDIR /app

# 安装依赖
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm ci

# 复制源码
COPY index.js ./

# 环境变量
ENV PKGM_USERS_DIR=/workspace/project/PKGM/users
ENV WEB_HOST=pkgm-web
ENV WEB_PORT=3001
ENV INDEXER_PORT=3004
ENV NODE_ENV=production

EXPOSE 3004

CMD ["node", "index.js"]

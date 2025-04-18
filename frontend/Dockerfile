# 階段 1: 構建應用
FROM node:23-alpine AS builder
WORKDIR /app

# 複製依賴相關文件
COPY package*.json ./
RUN npm install

# 複製所有文件
COPY . .

# 構建應用
RUN npm run build


# 階段 2: 生產環境
FROM node:23-alpine
WORKDIR /app

# 從構建階段複製必要文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./package.json

# 環境變數
ARG NODE_ENV_ARG=${NODE_ENV_ARG_COMPOSE}
ENV NODE_ENV=${NODE_ENV_ARG}

# 開放端口
EXPOSE 3000

# 使用啟動腳本運行應用
CMD ["node", ".output/server/index.mjs"]
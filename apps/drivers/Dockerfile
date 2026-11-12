FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY service.mjs dispatch.mjs schema.sql ./
USER node
EXPOSE 3004
CMD ["node","service.mjs"]

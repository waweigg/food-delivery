FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY schema.sql service.mjs provider.mjs ./
USER node
EXPOSE 3003
CMD ["node","service.mjs"]


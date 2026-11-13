FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY delivery.mjs schema.sql dispatch.mjs kitchen.mjs admin-orders.mjs service.mjs ./
USER node
EXPOSE 3002
CMD ["node","service.mjs"]


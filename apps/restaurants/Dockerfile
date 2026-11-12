FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN RESTAURANT_DATABASE_URL=postgresql://unused:unused@localhost:5432/unused npm run generate && npm run build
USER node
EXPOSE 3001
CMD ["npm", "start"]

FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev --ignore-scripts

RUN npm install tsx

COPY . .

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "node_modules/.bin/tsx", "server/index.ts"]

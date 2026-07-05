FROM node:22-slim
WORKDIR /usr/src/app
COPY bot/package*.json ./
RUN npm ci --omit=dev
COPY bot/. .
CMD [ "node", "bot.js" ]

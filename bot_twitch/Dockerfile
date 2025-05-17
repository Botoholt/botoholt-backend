FROM node:latest
WORKDIR /usr/src/app
# VOLUME ["/usr/src/app"]
COPY bot/package*.json ./
RUN npm install
COPY bot/. .
CMD [ "node", "bot.js" ]

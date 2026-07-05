FROM node:22-slim
WORKDIR /usr/src/app
COPY v1/package*.json ./
RUN npm ci --omit=dev
COPY v1/. .
EXPOSE 3000
EXPOSE 2999
CMD [ "node", "app.js" ]

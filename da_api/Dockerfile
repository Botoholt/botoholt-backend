FROM node:22-slim
WORKDIR /usr/src/app
COPY app/package*.json ./
RUN npm ci --omit=dev
COPY app/. .
CMD [ "node", "app.js" ]

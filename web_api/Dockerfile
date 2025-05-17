FROM node:latest
WORKDIR /usr/src/app
COPY v1/. .
RUN npm install
EXPOSE 3000
EXPOSE 2999
CMD [ "node", "app.js" ]

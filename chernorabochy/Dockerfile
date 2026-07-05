FROM node:22-slim
WORKDIR /usr/src/app
COPY media_followers/package*.json ./
RUN npm ci --omit=dev
COPY media_followers/. .
# The sync is still triggered manually (docker compose exec chernorabochy node app.js);
# turning it into a scheduled job is planned for a later phase.
CMD ["sleep", "infinity"]

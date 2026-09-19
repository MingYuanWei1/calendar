FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node public ./public
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server/index.mjs"]

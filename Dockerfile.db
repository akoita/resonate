FROM node:18-alpine
WORKDIR /app
COPY db-update.js ./
RUN npm install pg
CMD ["node", "db-update.js"]

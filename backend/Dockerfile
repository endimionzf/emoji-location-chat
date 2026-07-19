FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --only=production

COPY src/ ./src/

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "start"]

FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY agent-runner.js ./

CMD ["node", "agent-runner.js"]

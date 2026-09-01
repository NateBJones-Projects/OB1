FROM node:22-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY src/ ./src/
EXPOSE 3100
CMD ["node", "--import", "tsx/esm", "src/index.ts"]

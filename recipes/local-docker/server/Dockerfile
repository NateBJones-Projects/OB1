FROM node:22-alpine

WORKDIR /app

COPY package.json .
RUN npm install

COPY index.ts .

EXPOSE 3000

CMD ["npm", "start"]

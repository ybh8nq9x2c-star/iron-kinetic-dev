FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "node_modules/.bin/serve", "-s", ".", "-p", "3000", "--no-clipboard"]

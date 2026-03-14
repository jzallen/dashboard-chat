FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production && npm install tsx

COPY . .

RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

CMD ["npx", "tsx", "index.ts"]

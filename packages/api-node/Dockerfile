# API Gateway (Node + TS)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# 👇 ADICIONE ESTA LINHA:
COPY package.json ./
COPY tsconfig.json ./
COPY openapi.yaml ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY openapi.yaml ./
RUN npm pkg delete scripts.prepare || true
RUN npm i --omit=dev
EXPOSE 3001
CMD ["node", "dist/index.js"]

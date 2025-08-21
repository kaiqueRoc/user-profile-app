# deps (com devDependencies)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# build (produção)
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.json ./
COPY openapi.yaml ./
COPY src ./src
RUN npm run build

# test (com devDependencies disponíveis)
FROM node:20-alpine AS test
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.json ./
COPY openapi.yaml ./
COPY src ./src
CMD ["npm","test"]

# runner (produção, sem dev)
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

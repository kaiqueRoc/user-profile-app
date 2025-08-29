FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
# Always run npm install (lock file removed for dynamic deps like sweetalert2)
RUN npm install

FROM node:20-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Ensure NEXT_PUBLIC_API_URL is available during Next.js build so it gets inlined into the client bundle
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json ./
RUN npm i --omit=dev
EXPOSE 3000
CMD ["npm", "start"]

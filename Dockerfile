FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY package*.json ./
# scripts 디렉토리 생성 및 스크립트 복사
RUN mkdir -p ./scripts
COPY --from=build /app/scripts/check-prisma-sync.sh ./scripts/
RUN chmod +x ./scripts/check-prisma-sync.sh
EXPOSE 8080
CMD ["sh", "-c", "./scripts/check-prisma-sync.sh && node dist/main.js"]

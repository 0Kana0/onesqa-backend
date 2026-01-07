# ---------- build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# ---------- runtime stage ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ถ้ามี build output เช่น dist
COPY --from=build /app/dist ./dist
# ถ้า worker อยู่ใน src/workers และใช้ตอนรันจริง ให้ copy มาด้วย
COPY --from=build /app/workers ./workers

EXPOSE 4000
CMD ["npm", "start"]

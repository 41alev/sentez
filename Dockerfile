# Arayüzün TAMAMI (frontend-react/, 13 ekran) Vite ile derlenir; bu,
# devDependencies (vite, @vitejs/plugin-react) gerektirir. Üretim imajına dev
# araçlarını taşımamak için ayrı bir derleme (builder) aşaması kullanılıyor —
# yalnızca derlemenin ÇIKTISI (public/dist/) son imaja kopyalanır.
# `npm run build`, ekran bazlı kod bölme için tek bir `vite build` yerine
# scripts/build-frontend.js'i çağırıyor (bkz. o dosyadaki ve
# docs/YOL-HARITASI.md §8'deki not) — vite.config.js artık YOK.
FROM node:22-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY scripts/build-frontend.js ./scripts/build-frontend.js
COPY frontend-react/ ./frontend-react/
RUN npm run build

FROM node:22-slim

# better-sqlite3 her platform için önceden derlenmiş ikili kullanır (kök
# dizindeki .npmrc: ignore-scripts=true, node-gyp'i hiç tetiklemez — bkz.
# PROJECT_STATUS.md). Bu araç normal yolda KULLANILMAZ; yalnızca bir
# platform için prebuild hiç yayınlanmamışsa devreye giren bir güvenlik ağıdır.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Bağımlılıklar önce kopyalanır: kaynak değişince npm katmanı yeniden kurulmaz
COPY package*.json ./
RUN npm ci --omit=dev

COPY server/ ./server/
COPY public/ ./public/
COPY --from=builder /app/public/dist ./public/dist

# Veritabanı ve yüklenen dosyalar kalıcı olmalı
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]

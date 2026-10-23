# Imagen para alojar Catálogo Maestro en un servidor o plataforma (Railway, Render, Fly.io, VPS).
# En servidor se usa un PostgreSQL administrado (DATABASE_URL) y un volumen persistente para las fotos.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build && npm prune --omit=dev

# /data/storage guarda las fotografías y archivos: móntalo como volumen persistente.
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]

# syntax=docker/dockerfile:1

# ── Estágio 1: build do frontend ─────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
# Copiar só os manifestos primeiro faz o npm ci ser reaproveitado do cache
# enquanto as dependências não mudarem — importante em máquina lenta.
COPY frontend/package.json frontend/package-lock.json ./
# Sem --omit=dev de propósito: o Vite é devDependency e é o que faz o build.
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Estágio 2: dependências de produção do backend ───────────────────────
FROM node:20-alpine AS backend-deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Estágio 3: imagem final ──────────────────────────────────────────────
FROM node:20-alpine

# tini: o Node como PID 1 não faz "reap" de processos filhos órfãos, então
# cada serviço parado deixava um zumbi na tabela de processos até o
# container reiniciar. tini é ~10 KB e resolve isso corretamente.
# curl: usado pelo HEALTHCHECK abaixo.
# git: usado por quem clona projetos direto pelo painel.
RUN apk add --no-cache tini curl git

WORKDIR /app

# node_modules antes do código-fonte: o código muda a cada commit, as
# dependências não — assim o rebuild reaproveita a camada pesada.
COPY --from=backend-deps /app/backend/node_modules ./backend/node_modules
COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Um único diretório de dados, com tudo dentro (banco, workspaces,
# cloudflared). A versão anterior espalhava isso entre /home/appuser/data e
# /workspaces/pterodroid/data, o que fazia o gerenciador de arquivos e os
# workspaces dos serviços apontarem para árvores diferentes.
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_ROOT=/data \
    WORKSPACES_ROOT=/data/workspaces

RUN mkdir -p /data/workspaces && chown -R node:node /data /app

# Usuário sem privilégios por padrão. Para gerenciar o Docker do host é
# preciso acesso ao socket — veja a nota sobre `group_add` no
# docker-compose.yml (preferível a rodar como root).
USER node

EXPOSE 3001

# O healthcheck é o que permite ao Docker (e ao compose, via
# service_healthy) saber que o painel está realmente respondendo, e não
# apenas que o processo subiu.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "backend/src/server.js"]

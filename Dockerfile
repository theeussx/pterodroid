# syntax=docker/dockerfile:1

# ── Estágio 1: build do frontend ─────────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
# Copiar só os manifestos primeiro faz o npm ci ser reaproveitado do cache
# enquanto as dependências não mudarem — importante em máquina lenta.
COPY apps/frontend/package.json apps/frontend/package-lock.json ./
# Sem --omit=dev de propósito: o Vite é devDependency e é o que faz o build.
RUN npm ci
COPY apps/frontend/ ./
RUN npm run build

# ── Estágio 2: dependências de produção do backend ───────────────────────
FROM node:22-alpine AS backend-deps
WORKDIR /app/backend
COPY apps/backend/package.json apps/backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Estágio 3: imagem final ──────────────────────────────────────────────
FROM node:22-alpine

# tini: o Node como PID 1 não faz "reap" de processos filhos órfãos, então
# cada serviço parado deixava um zumbi na tabela de processos até o
# container reiniciar. tini é ~10 KB e resolve isso corretamente.
# curl: usado pelo HEALTHCHECK abaixo.
# git: usado por quem clona projetos direto pelo painel.
# su-exec: entrypoint baixa de root para o usuário `node` antes de execar o
# painel (gosu nele é complexo demais; su-exec é um binário de ~10 KB e
# aceita user:gid numérico, que usamos pro grupo do docker.sock).
RUN apk add --no-cache tini curl git su-exec

WORKDIR /app

# node_modules antes do código-fonte: o código muda a cada commit, as
# dependências não — assim o rebuild reaproveita a camada pesada.
COPY --from=backend-deps /app/backend/node_modules ./apps/backend/node_modules
COPY apps/backend/ ./apps/backend/
COPY --from=frontend-builder /app/frontend/dist ./apps/frontend/dist
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Um único diretório de dados, com tudo dentro (banco, workspaces,
# cloudflared). A versão anterior espalhava isso entre /home/appuser/data e
# /workspaces/pterodroid/data, o que fazia o gerenciador de arquivos e os
# workspaces dos serviços apontarem para árvores diferentes.
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_ROOT=/data \
    WORKSPACES_ROOT=/data/workspaces

RUN mkdir -p /data/workspaces && chown -R node:node /data /app

# USER root existe só para o entrypoint conseguir ajustar o ownership do
# volume montado em /data. O painel em si NUNCA roda como root: o
# entrypoint chowna /data para node e depois baixa privilégios com su-exec
# (com o GID do docker.sock como grupo suplementar, se o socket estiver
# montado) antes de execar o tini → Node.
USER root

EXPOSE 3001

# O healthcheck é o que permite ao Docker (e ao compose, via
# service_healthy) saber que o painel está realmente respondendo, e não
# apenas que o processo subiu.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/backend/src/server.js"]

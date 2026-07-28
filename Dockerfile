# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./ 
# Removido --omit=dev para manter o Vite disponível para compilação
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the backend and serve the frontend
FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev
COPY backend/ ./

# Stage 3: Final image
FROM node:20-alpine
WORKDIR /app

# Instala pacotes necessários para monitoramento e utilitários
RUN apk add --no-cache curl git

# Cria o grupo e o usuário antes de gerenciar arquivos ou permissões
RUN addgroup --system appgroup && adduser --system appuser --ingroup appgroup

# Copia a pasta do backend para o local correto
COPY --from=backend-builder /app/backend /app/backend

# CORREÇÃO CRÚRGICA: Copia para o caminho exato exigido pelo backend (../../frontend/dist)
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

WORKDIR /app/backend

# Expose the application port
EXPOSE 3001

# Cria os diretórios necessários e ajusta as permissões antes de rodar o container
RUN mkdir -p /home/appuser/data /workspaces/pterodroid/data/projects /workspaces/pterodroid/data/files && \
    chown -R appuser:appgroup /home/appuser/data /workspaces/pterodroid/data/projects /workspaces/pterodroid/data/files /app

# Usuário padrão do container (sobrescrito por user: "root" no compose para ler o docker.sock)
USER appuser

# Configuração de variáveis de ambiente com NODE_ENV de produção ativo por padrão
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_ROOT=/home/appuser/data \
    PROJECTS_ROOT=/workspaces/pterodroid/data/projects \
    FILES_ROOT=/workspaces/pterodroid/data/files

# Command to run the application
CMD ["node", "src/server.js"]


# Stage 1: Build the frontend
FROM node:20-alpine as frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./ 
RUN npm ci --omit=dev
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the backend and serve the frontend
FROM node:20-alpine as backend-builder
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev
COPY backend/ ./

# Stage 3: Final image
FROM node:20-alpine
WORKDIR /app

# Install necessary packages for system monitoring and cloudflared (if needed)
# The original project uses `cloudflared` and reads system info from `/proc`, `/sys`
# For a Dockerized environment, `cloudflared` might be run as a sidecar or separately.
# System monitoring will be limited to the container's view of /proc and /sys.
# We'll include `curl` and `git` for potential runtime needs, though `git` might be removed for smaller image.
RUN apk add --no-cache curl git

# Copy backend and built frontend from previous stages
COPY --from=backend-builder /app/backend /app/backend
COPY --from=frontend-builder /app/frontend/dist /app/backend/frontend/dist

WORKDIR /app/backend

# Expose the application port
EXPOSE 3001

# Create a non-root user for security
RUN addgroup --system appgroup && adduser --system appuser --ingroup appgroup
USER appuser

# Create data directories and set permissions
# These paths are derived from backend/src/config.js
# We'll use /home/appuser/data for persistent data
# And /home/appuser/projects and /home/appuser/files for user projects/files
RUN mkdir -p /home/appuser/data /home/appuser/projects /home/appuser/files && \
    chown -R appuser:appgroup /home/appuser/data /home/appuser/projects /home/appuser/files

# Set environment variables (these can be overridden by docker-compose or .env)
ENV PORT=3001 \
    DATA_ROOT=/home/appuser/data \
    PROJECTS_ROOT=/home/appuser/projects \
    FILES_ROOT=/home/appuser/files

# Command to run the application
CMD ["node", "src/server.js"]

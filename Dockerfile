# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
RUN npm run build

# Serve stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Keep the container contract explicit for Coolify's Dockerfile build pack.
# Without this declaration a provider-side port/healthcheck default can point at
# a different port even though nginx is listening on 80.
EXPOSE 80

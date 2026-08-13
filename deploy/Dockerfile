# Build the SPA, then serve it from nginx. The Gemini key is NOT a build arg —
# it stays server-side in the nginx layer (see nginx.conf.template), so the
# bundle shipped to browsers never contains it.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Points the client at the same-origin proxy instead of googleapis.com.
ENV VITE_GEMINI_PROXY=/gemini
RUN npx vite build

FROM nginx:1.27-alpine
# The base image runs envsubst over /etc/nginx/templates/*.template at startup.
# The filter keeps it from mangling nginx's own $uri/$host variables.
ENV NGINX_ENVSUBST_FILTER=GEMINI_API_KEY
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

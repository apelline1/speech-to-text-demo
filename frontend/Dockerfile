# nginx-unprivileged already listens on 8080 and runs as non-root user 101.
# This makes it OpenShift-compatible out of the box (no extra chmod needed).
FROM nginxinc/nginx-unprivileged:1.25-alpine

# Replace default nginx site config with our proxy config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy all static assets
COPY index.html app.js style.css /usr/share/nginx/html/

EXPOSE 8080

FROM ghcr.io/puppeteer/puppeteer:22.6.0

# Switch to root to handle file permissions
USER root

WORKDIR /app

# COPY package.json directly to prepare installation
COPY package.json ./

# CACHE BUSTER: Increment this number if npm packages fail to update
ENV CACHE_BYPASS_VERSION=1.0.2

# Force a completely clean installation of all packages
RUN npm cache clean --force && npm install --omit=dev

# Copy the rest of your application code
COPY . .

# Assign folder permissions to the safe runner user
RUN chown -R pptruser:pptruser /app

# Switch to the safe non-root user built into the image
USER pptruser

EXPOSE 10000

CMD ["node", "index.js"]

FROM ghcr.io/puppeteer/puppeteer:22.6.0

# Switch to root to handle file permissions
USER root

WORKDIR /app

# Copy dependency mappings
COPY package*.json ./

# Standard installation of dependencies (fixes the missing lockfile error)
RUN npm install --omit=dev

# Copy all project code
COPY . .

# Assign folder permissions to the safe runner user
RUN chown -R pptruser:pptruser /app

# Switch to the safe non-root user built into the image
USER pptruser

EXPOSE 10000

CMD ["node", "index.js"]

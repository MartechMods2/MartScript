FROM ghcr.io/puppeteer/puppeteer:22.6.0

USER root

WORKDIR /app

# Copy configuration structures
COPY package*.json ./

# Perform standard dependency pass
RUN npm install --omit=dev

COPY . .

# Grant data path rights to the system account
RUN chown -R pptruser:pptruser /app

USER pptruser

EXPOSE 10000

CMD ["node", "index.js"]

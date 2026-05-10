FROM ghcr.io/puppeteer/puppeteer:latest

# Set environment variables so Puppeteer uses the installed Google Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY --chown=pptruser:pptruser package*.json ./

# Switch to root to change ownership or install packages if needed (optional)
# USER root

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY --chown=pptruser:pptruser . .

# Start the bot
CMD ["npm", "start"]

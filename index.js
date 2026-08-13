const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
// Pterodactyl passes network port mapping configurations via SERVER_PORT
const PORT = process.env.SERVER_PORT || 3000; 

// Initialize WhatsApp Client optimized for Pterodactyl's Chromium path rules
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth' // Explicit path maps to local persistent disk storage
    }),
    puppeteer: {
        // Tells Puppeteer to leverage Pterodactyl's preinstalled Linux package location
        executablePath: '/usr/bin/chromium-browser', 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

// Stream your authentication QR blocks directly to Pterodactyl's terminal interface
client.on('qr', (qr) => {
    console.log('\n==================================================');
    console.log('SCAN THIS QR CODE WITH YOUR WHATSAPP PHONE APP:');
    console.log('==================================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Success: WhatsApp Bot is active and connected!');
});

// Standard keyword chat trigger handler
client.on('message', async (msg) => {
    if (msg.body.toLowerCase() === 'hello') {
        await msg.reply('Hi there! I am your automated WhatsApp bot.');
    }
});

// Expose web port listener to avoid health monitoring execution blocks
app.get('/', (req, res) => {
    res.send('Bot Status: Active');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web server listening on port ${PORT}`);
});

client.initialize();

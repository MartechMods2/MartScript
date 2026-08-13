const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000; // Render automatically gives you this port

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        // These arguments are required so the bot can run on cloud hosts
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

// Generates QR Code in the logs
client.on('qr', (qr) => {
    console.log('SCAN THIS QR CODE WITH WHATSAPP:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp Bot is active and connected!');
});

// Simple reply logic
client.on('message', async (msg) => {
    if (msg.body.toLowerCase() === 'hello') {
        await msg.reply('Hi there! I am your automated WhatsApp bot.');
    }
});

// Web server keep-alive
app.get('/', (req, res) => {
    res.send('Bot status: Active');
});

app.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT}`);
});

client.initialize();
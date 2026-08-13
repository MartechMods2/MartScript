const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000; 

// Initialize WhatsApp Client targeting the container's global Chrome binary
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/google-chrome', // Forces the system browser to load
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

// Render the text-based QR code directly in the terminal log stream
client.on('qr', (qr) => {
    console.log('\n==================================================');
    console.log('SCAN THIS QR CODE WITH YOUR WHATSAPP PHONE APP:');
    console.log('==================================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Success: WhatsApp Bot is active and connected!');
});

// Simple test response command
client.on('message', async (msg) => {
    if (msg.body.toLowerCase() === 'hello') {
        await msg.reply('Hi there! I am your automated WhatsApp bot.');
    }
});

// Keeps the Render health checker happy so the service stays alive
app.get('/', (req, res) => {
    res.send('Bot Status: Active');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web server listening on port ${PORT}`);
});

client.initialize();

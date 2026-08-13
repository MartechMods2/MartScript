const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000; 

// Initialize WhatsApp Web Client with Docker Chrome config
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/google-chrome-stable', 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

// Display the text QR code in the Render terminal logs
client.on('qr', (qr) => {
    console.log('\n==================================================');
    console.log('SCAN THIS QR CODE WITH YOUR WHATSAPP PHONE APP:');
    console.log('==================================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Success: WhatsApp Bot is active and connected!');
});

// Basic chat command logic
client.on('message', async (msg) => {
    if (msg.body.toLowerCase() === 'hello') {
        await msg.reply('Hi there! I am your automated WhatsApp bot.');
    }
});

// HTTP listener keeps the Render background worker happy
app.get('/', (req, res) => {
    res.send('Bot Status: Active');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web server listening on port ${PORT}`);
});

client.initialize();

const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI; 

if (!MONGO_URI) {
    console.error("Error: MONGO_URI environment variable is missing!");
    process.exit(1);
}

// Connect to MongoDB Cloud Database
mongoose.connect(MONGO_URI).then(() => {
    const store = new MongoStore({ mongoose: mongoose });
    
    // Initialize WhatsApp with Remote Cloud Authentication
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 60000, 
            clientId: "martchat-session"
        }),
        puppeteer: {
            // REMOVED hardcoded executablePath! The image detects it automatically.
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', (qr) => {
        console.log('\n==================================================');
        console.log('SCAN THIS QR CODE WITH YOUR WHATSAPP PHONE APP:');
        console.log('==================================================\n');
        qrcode.generate(qr, { small: true });
    });

    client.on('remote_auth_success', () => {
        console.log('Success: Cloud Session Saved to MongoDB!');
    });

    client.on('ready', () => {
        console.log('Success: WhatsApp Bot is active and connected!');
    });

    client.on('message', async (msg) => {
        if (msg.body.toLowerCase() === 'hello') {
            await msg.reply('Hi there! I am your automated WhatsApp bot backed by cloud memory.');
        }
    });

    client.initialize();
}).catch(err => {
    console.error("MongoDB Connection Error:", err);
});

// HTTP listener keeps the Render app happy
app.get('/', (req, res) => { res.send('Bot Status: Active'); });
app.listen(PORT, '0.0.0.0', () => { console.log(`Web server listening on port ${PORT}`); });

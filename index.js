// ========================================================
// SELF-INSTALLATION BOOTSTRAPPER (FIX FOR RENDER CACHE BUG)
// ========================================================
const { execSync } = require('child_process');

console.log('Running system environment diagnostics...');
try {
    require.resolve('wwebjs-mongo');
    console.log('Module check: "wwebjs-mongo" is present.');
} catch (e) {
    console.log('Module missing from cache. Forcing production library setup...');
    try {
        execSync('npm install express mongoose qrcode-terminal whatsapp-web.js wwebjs-mongo', { 
            stdio: 'inherit',
            env: { ...process.env, NODE_ENV: 'production' }
        });
        console.log('System packages successfully configured!');
    } catch (err) {
        console.error('Package installation failed:', err.message);
        process.exit(1);
    }
}

// ========================================================
// CORE APPLICATION CODE
// ========================================================
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000; // Bind to default expected port
const MONGO_URI = process.env.MONGO_URI; 

if (!MONGO_URI) {
    console.error("Critical Error: MONGO_URI environment variable is missing in Render settings!");
    process.exit(1);
}

// Establish secure pipeline with MongoDB Atlas
mongoose.connect(MONGO_URI).then(() => {
    console.log('Successfully connected to cloud database cluster.');
    const store = new MongoStore({ mongoose: mongoose });
    
    // Initialize WhatsApp Client optimized for Puppeteer
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 60000, 
            clientId: "martchat-session"
        }),
        puppeteer: {
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        }
    });

    // Output QR code blocks to log console
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

    // Standard bot keyword responder
    client.on('message', async (msg) => {
        if (msg.body.toLowerCase() === 'hello') {
            await msg.reply('Hi there! I am your automated WhatsApp bot backed by cloud memory.');
        }
    });

    client.initialize();
}).catch(err => {
    console.error("MongoDB Connection Error:", err);
});

// Simple public endpoint for Render health checker
app.get('/', (req, res) => { res.send('Bot Status: Active'); });
app.listen(PORT, '0.0.0.0', () => { console.log(`Web server listening on port ${PORT}`); });

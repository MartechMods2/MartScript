// ========================================================
// SELF-INSTALLATION BOOTSTRAPPER (FIX FOR RENDER CACHE BUG)
// ========================================================
const { execSync } = require('child_process');

console.log('Running system environment diagnostics...');
try {
    require.resolve('wwebjs-mongo');
} catch (e) {
    console.log('Module missing from cache. Forcing production library setup...');
    try {
        execSync('npm install express mongoose qrcode-terminal whatsapp-web.js wwebjs-mongo', { 
            stdio: 'inherit',
            env: { ...process.env, NODE_ENV: 'production' }
        });
    } catch (err) {
        console.error('Bootstrapper failed:', err.message);
        process.exit(1);
    }
}

// ========================================================
// CORE APPLICATION MODULES
// ========================================================
const { Client, RemoteAuth, MessageMedia } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000; 
const MONGO_URI = process.env.MONGO_URI; 

// Memory cache tables for tracking user states & configurations
const userStates = new Map(); 
const rateLimits = new Map();
let botMutedGlobally = false;

// ========================================================
// ⚙️ CHANNELS CONFIGURATION (TAILORED FOR YOUR NUMBER)
// ========================================================
const BOT_PHONE_NUMBER = '2348140893169'; 

if (!MONGO_URI) {
    console.error("Critical Error: MONGO_URI environment variable is missing!");
    process.exit(1);
}

// Connect to MongoDB Atlas
mongoose.connect(MONGO_URI).then(() => {
    console.log('Successfully connected to cloud database cluster.');
    const store = new MongoStore({ mongoose: mongoose });
    
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 30000, 
            clientId: "martchat-session",
            dataPath: './.wwebjs_auth'
        }),
        puppeteer: {
            executablePath: '/usr/bin/google-chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        }
    });

    // ========================================================
    // 🔑 8-DIGIT SECURE PHONE PAIRING ENGINE
    // ========================================================
    client.on('qr', async () => {
        try {
            console.log(`\n⏳ Generating secure WhatsApp pairing code for ${BOT_PHONE_NUMBER}...`);
            const pairingCode = await client.requestPairingCode(BOT_PHONE_NUMBER);
            console.log('\n==================================================');
            console.log(`👉 YOUR WHATSAPP PAIRING CODE IS:  ${pairingCode}`);
            console.log('==================================================\n');
        } catch (err) {
            console.error('Failed to generate phone pairing code:', err.message);
        }
    });

    client.on('remote_auth_success', () => {
        console.log('✅ Success: Cloud Session Saved to MongoDB!');
    });

    client.on('ready', () => {
        console.log('\n==================================================');
        console.log('🚀 SUCCESS: MARTSCRIPT BOT IS ACTIVE AND ONLINE!');
        console.log('==================================================\n');
    });

    // ========================================================
    // 🧠 ADVANCED ECOSYSTEM LOGIC WORKFLOW INTERCEPTOR
    // ========================================================
    client.on('message_create', async (msg) => {
        if (msg.fromMe && !msg.body.startsWith('!')) return; 
        
        const chat = await msg.getChat();
        const contact = await msg.getContact();
        const userId = msg.from;
        const cleanMsg = msg.body.trim().toLowerCase();

        // 1. Image Transaction Receipt Notification Hook
        if (msg.hasMedia && !msg.fromMe) {
            await msg.reply('📥 *Receipt Parser:* Document payload detected. Our system will analyze the confirmation transaction code once reviewed by billing admins.');
            return;
        }

        // 2. Administrative Master Panic Switch
        if (msg.fromMe && cleanMsg === '!panic') {
            botMutedGlobally = !botMutedGlobally;
            await msg.reply(`⚠️ *System Status:* Bot responses are now *${botMutedGlobally ? 'OFF' : 'ON'}*.`);
            return;
        }
        if (botMutedGlobally) return;

        // 3. Spam Rate Limiter Safeguard
        const now = Date.now();
        if (rateLimits.has(userId) && (now - rateLimits.get(userId) < 2000)) return;
        rateLimits.set(userId, now);

        // 4. Inbound Message Human Typing Simulation
        if (!msg.fromMe) {
            await chat.sendStateTyping();
            await new Promise(resolve => setTimeout(resolve, 1200));
        }

        // 5. Group Isolation Enforcement
        if (chat.isGroup && !msg.fromMe) return;

        // 6. Context-Aware Adaptive Greeting Parser
        const greetings = ['hi', 'hello', 'hey', 'yo', 'good morning', 'good afternoon', 'baddest', 'boss'];
        if (greetings.includes(cleanMsg)) {
            userStates.set(userId, 'MAIN_MENU');
            await msg.reply(
                `👋 Hello, *${contact.pushname || 'there'}*!\n` +
                `Welcome to *MartScript Automation Hub* 🤖\n\n` +
                `Please reply with a *Number* or *Keyword* to navigate:\n\n` +
                `📝 *1* — Open Portal Menu Directory\n` +
                `💼 *2* — View Premium Services\n` +
                `💳 *3* — Get Payment & Bank Details\n` +
                `📈 *4* — Check Currency Parallel Rates\n` +
                `📞 *5* — Escalate to Owner Directly\n` +
                `🕒 *6* — Check Operational Business Timelines\n\n` +
                `_🔒 Cloud Session Secured by MongoDB Memory Layer._`
            );
            return;
        }

        // 7. Core Directory Endpoint
        if (cleanMsg === '1' || cleanMsg === '!menu') {
            userStates.set(userId, 'MAIN_MENU');
            await msg.reply(
                `🛠️ *MartScript Core Directory*:\n\n` +
                `• Type *!services* — Software development architecture\n` +
                `• Type *!pay* — Secure transaction pathways\n` +
                `• Type *!rate* — Currency data evaluation modules\n` +
                `• Type *!status* — View live container diagnostic strings`
            );
            return;
        }

        // 8. Premium Services Submenu Router
        if (cleanMsg === '2' || cleanMsg === '!services') {
            userStates.set(userId, 'SERVICES_MENU');
            await msg.reply(
                `⚡ *Available Automated Frameworks*:\n\n` +
                `• *[A]* WhatsApp Custom Automation Bots\n` +
                `• *[B]* Cloud Server Deployments & Pterodactyl Setup\n` +
                `• *[C]* Dynamic Web Backend Scraping Modules\n\n` +
                `_Reply with the letter corresponding to your selection for details._`
            );
            return;
        }

        // 9. Conditional Context Evaluation Layer
        const currentState = userStates.get(userId);
        if (currentState === 'SERVICES_MENU') {
            if (cleanMsg === 'a') {
                await msg.reply('🤖 *WhatsApp API Bots:* Includes 24/7 background hosting, database state memory persistence, and custom keyword response maps.');
                return;
            } else if (cleanMsg === 'b') {
                await msg.reply('☁️ *Cloud Server Setups:* Expert configurations for Pterodactyl hosting panels, background Docker nodes, and API network routing.');
                return;
            } else if (cleanMsg === 'c') {
                await msg.reply('💻 *Web Automation:* Scalable data scrapers, automated webhook routers, and custom database pipelines.');
                return;
            }
        }

        // 10. Localized Financial Account Dispatcher
        if (cleanMsg === '3' || cleanMsg === '!pay') {
            await msg.reply(
                `💳 *Secure Billing Pipeline*:\n\n` +
                `To proceed with your order activation, wire funds to:\n` +
                `• *Bank:* Moniepoint Bank\n` +
                `• *Account Name:* MartScript Global Services\n` +
                `• *Account Number:* 1234567890\n\n` +
                `👉 _Once completed, send your payment screenshot directly to this chat window._`
            );
            return;
        }

        // 11. Nigeria Dynamic Parallel Exchange Tracker
        if (cleanMsg === '4' || cleanMsg === '!rate') {
            await msg.reply(
                `📈 *Parallel Exchange Estimator (NGN/USD)*:\n\n` +
                `• *Buy Rate:* ₦1,610 / \$1 USD\n` +
                `• *Sell Rate:* ₦1,625 / \$1 USD\n\n` +
                `_Disclaimer: Custom local billing operations utilize these calculations for international script assets._`
            );
            return;
        }

        // 12. Support Dispatch System
        if (cleanMsg === '5' || cleanMsg === '!support') {
            await msg.reply(
                `🚀 *Support Ticket Dispatched!*\n\n` +
                `Your profile ID (*${userId.split('@')[0]}*) has been put in the priority queue. The developer will message you shortly.`
            );
            return;
        }

        // 13. Operational Timeline Matrix
        if (cleanMsg === '6' || cleanMsg === '!hours') {
            await msg.reply(
                `🕒 *MartScript System Operating Hours*:\n\n` +
                `• *Monday - Friday:* 8:00 AM - 10:00 PM [WAT]\n` +
                `• *Saturday:* 10:00 AM - 6:00 PM [WAT]\n` +
                `• *Sunday:* Closed (Background API Automated Monitoring Only)`
            );
            return;
        }
// 14. Real-Time Telemetry Hardware Metrics
        if (cleanMsg === '!status') {const uptime = process.uptime();const hours = Math.floor(uptime / 3600);const minutes = Math.floor((uptime % 3600) / 60);await msg.reply(🖥 *MartScript Cluster Telemetry*:\n\n +• *Engine Status:* Nominal (Active) ✅\n +• *Cloud State:* Synchronized (MongoDB Cloud Atlas) 🗄\n +• *Runtime Instance:* Linux Docker Container (Render Engine)\n +• *Process Uptime:* ${hours} hours, ${minutes} minutes);return;}
        // 15. Rich Digital Media Downloader Tool
        if (cleanMsg === '!flyer' || cleanMsg === '!image') {try {const media = await MessageMedia.fromUrl('picsum.photos');await chat.sendMessage(media, { caption: 'Here is our automated business overview brochure!' });} catch (err) {await msg.reply('⚠️ Asset pipeline error: Unable to retrieve flyer media from cloud array.');}return;}
        // 16. Fast Mock Crypto Snapshot
        if (cleanMsg === '!crypto' || cleanMsg === '!btc') {await msg.reply('📊 Crypto Market Snapshot: Bitcoin (BTC) is currently trading at approximately $64,250.00 USD.');return;}
        // 17. Architecture Background Core Documentation
        if (cleanMsg === '!about') {await msg.reply('🏢 About MartScript: We build industrial-grade messaging automation engines that execute tasks flawlessly across cloud server nodes 24/7.');return;}
        // 18. Dynamic State Clear Configuration
        if (cleanMsg === '!clear' || cleanMsg === 'reset') {userStates.delete(userId);await msg.reply('🔄 Your session context states have been cleared from memory arrays.');return;}
        // 19. Static Command Guide Mapping
        if (cleanMsg === '!help' || cleanMsg === 'help') {await msg.reply(💡 *MartScript Master Command Key*:\n\n +• *!menu* — Load core directory panel\n +• *!services* — Review framework list\n +• *!pay* — Display bank account configurations\n +• *!rate* — View local currency metrics\n +• *!status* — Inquire node processing states\n +• *!flyer* — Receive media documentation packages\n +• *!clear* — Wipe temporary navigation states);return;}
        // 20. Advanced AI Chat Conversation Simulator Fallback
        if (userStates.has(userId) && !['a','b','c','1','2','3','4','5','6'].includes(cleanMsg)) {await msg.reply(🤖 *MartScript Automated Assistant*:\n\n +I noticed you said: "${msg.body}". I am an automated routing process engine. \n\n +👉 Type *!menu* to view selectable navigation options, or type *!support* to transfer this chat queue to a human engineer.);}});client.initialize();}).catch(err => {console.error("MongoDB Connection Error:", err);});
// Production Web Endpoints
app.get('/', (req, res) => { res.send('MartScript Framework Core Network Node: Online.'); });app.listen(PORT, '0.0.0.0', () => { console.log(Web server listening on port ${PORT}); });

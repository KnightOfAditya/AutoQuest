// ╔══════════════════════════════════════════════════════╗
// ║     ATERNOS DISCORD BOT — v10 ULTRA                 ║
// ║     Modern Red UI • Auto-Retry Start • Smart CAPTCHA║
// ║     Made by KNIGHTOFADITYA                          ║
// ╚══════════════════════════════════════════════════════╝

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const https = require('https');

// ── Config ────────────────────────────────────────────
const CFG_FILE = path.join(__dirname, 'config.json');
function loadCFG() {
    try { if (fs.existsSync(CFG_FILE)) return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch {}
    return { token: '', aternosUser: '', aternosPass: '', aternosSession: '', serverName: '' };
}
function saveCFG(d) { fs.writeFileSync(CFG_FILE, JSON.stringify(d, null, 2), 'utf8'); }
let CFG = loadCFG();

// ── Railway / Environment Variables Override ──────────
if (process.env.TOKEN) CFG.token = process.env.TOKEN;
if (process.env.ATERNOS_USER) CFG.aternosUser = process.env.ATERNOS_USER;
if (process.env.ATERNOS_PASS) CFG.aternosPass = process.env.ATERNOS_PASS;
if (process.env.ATERNOS_SESSION) CFG.aternosSession = process.env.ATERNOS_SESSION;
if (process.env.SERVER_NAME) CFG.serverName = process.env.SERVER_NAME;


// ── Package check ────────────────────────────────────
let djs, puppeteer, StealthPlugin;
try { djs = require('discord.js'); } catch {
    console.error('❌ discord.js not found!\n   Run: npm install discord.js');
    process.exit(1);
}
try {
    puppeteer = require('puppeteer-extra');
    StealthPlugin = require('puppeteer-extra-plugin-stealth');
    // Use only the evasions that don't cause addScriptToEvaluateOnNewDocument timeouts
    const stealth = StealthPlugin();
    stealth.enabledEvasions = new Set([
        'chrome.app',
        'chrome.runtime',
        'navigator.languages',
        'navigator.permissions',
        'navigator.plugins',
        'user-agent-override',
        'webgl.vendor',
        'window.outerdimensions'
    ]);
    puppeteer.use(stealth);
    try { require('puppeteer-core'); } catch {}
} catch {
    console.error('❌ puppeteer-extra or stealth plugin not found!\n   Run: npm install puppeteer-extra puppeteer-extra-plugin-stealth puppeteer-core');
    process.exit(1);
}

// ── Chromium Path ─────────────────────────────────────
function setupChromium() {
    const candidates = [
        // Termux paths
        '/data/data/com.termux/files/usr/bin/chromium-browser',
        '/data/data/com.termux/files/usr/bin/chromium',
        // Linux / WSL standard paths
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/snap/bin/chromium',
        '/usr/local/bin/chromium',
        '/usr/local/bin/chromium-browser',
    ];

    // Try 'which' for chromium, chromium-browser, google-chrome
    for (const bin of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
        try {
            const w = spawnSync('which', [bin], { encoding: 'utf8' });
            if (w.stdout?.trim()) candidates.unshift(w.stdout.trim());
        } catch {}
    }

    for (const p of candidates) {
        if (fs.existsSync(p)) { console.log(`✅ Chromium: ${p}`); return p; }
    }

    // Last resort: use puppeteer's bundled Chromium (only available with full puppeteer, not puppeteer-core)
    try {
        const pup = require('puppeteer');
        const execPath = pup.executablePath?.();
        if (execPath && fs.existsSync(execPath)) {
            console.log(`✅ Using puppeteer bundled Chromium: ${execPath}`);
            return execPath;
        }
    } catch {}

    console.error('\n❌ Chromium not found!\n   Termux: pkg install chromium\n   Ubuntu/Debian/WSL: sudo apt install -y chromium-browser\n   Or install full puppeteer: npm install puppeteer');
    process.exit(1);
}
const chromiumPath = setupChromium();

// ── Small caps helper ────────────────────────────────
const _M = {a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'ꜱ',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'};
const sc = t => String(t||'').toLowerCase().split('').map(c=>_M[c]||c).join('');

// ── Discord.js imports ────────────────────────────────
const {
    Client, GatewayIntentBits, REST, Routes,
    ContainerBuilder, ButtonBuilder, ButtonStyle,
    MessageFlags, SeparatorSpacingSize,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = djs;

const EPH  = MessageFlags.Ephemeral;
const CV2  = MessageFlags.IsComponentsV2;
const FLAGS = { flags: [CV2, EPH] };

// ── UI Helpers ─────────────────────────────────────────
// Custom Discord emojis
const EMOJI_ONLINE  = '<a:online5:1490944088155881572>';
const EMOJI_OFFLINE = '<a:offline:1493462926793904168>';
const EMOJI_INFO    = '<:info:1495717180434813001>';

function statusEmoji(s) {
    const st = s?.toLowerCase();
    if (st === 'online')  return EMOJI_ONLINE;
    if (st === 'offline') return EMOJI_OFFLINE;
    if (st === 'starting' || st === 'loading' || st === 'preparing') return '🟡';
    if (st === 'stopping') return '🟠';
    if (st === 'waiting')  return '🔵';
    return '❓';
}
function statusBar(s) {
    const bars = { online:'▰▰▰▰▰ `100%`', starting:'▰▰▰▰▱ `80%`', loading:'▰▰▰▱▱ `60%`', preparing:'▰▰▰▱▱ `60%`', waiting:'▰▰▱▱▱ `40%`', stopping:'▰▰▱▱▱ `40%`', offline:'▱▱▱▱▱ `0%`' };
    return bars[s?.toLowerCase()] || '▱▱▱▱▱ `0%`';
}
function detectEdition(info) {
    const soft = (info?.software||'').toLowerCase();
    if (/bedrock|nukkit|pocketmine|pmmp/.test(soft)) return 'Bedrock';
    return (info?.port == 19132) ? 'Bedrock' : 'Java';
}
function uptimeStr() {
    const s = Math.floor(process.uptime());
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), ss = s%60;
    return h ? `${h}h ${m}m` : m ? `${m}m ${ss}s` : `${ss}s`;
}

// ══════════════════════════════════════════════════════
// ── Build Panel (Components V2)
// ══════════════════════════════════════════════════════
function buildPanel(info=null, err=null, serverList=[], loading=false, loggedOut=false) {
    const c = new ContainerBuilder();
    const footer = (extra='') =>
        `-# ⏱ \`${uptimeStr()}\`${extra}  •  *Made by* **KNIGHTOFADITYA**`;

    // Only show Login button when logged out, otherwise show Logout
    const addAuthRow = (container) => {
        if (loggedOut) {
            container.addActionRowComponents(row => row.addComponents(
                new ButtonBuilder().setCustomId('at_manual_login').setLabel('🔑 Login').setStyle(ButtonStyle.Primary)
            ));
        } else {
            container.addActionRowComponents(row => row.addComponents(
                new ButtonBuilder().setCustomId('at_manual_login').setLabel('🔑 Manual Login').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('at_logout').setLabel('🚪 Logout').setStyle(ButtonStyle.Danger)
            ));
        }
    };

    // ── Loading View
    if (loading) {
        c.addTextDisplayComponents(t => t.setContent(`## 🔴 ATERNOS CONTROL PANEL`));
        c.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        c.addTextDisplayComponents(t => t.setContent(`⏳ **Fetching servers...** Please wait...`));
        c.addTextDisplayComponents(t => t.setContent(footer()));
        return { ...FLAGS, components: [c] };
    }

    // ── Error View
    if (err) {
        c.addTextDisplayComponents(t => t.setContent(`## 🔴 ATERNOS CONTROL PANEL`));
        c.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        c.addTextDisplayComponents(t => t.setContent(`❌ **Error:**\n\`\`\`${err}\`\`\``));
        c.addTextDisplayComponents(t => t.setContent(
            `> 💡 CAPTCHA / session issue? → Use **Manual Login**\n` +
            `> 💡 Session expired? → Logout, then re-login via Manual Login`
        ));
        c.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        c.addActionRowComponents(row => row.addComponents(
            new ButtonBuilder().setCustomId('at_refresh').setLabel('🔄 Retry').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('at_manual_login').setLabel('🔑 Manual Login').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('at_logout').setLabel('🚪 Logout').setStyle(ButtonStyle.Danger)
        ));
        c.addTextDisplayComponents(t => t.setContent(footer()));
        return { ...FLAGS, components: [c] };
    }

    // ── Server List View
    if (serverList.length > 0 && !info) {
        const onlineCount  = serverList.filter(s => s.status === 'online').length;
        const offlineCount = serverList.filter(s => s.status === 'offline').length;
        const otherCount   = serverList.length - onlineCount - offlineCount;

        c.addTextDisplayComponents(t => t.setContent(`## 🔴 ATERNOS CONTROL PANEL`));
        c.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        c.addTextDisplayComponents(t => t.setContent(
            `${EMOJI_ONLINE} Online: \`${onlineCount}\`   ${EMOJI_OFFLINE} Offline: \`${offlineCount}\`   🟡 Other: \`${otherCount}\`   📊 Total: \`${serverList.length}\``
        ));
        c.addSeparatorComponents(s => s.setDivider(false).setSpacing(SeparatorSpacingSize.Small));

        serverList.forEach(s => {
            const soft  = s.software ? `  \`${s.software}\`` : '';
            const barMap = { online:'▰▰▰▰▰', starting:'▰▰▰▰▱', offline:'▱▱▱▱▱', waiting:'▰▰▱▱▱', stopping:'▰▰▱▱▱' };
            const bar   = barMap[s.status?.toLowerCase()] || '▱▱▱▱▱';
            c.addTextDisplayComponents(t => t.setContent(
                `${statusEmoji(s.status)} **${s.name}**${soft}   \`${bar}\`\n` +
                `${EMOJI_INFO} \`${s.ip}\``
            ));
        });

        c.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        c.addActionRowComponents(row => row.addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('at_select_server')
                .setPlaceholder('🖱️ Select a server...')
                .addOptions(serverList.slice(0, 25).map(s => {
                    const opt = new StringSelectMenuOptionBuilder()
                        .setLabel(s.name.slice(0, 100))
                        .setDescription(`${(s.ip||'aternos.me').slice(0,80)} • ${s.status.toUpperCase()}`)
                        .setValue(s.id);
                    if (s.status === 'online')       opt.setEmoji({ id:'1490944088155881572', name:'online5',  animated:true });
                    else if (s.status === 'offline') opt.setEmoji({ id:'1493462926793904168', name:'offline',  animated:true });
                    else                             opt.setEmoji('🟡');
                    return opt;
                }))
        ));
        c.addSeparatorComponents(s => s.setDivider(false).setSpacing(SeparatorSpacingSize.Small));
        c.addActionRowComponents(row => row.addComponents(
            new ButtonBuilder().setCustomId('at_refresh').setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary)
        ));
        addAuthRow(c);
        c.addTextDisplayComponents(t => t.setContent(footer('  •  ⬇️ Select a server below')));
        return { ...FLAGS, components: [c] };
    }

    // ── No servers found
    if (!info && !err) {
        c.addTextDisplayComponents(t => t.setContent(`## 🔴 ATERNOS CONTROL PANEL`));
        c.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        c.addTextDisplayComponents(t => t.setContent(
            `⚠️ **No servers found.**\n` +
            `> 🔑 Use **Manual Login** to sign in to your Aternos account`
        ));
        c.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        c.addActionRowComponents(row => row.addComponents(
            new ButtonBuilder().setCustomId('at_refresh').setLabel('🔄 Retry').setStyle(ButtonStyle.Secondary)
        ));
        addAuthRow(c);
        c.addTextDisplayComponents(t => t.setContent(footer()));
        return { ...FLAGS, components: [c] };
    }

    // ── Server Control View
    const edition  = detectEdition(info);
    const isOnline   = info?.status === 'online';
    const isStarting = ['starting','loading','preparing','waiting'].includes(info?.status);
    const isOffline  = info?.status === 'offline';
    const statusUp   = (info?.status || 'unknown').toUpperCase();
    const srvName    = info?.name || info?.id || '...';
    // Strip any trailing domain / extra text from IP — just keep host
    const rawIp      = (info?.ip || '...').split(/\s/)[0];
    const software   = info?.software || '...';
    const version    = info?.version  ? ` ${info.version}` : '';
    const players    = info?.players  || '0';
    const srvId      = info?.id       || '...';

    c.addTextDisplayComponents(t => t.setContent(
        `## 🔴 SERVER CONTROL — **${srvName}**`
    ));
    c.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    c.addTextDisplayComponents(t => t.setContent(
        `${statusEmoji(info?.status)} **Status:** \`${statusUp}\`   ${statusBar(info?.status)}`
    ));
    c.addTextDisplayComponents(t => t.setContent(
        `${edition === 'Java' ? '☕' : '💎'} **Edition:** \`${edition === 'Java' ? 'Java' : 'Bedrock'}\``
    ));
    c.addTextDisplayComponents(t => t.setContent(
        `${EMOJI_INFO} **Address:** \`${rawIp}\``
    ));
    c.addSeparatorComponents(s => s.setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents(t => t.setContent(
        `> 🛠️ **Software:** \`${software}${version}\`\n` +
        `> 👥 **Players:** \`${players} / 20\`\n` +
        `> 🔢 **Server ID:** \`${srvId}\``
    ));
    c.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const kaOn = Aternos.isKeepAlive(info?.id);
    c.addActionRowComponents(row => row.addComponents(
        new ButtonBuilder().setCustomId(`at_start_${info?.id}`)
            .setLabel(isStarting ? '⏳ Starting...' : '▶ Start')
            .setStyle(ButtonStyle.Success).setDisabled(isOnline || isStarting),
        new ButtonBuilder().setCustomId(`at_stop_${info?.id}`)
            .setLabel('⏹ Stop')
            .setStyle(ButtonStyle.Danger).setDisabled(isOffline || isStarting),
        new ButtonBuilder().setCustomId(`at_refresh_${info?.id}`)
            .setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('at_back')
            .setLabel('🔙 Back').setStyle(ButtonStyle.Secondary)
    ));
    c.addActionRowComponents(row => row.addComponents(
        new ButtonBuilder()
            .setCustomId((kaOn ? 'at_ka_off_' : 'at_ka_on_') + info?.id)
            .setLabel(kaOn ? '🔕 KeepAlive: ON  (click to stop)' : '🔔 KeepAlive: OFF (click to start)')
            .setStyle(kaOn ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(isOffline)
    ));
    addAuthRow(c);
    c.addTextDisplayComponents(t => t.setContent(footer(isStarting ? '  •  🔄 Auto-refreshing...' : '')));
    return { ...FLAGS, components: [c] };
}

// ── "Starting..." panel shown while polling
function buildStartingPanel(info, pollNum=0) {
    const c = new ContainerBuilder();
    const totalBars = 10;
    const filled = Math.min(pollNum + 1, totalBars);
    const bar = '▰'.repeat(filled) + '▱'.repeat(totalBars - filled);
    const secsWaited = (pollNum + 1) * 6;
    const statusText = ['starting','loading','preparing','waiting'].includes(info?.status)
        ? (info.status.toUpperCase())
        : 'STARTING...';

    c.addTextDisplayComponents(t => t.setContent(
        `## 🔴 SERVER STARTING\n\n` +
        `> 🟡 **Status:** \`${statusText}\`\n` +
        `> 📡 **Address:** \`${info?.ip||'...'}\`\n` +
        `> 🛠️ **Software:** \`${info?.software||'...'}\`\n\n` +
        `> ⏳ **Progress:** \`${bar}\`\n` +
        `> ⏱ **Time waited:** \`~${secsWaited}s\` / \`120s\`\n\n` +
        `> 💡 Aternos servers take a moment to start. Please wait...\n\n` +
        `-# Start was clicked once — polling status • *Made by* **KNIGHTOFADITYA**`
    ));
    c.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    c.addActionRowComponents(row => row.addComponents(
        new ButtonBuilder().setCustomId(`at_refresh_${info?.id}`)
            .setLabel('🔄 Check Status Now')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('at_back')
            .setLabel('🔙 Back')
            .setStyle(ButtonStyle.Secondary)
    ));
    return { ...FLAGS, components: [c] };
}

// ══════════════════════════════════════════════════════
// ── Aternos Core — Puppeteer
// ══════════════════════════════════════════════════════
const Aternos = {
    cookies: null,
    user: null,
    _browser: null,
    _keepAlive: {},   // { serverId: { active, timer } }

    startKeepAlive(serverId) {
        if (this._keepAlive[serverId] && this._keepAlive[serverId].active) return;
        this._keepAlive[serverId] = { active: true, timer: null };
        const self = this;
        const loop = async () => {
            if (!self._keepAlive[serverId] || !self._keepAlive[serverId].active) return;
            try {
                await self.ensureSession();
                const browser = await self.getBrowser();
                const page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36');
                if (self.cookies) await page.setCookie(...self.cookies);
                try {
                    await self._gotoServer(page, serverId);
                    await new Promise(r => setTimeout(r, 4000));
                    const result = await page.evaluate(() => {
                        function fireClick(el) {
                            ['mousedown','mouseup','click'].forEach(function(ev) {
                                el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }));
                            });
                            el.click();
                        }

                        // PRIMARY: exact selectors from Aternos HTML structure
                        const primary = [
                            '.end-countdown .extend button',
                            '.end-countdown button',
                            '.extend button',
                            '.extend .btn',
                            'div.extend button'
                        ];
                        for (var i = 0; i < primary.length; i++) {
                            var btn = document.querySelector(primary[i]);
                            if (btn) { fireClick(btn); return 'clicked:' + primary[i]; }
                        }

                        // FALLBACK: any button/element with +1 text anywhere on page
                        var allEls = Array.from(document.querySelectorAll('button, a, span, div'));
                        var plus = allEls.find(function(el) {
                            return el.textContent.trim() === '+1';
                        });
                        if (plus) { fireClick(plus); return 'clicked:+1-text:' + plus.tagName; }

                        // DIAGNOSIS if still not found
                        var timer = document.querySelector('.end-countdown, #countdown, .countdown, [class*="countdown"]');
                        return timer ? 'timer-html:' + timer.outerHTML.slice(0, 300) : 'no-timer';
                    });
                    if (result.startsWith('clicked')) {
                            } else {
                        }
                } finally {
                    await page.close().catch(function() {});
                }
            } catch (e) {
            }
            if (self._keepAlive[serverId] && self._keepAlive[serverId].active) {
                self._keepAlive[serverId].timer = setTimeout(loop, 30000);
            }
        };
        this._keepAlive[serverId].timer = setTimeout(loop, 20000);
    },

    stopKeepAlive(serverId) {
        if (this._keepAlive[serverId]) {
            this._keepAlive[serverId].active = false;
            clearTimeout(this._keepAlive[serverId].timer);
            delete this._keepAlive[serverId];
            }
    },

    isKeepAlive(serverId) {
        return !!(this._keepAlive[serverId] && this._keepAlive[serverId].active);
    },

    async getBrowser() {
        if (this._browser && this._browser.connected) return this._browser;
        this._browser = await puppeteer.launch({
            headless: true,
            executablePath: chromiumPath,
            protocolTimeout: 120000,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-gpu', '--no-zygote',
                '--disable-extensions', '--disable-background-networking',
                '--disable-default-apps', '--mute-audio',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        this._browser.on('disconnected', () => { this._browser = null; });
        return this._browser;
    },

    async login() {
        const browser = await this.getBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36');

        try {
            if (CFG.aternosSession) {
                await page.setCookie({ name: 'ATERNOS_SESSION', value: CFG.aternosSession, domain: '.aternos.org' });
                await page.goto('https://aternos.org/servers/', { waitUntil: 'domcontentloaded', timeout: 30000 });
                const isLoggedIn = await page.evaluate(() => !!document.querySelector('.servercard, .server-list, .servercardlist'));
                if (isLoggedIn) {
                    this.cookies = await page.cookies();
                    this.user = CFG.aternosUser;
                    await page.close();
                    return;
                }
            }

            if (!CFG.aternosUser || !CFG.aternosPass) {
                await page.close();
                throw new Error('Credentials missing! Use `/setup` to set username/password or use Manual Login.');
            }

            await page.goto('https://aternos.org/go/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => {
                if (!e.message.includes('ERR_ABORTED')) throw e;
            });

            await page.waitForSelector('input.username, .servercard, .servercardlist', { timeout: 15000 }).catch(() => {});

            const onLogin = await page.evaluate(() => !!document.querySelector('input.username'));
            if (onLogin) {
                await page.type('input.username', CFG.aternosUser, { delay: 50 });
                await page.type('input.password', CFG.aternosPass, { delay: 50 });
                await page.keyboard.press('Enter');
                await page.waitForNavigation({ timeout: 20000, waitUntil: 'domcontentloaded' }).catch(() => {});
                await page.waitForSelector('.servercard, .h-captcha, .login-error, .servercardlist', { timeout: 10000 }).catch(() => {});

                const hasCaptcha = await page.evaluate(() => !!document.querySelector('.h-captcha, iframe[src*="hcaptcha"]'));
                if (hasCaptcha) {
                    await page.close();
                    throw new Error('CAPTCHA detected! 🔑 Use the Manual Login button or set a session cookie.');
                }
                const hasError = await page.evaluate(() => {
                    const e = document.querySelector('.login-error, .alert-danger');
                    return e ? e.textContent.trim() : null;
                });
                if (hasError) { await page.close(); throw new Error(`Login failed: ${hasError}`); }
            }

            this.cookies = await page.cookies();
            this.user = CFG.aternosUser;
        } finally {
            await page.close().catch(() => {});
        }
    },

    async ensureSession() {
        if (this.cookies) return;
        await this.login();
    },

    async _gotoServer(page, serverId) {
        // Always go via server list and click the card — most reliable method
        await page.goto('https://aternos.org/servers/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForSelector('.servercard', { timeout: 15000 }).catch(() => {});

        const clicked = await page.evaluate((id) => {
            const cards = Array.from(document.querySelectorAll('.servercard'));
            // Exact match first
            for (const card of cards) {
                const nameEl = card.querySelector('.server-name');
                const cardName = (nameEl?.textContent?.trim() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cardName === id) { card.click(); return 'name-match:' + cardName; }
            }
            // Partial match fallback
            for (const card of cards) {
                const nameEl = card.querySelector('.server-name');
                const cardName = (nameEl?.textContent?.trim() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cardName.includes(id) || id.includes(cardName)) { card.click(); return 'partial-match:' + cardName; }
            }
            return false;
        }, serverId);

        if (!clicked) throw new Error(`Server "${serverId}" not found! Go back and select again.`);
        // Wait for URL to change away from /servers/ (card click triggers navigation)
        try {
            await page.waitForFunction(
                () => !window.location.pathname.startsWith('/servers'),
                { timeout: 15000 }
            );
        } catch {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        }
        // Wait for server control elements to appear
        await page.waitForSelector('#start, #stop, .statuslabel', { timeout: 15000 }).catch(() => {});
        // Extra wait for Aternos JS to fully initialize page controls
        await new Promise(r => setTimeout(r, 2500));
        return true;
    },

    async getServerList() {
        await this.ensureSession();
        const browser = await this.getBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36');

        try {
            if (this.cookies) await page.setCookie(...this.cookies);

            await page.goto('https://aternos.org/servers/', { waitUntil: 'networkidle2', timeout: 45000 }).catch(() =>
                page.goto('https://aternos.org/servers/', { waitUntil: 'domcontentloaded', timeout: 30000 })
            );

            await page.waitForSelector('.servercardlist, .servercard', { timeout: 15000 }).catch(() => {});

            const needsLogin = await page.evaluate(() =>
                !!document.querySelector('input[name="user"], input.username, #user')
            ).catch(() => false);
            if (needsLogin) {
                this.cookies = null;
                throw new Error('Session expired! 🔑 Use the Manual Login button.');
            }

            const list = await page.evaluate(() => {
                const cards = Array.from(document.querySelectorAll('.servercard'));
                return cards.map(card => {
                    const cl = card.className || '';
                    let status = 'offline';
                    if (/\bonline\b/.test(cl))   status = 'online';
                    else if (/\bstarting\b|\bpreparing\b|\bloading\b/.test(cl)) status = 'starting';
                    else if (/\bstopping\b/.test(cl)) status = 'stopping';
                    else if (/\bwaiting\b/.test(cl))  status = 'waiting';
                    const name     = card.querySelector('.server-name')?.textContent?.trim() || 'Unknown';
                    const id       = name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'server';
                    const ip       = id + '.aternos.me';
                    const software = card.querySelector('.server-software-name')?.textContent?.trim() || '';
                    return { id, name, status, ip, software, version: '', players: '0' };
                }).filter(s => s.name && s.name !== 'Unknown');
            });

            if (!list.length) throw new Error('No servers found. Check your credentials via `/setup`.');
            return list;

        } finally {
            await page.close().catch(() => {});
        }
    },

    async getServerInfo(serverId) {
        await this.ensureSession();
        const browser = await this.getBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36');

        try {
            if (this.cookies) await page.setCookie(...this.cookies);
            await this._gotoServer(page, serverId);

            await page.waitForSelector(
                '#start, #stop, .statuslabel, .server-ip, .server-status',
                { timeout: 15000 }
            ).catch(() => {});

            return await page.evaluate((sId) => {
                const getText = (...sels) => {
                    for (const s of sels) {
                        const el = document.querySelector(s);
                        if (el?.textContent?.trim()) return el.textContent.trim();
                    }
                    return '';
                };

                let status = 'offline';
                const statusLabel = document.querySelector('.statuslabel');
                const startBtn = document.querySelector('#start');
                const stopBtn  = document.querySelector('#stop');

                if (statusLabel) {
                    const cl = statusLabel.className;
                    const st = statusLabel.textContent.toLowerCase();
                    if (/\bonline\b/.test(cl) || /online|running/.test(st)) status = 'online';
                    else if (/\bstarting\b|\bpreparing\b|\bloading\b/.test(cl) || /start|load|prepar/.test(st)) status = 'starting';
                    else if (/\bstopping\b/.test(cl) || /stopping/.test(st)) status = 'stopping';
                    else if (/\bwaiting\b/.test(cl) || /waiting/.test(st)) status = 'waiting';
                } else if (stopBtn && stopBtn.offsetParent !== null) {
                    status = 'online';
                } else if (startBtn && startBtn.offsetParent !== null) {
                    status = 'offline';
                }

                const ip       = getText('#server-ip', '.server-ip', '#ip', '.ip') ||
                    document.title.match(/([a-z0-9-]+\.aternos\.me)/i)?.[1] ||
                    sId + '.aternos.me';
                const software = getText('#software', '.software-name', '.server-software', '.server-software-name') || 'Unknown';
                const version  = getText('#version', '.version-name', '.server-version') || '';
                const players  = getText('.js-players', '#players', '.players-count') || '0';
                const name     = document.title.split('|')[0].trim() || sId;

                return { id: sId, status, ip, port: '25565', software, version, players, name };
            }, serverId);

        } finally {
            await page.close().catch(() => {});
        }
    },

    // ── Start/Stop with auto-retry for start
    async manage(serverId, task) {
        await this.ensureSession();
        const browser = await this.getBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36');

        try {
            if (this.cookies) await page.setCookie(...this.cookies);
            await this._gotoServer(page, serverId);

            if (task === 'start') {
                // Wait for start button to be visible and clickable
                await page.waitForFunction(() => {
                    const btn = document.querySelector('#start');
                    return btn && btn.offsetParent !== null && !btn.disabled;
                }, { timeout: 15000 }).catch(() => {});

                // Extra wait for page JS to fully initialize
                await new Promise(r => setTimeout(r, 1000));

                const clicked = await page.evaluate(() => {
                    const btn = document.querySelector('#start');
                    if (btn && btn.offsetParent !== null && !btn.disabled) { btn.click(); return true; }
                    const allBtns = Array.from(document.querySelectorAll('button, a[class*="btn"]'));
                    const sb = allBtns.find(b => /^start$/i.test(b.textContent.trim()));
                    if (sb) { sb.click(); return true; }
                    return false;
                });
                if (!clicked) throw new Error('Start button not found!');

                // Wait for page to react to the click
                await new Promise(r => setTimeout(r, 3000));

                // Handle any confirmation/accept modal that may appear
                await page.evaluate(() => {
                    const allBtns = Array.from(document.querySelectorAll('button, a[class*="btn"]'));
                    const confirm = allBtns.find(b => /accept|confirm|okay|yes|agree|i.?understand/i.test(b.textContent));
                    if (confirm) { confirm.click(); return true; }
                    return false;
                }).catch(() => {});


            } else {
                await page.waitForFunction(() => {
                    const btn = document.querySelector('#stop');
                    return btn && btn.offsetParent !== null;
                }, { timeout: 15000 }).catch(() => {});

                const clicked = await page.evaluate(() => {
                    const btn = document.querySelector('#stop');
                    if (btn && btn.offsetParent !== null) { btn.click(); return true; }
                    const allBtns = Array.from(document.querySelectorAll('button, a[class*="btn"]'));
                    const sb = allBtns.find(b => /^stop$/i.test(b.textContent.trim()));
                    if (sb) { sb.click(); return true; }
                    return false;
                });
                if (!clicked) throw new Error('Stop button not found!');
            }

            return true;
        } finally {
            await page.close().catch(() => {});
        }
    },

    // ── Start server: click once, return immediately (user refreshes manually)
    async startWithRetry(serverId, interaction) {
        const info = await this.getServerInfo(serverId).catch(() => ({
            id: serverId, status: 'offline', ip: serverId + '.aternos.me',
            software: '...', name: serverId, players: '0', version: '', port: '25565'
        }));
        info.id = serverId;
        if (['online', 'starting', 'loading', 'preparing', 'waiting'].includes(info.status)) {
            return info;
        }
        await this.manage(serverId, 'start');
        info.status = 'starting';
        return info;
    }
};

// ══════════════════════════════════════════════════════
// ── Manual Login — Modern Red Web UI
// ══════════════════════════════════════════════════════
let manualServer = null;
let manualBrowser = null;
let manualPage = null;

async function startManualLogin(interaction) {
    if (manualServer) {
        const c2 = new ContainerBuilder();
        c2.addTextDisplayComponents(t => t.setContent(
            `## 🔴 MANUAL LOGIN — Already Running\n\n` +
            `> ⚠️ **Browser is already running!**\n\n` +
            `> 🔗 Open this link in your browser:\n` +
            `> ### \`http://127.0.0.1:3000\`\n\n` +
            `-# Use the tab that is already open. *Made by* **KNIGHTOFADITYA**`
        ));
        return interaction.editReply({ ...FLAGS, components: [c2] });
    }

    const app = express();
    const port = 3000;

    try {
        manualBrowser = await puppeteer.launch({
            headless: true,
            executablePath: chromiumPath,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-gpu', '--no-zygote', '--single-process',
                '--disable-blink-features=AutomationControlled', '--window-size=1280,800'
            ]
        });

        manualPage = await manualBrowser.newPage();
        await manualPage.setViewport({ width: 1280, height: 800 });
        await manualPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36');
        await manualPage.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
        await manualPage.goto('https://aternos.org/go/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        // ── Web UI HTML (Modern Red Theme)
        app.get('/', (req, res) => {
            res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aternos Remote • Manual Login</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0606;
  --surface:#110909;
  --panel:#180d0d;
  --border:#2d1515;
  --red:#e03131;
  --red2:#ff6b6b;
  --red-glow:rgba(224,49,49,.18);
  --amber:#ffa94d;
  --green:#69db7c;
  --blue:#74c0fc;
  --text:#f1e6e6;
  --muted:#6e4f4f;
  --font:'DM Sans',sans-serif;
  --display:'Bebas Neue',sans-serif;
  --mono:'JetBrains Mono',monospace;
}
body{
  background:var(--bg);color:var(--text);font-family:var(--font);
  height:100vh;display:flex;flex-direction:column;overflow:hidden;
  background-image:
    radial-gradient(ellipse 80% 60% at 50% -10%, rgba(224,49,49,.12), transparent),
    repeating-linear-gradient(0deg, transparent, transparent 59px, rgba(255,255,255,.02) 60px),
    repeating-linear-gradient(90deg, transparent, transparent 59px, rgba(255,255,255,.02) 60px);
}

/* ── Topbar */
.topbar{
  background:rgba(17,9,9,.9);
  border-bottom:1px solid var(--border);
  padding:8px 14px;display:flex;align-items:center;gap:8px;flex-shrink:0;
  backdrop-filter:blur(12px);position:relative;
  box-shadow:0 1px 0 rgba(224,49,49,.2);
}
.logo{
  font-family:var(--display);font-size:20px;letter-spacing:3px;color:var(--red);
  margin-right:auto;display:flex;align-items:center;gap:8px;text-shadow:0 0 20px var(--red-glow);
}
.logo-dot{width:8px;height:8px;border-radius:50%;background:var(--red);box-shadow:0 0 8px var(--red);animation:blink 1.2s ease-in-out infinite}
@keyframes blink{0%,100%{opacity:1;box-shadow:0 0 8px var(--red)}50%{opacity:.3;box-shadow:0 0 2px var(--red)}}

.urlbar{
  background:var(--panel);border:1px solid var(--border);border-radius:6px;
  padding:5px 12px;font-size:11px;color:var(--muted);font-family:var(--mono);
  max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;
  transition:all .2s;
}
.urlbar.active{border-color:var(--red);color:var(--red2);box-shadow:0 0 0 2px rgba(224,49,49,.15)}

/* ── Buttons */
.btn{
  padding:6px 13px;border-radius:6px;border:none;font-family:var(--font);
  font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;
  display:flex;align-items:center;gap:5px;white-space:nowrap;letter-spacing:.3px;
}
.btn:hover{filter:brightness(1.2);transform:translateY(-1px)}
.btn:active{transform:translateY(0);filter:brightness(.95)}
.btn-red{background:linear-gradient(135deg,#e03131,#9b1a1a);color:#fff;box-shadow:0 2px 12px rgba(224,49,49,.3)}
.btn-amber{background:linear-gradient(135deg,#ffa94d,#e67700);color:#000}
.btn-green{background:linear-gradient(135deg,#69db7c,#2f9e44);color:#000}
.btn-dark{background:var(--panel);color:var(--text);border:1px solid var(--border)}
.btn-dark:hover{border-color:var(--red);color:var(--red2)}
.btn-blue{background:linear-gradient(135deg,#74c0fc,#1971c2);color:#fff}

/* ── Viewport */
.viewport{flex:1;position:relative;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center}
#screen{
  max-width:100%;max-height:100%;object-fit:contain;cursor:crosshair;display:block;
  transition:opacity .15s;
  box-shadow:0 0 60px rgba(0,0,0,.8);
}
#screen.loading{opacity:.4}

/* ── Click ripple */
.ripple{
  position:absolute;width:32px;height:32px;border-radius:50%;
  border:2px solid var(--red);animation:ripple .5s ease-out forwards;
  pointer-events:none;transform:translate(-50%,-50%);
}
.ripple-inner{
  position:absolute;width:10px;height:10px;border-radius:50%;
  background:var(--red);opacity:.6;animation:ripple-in .5s ease-out forwards;
  pointer-events:none;transform:translate(-50%,-50%);
}
@keyframes ripple{0%{transform:translate(-50%,-50%) scale(0);opacity:1}100%{transform:translate(-50%,-50%) scale(3);opacity:0}}
@keyframes ripple-in{0%{transform:translate(-50%,-50%) scale(1);opacity:.6}100%{transform:translate(-50%,-50%) scale(0);opacity:0}}

/* ── CAPTCHA Detection Banner */
.captcha-banner{
  display:none;
  background:linear-gradient(135deg,rgba(255,107,107,.15),rgba(224,49,49,.1));
  border-bottom:1px solid rgba(255,107,107,.4);
  padding:8px 16px;align-items:center;gap:10px;
  font-size:12px;color:var(--red2);font-weight:600;flex-shrink:0;
  animation:slideIn .3s ease;
}
.captcha-banner.show{display:flex}
@keyframes slideIn{from{transform:translateY(-100%)}to{transform:translateY(0)}}
.captcha-badge{
  background:var(--red);color:#fff;border-radius:4px;padding:2px 8px;
  font-family:var(--mono);font-size:10px;letter-spacing:1px;
}

/* ── Type overlay — now AUTO shows on captcha/input clicks */
.type-overlay{
  position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);
  display:none;z-index:300;align-items:center;justify-content:center;
}
.type-overlay.show{display:flex}
.type-box{
  background:var(--surface);border:1px solid var(--red);border-radius:16px;
  padding:28px;width:440px;max-width:95vw;
  box-shadow:0 0 80px rgba(224,49,49,.25),0 4px 40px rgba(0,0,0,.6);
  animation:popIn .2s cubic-bezier(.34,1.56,.64,1);
}
@keyframes popIn{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}
.type-box-header{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.type-box-icon{width:36px;height:36px;border-radius:8px;background:rgba(224,49,49,.2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.type-box h3{font-size:15px;color:var(--red2);font-family:var(--mono);font-weight:600}
.type-box p{font-size:11px;color:var(--muted);margin-top:2px}
.type-input{
  width:100%;background:var(--panel);border:1px solid var(--border);border-radius:8px;
  padding:12px 14px;color:var(--text);font-size:15px;font-family:var(--font);outline:none;
  transition:all .2s;
}
.type-input:focus{border-color:var(--red);box-shadow:0 0 0 3px rgba(224,49,49,.15)}
.type-actions{display:flex;gap:8px;margin-top:14px;justify-content:flex-end}

/* ── Statusbar */
.statusbar{
  background:rgba(17,9,9,.95);border-top:1px solid var(--border);
  padding:5px 14px;display:flex;align-items:center;gap:12px;font-size:11px;
  color:var(--muted);font-family:var(--mono);flex-shrink:0;
}
.status-dot{width:7px;height:7px;border-radius:50%;background:var(--red);box-shadow:0 0 6px var(--red);animation:pulse 2s infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.fps-counter{margin-left:auto;color:var(--muted)}
.kbd{background:var(--panel);border:1px solid var(--border);border-radius:4px;padding:1px 5px;font-family:var(--mono);font-size:10px;color:var(--text)}

/* ── Success overlay */
#success-overlay{
  display:none;position:absolute;inset:0;
  background:radial-gradient(ellipse at center, rgba(105,219,124,.15), rgba(0,0,0,.9));
  align-items:center;justify-content:center;z-index:200;flex-direction:column;gap:16px;
  backdrop-filter:blur(8px);
}
#success-overlay.show{display:flex}
.success-card{
  background:var(--surface);border:1px solid var(--green);border-radius:20px;
  padding:40px 48px;text-align:center;box-shadow:0 0 80px rgba(105,219,124,.2);
  animation:popIn .3s cubic-bezier(.34,1.56,.64,1);
}
.success-icon{font-size:56px;margin-bottom:16px;display:block}
.success-card h2{font-family:var(--display);font-size:28px;color:var(--green);letter-spacing:2px;margin-bottom:8px}
.success-card p{color:var(--muted);font-size:13px;line-height:1.5}

/* ── Scroll indicator overlay */
.scroll-flash{
  position:absolute;left:50%;transform:translateX(-50%);
  bottom:20px;background:rgba(224,49,49,.9);border-radius:20px;
  padding:6px 16px;font-size:12px;color:#fff;font-weight:600;
  opacity:0;transition:opacity .2s;pointer-events:none;
  font-family:var(--mono);
}
.scroll-flash.show{opacity:1}
</style>
</head>
<body>

<!-- CAPTCHA detection banner -->
<div class="captcha-banner" id="captchaBanner">
  <span class="captcha-badge">CAPTCHA</span>
  <span>⚠️ CAPTCHA detected! Click directly on the captcha area on screen. No typing needed — just click the correct image.</span>
  <button class="btn btn-amber" style="margin-left:auto" onclick="doScroll(-400)">↑ Scroll Up</button>
</div>

<!-- Topbar -->
<div class="topbar">
  <div class="logo">
    <div class="logo-dot"></div>
    ATERNOS REMOTE
  </div>
  <div class="urlbar" id="urlbar">connecting...</div>
  <button class="btn btn-dark" onclick="navBack()" title="Back (Alt+←)">← Back</button>
  <button class="btn btn-dark" onclick="navForward()" title="Forward">→</button>
  <button class="btn btn-dark" onclick="navRefresh()" title="Refresh (F5)">↻</button>
  <button class="btn btn-dark" onclick="gotoAternos()" title="Go to Aternos login">🔴 Aternos</button>
  <button class="btn btn-red" onclick="showTypeBox(null, null, null)" title="Type (T)">⌨ Type</button>
  <button class="btn btn-dark" onclick="doEnter()" title="Enter">↵</button>
  <button class="btn btn-dark" onclick="doScroll(-300)" title="Scroll Up">↑</button>
  <button class="btn btn-dark" onclick="doScroll(300)" title="Scroll Down">↓</button>
</div>

<!-- Type overlay -->
<div class="type-overlay" id="typeOverlay" onclick="if(event.target===this)hideTypeBox()">
  <div class="type-box">
    <div class="type-box-header">
      <div class="type-box-icon">⌨</div>
      <div>
        <h3 id="typeTitle">Type Text</h3>
        <p id="typeSubtitle">Press Enter to submit</p>
      </div>
    </div>
    <input class="type-input" id="typeInput" placeholder="Type here..." autocomplete="off"
      onkeydown="if(event.key==='Enter'){event.preventDefault();submitType()}else if(event.key==='Escape'){hideTypeBox()}">
    <div class="type-actions">
      <button class="btn btn-dark" onclick="hideTypeBox()">Cancel <span class="kbd">Esc</span></button>
      <button class="btn btn-red" onclick="submitType()">Send <span class="kbd">↵</span></button>
    </div>
  </div>
</div>

<!-- Viewport -->
<div class="viewport" id="viewport">
  <img id="screen" src="/screenshot" alt="browser" draggable="false">
  <div class="scroll-flash" id="scrollFlash"></div>
  <div id="success-overlay">
    <div class="success-card">
      <span class="success-icon">✅</span>
      <h2>LOGIN SUCCESSFUL</h2>
      <p>Session saved!<br>This window will close shortly.<br>Use <code>/aternos</code> in Discord.</p>
    </div>
  </div>
</div>

<!-- Statusbar -->
<div class="statusbar">
  <div class="status-dot"></div>
  <span id="status-text">Live View</span>
  <span>·</span>
  <span id="click-hint">Input field click → type box opens &nbsp;|&nbsp; Button/CAPTCHA click → direct action &nbsp;<span class="kbd">T</span> type &nbsp;<span class="kbd">Alt+←</span> back &nbsp;<span class="kbd">F5</span> refresh</span>
  <span class="fps-counter" id="fps">-- fps</span>
</div>

<script>
let done = false;
let pendingClickX = null, pendingClickY = null;
let lastTs = Date.now(), frameCount = 0;
let captchaDetected = false;

const screen    = document.getElementById('screen');
const urlbar    = document.getElementById('urlbar');
const overlay   = document.getElementById('success-overlay');
const viewport  = document.getElementById('viewport');
const capBanner = document.getElementById('captchaBanner');

// ── Screenshot polling (600ms for snappy feel)
function refreshScreen() {
  if (done) return;
  const img = new Image();
  img.onload = () => {
    screen.src = img.src;
    screen.classList.remove('loading');
    frameCount++;
    const now = Date.now();
    if (now - lastTs > 2000) {
      const fps = Math.round(frameCount * 1000 / (now - lastTs));
      document.getElementById('fps').textContent = fps + ' fps';
      frameCount = 0; lastTs = now;
    }
  };
  img.onerror = () => screen.classList.remove('loading');
  img.src = '/screenshot?t=' + Date.now();
}
setInterval(refreshScreen, 600);

// ── Status check every 1.5s — captcha detection + login detection
async function checkStatus() {
  if (done) return;
  try {
    const d = await fetch('/check').then(r => r.json());
    const u = d.url || '';
    urlbar.textContent = u;
    urlbar.className = 'urlbar' + (u.includes('aternos') ? ' active' : '');
    document.getElementById('status-text').textContent = u.includes('aternos') ? 'Aternos Connected' : 'Live View';

    // Captcha detection
    if (d.hasCaptcha && !captchaDetected) {
      captchaDetected = true;
      capBanner.classList.add('show');
      document.getElementById('status-text').textContent = '⚠️ CAPTCHA detected — click on captcha area';
    } else if (!d.hasCaptcha && captchaDetected) {
      captchaDetected = false;
      capBanner.classList.remove('show');
    }

    if (d.success) {
      done = true;
      capBanner.classList.remove('show');
      overlay.classList.add('show');
    }
  } catch {}
}
setInterval(checkStatus, 1500);

// ── Click handler — smart: only show type box for text inputs, NOT buttons/captcha
screen.addEventListener('click', e => {
  if (done) return;
  const r = screen.getBoundingClientRect();
  const x = Math.round((e.clientX - r.left) * (1280 / r.width));
  const y = Math.round((e.clientY - r.top)  * (800  / r.height));

  // Show ripple
  const rip = document.createElement('div');
  rip.className = 'ripple';
  rip.style.left = (e.clientX - viewport.getBoundingClientRect().left) + 'px';
  rip.style.top  = (e.clientY - viewport.getBoundingClientRect().top) + 'px';
  viewport.appendChild(rip);
  const rip2 = document.createElement('div');
  rip2.className = 'ripple-inner';
  rip2.style.left = rip.style.left;
  rip2.style.top  = rip.style.top;
  viewport.appendChild(rip2);
  setTimeout(() => { rip.remove(); rip2.remove(); }, 600);

  // Fire click on headless browser, then check what element was clicked
  fetch('/click?x=' + x + '&y=' + y)
    .then(() => fetch('/whatclicked?x=' + x + '&y=' + y))
    .then(r2 => r2.json())
    .then(info => {
      setTimeout(refreshScreen, 200);
      setTimeout(refreshScreen, 800);
      // Only open type box if it's a text/password/email input field
      // NOT for buttons, divs, captcha image clicks, login buttons etc.
      if (info.isTextInput) {
        pendingClickX = x; pendingClickY = y;
        showTypeBox(
          info.isPassword ? '🔑 Enter Password' : '⌨ ' + (info.placeholder || 'Enter Text'),
          'Press Enter to submit, Esc to cancel',
          null
        );
      }
      // For captcha: just click is enough (visual puzzle — user clicks image directly)
      // No type box for buttons, links, captcha image elements
    })
    .catch(() => {
      setTimeout(refreshScreen, 300);
    });
});

// ── Type box functions
function showTypeBox(title, subtitle, preset) {
  document.getElementById('typeTitle').textContent = title || '⌨ Type Text';
  document.getElementById('typeSubtitle').textContent = subtitle || 'Press Enter to submit';
  const inp = document.getElementById('typeInput');
  inp.value = preset || '';
  document.getElementById('typeOverlay').classList.add('show');
  setTimeout(() => inp.focus(), 60);
}
function hideTypeBox() {
  document.getElementById('typeOverlay').classList.remove('show');
  pendingClickX = null; pendingClickY = null;
}
function submitType() {
  const t = document.getElementById('typeInput').value;
  hideTypeBox();
  if (!t) return;
  fetch('/type?t=' + encodeURIComponent(t)).then(() => {
    setTimeout(refreshScreen, 300);
    setTimeout(refreshScreen, 900);
  });
}

// ── Nav controls
async function navBack() {
  await fetch('/nav?action=back');
  screen.classList.add('loading');
  setTimeout(() => { refreshScreen(); checkStatus(); }, 800);
}
async function navForward() {
  await fetch('/nav?action=forward');
  screen.classList.add('loading');
  setTimeout(refreshScreen, 800);
}
async function navRefresh() {
  screen.classList.add('loading');
  await fetch('/nav?action=reload');
  setTimeout(() => { refreshScreen(); checkStatus(); }, 1200);
}
function doEnter() {
  fetch('/enter').then(() => {
    setTimeout(refreshScreen, 300);
    setTimeout(checkStatus, 800);
  });
}
function doScroll(dy) {
  fetch('/scroll?dy=' + dy).then(() => setTimeout(refreshScreen, 200));
  const fl = document.getElementById('scrollFlash');
  fl.textContent = dy < 0 ? '↑ Scrolling Up' : '↓ Scrolling Down';
  fl.classList.add('show');
  setTimeout(() => fl.classList.remove('show'), 800);
}
function gotoAternos() {
  fetch('/goto?url=' + encodeURIComponent('https://aternos.org/go/'));
  screen.classList.add('loading');
  setTimeout(() => { refreshScreen(); checkStatus(); }, 1500);
}

// ── Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (document.getElementById('typeOverlay').classList.contains('show')) return;
  if (e.key === 't' || e.key === 'T') { e.preventDefault(); showTypeBox(null, null, null); }
  if (e.key === 'F5') { e.preventDefault(); navRefresh(); }
  if (e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); navBack(); }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navForward(); }
  if (e.key === 'ArrowUp')   { e.preventDefault(); doScroll(-300); }
  if (e.key === 'ArrowDown') { e.preventDefault(); doScroll(300); }
});
</script>
</body>
</html>`);
        });

        // ── Express routes
        app.get('/screenshot', async (req, res) => {
            try {
                const buf = await manualPage.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
                res.setHeader('Cache-Control', 'no-store');
                res.contentType('image/jpeg');
                res.send(buf);
            } catch { res.status(500).send('Error'); }
        });

        app.get('/click', async (req, res) => {
            await manualPage.mouse.click(parseInt(req.query.x), parseInt(req.query.y)).catch(() => {});
            res.send('ok');
        });

        // ── Smart element detection — only open type box for real text inputs
        app.get('/whatclicked', async (req, res) => {
            try {
                const x = parseInt(req.query.x);
                const y = parseInt(req.query.y);
                const info = await manualPage.evaluate((cx, cy) => {
                    const el = document.elementFromPoint(cx, cy);
                    if (!el) return { isTextInput: false };
                    const tag  = el.tagName.toLowerCase();
                    const type = (el.getAttribute('type') || 'text').toLowerCase();
                    const isInput = tag === 'input' && ['text','password','email','search','tel','url','number'].includes(type);
                    const isTextarea = tag === 'textarea';
                    if (isInput || isTextarea) {
                        return {
                            isTextInput: true,
                            isPassword: type === 'password',
                            placeholder: el.placeholder || el.getAttribute('aria-label') || el.name || ''
                        };
                    }
                    return { isTextInput: false };
                }, x, y).catch(() => ({ isTextInput: false }));
                res.json(info);
            } catch {
                res.json({ isTextInput: false });
            }
        });

        app.get('/type', async (req, res) => {
            await manualPage.keyboard.type(req.query.t, { delay: 25 }).catch(() => {});
            res.send('ok');
        });

        app.get('/enter', async (req, res) => {
            await manualPage.keyboard.press('Enter').catch(() => {});
            res.send('ok');
        });

        app.get('/nav', async (req, res) => {
            const action = req.query.action;
            try {
                if (action === 'back') {
                    const canGoBack = await manualPage.evaluate(() => window.history.length > 1).catch(() => false);
                    if (canGoBack) await manualPage.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
                    else await manualPage.goto('https://aternos.org/go/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                } else if (action === 'forward') {
                    await manualPage.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
                } else if (action === 'reload') {
                    await manualPage.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                }
            } catch {}
            res.send('ok');
        });

        app.get('/goto', async (req, res) => {
            try { await manualPage.goto(req.query.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}); } catch {}
            res.send('ok');
        });

        app.get('/scroll', async (req, res) => {
            const dy = parseInt(req.query.dy) || 300;
            await manualPage.evaluate((d) => window.scrollBy(0, d), dy).catch(() => {});
            res.send('ok');
        });

        app.get('/check', async (req, res) => {
            try {
                const url = manualPage.url();
                const cookies = await manualPage.cookies();
                const sess = cookies.find(c => c.name === 'ATERNOS_SESSION');

                // Captcha detection
                const hasCaptcha = await manualPage.evaluate(() =>
                    !!(document.querySelector('.h-captcha, iframe[src*="hcaptcha"], .captcha, #captcha'))
                ).catch(() => false);

                if ((url.includes('/servers') || url.includes('/server')) && sess) {
                    CFG.aternosSession = sess.value;
                    saveCFG(CFG);
                    Aternos.cookies = null;
                    res.json({ url, success: true, hasCaptcha: false });

                    try {
                        await interaction.followUp({
                            content: '✅ **Manual Login Successful!** Session saved. Use `/aternos` now.',
                            flags: EPH
                        });
                    } catch {}

                    setTimeout(() => {
                        if (manualBrowser) manualBrowser.close().catch(() => {});
                        if (manualServer) manualServer.close(() => {});
                        manualServer = null; manualBrowser = null; manualPage = null;
                    }, 3500);
                } else {
                    res.json({ url, success: false, hasCaptcha });
                }
            } catch {
                res.json({ url: 'error', success: false, hasCaptcha: false });
            }
        });

        // ── Start express server
        await new Promise((resolve, reject) => {
            manualServer = app.listen(port, '0.0.0.0', resolve);
            manualServer.on('error', reject);
        });

        // ── Reply to Discord
        const cPanel = new ContainerBuilder();
        cPanel.addTextDisplayComponents(t => t.setContent(
            `## 🔴 MANUAL LOGIN READY\n\n` +
            `> 🔗 **Open in your browser:**\n` +
            `> ### \`http://127.0.0.1:${port}\`\n\n` +
            `> ✅ Login to Aternos — session will be saved automatically.\n` +
            `> 🔒 If CAPTCHA appears, click on it directly — the type box will open!\n\n` +
            `-# Window will auto-close after login. *Made by* **KNIGHTOFADITYA**`
        ));
        cPanel.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        cPanel.addActionRowComponents(row => row.addComponents(
            new ButtonBuilder().setCustomId('at_back').setLabel('🔙 Cancel').setStyle(ButtonStyle.Secondary)
        ));
        await interaction.editReply({ ...FLAGS, components: [cPanel] });

    } catch (e) {
        if (manualBrowser) manualBrowser.close().catch(() => {});
        if (manualServer) manualServer.close(() => {});
        manualServer = null; manualBrowser = null; manualPage = null;

        const errC = new ContainerBuilder();
        errC.addTextDisplayComponents(t => t.setContent(
            `## 🔴 MANUAL LOGIN\n\n` +
            `> ❌ **Error:**\n> \`\`\`${e.message}\`\`\`\n\n` +
            `-# Try again or run \`npm install puppeteer-core\`.`
        ));
        errC.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        errC.addActionRowComponents(row => row.addComponents(
            new ButtonBuilder().setCustomId('at_manual_login').setLabel('🔁 Retry').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('at_back').setLabel('🔙 Back').setStyle(ButtonStyle.Secondary)
        ));
        try { await interaction.editReply({ ...FLAGS, components: [errC] }); } catch {}
    }
}

// ══════════════════════════════════════════════════════
// ── Bot Main
// ══════════════════════════════════════════════════════
async function startBot() {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once('clientReady', async () => {
        console.log(`\n🤖 Bot online: ${client.user.tag}`);
        const rest = new REST({ version: '10' }).setToken(CFG.token);
        const app = await rest.get(Routes.currentApplication());
        await rest.put(Routes.applicationCommands(app.id), {
            body: [
                { name: 'setup',   description: '🔧 Set up your credentials' },
                { name: 'aternos', description: '🌐 Open Aternos Control Panel' }
            ]
        });

        setTimeout(async () => {
            try {
                if (!CFG.aternosSession) return;
                await Aternos.getBrowser();
                await Aternos.ensureSession();
            } catch (e) {
            }
        }, 1500);
    });

    client.on('interactionCreate', async interaction => {
        const id = interaction.commandName || interaction.customId;
        if (!id) return;

        try {
            // ── Setup Modal
            if (id === 'setup') {
                const modal = new ModalBuilder().setCustomId('setup_modal').setTitle('🔴 Aternos Setup');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('u').setLabel('Aternos Username').setStyle(TextInputStyle.Short)
                            .setValue(CFG.aternosUser||'').setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('p').setLabel('Aternos Password').setStyle(TextInputStyle.Short)
                            .setValue(CFG.aternosPass||'').setRequired(false)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('sess').setLabel('Session Cookie (Recommended)').setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('Paste ATERNOS_SESSION cookie value here (F12 → Application → Cookies)').setValue(CFG.aternosSession||'').setRequired(false)
                    )
                );
                return await interaction.showModal(modal);
            }

            if (interaction.isModalSubmit?.() && id === 'setup_modal') {
                CFG.aternosUser    = interaction.fields.getTextInputValue('u');
                CFG.aternosPass    = interaction.fields.getTextInputValue('p');
                CFG.aternosSession = interaction.fields.getTextInputValue('sess');
                saveCFG(CFG);
                Aternos.cookies = null;
                Aternos.user = null;
                return await interaction.reply({ content: '✅ **Setup saved!** Now use `/aternos`.', flags: EPH });
            }

            // ── Defer slow operations
            const slowOps = ['aternos','at_refresh','at_back','at_select_server','at_manual_login','at_logout'];
            const isSlow  = slowOps.includes(id) || id.startsWith('at_refresh_') || id.startsWith('at_start_') || id.startsWith('at_stop_') || id.startsWith('at_ka_on_') || id.startsWith('at_ka_off_');

            if (isSlow) {
                try {
                    if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
                        await interaction.deferUpdate();
                    } else {
                        await interaction.deferReply({ flags: EPH });
                    }
                } catch (e) {
                    return;
                }
            }

            // ── Logout
            if (id === 'at_logout') {
                CFG.aternosSession = '';
                saveCFG(CFG);
                Aternos.cookies = null;
                Aternos.user = null;
                const c = new ContainerBuilder();
                c.addTextDisplayComponents(t => t.setContent(
                    `## 🔴 ATERNOS PANEL\n\n` +
                    `> ✅ **Logged out!** Session cleared.\n\n` +
                    `> 🔑 Add a new account via Manual Login\n` +
                    `> 🔧 Or update credentials with \`/setup\`\n\n` +
                    `-# *Made by* **KNIGHTOFADITYA**`
                ));
                c.addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
                c.addActionRowComponents(row => row.addComponents(
                    new ButtonBuilder().setCustomId('at_manual_login').setLabel('🔑 Manual Login').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('at_refresh').setLabel('🔄 Try Session').setStyle(ButtonStyle.Secondary)
                ));
                return await interaction.editReply({ ...FLAGS, components: [c] });
            }

            // ── Manual Login
            if (id === 'at_manual_login') {
                return await startManualLogin(interaction);
            }

            // ── Main Panel / Back / Refresh
            if (id === 'aternos' || id === 'at_refresh' || id === 'at_back') {
                await interaction.editReply(buildPanel(null, null, [], true));
                try {
                    const list = await Aternos.getServerList();
                    return await interaction.editReply(buildPanel(null, null, list));
                } catch (e) {
                    return await interaction.editReply(buildPanel(null, e.message));
                }
            }

            // ── Select Server / Refresh specific server
            if (id === 'at_select_server' || id.startsWith('at_refresh_')) {
                const srvId = interaction.isStringSelectMenu?.() ? interaction.values[0] : id.replace('at_refresh_', '');
                try {
                    const info = await Aternos.getServerInfo(srvId);
                    info.id = srvId;
                    return await interaction.editReply(buildPanel(info));
                } catch (e) {
                    return await interaction.editReply(buildPanel(null, e.message));
                }
            }

            // ── Start (with auto-retry)
            if (id.startsWith('at_start_')) {
                const srvId = id.replace('at_start_', '');
                try {
                    const info = await Aternos.startWithRetry(srvId, interaction);
                    return await interaction.editReply(buildPanel(info));
                } catch (e) {
                    return await interaction.editReply(buildPanel(null, `Start failed: ${e.message}`));
                }
            }

            // ── KeepAlive ON
            if (id.startsWith('at_ka_on_')) {
                const srvId = id.replace('at_ka_on_', '');
                Aternos.startKeepAlive(srvId);
                try {
                    const info = await Aternos.getServerInfo(srvId);
                    info.id = srvId;
                    return await interaction.editReply(buildPanel(info));
                } catch (e) {
                    return await interaction.editReply(buildPanel(null, e.message));
                }
            }

            // ── KeepAlive OFF
            if (id.startsWith('at_ka_off_')) {
                const srvId = id.replace('at_ka_off_', '');
                Aternos.stopKeepAlive(srvId);
                try {
                    const info = await Aternos.getServerInfo(srvId);
                    info.id = srvId;
                    return await interaction.editReply(buildPanel(info));
                } catch (e) {
                    return await interaction.editReply(buildPanel(null, e.message));
                }
            }

            // ── Stop
            if (id.startsWith('at_stop_')) {
                const srvId = id.replace('at_stop_', '');
                try {
                    await Aternos.manage(srvId, 'stop');
                    await new Promise(r => setTimeout(r, 2000));
                    const info = await Aternos.getServerInfo(srvId);
                    info.id = srvId;
                    return await interaction.editReply(buildPanel(info));
                } catch (e) {
                    return await interaction.editReply(buildPanel(null, e.message));
                }
            }

        } catch (err) {
            if (err.code === 10062) console.log('⚠️ Interaction expired');
            else console.error('❌ Error:', err);
            try {
                const msg = `❌ Error: ${err.message || 'Unknown error'}`;
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: msg });
                }
            } catch {}
        }
    });

    await client.login(CFG.token);
}

if (!CFG.token) {
    console.error('❌ Token missing in config.json! Check /setup or config.json.');
    process.exit(1);
} else {
    startBot().catch(e => console.error('💥 Crash:', e));
}

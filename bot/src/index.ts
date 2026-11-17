import {Bot,InlineKeyboard} from 'grammy';
const token=process.env.BOT_TOKEN;const appUrl=process.env.MINI_APP_URL;
if(!token)throw new Error('BOT_TOKEN is missing. Set it as a private environment variable; never commit it.');
const bot=new Bot(token);
bot.command('start',async ctx=>{const kb=new InlineKeyboard();if(appUrl)kb.webApp('Open DUR',appUrl);await ctx.reply('🚀 Welcome to DUR Protocol\n\nDecentralized Trust Infrastructure built on TON.\n\nExplore verifiable attestations, portable reputation and modular escrow.\n\nEarly preview: reputation scoring and escrow execution are not active yet.',{reply_markup:kb});});
bot.command('help',ctx=>ctx.reply('DUR Protocol commands\n/start — Open DUR\n/help — Help and commands\n/about — About DUR\n/status — Preview status'));
bot.command('about',ctx=>ctx.reply('DUR is an independent project exploring decentralized trust infrastructure for TON: reputation, attestations and modular escrow.'));
bot.command('status',ctx=>ctx.reply('DUR Preview · v0.1.0\nMini App: prototype\nNetwork: TON Testnet integration planned\nReputation: not active\nEscrow: design preview only'));
bot.catch(err=>console.error('DUR bot update error:',err));bot.start();console.log('DUR bot started.');
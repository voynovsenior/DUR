import { Bot, InlineKeyboard } from 'grammy';

const token = process.env.BOT_TOKEN;
const appUrl = process.env.MINI_APP_URL;

if (!token) {
  throw new Error('BOT_TOKEN is missing. Set it as a private environment variable; never commit it.');
}

const bot = new Bot(token);

bot.command('start', async ctx => {
  const keyboard = new InlineKeyboard();
  if (appUrl) keyboard.webApp('Open DUR', appUrl);

  await ctx.reply(
    [
      '🚀 Welcome to DUR Protocol',
      '',
      'Decentralized Trust Infrastructure for TON.',
      '',
      'Explore issuer attestations, experimental reputation and the modular escrow research prototype.',
      '',
      'Early Testnet preview: escrow execution is not available and reputation is experimental.',
    ].join('\n'),
    { reply_markup: keyboard },
  );
});

bot.command('help', ctx => ctx.reply(
  [
    'DUR Protocol commands',
    '/start — Open DUR',
    '/help — Help and commands',
    '/about — About DUR',
    '/status — Preview status',
  ].join('\n'),
));

bot.command('about', ctx => ctx.reply(
  'DUR is an early-stage project exploring decentralized trust infrastructure for TON: attestations, evidence-based reputation and modular escrow research.',
));

bot.command('status', ctx => ctx.reply(
  [
    'DUR Protocol · v0.3.0',
    'Environment: early Testnet preview',
    'Mini App: interface prototype',
    'Identity and attestations: implemented, requires deployment QA',
    'Reputation: experimental projection',
    'Indexer: Testnet ingestion and transaction proof tooling; DUR source identity policy pending',
    'Escrow: experimental contract; not deployed, audited or available for real funds',
  ].join('\n'),
));

bot.catch(error => {
  console.error('DUR bot update error:', error);
});

bot.start();
console.log('DUR bot started.');

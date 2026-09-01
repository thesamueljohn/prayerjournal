import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import makeWASocket, { makeCacheableSignalKeyStore, useMultiFileAuthState } from '@whiskeysockets/baileys';
import P from 'pino';
import qrcode from 'qrcode-terminal';

const ROOT = path.resolve(import.meta.dirname, '..');
const silentLogger = P({ level: 'silent' });
const args = new Set(process.argv.slice(2));
const mode = args.has('--login') ? 'login' : args.has('--list-groups') ? 'list-groups' : args.has('--dry-run') ? 'dry-run' : args.has('--send-today') ? 'send-today' : null;

if (!mode) throw new Error('Choose one: --login, --list-groups, --dry-run, or --send-today.');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required. Copy .env.example to a private environment file and set it.`);
  return value;
}

function nigeriaToday() {
  const fields = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.JOURNAL_TIMEZONE || 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${fields.year}-${fields.month}-${fields.day}`;
}

async function journalForToday() {
  const data = JSON.parse(await readFile(path.join(ROOT, 'dist', 'data.json'), 'utf8'));
  const key = nigeriaToday();
  const month = data.months.find((item) => item.slug === key.slice(0, 7));
  const day = month?.days.find((item) => item.key === key);
  if (!day) throw new Error(`No published devotional found for ${key}. Run npm run build and confirm the monthly source contains this day.`);
  const baseUrl = required('PUBLIC_BASE_URL').replace(/\/$/, '');
  return { key, day, url: `${baseUrl}/${month.slug}/${String(day.day).padStart(2, '0')}/` };
}

async function connect(authDir, showQr) {
  await mkdir(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const socket = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silentLogger) },
    logger: silentLogger,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });
  socket.ev.on('creds.update', saveCreds);
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WhatsApp connection timed out after 60 seconds.')), 60_000);
    socket.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
      if (qr && showQr) qrcode.generate(qr, { small: true });
      if (connection === 'open') { clearTimeout(timer); resolve(); }
      if (connection === 'close') { clearTimeout(timer); reject(lastDisconnect?.error || new Error('WhatsApp connection closed.')); }
    });
  });
  return { socket, opened };
}

async function readLedger(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { deliveries: [] }; throw error; }
}

async function saveLedger(file, ledger) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

async function retrySend(socket, jid, text) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return await socket.sendMessage(jid, { text }); }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, attempt * 2_000)); }
  }
  throw lastError;
}

if (mode === 'login') {
  const authDir = required('WHATSAPP_AUTH_DIR');
  console.log('Scan the QR code in WhatsApp > Linked devices. This command exits after the link succeeds.');
  const { socket, opened } = await connect(authDir, true);
  await opened;
  console.log('WhatsApp linked successfully.');
  socket.ws.close();
  process.exit(0);
}

if (mode === 'list-groups') {
  const { socket, opened } = await connect(required('WHATSAPP_AUTH_DIR'), false);
  await opened;
  const groups = await socket.groupFetchAllParticipating();
  console.table(Object.values(groups)
    .map((group) => ({ jid: group.id, name: group.subject || '(unnamed group)' }))
    .sort((left, right) => left.name.localeCompare(right.name)));
  socket.ws.close();
  process.exit(0);
}

const { key, day, url } = await journalForToday();
const text = `${day.messageText}\n\nRead and share online: ${url}`;
const jids = required('WHATSAPP_GROUP_JIDS').split(',').map((value) => value.trim()).filter(Boolean);
if (jids.some((jid) => !jid.endsWith('@g.us'))) throw new Error('WHATSAPP_GROUP_JIDS must contain group JIDs ending in @g.us.');

if (mode === 'dry-run') {
  console.log(JSON.stringify({ date: key, groups: jids, url, text }, null, 2));
  process.exit(0);
}

const ledgerFile = required('WHATSAPP_LEDGER_FILE');
const ledger = await readLedger(ledgerFile);
const { socket, opened } = await connect(required('WHATSAPP_AUTH_DIR'), false);
await opened;
const failures = [];
for (const jid of jids) {
  if (ledger.deliveries.some((entry) => entry.key === key && entry.jid === jid)) {
    console.log(`Skipping ${jid}; ${key} was already sent.`);
    continue;
  }
  try {
    const result = await retrySend(socket, jid, text);
    ledger.deliveries.push({ key, jid, sentAt: new Date().toISOString(), messageId: result?.key?.id || null });
    await saveLedger(ledgerFile, ledger);
    console.log(`Sent ${key} to ${jid}.`);
  } catch (error) {
    failures.push(`${jid}: ${error.message}`);
  }
}
socket.ws.close();
if (failures.length) throw new Error(`Delivery failed:\n${failures.join('\n')}`);

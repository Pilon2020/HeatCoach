// Minimal Express server to persist users and logs to data/users.json
const path = require('path');
const fs = require('fs');
const express = require('express');
// Weather proxy no longer used

const app = express();
const PORT = process.env.PORT || 3000;
const WEB_ROOT = __dirname; // serve this directory
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(WEB_ROOT));

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
}

function readUsers() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = raw ? JSON.parse(raw) : {};
    return data;
  } catch (e) {
    console.error('Failed to read users.json:', e);
    return {};
  }
}

function writeUsers(users) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

// Health check
app.get('/api/ping', (_req, res) => res.json({ ok: true }));

// Get all users (including profiles and logs)
app.get('/api/users', (_req, res) => {
  res.json(readUsers());
});

// Replace all users (idempotent sync)
app.put('/api/users', (req, res) => {
  const incoming = req.body || {};
  if (typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'Body must be an object keyed by email' });
  }
  // Normalize: ensure logs arrays exist
  const normalized = {};
  for (const [email, u] of Object.entries(incoming)) {
    normalized[email] = {
      email: u.email || email,
      name: u.name || '',
      passwordHash: u.passwordHash || '',
      profile: u.profile || { massKg: null, sweatRateLph: 1.0 },
      logs: Array.isArray(u.logs) ? u.logs : [],
      daily: Array.isArray(u.daily) ? u.daily : [],
    };
  }
  writeUsers(normalized);
  res.json({ ok: true });
});

// Upsert a single user (without replacing others)
app.post('/api/users', (req, res) => {
  const user = req.body;
  if (!user || typeof user.email !== 'string') {
    return res.status(400).json({ error: 'User with email required' });
  }
  const users = readUsers();
  const existing = users[user.email] || {};
  users[user.email] = {
    email: user.email,
    name: user.name ?? existing.name ?? '',
    passwordHash: user.passwordHash ?? existing.passwordHash ?? '',
    profile: user.profile ?? existing.profile ?? { massKg: null, sweatRateLph: 1.0 },
    logs: Array.isArray(existing.logs) ? existing.logs : [],
    daily: Array.isArray(existing.daily) ? existing.daily : [],
  };
  writeUsers(users);
  res.json({ ok: true });
});

// Append a log to a user's subarray
app.post('/api/logs', (req, res) => {
  const { email, log } = req.body || {};
  if (typeof email !== 'string' || !log) {
    return res.status(400).json({ error: 'email and log required' });
// Update a single log's actualIntakeL by timestamp
app.post('/api/logs/update', (req, res) => {
  const { email, ts, actualIntakeL } = req.body || {};
  if (typeof email !== 'string' || typeof ts !== 'number') {
    return res.status(400).json({ error: 'email and ts required' });
  }
  const users = readUsers();
  if (!users[email] || !Array.isArray(users[email].logs)) return res.status(404).json({ error: 'user or logs not found' });
  const idx = users[email].logs.findIndex(l => l.ts === ts);
  if (idx === -1) return res.status(404).json({ error: 'log not found' });
  users[email].logs[idx].actualIntakeL = typeof actualIntakeL === 'number' ? actualIntakeL : null;
  writeUsers(users);
  res.json({ ok: true, log: users[email].logs[idx] });
});

  }
  const users = readUsers();
  if (!users[email]) {
    users[email] = {
      email,
      name: '',
      passwordHash: '',
      profile: { massKg: null, sweatRateLph: 1.0 },
      logs: [],
    };
  }
  if (!Array.isArray(users[email].logs)) users[email].logs = [];
  users[email].logs.unshift(log);
  writeUsers(users);
  res.json({ ok: true });
});

// Upsert a daily subjective hydration entry for a specific date
app.post('/api/daily', (req, res) => {
  const { email, entry } = req.body || {};
  if (typeof email !== 'string' || !entry || typeof entry.date !== 'string') {
    return res.status(400).json({ error: 'email and entry with date required' });
  }
  const users = readUsers();
  if (!users[email]) {
    users[email] = {
      email,
      name: '',
      passwordHash: '',
      profile: { massKg: null, sweatRateLph: 1.0 },
      logs: [],
      daily: [],
    };
  }
  if (!Array.isArray(users[email].daily)) users[email].daily = [];
  // Replace existing entry for that date if present
  const idx = users[email].daily.findIndex(d => d.date === entry.date);
  if (idx >= 0) users[email].daily[idx] = entry; else users[email].daily.push(entry);
  writeUsers(users);
  res.json({ ok: true });
});

// Weather API removed; client now inputs weather manually

app.listen(PORT, () => {
  ensureDataFile();
  console.log(`HydrationCoachWeb server running at http://localhost:${PORT}`);
});



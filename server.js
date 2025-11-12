// server.js
require('dotenv').config(); // loads WEATHER_API_KEY from .env

const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const WEB_ROOT = __dirname; // serve this directory
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(WEB_ROOT));

// ---------------------------------------------------------------------------
// Helpers for users.json
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/api/ping', (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Users (get/put/post)
// ---------------------------------------------------------------------------
app.get('/api/users', (_req, res) => {
  res.json(readUsers());
});

app.put('/api/users', (req, res) => {
  const incoming = req.body || {};
  if (typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'Body must be an object keyed by email' });
  }
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

// ---------------------------------------------------------------------------
// Logs (append + update actualIntakeL)
// ---------------------------------------------------------------------------
app.post('/api/logs', (req, res) => {
  const { email, log } = req.body || {};
  if (typeof email !== 'string' || !log) {
    return res.status(400).json({ error: 'email and log required' });
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
  if (!Array.isArray(users[email].logs)) users[email].logs = [];
  users[email].logs.unshift(log);
  writeUsers(users);
  res.json({ ok: true });
});

app.post('/api/logs/update', (req, res) => {
  const { email, ts, actualIntakeL } = req.body || {};
  if (typeof email !== 'string' || typeof ts !== 'number') {
    return res.status(400).json({ error: 'email and ts required' });
  }
  const users = readUsers();
  if (!users[email] || !Array.isArray(users[email].logs)) {
    return res.status(404).json({ error: 'user or logs not found' });
  }
  const idx = users[email].logs.findIndex(l => l.ts === ts);
  if (idx === -1) return res.status(404).json({ error: 'log not found' });
  users[email].logs[idx].actualIntakeL = typeof actualIntakeL === 'number' ? actualIntakeL : null;
  writeUsers(users);
  res.json({ ok: true, log: users[email].logs[idx] });
});

// ---------------------------------------------------------------------------
// Daily (upsert by date)
// ---------------------------------------------------------------------------
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
  const idx = users[email].daily.findIndex(d => d.date === entry.date);
  if (idx >= 0) users[email].daily[idx] = entry; else users[email].daily.push(entry);
  writeUsers(users);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Weather proxy (prints temp to server terminal)
// ---------------------------------------------------------------------------
app.get('/api/weather', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

    const key = process.env.WEATHER_API_KEY;
    if (!key) return res.status(500).json({ error: 'Server missing WEATHER_API_KEY' });

    const url = `https://api.weatherapi.com/v1/current.json?key=${encodeURIComponent(key)}&q=${encodeURIComponent(lat)},${encodeURIComponent(lon)}&aqi=no`;
    const resp = await fetch(url);
    if (!resp.ok) return res.status(resp.status).json({ error: 'WeatherAPI request failed', detail: await resp.text().catch(() => '') });

    const data = await resp.json();
    const current = data?.current || {};
    const location = data?.location || {};
    
    // Debug: Log raw API response
    console.log('[weather] Raw API current object:', JSON.stringify(current, null, 2));
    console.log('[weather] Humidity value from API:', current.humidity, 'Type:', typeof current.humidity);
    
    // Extract comprehensive weather metrics with fallbacks
    const tempC = typeof current.temp_c === 'number' ? current.temp_c : null;
    const feelslikeC = typeof current.feelslike_c === 'number' ? current.feelslike_c : null;
    // Handle humidity - it should be a number (0-100)
    const humidityPct = (typeof current.humidity === 'number' && !isNaN(current.humidity)) ? current.humidity : null;
    const uvIndex = (typeof current.uv === 'number' && !isNaN(current.uv)) ? current.uv : null;
    const windKph = typeof current.wind_kph === 'number' ? current.wind_kph : null;
    const windMps = windKph != null ? windKph / 3.6 : null; // Convert km/h to m/s
    const windDir = current.wind_dir || null;
    const pressureMb = typeof current.pressure_mb === 'number' ? current.pressure_mb : null;
    const cloudPct = typeof current.cloud === 'number' ? current.cloud : null;
    const visibilityKm = typeof current.vis_km === 'number' ? current.vis_km : null;
    const city = location.name || null;
    const region = location.region || null;
    const country = location.country || null;

    // Log comprehensive weather data
    console.log(`[weather] ${new Date().toISOString()} ${city || 'Unknown'}, ${region || ''}, ${country || ''}: ${tempC}°C (feels ${feelslikeC}°C), UV ${uvIndex}, Wind ${windKph}km/h (${windMps?.toFixed(2)}m/s), Humidity ${humidityPct}%`);
    console.log('[weather] Full response data:', {
      tempC,
      feelslikeC,
      humidityPct,
      uvIndex,
      windKph,
      windMps,
      location: { city, region, country }
    });

    // Validate required fields
    if (tempC == null || humidityPct == null) {
      console.error('[weather] Missing required fields:', { tempC, humidityPct });
      return res.status(500).json({ 
        error: 'Incomplete weather data from API', 
        tempC, 
        humidityPct,
        raw: data 
      });
    }

    return res.json({
      city,
      region,
      country,
      tempC,
      feelslikeC,
      humidityPct,
      uvIndex,
      windKph,
      windMps,
      windDir,
      pressureMb,
      cloudPct,
      visibilityKm,
      raw: data
    });
  } catch (e) {
    console.error('Weather proxy error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  ensureDataFile();
  console.log(`HydrationCoachWeb server running at http://localhost:${PORT}`);
});

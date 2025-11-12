// Load environment variables from .env file (if it exists)
// In production, environment variables should be set by the hosting platform
require('dotenv').config({ silent: true });

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const WEB_ROOT = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

const STORAGE = {
  profiles: path.join(DATA_DIR, 'profiles.json'),
  activity: path.join(DATA_DIR, 'activity-plans.json'),
  daily: path.join(DATA_DIR, 'daily-tracking.json'),
  legacy: path.join(DATA_DIR, 'users.json'),
};

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error('ERROR: MONGO_URI environment variable is required');
  console.error('Please set MONGO_URI in your environment variables or .env file');
  console.error('Example: mongodb+srv://username:password@cluster.mongodb.net/database');
  process.exit(1);
}
const DB_NAME = process.env.MONGO_DB;

// MongoDB connection options optimized for cluster connections and production
const mongoClient = new MongoClient(mongoUri, {
  serverSelectionTimeoutMS: 30000, // Increased timeout for cluster connections (30s for production)
  connectTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10, // Maximum number of connections in the connection pool
  minPoolSize: 2, // Minimum number of connections in the connection pool
  maxIdleTimeMS: 30000,
  retryWrites: true, // Enable retryable writes for better reliability
  retryReads: true, // Enable retryable reads for better reliability
  // Production-ready options
  heartbeatFrequencyMS: 10000, // Check server status every 10 seconds
});

let mongoInitPromise;
let collectionsCache;
let dbInstance;

app.use(express.json({ limit: '1mb' }));

// CORS middleware - allow requests from GitHub Pages and other origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow requests from GitHub Pages or any origin (you can restrict this in production)
  if (origin && (origin.includes('github.io') || origin.includes('localhost') || process.env.NODE_ENV !== 'production')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (process.env.ALLOWED_ORIGINS) {
    // Allow specific origins from environment variable
    const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',');
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.static(WEB_ROOT));

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function ensureJsonFile(filePath, initialValue = {}) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(initialValue, null, 2));
  }
}

function readJson(filePath, fallback = {}) {
  ensureJsonFile(filePath, fallback);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error(`Failed to read ${path.basename(filePath)}:`, err);
    return fallback;
  }
}

function defaultProfileData() {
  return { massKg: null, sweatRateLph: 1.0 };
}

function generatePrivateKey() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function normalizeLogEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const normalized = { ...entry };
  const hasObjectInput = entry.input && typeof entry.input === 'object';
  let normalizedInput = hasObjectInput ? { ...entry.input } : null;
  if (normalizedInput) {
    if (!normalizedInput.workoutType && entry.workout && typeof entry.workout.type === 'string') {
      normalizedInput.workoutType = entry.workout.type;
    }
    if ('workoutLabel' in normalizedInput) delete normalizedInput.workoutLabel;
    if ('workoutIcon' in normalizedInput) delete normalizedInput.workoutIcon;
    normalized.input = normalizedInput;
  } else if (entry.workout && typeof entry.workout.type === 'string') {
    normalized.input = { workoutType: entry.workout.type };
  }
  if (normalized.input && typeof normalized.input === 'object' && !normalized.input.workoutType) {
    const fromWorkout = entry.workout && typeof entry.workout.type === 'string'
      ? entry.workout.type
      : null;
    if (fromWorkout) normalized.input.workoutType = fromWorkout;
  }
  if ('workout' in normalized) delete normalized.workout;
  return normalized;
}

function normalizeLogs(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeLogEntry).filter(Boolean);
}

function sanitizeActivityStore(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) return {};
  return Object.entries(store).reduce((acc, [key, logs]) => {
    acc[key] = normalizeLogs(logs);
    return acc;
  }, {});
}

function toIsoTimestamp(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function normalizeUrineEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(sample => {
    if (!sample || typeof sample !== 'object') return null;
    const rawLevel = sample.sampleValue ?? sample.level ?? sample.value;
    const numericLevel = Number(rawLevel);
    const level = Number.isFinite(numericLevel)
      ? Math.min(10, Math.max(1, Math.round(numericLevel)))
      : 5;
    const recordedAt = toIsoTimestamp(sample.recordedAt || sample.time);
    return { level, recordedAt };
  }).filter(Boolean);
}

function normalizeDailyEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.date) return null;

  const normalized = {
    date: entry.date,
    metrics: { ...(entry.metrics || {}) },
  };

  if ('rating' in entry) normalized.rating = entry.rating;
  if ('note' in entry) normalized.note = entry.note || '';
  if ('time' in entry && entry.time) normalized.time = entry.time;
  if (entry.urine && typeof entry.urine === 'object') {
    normalized.urine = { entries: normalizeUrineEntries(entry.urine.entries || []) };
  }
  if (entry.hydration && typeof entry.hydration === 'object') {
    normalized.hydration = normalizeHydrationData(entry.hydration);
  }

  return normalized;
}

function normalizeHydrationData(hydration) {
  if (!hydration || typeof hydration !== 'object') return null;
  const normalized = {};
  
  if (Array.isArray(hydration.entries)) {
    normalized.entries = hydration.entries
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const volumeL = Number(entry.volumeL);
        const recordedAt = entry.recordedAt || new Date().toISOString();
        if (!Number.isFinite(volumeL) || volumeL <= 0) return null;
        return {
          volumeL: Number(volumeL.toFixed(3)),
          recordedAt: typeof recordedAt === 'string' ? recordedAt : new Date(recordedAt).toISOString()
        };
      })
      .filter(Boolean);
  }
  
  if (Number.isFinite(hydration.totalL)) {
    normalized.totalL = Number(hydration.totalL);
  }
  
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeDailyList(entries) {
  if (!Array.isArray(entries)) return [];
  const normalized = [];
  for (const entry of entries) {
    const normalizedEntry = normalizeDailyEntry(entry);
    if (normalizedEntry) normalized.push(normalizedEntry);
  }
  return normalized;
}

const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

async function getDb() {
  if (!mongoInitPromise) {
    mongoInitPromise = mongoClient.connect()
      .then(async client => {
        console.log('Successfully connected to MongoDB cluster');
        const db = DB_NAME ? client.db(DB_NAME) : client.db();
        dbInstance = db;
        
        // Verify connection by pinging the database (with error handling for production)
        try {
          await client.db('admin').command({ ping: 1 });
          console.log('MongoDB cluster connection verified');
        } catch (pingErr) {
          // Ping might fail in some production setups, but connection is still valid
          console.warn('MongoDB ping failed, but connection appears valid:', pingErr.message);
          // Try a simple operation on the actual database instead
          try {
            await db.listCollections().toArray();
            console.log('MongoDB cluster connection verified via collection list');
          } catch (listErr) {
            console.warn('Could not verify connection, but proceeding:', listErr.message);
          }
        }
        
        await ensureIndexes(db);
        await bootstrapFromDisk(db);
        return db;
      })
      .catch(err => {
        console.error('Failed to initialize MongoDB connection:', err.message);
        console.error('Error details:', err.name, err.code);
        if (err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
          console.error('Network error: Check your internet connection and MongoDB cluster accessibility');
        } else if (err.code === 'EAUTH') {
          console.error('Authentication error: Check your MongoDB username and password');
        } else if (err.message.includes('authentication')) {
          console.error('Authentication failed: Verify your MongoDB credentials');
        } else {
          console.error('Please verify your MONGO_URI environment variable is correct');
        }
        console.error('MONGO_URI format: mongodb+srv://username:password@cluster.mongodb.net/database');
        process.exit(1);
      });
  }
  return mongoInitPromise;
}

async function ensureIndexes(db) {
  try {
    await Promise.all([
      db.collection('profiles').createIndex({ email: 1 }, { unique: true }).catch(() => {}), // Ignore if exists
      db.collection('profiles').createIndex({ privateKey: 1 }, { unique: true }).catch(() => {}),
      db.collection('activities').createIndex({ privateKey: 1 }, { unique: true }).catch(() => {}),
      db.collection('daily').createIndex({ privateKey: 1 }, { unique: true }).catch(() => {}),
    ]);
  } catch (err) {
    // Index creation errors are non-fatal (indexes might already exist)
    console.warn('Some indexes may already exist:', err.message);
  }
}

async function bootstrapFromDisk(db) {
  // Skip bootstrap if data directory doesn't exist (common in production)
  if (!fs.existsSync(DATA_DIR)) {
    console.log('Data directory not found, skipping disk bootstrap (production mode)');
    return;
  }

  const profilesCol = db.collection('profiles');
  const activitiesCol = db.collection('activities');
  const dailyCol = db.collection('daily');

  const [profileCount, activityCount, dailyCount] = await Promise.all([
    profilesCol.estimatedDocumentCount(),
    activitiesCol.estimatedDocumentCount(),
    dailyCol.estimatedDocumentCount(),
  ]);

  if (profileCount === 0) {
    const diskProfiles = readJson(STORAGE.profiles, {});
    const profileDocs = Object.entries(diskProfiles).map(([email, record]) => ({
      _id: email,
      email: record?.email || email,
      privateKey: record?.privateKey || generatePrivateKey(),
      name: record?.name || '',
      passwordHash: record?.passwordHash || '',
      profile: record?.profile || defaultProfileData(),
    }));
    if (profileDocs.length) {
      await profilesCol.insertMany(profileDocs);
    }
  }

  if (activityCount === 0) {
    const activityStore = sanitizeActivityStore(readJson(STORAGE.activity, {}));
    const activityDocs = Object.entries(activityStore).map(([privateKey, logs]) => ({
      _id: privateKey,
      privateKey,
      logs: normalizeLogs(logs),
    }));
    if (activityDocs.length) {
      await activitiesCol.insertMany(activityDocs);
    }
  }

  if (dailyCount === 0) {
    const dailyStore = readJson(STORAGE.daily, {});
    const dailyDocs = Object.entries(dailyStore).map(([privateKey, entries]) => ({
      _id: privateKey,
      privateKey,
      entries: normalizeDailyList(entries),
    }));
    if (dailyDocs.length) {
      await dailyCol.insertMany(dailyDocs);
    }
  }

  await maybeMigrateLegacyUsers(db);
}

async function maybeMigrateLegacyUsers(db) {
  // Skip if data directory doesn't exist (production mode)
  if (!fs.existsSync(DATA_DIR) || !fs.existsSync(STORAGE.legacy)) return;
  const legacyData = readJson(STORAGE.legacy, {});
  if (!legacyData || !Object.keys(legacyData).length) return;

  const profilesCol = db.collection('profiles');
  const activitiesCol = db.collection('activities');
  const dailyCol = db.collection('daily');

  let migrated = false;
  for (const [email, legacyUser] of Object.entries(legacyData)) {
    const existingProfile = await profilesCol.findOne({ _id: email });
    const privateKey = existingProfile?.privateKey || legacyUser.privateKey || generatePrivateKey();
    const profileDoc = {
      email: legacyUser.email || email,
      privateKey,
      name: legacyUser.name || existingProfile?.name || '',
      passwordHash: legacyUser.passwordHash || existingProfile?.passwordHash || '',
      profile: legacyUser.profile || existingProfile?.profile || defaultProfileData(),
    };

    await profilesCol.updateOne(
      { _id: email },
      { $set: profileDoc, $setOnInsert: { _id: email } },
      { upsert: true },
    );

    await activitiesCol.updateOne(
      { _id: privateKey },
      {
        $set: {
          privateKey,
          logs: normalizeLogs(legacyUser.logs),
        },
      },
      { upsert: true },
    );

    await dailyCol.updateOne(
      { _id: privateKey },
      {
        $set: {
          privateKey,
          entries: normalizeDailyList(legacyUser.daily),
        },
      },
      { upsert: true },
    );

    migrated = true;
  }

  if (migrated) {
    const backupPath = `${STORAGE.legacy}.legacy`;
    try {
      fs.renameSync(STORAGE.legacy, backupPath);
    } catch (err) {
      console.warn('Could not archive legacy users.json:', err.message);
    }
  }
}

async function getCollections() {
  if (collectionsCache) return collectionsCache;
  const db = await getDb();
  collectionsCache = {
    profiles: db.collection('profiles'),
    activities: db.collection('activities'),
    daily: db.collection('daily'),
  };
  return collectionsCache;
}

// Helper to handle MongoDB connection errors and retry
async function withDbRetry(operation, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (err) {
      if (i === retries - 1) throw err;
      // Check if it's a connection error
      if (err.message.includes('connection') || err.message.includes('timeout') || err.code === 'ETIMEDOUT') {
        console.warn(`Database operation failed, retrying (${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
        // Reset cache to force reconnection
        collectionsCache = null;
        mongoInitPromise = null;
      } else {
        throw err; // Not a connection error, don't retry
      }
    }
  }
}

async function ensureProfileRecord(email) {
  const { profiles } = await getCollections();
  const existing = await profiles.findOne({ _id: email });
  if (existing) return existing;
  const record = {
    _id: email,
    email,
    privateKey: generatePrivateKey(),
    name: '',
    passwordHash: '',
    profile: defaultProfileData(),
  };
  await profiles.insertOne(record);
  return record;
}

async function buildUsersSnapshot() {
  return await withDbRetry(async () => {
    const { profiles, activities, daily } = await getCollections();
    const [profileList, activityList, dailyList] = await Promise.all([
      profiles.find({}).toArray(),
      activities.find({}).toArray(),
      daily.find({}).toArray(),
    ]);

    const activityMap = new Map(activityList.map(doc => [doc.privateKey, Array.isArray(doc.logs) ? doc.logs : []]));
    const dailyMap = new Map(dailyList.map(doc => [doc.privateKey, Array.isArray(doc.entries) ? doc.entries : []]));
    const snapshot = {};

    for (const profile of profileList) {
      const key = profile._id;
      const privateKey = profile.privateKey;
      snapshot[key] = {
        email: profile.email || key,
        name: profile.name || '',
        passwordHash: profile.passwordHash || '',
        profile: profile.profile || defaultProfileData(),
        privateKey,
        logs: normalizeLogs(activityMap.get(privateKey) || []),
        daily: normalizeDailyList(dailyMap.get(privateKey) || []),
      };
    }

    return snapshot;
  });
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/api/ping', async (_req, res) => {
  try {
    // Verify MongoDB connection is still alive
    const db = await getDb();
    await db.admin().ping();
    res.json({ ok: true, mongodb: 'connected' });
  } catch (err) {
    res.status(503).json({ ok: false, mongodb: 'disconnected', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Users (get/put/post)
// ---------------------------------------------------------------------------
app.get('/api/users', asyncHandler(async (_req, res) => {
  const snapshot = await buildUsersSnapshot();
  res.json(snapshot);
}));

app.put('/api/users', asyncHandler(async (req, res) => {
  const incoming = req.body || {};
  if (typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'Body must be an object keyed by email' });
  }

  const { profiles, activities, daily } = await getCollections();
  const existingProfiles = await profiles.find({}).toArray();
  const existingMap = new Map(existingProfiles.map(doc => [doc._id, doc]));

  const profileDocs = [];
  const activityDocs = [];
  const dailyDocs = [];

  for (const [email, user] of Object.entries(incoming)) {
    const existingProfile = existingMap.get(email);
    const privateKey = existingProfile?.privateKey || user.privateKey || generatePrivateKey();
    profileDocs.push({
      _id: email,
      email: user.email || existingProfile?.email || email,
      privateKey,
      name: user.name || existingProfile?.name || '',
      passwordHash: user.passwordHash || existingProfile?.passwordHash || '',
      profile: user.profile || existingProfile?.profile || defaultProfileData(),
    });
    activityDocs.push({
      _id: privateKey,
      privateKey,
      logs: normalizeLogs(user.logs),
    });
    dailyDocs.push({
      _id: privateKey,
      privateKey,
      entries: normalizeDailyList(user.daily),
    });
  }

  await Promise.all([
    profiles.deleteMany({}),
    activities.deleteMany({}),
    daily.deleteMany({}),
  ]);

  if (profileDocs.length) await profiles.insertMany(profileDocs);
  if (activityDocs.length) await activities.insertMany(activityDocs);
  if (dailyDocs.length) await daily.insertMany(dailyDocs);

  res.json({ ok: true });
}));

app.post('/api/users', asyncHandler(async (req, res) => {
  const user = req.body;
  if (!user || typeof user.email !== 'string') {
    return res.status(400).json({ error: 'User with email required' });
  }

  const { profiles } = await getCollections();
  const existing = await profiles.findOne({ _id: user.email });
  const record = {
    email: user.email,
    privateKey: existing?.privateKey || user.privateKey || generatePrivateKey(),
    name: user.name ?? existing?.name ?? '',
    passwordHash: user.passwordHash ?? existing?.passwordHash ?? '',
    profile: user.profile ?? existing?.profile ?? defaultProfileData(),
  };

  await profiles.updateOne(
    { _id: user.email },
    { $set: record, $setOnInsert: { _id: user.email } },
    { upsert: true },
  );

  res.json({ ok: true, privateKey: record.privateKey });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, passwordHash } = req.body || {};
  if (typeof email !== 'string' || typeof passwordHash !== 'string') {
    return res.status(400).json({ error: 'email and passwordHash required' });
  }

  const { profiles, activities, daily } = await getCollections();
  const profile = await profiles.findOne({ _id: email });
  if (!profile || !profile.passwordHash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (profile.passwordHash !== passwordHash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const activityDoc = await activities.findOne({ _id: profile.privateKey });
  const dailyDoc = await daily.findOne({ _id: profile.privateKey });

  res.json({
    email: profile.email || email,
    name: profile.name || '',
    passwordHash: profile.passwordHash,
    privateKey: profile.privateKey,
    profile: profile.profile || defaultProfileData(),
    logs: normalizeLogs(activityDoc?.logs),
    daily: normalizeDailyList(dailyDoc?.entries),
  });
}));

// ---------------------------------------------------------------------------
// Logs (append + update actualIntakeL)
// ---------------------------------------------------------------------------
app.post('/api/logs', asyncHandler(async (req, res) => {
  const { email, log } = req.body || {};
  if (typeof email !== 'string' || !log) {
    return res.status(400).json({ error: 'email and log required' });
  }
  const normalizedLog = normalizeLogEntry(log);
  if (!normalizedLog) {
    return res.status(400).json({ error: 'invalid log payload' });
  }

  const profile = await ensureProfileRecord(email);
  const { activities } = await getCollections();
  await activities.updateOne(
    { _id: profile.privateKey },
    {
      $setOnInsert: { privateKey: profile.privateKey },
      $push: { logs: { $each: [normalizedLog], $position: 0 } },
    },
    { upsert: true },
  );

  res.json({ ok: true });
}));

app.post('/api/logs/update', asyncHandler(async (req, res) => {
  const { email, ts, actualIntakeL } = req.body || {};
  if (typeof email !== 'string' || typeof ts !== 'number') {
    return res.status(400).json({ error: 'email and ts required' });
  }

  const { profiles, activities } = await getCollections();
  const profile = await profiles.findOne({ _id: email });
  if (!profile) {
    return res.status(404).json({ error: 'user not found' });
  }

  const activityDoc = await activities.findOne({ _id: profile.privateKey });
  const list = Array.isArray(activityDoc?.logs) ? [...activityDoc.logs] : [];
  const idx = list.findIndex(log => log.ts === ts);
  if (idx === -1) {
    return res.status(404).json({ error: 'log not found' });
  }
  list[idx] = {
    ...list[idx],
    actualIntakeL: typeof actualIntakeL === 'number' ? actualIntakeL : null,
  };

  await activities.updateOne(
    { _id: profile.privateKey },
    { $set: { privateKey: profile.privateKey, logs: list } },
  );

  res.json({ ok: true, log: list[idx] });
}));

// ---------------------------------------------------------------------------
// Daily (upsert by date)
// ---------------------------------------------------------------------------
app.post('/api/daily', asyncHandler(async (req, res) => {
  const { email, entry } = req.body || {};
  if (typeof email !== 'string' || !entry || typeof entry.date !== 'string') {
    return res.status(400).json({ error: 'email and entry with date required' });
  }
  const normalizedEntry = normalizeDailyEntry(entry);
  if (!normalizedEntry) return res.status(400).json({ error: 'invalid daily entry' });

  const profile = await ensureProfileRecord(email);
  const { daily } = await getCollections();
  const doc = await daily.findOne({ _id: profile.privateKey });
  const list = Array.isArray(doc?.entries) ? [...doc.entries] : [];
  const idx = list.findIndex(item => item.date === normalizedEntry.date);
  if (idx >= 0) {
    // Merge existing entry with new data to preserve all fields
    const existing = list[idx];
    const merged = { ...existing, ...normalizedEntry };
    // Preserve existing hydration/urine/metrics if not being updated
    if (normalizedEntry.hydration) {
      merged.hydration = normalizedEntry.hydration;
    } else if (existing.hydration) {
      merged.hydration = existing.hydration;
    }
    if (normalizedEntry.urine) {
      merged.urine = normalizedEntry.urine;
    } else if (existing.urine) {
      merged.urine = existing.urine;
    }
    // Merge metrics
    if (normalizedEntry.metrics && existing.metrics) {
      merged.metrics = { ...existing.metrics, ...normalizedEntry.metrics };
    } else if (normalizedEntry.metrics) {
      merged.metrics = normalizedEntry.metrics;
    } else if (existing.metrics) {
      merged.metrics = existing.metrics;
    }
    list[idx] = merged;
  } else {
    list.push(normalizedEntry);
  }

  await daily.updateOne(
    { _id: profile.privateKey },
    { $set: { privateKey: profile.privateKey, entries: list } },
    { upsert: true },
  );

  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Weather proxy (prints temp to server terminal)
// ---------------------------------------------------------------------------
app.get('/api/weather', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

    const key = process.env.WEATHER_API_KEY;
    if (!key) {
      console.error('[weather] WEATHER_API_KEY environment variable is not set');
      return res.status(503).json({ 
        error: 'Weather service unavailable', 
        code: 'MISSING_API_KEY',
        message: 'Weather API key is not configured on the server. Please contact the administrator.' 
      });
    }

    const url = `https://api.weatherapi.com/v1/current.json?key=${encodeURIComponent(key)}&q=${encodeURIComponent(lat)},${encodeURIComponent(lon)}&aqi=no`;
    const resp = await fetch(url);
    if (!resp.ok) return res.status(resp.status).json({ error: 'WeatherAPI request failed', detail: await resp.text().catch(() => '') });

    const data = await resp.json();
    const current = data?.current || {};
    const location = data?.location || {};

    const tempC = typeof current.temp_c === 'number' ? current.temp_c : null;
    const feelslikeC = typeof current.feelslike_c === 'number' ? current.feelslike_c : null;
    const humidityPct = (typeof current.humidity === 'number' && !isNaN(current.humidity)) ? current.humidity : null;
    const uvIndex = (typeof current.uv === 'number' && !isNaN(current.uv)) ? current.uv : null;
    const windKph = typeof current.wind_kph === 'number' ? current.wind_kph : null;
    const windMps = windKph != null ? windKph / 3.6 : null;
    const windDir = current.wind_dir || null;
    const pressureMb = typeof current.pressure_mb === 'number' ? current.pressure_mb : null;
    const cloudPct = typeof current.cloud === 'number' ? current.cloud : null;
    const visibilityKm = typeof current.vis_km === 'number' ? current.vis_km : null;
    const city = location.name || null;
    const region = location.region || null;
    const country = location.country || null;

    res.json({
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
      city,
      region,
      country,
    });
  } catch (err) {
    console.error('[weather] failed', err);
    res.status(500).json({ error: 'weather proxy failed' });
  }
});

// ---------------------------------------------------------------------------
// Frontend fallback (serves SPA/static assets via Express on Vercel)
// ---------------------------------------------------------------------------
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(WEB_ROOT, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  // Log more details about database errors
  if (err.message && (err.message.includes('Mongo') || err.message.includes('connection') || err.message.includes('timeout'))) {
    console.error('[Server Error] Database connection issue detected');
  }
  res.status(500).json({ 
    error: 'internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Closing MongoDB connection...`);
  try {
    if (mongoClient) {
      await mongoClient.close();
      console.log('MongoDB connection closed gracefully');
    }
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
/*
 * When running on traditional Node environments (e.g. during local development or when
 * executed directly via `node server.js`), we start the HTTP listener as usual.
 * However, on serverless platforms like Vercel the module is imported rather than
 * executed directly. In those cases `require.main` will not equal `module`, so
 * we skip calling `app.listen` and instead simply export the Express application.
 *
 * Vercel's Node.js runtime wraps the exported handler (in this case the Express
 * `app`) as a serverless function. Exporting the Express app allows Vercel to
 * handle incoming requests without needing a call to `app.listen`. The database
 * initialization is triggered on import via `getDb()`, ensuring that MongoDB
 * connection and indexes are prepared before handling requests.
 */
if (require.main === module) {
  // Only start the server if this script is executed directly (not in a serverless environment)
  getDb()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Hydration Coach API listening on port ${PORT}`);
        console.log(`MongoDB database: ${DB_NAME || 'default'}`);
      });
    })
    .catch(err => {
      console.error('Failed to start server:', err.message);
      process.exit(1);
    });
} else {
  // In serverless environments (e.g. Vercel), initialize the DB but do not start a listener
  getDb().catch(err => {
    console.error('Failed to initialize MongoDB in serverless context:', err.message);
  });
}

// Export the Express application for serverless platforms
module.exports = app;
module.exports.handler = app;
module.exports.default = app;

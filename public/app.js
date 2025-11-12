(function() {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  
  // API Configuration
  // For GitHub Pages or static hosting, set this to your API server URL
  // Example: 'https://your-api-server.herokuapp.com' or 'https://api.yourdomain.com'
  // Leave empty string '' for same-origin (when frontend and backend are on same domain)
  const API_BASE_URL = window.API_BASE_URL || '';
  
  // Helper to build API URLs
  const apiUrl = (path) => {
    // Remove leading slash from path if API_BASE_URL ends with slash, or ensure path starts with /
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return API_BASE_URL ? `${API_BASE_URL}${cleanPath}` : cleanPath;
  };
  
  // Weather fetching removed; inputs are manual now

  const PROFILE_PREF_DEFAULTS = {
    theme: 'auto',
    units: 'metric',
    dashboardDensity: 'comfortable',
    reduceMotion: false,
    browserPrompts: 'off'
  };

  const PROFILE_FOCUS_LABELS = {
    endurance: 'Endurance',
    strength: 'Strength & power',
    team: 'Team sport',
    heat: 'Heat acclimation'
  };
  const PROFILE_THEME_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  const PROFILE_UNIT_LABELS = { metric: 'Metric', imperial: 'Imperial' };
  const PROFILE_DENSITY_LABELS = { comfortable: 'Comfortable', compact: 'Compact' };
  const PROFILE_PROMPT_LABELS = {
    off: 'Off',
    nudges: 'Gentle nudges',
    all: 'All alerts'
  };
  const DEFAULT_WORKOUT_TYPE = 'run';
  const WORKOUT_TYPES = {
    run: { icon: '🏃', label: 'Running', description: 'Road, trail, treadmill' },
    walk: { icon: '🚶', label: 'Walking', description: 'Easy or brisk walks' },
    ride: { icon: '🚴', label: 'Biking', description: 'Road, MTB, or indoor' },
    strength: { icon: '🏋️', label: 'Strength', description: 'Lifts & circuits' },
    hike: { icon: '🥾', label: 'Hiking', description: 'Trail or ruck work' },
    team: { icon: '⚽', label: 'Team sport', description: 'Field or court play' }
  };
  function getWorkoutMeta(type) {
    return WORKOUT_TYPES[type] || WORKOUT_TYPES[DEFAULT_WORKOUT_TYPE];
  }

  function getWorkoutDisplayMeta(source) {
    if (!source || typeof source !== 'object') return null;
    const type = typeof source.workoutType === 'string'
      ? source.workoutType
      : (typeof source.type === 'string' ? source.type : null);
    const base = type ? getWorkoutMeta(type) : null;
    const label = source.workoutLabel || source.label || base?.label;
    const icon = source.workoutIcon || source.icon || base?.icon || '';
    if (!type && !label && !icon) return null;
    return {
      type: type || null,
      label: label || 'Workout',
      icon
    };
  }

  const UNIT_LABELS = {
    metric: {
      volume: 'L',
      volumeRate: 'L/hr',
      mass: 'kg',
      height: 'cm'
    },
    imperial: {
      volume: 'fl oz',
      volumeRate: 'fl oz/hr',
      mass: 'lb',
      height: 'ft / in'
    }
  };

  function normalizeProfile(profile, fallbackName = '') {
    const base = {
      name: fallbackName || '',
      age: null,
      location: '',
      tagline: '',
      massKg: null,
      heightCm: null,
      sweatRateLph: 1.0,
      restingHr: null,
      hydrationGoalL: 2.5,
      trainingFocus: '',
      accentColor: '#2563eb',
      preferences: { ...PROFILE_PREF_DEFAULTS }
    };
    const incoming = profile || {};
    const merged = { ...base, ...incoming };
    merged.preferences = { ...PROFILE_PREF_DEFAULTS, ...(incoming.preferences || {}) };
    if (!merged.name && fallbackName) merged.name = fallbackName;
    if (!merged.accentColor) merged.accentColor = '#2563eb';
    return merged;
  }

  const Views = {
    auth: $('#view-auth'),
    dashboard: $('#view-dashboard'),
    profile: $('#view-profile'),
    logs: $('#view-logs'),
  };

  const Nav = {
    container: $('#nav'),
    dash: $('#nav-dashboard'),
    profile: $('#nav-profile'),
    logs: $('#nav-logs'),
    logout: $('#nav-logout')
  };

  const Auth = {
    currentUserKey: 'hc_current_user',
    usersKey: 'hc_users',
    async hash(text) {
      const data = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },
    getUsers() {
      const raw = localStorage.getItem(this.usersKey);
      return raw ? JSON.parse(raw) : {};
    },
    setUsers(users) {
      localStorage.setItem(this.usersKey, JSON.stringify(users));
    },
    getCurrent() {
      const raw = localStorage.getItem(this.currentUserKey);
      return raw ? JSON.parse(raw) : null;
    },
    setCurrent(user) {
      localStorage.setItem(this.currentUserKey, JSON.stringify(user));
    },
    clearCurrent() {
      localStorage.removeItem(this.currentUserKey);
    },
    async register(name, email, password) {
      const users = this.getUsers();
      if (users[email]) throw new Error('Email already registered');
      const passwordHash = await this.hash(password);
      users[email] = {
        email,
        name,
        passwordHash,
        profile: normalizeProfile({ name }, name),
      };
      this.setUsers(users);
      // Best-effort server sync
      Api.upsertUser(users[email]).catch(() => {});
      return { email, name };
    },
    async login(email, password) {
      const passwordHash = await this.hash(password);
      let remoteError = null;
      try {
        const remoteUser = await Api.authLogin(email, passwordHash);
        if (remoteUser && remoteUser.email) {
          const users = this.getUsers();
          const updated = {
            email: remoteUser.email,
            name: remoteUser.name || '',
            passwordHash: remoteUser.passwordHash || passwordHash,
            privateKey: remoteUser.privateKey || users[email]?.privateKey,
            profile: normalizeProfile(remoteUser.profile, remoteUser.name || ''),
          };
          users[email] = { ...users[email], ...updated };
          this.setUsers(users);
          if (Array.isArray(remoteUser.logs)) {
            localStorage.setItem(Store.logsKey(email), JSON.stringify(remoteUser.logs));
          }
          if (Array.isArray(remoteUser.daily)) {
            localStorage.setItem(Store.dailyKey(email), JSON.stringify(remoteUser.daily));
          }
          this.setCurrent({ email });
          return { email };
        }
      } catch (err) {
        console.warn('[Auth] Remote login failed, attempting fallback:', err?.message || err);
        remoteError = err;
      }

      // Fallback: load entire snapshot or use local storage
      const serverUsers = await Api.loadUsers();
      let users = this.getUsers();
      let user = null;

      if (serverUsers && typeof serverUsers === 'object' && Object.keys(serverUsers).length > 0) {
        console.log('[Auth] Using database data for login (fallback snapshot)');
        this.setUsers(serverUsers);
        users = serverUsers;
        user = users[email];

        Object.values(serverUsers).forEach(u => {
          if (u && u.email) {
            const logs = Array.isArray(u.logs) ? u.logs : [];
            localStorage.setItem(Store.logsKey(u.email), JSON.stringify(logs));
            const daily = Array.isArray(u.daily) ? u.daily : [];
            localStorage.setItem(Store.dailyKey(u.email), JSON.stringify(daily));
          }
        });
      } else {
        console.warn('[Auth] Database unavailable, using local storage for login');
        user = users[email];
      }

      if (!user) {
        if (remoteError?.status === 503) {
          throw new Error('Server database is temporarily unavailable. Please try again shortly.');
        }
        throw new Error('Invalid credentials');
      }
      if (passwordHash !== user.passwordHash) throw new Error('Invalid credentials');
      this.setCurrent({ email });
      return { email };
    },
    me() {
      const current = this.getCurrent();
      if (!current) return null;
      const users = this.getUsers();
      return users[current.email] || null;
    },
    saveProfile(profile = {}) {
      const current = this.getCurrent();
      if (!current) return;
      const users = this.getUsers();
      const user = users[current.email];
      if (!user) return;
      const existingProfile = user.profile || {};
      const merged = { ...existingProfile, ...profile };
      if (profile.preferences) {
        merged.preferences = {
          ...(existingProfile.preferences || {}),
          ...profile.preferences
        };
      }
      user.profile = normalizeProfile(merged, profile.name || user.name || '');
      if (profile.name) user.name = profile.name;
      this.setUsers(users);
      // Best-effort server sync
      Api.upsertUser(users[current.email]).catch(() => {});
    }
  };

  const LITER_TO_FLOZ = 33.814;
  const KG_TO_LB = 2.20462;
  const CM_TO_IN = 0.393701;
  const MPS_TO_MPH = 2.23694;
  const MPS_TO_KPH = 3.6;

  function getActiveProfile() {
    const me = Auth.me();
    if (!me) return normalizeProfile({}, '');
    return normalizeProfile(me.profile, me.name || '');
  }

  function getCurrentPreferences() {
    const profile = getActiveProfile();
    return profile.preferences || { ...PROFILE_PREF_DEFAULTS };
  }

  function isImperialUnits(prefs = getCurrentPreferences()) {
    return (prefs?.units || 'metric') === 'imperial';
  }

  function roundValue(value, digits = 1) {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Number(num.toFixed(digits));
  }

  function formatVolume(valueL, { prefs = getCurrentPreferences(), withUnit = true, digits } = {}) {
    if (valueL === null || valueL === undefined) return '—';
    const num = Number(valueL);
    if (!Number.isFinite(num)) return '—';
    const imperial = isImperialUnits(prefs);
    const unit = imperial ? UNIT_LABELS.imperial.volume : UNIT_LABELS.metric.volume;
    const converted = imperial ? num * LITER_TO_FLOZ : num;
    const formatted = roundValue(converted, digits ?? (imperial ? 0 : 1));
    if (formatted === null) return '—';
    return withUnit ? `${formatted} ${unit}` : `${formatted}`;
  }

  function formatVolumeRate(valueLph, { prefs = getCurrentPreferences(), withUnit = true, digits } = {}) {
    if (valueLph === null || valueLph === undefined) return '—';
    const num = Number(valueLph);
    if (!Number.isFinite(num)) return '—';
    const imperial = isImperialUnits(prefs);
    const unit = imperial ? UNIT_LABELS.imperial.volumeRate : UNIT_LABELS.metric.volumeRate;
    const converted = imperial ? num * LITER_TO_FLOZ : num;
    const formatted = roundValue(converted, digits ?? (imperial ? 0 : 2));
    if (formatted === null) return '—';
    return withUnit ? `${formatted} ${unit}` : `${formatted}`;
  }

  function formatVolumeDelta(valueL, options = {}) {
    if (valueL === null || valueL === undefined) return '—';
    const num = Number(valueL);
    if (!Number.isFinite(num)) return '—';
    const abs = Math.abs(num);
    const body = formatVolume(abs, options);
    if (body === '—') return '—';
    if (num === 0) return body;
    const sign = num > 0 ? '+' : '-';
    return `${sign}${body}`;
  }

  function formatMass(valueKg, { prefs = getCurrentPreferences(), withUnit = true, digits } = {}) {
    if (valueKg === null || valueKg === undefined) return '—';
    const num = Number(valueKg);
    if (!Number.isFinite(num)) return '—';
    const imperial = isImperialUnits(prefs);
    const unit = imperial ? UNIT_LABELS.imperial.mass : UNIT_LABELS.metric.mass;
    const converted = imperial ? num * KG_TO_LB : num;
    const formatted = roundValue(converted, digits ?? (imperial ? 0 : 1));
    if (formatted === null) return '—';
    return withUnit ? `${formatted} ${unit}` : `${formatted}`;
  }

  function formatHeight(valueCm, { prefs = getCurrentPreferences(), withUnit = true } = {}) {
    if (valueCm === null || valueCm === undefined) return '—';
    const num = Number(valueCm);
    if (!Number.isFinite(num)) return '—';
    if (isImperialUnits(prefs)) {
      const totalInches = num * CM_TO_IN;
      const feet = Math.floor(totalInches / 12);
      const inches = Math.round(totalInches - feet * 12);
      const text = `${feet}'${inches}"`;
      return withUnit ? `${text}` : text;
    }
    const formatted = roundValue(num, 0);
    if (formatted === null) return '—';
    return withUnit ? `${formatted} ${UNIT_LABELS.metric.height}` : `${formatted}`;
  }

  function formatTemperature(valueC, { prefs = getCurrentPreferences(), withUnit = true } = {}) {
    if (valueC === null || valueC === undefined) return '—';
    const num = Number(valueC);
    if (!Number.isFinite(num)) return '—';
    const imperial = isImperialUnits(prefs);
    const value = imperial ? (num * 9/5) + 32 : num;
    const unit = imperial ? '°F' : '°C';
    const formatted = roundValue(value, imperial ? 0 : 1);
    if (formatted === null) return '—';
    return withUnit ? `${formatted}${unit}` : `${formatted}`;
  }

  function formatWindSpeed(valueMps, { prefs = getCurrentPreferences(), withUnit = true } = {}) {
    if (valueMps === null || valueMps === undefined) return null;
    const num = Number(valueMps);
    if (!Number.isFinite(num)) return null;
    const imperial = isImperialUnits(prefs);
    const unit = imperial ? 'mph' : 'km/h';
    const value = imperial ? num * MPS_TO_MPH : num * MPS_TO_KPH;
    const formatted = roundValue(value, 0);
    if (formatted === null) return null;
    return withUnit ? `${formatted} ${unit}` : `${formatted}`;
  }

  function applyPreferenceEffects(profile) {
    const prefs = profile?.preferences || PROFILE_PREF_DEFAULTS;
    const body = document.body;
    if (body) {
      body.classList.toggle('density-compact', prefs.dashboardDensity === 'compact');
      body.dataset.units = prefs.units || 'metric';
    }
  }

  const Store = {
    logsKey(email) { return `hc_logs_${email}`; },
    getLogs(email) {
      const raw = localStorage.getItem(this.logsKey(email));
      return raw ? JSON.parse(raw) : [];
    },
    addLog(email, log) {
      const logs = this.getLogs(email);
      logs.unshift(log);
      localStorage.setItem(this.logsKey(email), JSON.stringify(logs));
      // Best-effort server sync
      Api.addLog(email, log).catch(() => {});
    },
    updateLog(email, index, updater) {
      const logs = this.getLogs(email);
      if (index < 0 || index >= logs.length) return;
      const updated = updater({ ...logs[index] });
      logs[index] = updated;
      localStorage.setItem(this.logsKey(email), JSON.stringify(logs));
      // Sync to server
      Api.updateLog(email, updated.ts, updated.actualIntakeL).catch(() => {});
    },
    dailyKey(email) { return `hc_daily_${email}`; },
    getDaily(email) {
      const raw = localStorage.getItem(this.dailyKey(email));
      return raw ? JSON.parse(raw) : [];
    },
    upsertDaily(email, entry) {
      if (!entry || !entry.date) return null;
      const list = this.getDaily(email);
      const idx = list.findIndex(d => d.date === entry.date);
      const base = idx >= 0 ? list[idx] : { date: entry.date };
      const merged = mergeDailyRecords(base, entry);
      if (idx >= 0) list[idx] = merged; else list.push(merged);
      localStorage.setItem(this.dailyKey(email), JSON.stringify(list));
      Api.addDaily(email, merged).catch(() => {});
      return merged;
    },
    findDailyByDate(email, date) {
      if (!date) return null;
      const list = this.getDaily(email);
      return list.find((d) => d.date === date) || null;
    },
    ensureDailyRecord(email, date) {
      if (!date) return null;
      const list = this.getDaily(email);
      const existing = list.find((d) => d.date === date);
      if (existing) return existing;
      const placeholder = mergeDailyRecords(
        { date, metrics: {} },
        {}
      );
      list.push(placeholder);
      localStorage.setItem(this.dailyKey(email), JSON.stringify(list));
      return placeholder;
    }
  };

  function mergeDailyRecords(existing, incoming) {
    const metrics = { ...(existing.metrics || {}) };
    if (incoming.metrics) {
      Object.entries(incoming.metrics).forEach(([key, value]) => {
        if (value !== undefined && value !== null) metrics[key] = value;
      });
    }
    const merged = {
      ...existing,
      ...incoming,
      metrics
    };
    const incomingUrine = incoming.urine?.entries;
    const existingUrine = existing.urine?.entries;
    if (incomingUrine || existingUrine) {
      const prioritized = incomingUrine ?? existingUrine ?? [];
      merged.urine = { entries: normalizeUrineEntriesForStorage(prioritized) };
    }
    const incomingHydration = incoming.hydration;
    const existingHydration = existing.hydration;
    if (incomingHydration || existingHydration) {
      // Merge hydration data: prefer incoming if present, otherwise keep existing
      if (incomingHydration) {
        merged.hydration = {
          entries: Array.isArray(incomingHydration.entries) 
            ? normalizeHydrationEntriesForStorage(incomingHydration.entries)
            : (existingHydration?.entries || []),
          totalL: Number.isFinite(incomingHydration.totalL) 
            ? Number(incomingHydration.totalL) 
            : (existingHydration?.totalL || 0)
        };
      } else if (existingHydration) {
        merged.hydration = {
          entries: Array.isArray(existingHydration.entries)
            ? normalizeHydrationEntriesForStorage(existingHydration.entries)
            : [],
          totalL: Number.isFinite(existingHydration.totalL) ? Number(existingHydration.totalL) : 0
        };
      }
    }
    return merged;
  }

  function normalizeHydrationEntriesForStorage(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
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

  function normalizeUrineEntriesForStorage(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
      .map((sample) => normalizeUrineEntryForStorage(sample))
      .filter(Boolean);
  }

  function normalizeUrineEntryForStorage(sample) {
    if (!sample || typeof sample !== 'object') return null;
    const rawLevel = sample.level ?? sample.sampleValue ?? sample.value;
    const numericLevel = Number(rawLevel);
    const level = Number.isFinite(numericLevel)
      ? Math.min(10, Math.max(1, Math.round(numericLevel)))
      : 5;
    const recordedAt = normalizeUrineTimestamp(sample.recordedAt || sample.time);
    return { level, recordedAt };
  }

  function normalizeUrineTimestamp(value) {
    if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value)) {
      const today = new Date();
      const [hrs, mins] = value.split(':').map((part) => Number(part));
      if (Number.isInteger(hrs) && Number.isInteger(mins)) {
        today.setHours(hrs, mins, 0, 0);
        return today.toISOString();
      }
    }
    if (value) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return new Date().toISOString();
  }

  function latestUrineEntry(record) {
    const list = record?.urine?.entries;
    if (!Array.isArray(list) || !list.length) return null;
    return list.slice().sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))[0];
  }

  function caffeineToMg(value, unit) {
    const numeric = Number(value) || 0;
    if (!numeric) return 0;
    if (unit === 'cups') return Math.round(numeric * 95);
    return numeric;
  }

  function getDailyHydrationContext(email, date) {
    const record = Store.findDailyByDate(email, date);
    const metrics = record?.metrics || {};
    const fluidPriorL = Number(metrics.fluidL) || 0;
    const alcoholDrinks = Number(metrics.alcohol) || 0;
    const caffeineMetric = metrics.caffeine;
    const caffeineMg = caffeineMetric ? caffeineToMg(caffeineMetric.value, caffeineMetric.unit) : 0;
    return {
      record,
      fluidPriorL,
      alcoholDrinks,
      caffeineMg,
      urineEntry: latestUrineEntry(record)
    };
  }

  // --- Server API (best-effort; app still works offline) ---
  const Api = {
    async ping() {
      try { const r = await fetch(apiUrl('/api/ping')); return r.ok; } catch { return false; }
    },
    async authLogin(email, passwordHash) {
      try {
        const resp = await fetch(apiUrl('/api/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, passwordHash })
        });
        if (!resp.ok) {
          let payload = null;
          try {
            payload = await resp.json();
          } catch {
            const text = await resp.text().catch(() => '');
            payload = text ? { message: text } : null;
          }
          const error = new Error(
            payload?.message ||
            payload?.error ||
            (resp.status === 503 ? 'Database temporarily unavailable' : 'Login failed')
          );
          error.status = resp.status;
          if (payload?.detail) error.detail = payload.detail;
          throw error;
        }
        return await resp.json();
      } catch (err) {
        console.error('[API] Login request failed:', err);
        throw err;
      }
    },
    async getWeather(lat, lon) {
      try {
        console.log('[Weather API] Requesting weather for:', { lat, lon });
        const r = await fetch(apiUrl(`/api/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`));
        if (!r.ok) {
          let errorData;
          try {
            errorData = await r.json();
          } catch {
            const errorText = await r.text().catch(() => 'Unknown error');
            errorData = { error: errorText };
          }
          console.error('[Weather API] Server error:', r.status, errorData);
          // Return error info instead of throwing, so caller can handle it
          return { 
            error: true, 
            status: r.status, 
            code: errorData.code,
            message: errorData.message || errorData.error || 'Weather service unavailable'
          };
        }
        const data = await r.json();
        console.log('[Weather API] Server response:', data);
        return data;
      } catch (e) {
        console.error('[Weather API] Error:', e);
        return { error: true, message: 'Network error: Could not reach weather service' };
      }
    },
    async loadUsers() {
      try {
        const r = await fetch(apiUrl('/api/users'));
        if (!r.ok) {
          let message = 'Unknown error';
          try {
            const body = await r.json();
            message = body?.message || body?.error || message;
          } catch {
            message = await r.text().catch(() => message);
          }
          console.error('[API] Failed to load users:', r.status, message);
          return null;
        }
        const data = await r.json();
        console.log('[API] Successfully loaded users from database:', Object.keys(data).length, 'users');
        return data;
      } catch (e) {
        console.error('[API] Error loading users from database:', e);
        // Return null to indicate failure, but log it so we know what's happening
        return null;
      }
    },
    async upsertUser(user) {
      try {
        await fetch(apiUrl('/api/users'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(user)
        });
      } catch {}
    },
    async replaceAllUsers(users) {
      try {
        await fetch(apiUrl('/api/users'), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(users)
        });
      } catch {}
    },
    async addLog(email, log) {
      try {
        await fetch(apiUrl('/api/logs'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, log })
        });
      } catch {}
    },
    async addDaily(email, entry) {
      try {
        await fetch(apiUrl('/api/daily'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, entry })
        });
      } catch {}
    },
    async updateLog(email, ts, actualIntakeL) {
      try {
        await fetch(apiUrl('/api/logs/update'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, ts, actualIntakeL })
        });
      } catch {}
    },
  };

  const Ui = {
    show(view) {
      Object.values(Views).forEach(v => v.classList.add('hidden'));
      view.classList.remove('hidden');
    },
    setAuthed(isAuthed) {
      if (isAuthed) {
        Nav.container.classList.remove('hidden');
        Views.auth.classList.add('hidden');
      } else {
        Nav.container.classList.add('hidden');
        this.show(Views.auth);
      }
    },
    toast(msg) { alert(msg); }
  };

  const Recommendation = {
    // Estimate sweat rate (L/hr) using RPE, apparent heat, humidity, UV, and wind
    estimateSweatRateLph({ rpe, tempC, humidityPct, apparentTempC, uvIndex, windSpeedMps, userBaselineLph }) {
      const baseline = userBaselineLph || 1.0;
      const perceivedEffort = 0.15 * (rpe - 5); // +/- 0.75 across 1-10
      const heatRef = (typeof apparentTempC === 'number') ? apparentTempC : tempC;
      const heatFactor = Math.max(0, (heatRef - 20)) * 0.03; // °C above 20
      const humidFactor = Math.max(0, (humidityPct - 50)) * 0.005; // % above 50
      const uv = Math.max(0, (uvIndex || 0));
      const uvFactor = Math.min(0.4, uv * 0.03); // up to +0.4 @ ~13+
      const wind = Math.max(0, (windSpeedMps || 0));
      const windCooling = Math.min(0.25, wind * 0.02); // reduce up to 0.25
      const est = Math.max(0.3, baseline + perceivedEffort + heatFactor + humidFactor + uvFactor - windCooling);
      return Number(est.toFixed(2));
    },
    planLiters({
      rpe,
      durationMin,
      tempC,
      humidityPct,
      preScore,
      uvIndex,
      fluidPriorL,
      caffeineMg,
      alcoholDrinks,
      urineColor,
      massKg
    }) {
      const minutes = Math.max(Number(durationMin) || 0, 0);
      const safeTemp = Number.isFinite(tempC) ? tempC : 20;
      const safeHum = Number.isFinite(humidityPct) ? humidityPct : 40;
      const safeUv = Number.isFinite(uvIndex) ? uvIndex : 3;
      const srRpe = 0.18 + 0.12 * (Number(rpe) || 0);
      const fT = clamp(1 + 0.03 * (safeTemp - 20), 0.7, 2.0);
      const fH = clamp(1 + 0.004 * (safeHum - 40), 0.8, 1.6);
      const fU = clamp(1 + 0.02 * (safeUv - 3), 0.9, 1.4);
      const sweatRate = srRpe * fT * fH * fU;
      const sweatLoss = sweatRate * (minutes / 60);
      const S_PH = 0.25 * ((Number(preScore) || 0) - 3);
      const uc = Number(urineColor);
      const S_UC_raw = 0.5 * ((5 - (Number.isFinite(uc) ? uc : 5)) / 4);
      const S_UC = clamp(S_UC_raw, -0.5, 0.5);
      const S_start = 0.6 * S_UC + 0.4 * S_PH;
      const P_alc = 0.10 * (Number(alcoholDrinks) || 0);
      const cafMg = Number(caffeineMg) || 0;
      const P_caf = 0.10 * Math.max(cafMg - 200, 0) / 200;
      const priorFluids = Number(fluidPriorL) || 0;
      const F_eff = priorFluids + S_start - (P_alc + P_caf);
      const drinkDuring = Math.max(0, 0.70 * sweatLoss - F_eff);
      const drinkPost = Math.max(0, sweatLoss - drinkDuring - F_eff);
      const pctBodyMassLoss = massKg ? Number(((sweatLoss / massKg) * 100).toFixed(2)) : null;
      const totalTarget = drinkDuring + drinkPost;
      const sodiumGuide = { low: 300, high: 600 };
      const avgSodium = (sodiumGuide.low + sodiumGuide.high) / 2;
      return {
        sweatRate: Number(sweatRate.toFixed(2)),
        sweatLoss: Number(sweatLoss.toFixed(2)),
        drinkDuring: Number(drinkDuring.toFixed(2)),
        drinkPost: Number(drinkPost.toFixed(2)),
        totalTargetL: Number(totalTarget.toFixed(2)),
        netNeedL: Number(totalTarget.toFixed(2)),
        grossLossL: Number(sweatLoss.toFixed(2)),
        duringL: Number(drinkDuring.toFixed(2)),
        postL: Number(drinkPost.toFixed(2)),
        adjustments: {
          slider: Number(S_PH.toFixed(2)),
          urine: Number(S_UC.toFixed(2)),
          blendedStart: Number(S_start.toFixed(2)),
          alcohol: Number(P_alc.toFixed(2)),
          caffeine: Number(P_caf.toFixed(2)),
          fluidPrior: Number(priorFluids.toFixed(2)),
          effectivePre: Number(F_eff.toFixed(2))
        },
        factors: {
          temp: Number(fT.toFixed(2)),
          humidity: Number(fH.toFixed(2)),
          uv: Number(fU.toFixed(2))
        },
        sodium: sodiumGuide,
        sodiumMgPerL: Math.round(avgSodium),
        pctBodyMassLoss
      };
    },
    statusBadge(pctLoss) {
      if (pctLoss == null) return { cls: 'badge', text: 'Set body mass for % loss' };
      if (pctLoss < 2) return { cls: 'badge ok', text: `${pctLoss}% est. loss (OK)` };
      if (pctLoss < 3) return { cls: 'badge warn', text: `${pctLoss}% est. loss (Monitor)` };
      return { cls: 'badge danger', text: `${pctLoss}% est. loss (High)` };
    }
  };

  function buildDrinkSchedule(durationMin, duringLiters) {
    if (!durationMin || durationMin <= 0 || !duringLiters || duringLiters <= 0) return [];
    const targetInterval = durationMin <= 40 ? 10 : durationMin <= 70 ? 15 : 20;
    const slots = Math.max(1, Math.round(durationMin / targetInterval));
    const intervalMinutes = durationMin / slots;
    const perSlot = duringLiters / slots;
    return Array.from({ length: slots }, (_, idx) => {
      const rawMinute = Math.round(intervalMinutes * (idx + 1));
      const roundedMinute = Math.min(durationMin, Math.max(5, Math.round(rawMinute / 5) * 5));
      return {
        atMin: roundedMinute,
        volumeL: Number(perSlot.toFixed(2))
      };
    });
  }

  function renderPlanDetails(out, { plan, input, weather }) {
    if (!out || !plan || !input) return;
    const prefs = getCurrentPreferences();
    const badge = Recommendation.statusBadge(plan.pctBodyMassLoss);
    const schedule = buildDrinkSchedule(input.durationMin, plan.drinkDuring ?? plan.duringL);
    const adjustments = plan.adjustments || {};
    const sodiumGuide = plan.sodium || (plan.sodiumMgPerL
      ? { low: plan.sodiumMgPerL, high: plan.sodiumMgPerL }
      : { low: 300, high: 600 });
    const windMps = weather?.windMps ?? (typeof weather?.windKph === 'number' ? weather.windKph / 3.6 : null);
    const tempDisplay = formatTemperature(input.tempC ?? weather?.tempC, { prefs });
    const windDisplay = formatWindSpeed(windMps, { prefs });
    const workoutMeta = getWorkoutDisplayMeta(input);
    const metaParts = [
      workoutMeta ? `${workoutMeta.icon ? `${workoutMeta.icon} ` : ''}${workoutMeta.label}` : '',
      `RPE ${input.rpe}/10`,
      `${input.durationMin} min`,
      tempDisplay,
      `${input.humidityPct}% RH`,
      `UV ${input.uvIndex ?? weather?.uvIndex ?? 'n/a'}`,
      windDisplay ? `Wind ${windDisplay}` : '',
      input.urineColor ? `Urine Lv ${input.urineColor}${input.urineStatus ? ` (${input.urineStatus})` : ''}` : '',
      weather?.city || weather?.region || weather?.country || ''
    ].filter(Boolean);
    const scheduleList = schedule.length
      ? schedule.map((slot) => `
        <li>
          <span>${slot.atMin} min</span>
          <div>
            <strong>${formatVolume(slot.volumeL, { prefs })}</strong>
            <small>sip + electrolytes</small>
          </div>
        </li>
      `).join('')
      : `
        <li>
          <span>Short session</span>
          <div>
            <strong>Optional</strong>
            <small>during fluids not required</small>
          </div>
        </li>
      `;
    const drinkDuring = plan.drinkDuring ?? plan.duringL ?? 0;
    const drinkPost = plan.drinkPost ?? plan.postL ?? 0;
    const totalTarget = plan.totalTargetL ?? plan.netNeedL ?? planNeedValue(plan);
    const totalTargetDisplay = formatVolume(totalTarget, { prefs });
    const drinkDuringDisplay = formatVolume(drinkDuring, { prefs });
    const drinkPostDisplay = formatVolume(drinkPost, { prefs });
    const sweatLossDisplay = formatVolume(plan.sweatLoss ?? plan.grossLossL, { prefs });
    const sweatRateDisplay = formatVolumeRate(plan.sweatRate, { prefs });
    const sodiumRange = `${sodiumGuide.low}–${sodiumGuide.high} mg/L`;
    const avgSodium = (sodiumGuide.low + sodiumGuide.high) / 2;
    const perHalfValue = Number.isFinite(avgSodium) ? Math.round(avgSodium * 0.5) : null;
    const totalSodiumLow = Number.isFinite(sodiumGuide.low * drinkDuring) ? Math.round(drinkDuring * sodiumGuide.low) : null;
    const totalSodiumHigh = Number.isFinite(sodiumGuide.high * drinkDuring) ? Math.round(drinkDuring * sodiumGuide.high) : null;
    const totalRange = drinkDuring > 0 && totalSodiumLow != null && totalSodiumHigh != null
      ? `${totalSodiumLow}–${totalSodiumHigh} mg total for the during volume`
      : 'Add electrolytes if you sip during this session.';
    const perHalfText = perHalfValue != null ? `${perHalfValue} mg` : 'n/a';
    const perHalfLabel = isImperialUnits(prefs) ? 'per 17 fl oz' : 'per 500 mL';
    const duringNote = drinkDuring > 0
      ? 'Aim to finish this volume by the start of cooldown.'
      : 'Session is short enough that mid-session sipping is optional.';
    const sliderAdj = typeof adjustments.slider === 'number'
      ? `${formatVolumeDelta(adjustments.slider, { prefs })} self-check`
      : 'Self-check slider unavailable';
    const urineAdj = typeof adjustments.urine === 'number'
      ? `${formatVolumeDelta(adjustments.urine, { prefs })} urine signal`
      : 'Urine signal unavailable';
    const caffeineAdj = typeof adjustments.caffeine === 'number'
      ? `-${formatVolume(adjustments.caffeine, { prefs })} caffeine penalty`
      : 'Caffeine penalty unavailable';
    const alcoholAdj = typeof adjustments.alcohol === 'number'
      ? `-${formatVolume(adjustments.alcohol, { prefs })} alcohol penalty`
      : 'Alcohol penalty unavailable';
    const fluidAdj = typeof adjustments.fluidPrior === 'number'
      ? `${formatVolume(adjustments.fluidPrior, { prefs })} already consumed`
      : 'Pre-drank value unavailable';
    const blendedAdj = typeof adjustments.blendedStart === 'number'
      ? `${formatVolumeDelta(adjustments.blendedStart, { prefs })} combined preload`
      : null;
    const effectivePreload = Number.isFinite(adjustments.effectivePre)
      ? formatVolume(adjustments.effectivePre, { prefs })
      : '—';
    out.innerHTML = `
      <div class="plan-result-card">
        <div class="plan-result-head plan-total-head">
          <div class="plan-total-stack">
            <p class="eyebrow">Total hydration</p>
            <div class="plan-total-value">${totalTargetDisplay}</div>
            <div class="plan-total-sub">
              <small>During ${drinkDuringDisplay}</small>
              <small>Post ${drinkPostDisplay}</small>
            </div>
          </div>
          <span class="${badge.cls}">${badge.text}</span>
        </div>
        <div class="plan-result-meta">${metaParts.join(' • ')}</div>
        <div class="plan-metrics-grid plan-activity-metrics">
          <div>
            <span>Expected sweat loss</span>
            <strong>${sweatLossDisplay}</strong>
          </div>
          <div>
            <span>Sweat rate</span>
            <strong>${sweatRateDisplay}</strong>
          </div>
          <div>
            <span>Session RPE</span>
            <strong>${input.rpe}/10</strong>
          </div>
          <div>
            <span>Duration</span>
            <strong>${input.durationMin} min</strong>
          </div>
        </div>
        <div class="plan-block plan-guidance">
          <div class="plan-block-title">Execution guidance</div>
          <p><strong>During:</strong> ${drinkDuringDisplay} — ${duringNote}</p>
          <p><strong>Post:</strong> ${drinkPostDisplay} — Replace remaining loss within 60 minutes.</p>
        </div>
        <div class="plan-block">
          <div class="plan-block-title">Pre-hydration impact</div>
          <p>Effective preload: <strong>${effectivePreload}</strong></p>
          <ul class="plan-list">
            ${[fluidAdj, sliderAdj, urineAdj, blendedAdj, caffeineAdj, alcoholAdj]
              .filter(Boolean)
              .map(item => `<li>${item}</li>`)
              .join('')}
          </ul>
        </div>
        <div class="plan-block">
          <div class="plan-block-title">Electrolyte targets</div>
          <p>Keep mixes between <strong>${sodiumRange}</strong> (~${perHalfText} ${perHalfLabel}). ${totalRange}</p>
        </div>
        <div class="plan-block">
          <div class="plan-block-title">During-workout sip plan</div>
          <ol class="plan-schedule">
            ${scheduleList}
          </ol>
        </div>
      </div>
    `;
  }

  function planNeedValue(plan) {
    if (!plan) return 0;
    if (typeof plan.totalTargetL === 'number') return plan.totalTargetL;
    if (typeof plan.netNeedL === 'number') return plan.netNeedL;
    if (typeof plan.sweatLoss === 'number') return plan.sweatLoss;
    if (typeof plan.grossLossL === 'number') return plan.grossLossL;
    return 0;
  }

  const MAX_DAILY_POINTS = 7;
  const MAX_URINE_DAYS = 7;

  function drawDailyMetricChart(canvas, entries, accessor, options = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.clientWidth || 0;
    const height = canvas.clientHeight || 0;
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (dpr !== 1) ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const label = options.label || '';
    ctx.fillStyle = '#9bb0d3';
    ctx.font = '12px system-ui, -apple-system, Segoe UI';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (label) ctx.fillText(label, 12, 18);
    const trimmed = entries.slice(-MAX_DAILY_POINTS).map(entry => ({
      label: entry.date?.slice(5) || '',
      value: Math.max(0, Number(accessor(entry)) || 0)
    }));
    const data = trimmed.filter(sample => Number.isFinite(sample.value));
    if (!data.length) {
      ctx.fillText(options.emptyMessage || 'No data yet', 12, height / 2);
      return;
    }
    const pad = { left: 40, right: 20, top: 30, bottom: 35 };
    const chartHeight = Math.max(1, height - pad.top - pad.bottom);
    const availableWidth = Math.max(1, width - pad.left - pad.right);
    const gap = 10;
    const barWidth = Math.max(8, (availableWidth - gap * (data.length - 1)) / data.length);
    const maxValue = Math.max(options.maxValue || 0, ...data.map(d => d.value), 1);
    ctx.strokeStyle = 'rgba(148,163,184,.35)';
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + chartHeight);
    ctx.lineTo(width - pad.right, pad.top + chartHeight);
    ctx.stroke();
    data.forEach((sample, idx) => {
      const x = pad.left + idx * (barWidth + gap);
      const barHeight = (sample.value / maxValue) * chartHeight;
      ctx.fillStyle = options.color || '#3b82f6';
      ctx.fillRect(x, pad.top + chartHeight - barHeight, barWidth, barHeight);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '10px system-ui, -apple-system';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(sample.value.toFixed(1), x + barWidth / 2, pad.top + chartHeight - barHeight - 4);
      ctx.textBaseline = 'top';
      ctx.fillText(sample.label, x + barWidth / 2, height - pad.bottom + 6);
    });
  }

  function drawUrineTrendChart(canvas, entries, options = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.clientWidth || 0;
    const height = canvas.clientHeight || 0;
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (dpr !== 1) ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const minLevel = 1;
    const maxLevel = 10;
    const dataset = (entries || []).map((entry) => {
      const samples = Array.isArray(entry?.urine?.entries) ? [...entry.urine.entries] : [];
      if (!samples.length) {
        return {
          date: entry?.date || '',
          label: entry?.date ? entry.date.slice(5) : '',
          hasData: false,
          levels: []
        };
      }
      const ordered = samples.sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
      const normalized = ordered
        .map(sample => clamp(Number(sample.level), minLevel, maxLevel))
        .filter(level => Number.isFinite(level));
      if (!normalized.length) {
        return {
          date: entry?.date || '',
          label: entry?.date ? entry.date.slice(5) : '',
          hasData: false,
          levels: []
        };
      }
      const startLevel = normalized[0];
      const latestLevel = normalized[normalized.length - 1];
      const avg = normalized.reduce((sum, lvl) => sum + lvl, 0) / normalized.length;
      const meta = getUrineLevelMeta(latestLevel);
      return {
        date: entry.date,
        label: entry.date?.slice(5) || entry.date,
        hasData: true,
        start: startLevel,
        end: latestLevel,
        min: Math.min(...normalized),
        max: Math.max(...normalized),
        avg,
        color: meta.color,
        status: meta.status,
        levels: normalized
      };
    });
    const windowData = dataset.slice(-MAX_URINE_DAYS);
    const sampleCount = windowData.reduce((sum, point) => sum + (point.levels ? point.levels.length : 0), 0);
    if (!windowData.length || sampleCount === 0) {
      ctx.fillStyle = '#9bb0d3';
      ctx.font = '12px system-ui, -apple-system, Segoe UI';
      ctx.fillText(options.emptyMessage || 'No urine samples logged yet.', 12, height / 2);
      return;
    }
    const pad = { top: 32, right: 70, bottom: 36, left: 50 };
    const chartWidth = Math.max(1, width - pad.left - pad.right);
    const chartHeight = Math.max(1, height - pad.top - pad.bottom);
    const yFor = (val) => pad.top + chartHeight - ((val - minLevel) / (maxLevel - minLevel)) * chartHeight;
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartHeight);
    gradient.addColorStop(0, 'rgba(248,113,113,0.25)');
    gradient.addColorStop(0.55, 'rgba(250,204,21,0.14)');
    gradient.addColorStop(1, 'rgba(134,239,172,0.18)');
    ctx.fillStyle = gradient;
    ctx.fillRect(pad.left, pad.top, chartWidth, chartHeight);

    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, -apple-system';
    ctx.fillStyle = '#9bb0d3';
    for (let level = minLevel; level <= maxLevel; level += 1) {
      const y = yFor(level);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + chartWidth, y);
      ctx.stroke();
      if (level === minLevel || level === maxLevel || level % 2 === 0) {
        ctx.fillText(`Lv ${level}`, width - pad.right + 8, y + 3);
      }
    }

    const barGap = 8;
    const barWidth = Math.max(10, (chartWidth - barGap * (windowData.length - 1)) / windowData.length);

    let cumulativeSum = 0;
    let cumulativeCount = 0;
    const runningAverages = windowData.map((point) => {
      if (point.levels && point.levels.length) {
        cumulativeSum += point.levels.reduce((acc, lvl) => acc + lvl, 0);
        cumulativeCount += point.levels.length;
      }
      return cumulativeCount > 0 ? (cumulativeSum / cumulativeCount) : null;
    });
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    runningAverages.forEach((avg, idx) => {
      if (avg == null) return;
      const x = pad.left + idx * (barWidth + barGap) + barWidth / 2;
      const y = yFor(avg);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    ctx.restore();

    const lastAvgIndex = (() => {
      for (let i = runningAverages.length - 1; i >= 0; i -= 1) {
        if (runningAverages[i] != null) return i;
      }
      return -1;
    })();
    if (lastAvgIndex >= 0) {
      const lastAvg = runningAverages[lastAvgIndex];
      const labelX = pad.left + lastAvgIndex * (barWidth + barGap) + barWidth / 2 + 6;
      const labelY = yFor(lastAvg);
      ctx.fillStyle = '#60a5fa';
      ctx.font = '10px system-ui, -apple-system';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`run avg ${lastAvg.toFixed(1)}`, labelX, labelY - 4);
    }

    windowData.forEach((point, idx) => {
      const x = pad.left + idx * (barWidth + barGap);
      const center = x + barWidth / 2;
      if (!point.hasData) return;
      const whiskerTop = yFor(point.max);
      const whiskerBottom = yFor(point.min);
      ctx.strokeStyle = 'rgba(148,163,184,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(center, whiskerTop);
      ctx.lineTo(center, whiskerBottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(center - barWidth * 0.35, whiskerTop);
      ctx.lineTo(center + barWidth * 0.35, whiskerTop);
      ctx.moveTo(center - barWidth * 0.35, whiskerBottom);
      ctx.lineTo(center + barWidth * 0.35, whiskerBottom);
      ctx.stroke();

      const startY = yFor(point.start);
      const endY = yFor(point.end);
      const boxTop = Math.min(startY, endY);
      const boxHeight = Math.max(4, Math.abs(endY - startY));
      ctx.fillStyle = point.end <= point.start ? 'rgba(34,197,94,0.28)' : 'rgba(248,113,113,0.28)';
      ctx.fillRect(x, boxTop, barWidth, boxHeight);
      ctx.strokeStyle = 'rgba(15,23,42,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, boxTop, barWidth, boxHeight);

      const dayAvgY = yFor(point.avg);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, dayAvgY);
      ctx.lineTo(x + barWidth, dayAvgY);
      ctx.stroke();

      const dotY = yFor(point.end);
      ctx.fillStyle = point.color;
      ctx.beginPath();
      ctx.arc(center, dotY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#9bb0d3';
    const maxLabels = 6;
    const step = Math.max(1, Math.ceil(windowData.length / maxLabels));
    windowData.forEach((point, idx) => {
      if (idx % step !== 0 && idx !== windowData.length - 1) return;
      const x = pad.left + idx * (barWidth + barGap) + barWidth / 2;
      const label = point.label || point.date || '';
      ctx.fillText(label, x, pad.top + chartHeight + 6);
    });
  }


  function renderDailyCharts(email) {
    const fluidCanvas = document.getElementById('daily-fluid-chart');
    const caffeineCanvas = document.getElementById('daily-caffeine-chart');
    const alcoholCanvas = document.getElementById('daily-alcohol-chart');
    const urineTrendCanvas = document.getElementById('urine-trend-chart');
    if (!fluidCanvas && !caffeineCanvas && !alcoholCanvas && !urineTrendCanvas) return;
    if (!email) {
      drawDailyMetricChart(fluidCanvas, [], () => 0, { label: 'Fluid Intake (L)', emptyMessage: 'Login to view data' });
      drawDailyMetricChart(caffeineCanvas, [], () => 0, { label: 'Caffeine (mg)', emptyMessage: 'Login to view data' });
      drawDailyMetricChart(alcoholCanvas, [], () => 0, { label: 'Alcohol (drinks)', emptyMessage: 'Login to view data' });
      drawUrineTrendChart(urineTrendCanvas, [], { emptyMessage: 'Login to view urine trend.' });
      return;
    }
    const entries = Store.getDaily(email) || [];
    const chronological = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const lastWeekWindow = buildRecentDateWindow(chronological, 6);
    drawDailyMetricChart(
      fluidCanvas,
      lastWeekWindow,
      (entry) => {
        const preload = Number(entry.metrics?.fluidL) || 0;
        const storedTotal = Number(entry.hydration?.totalL);
        if (Number.isFinite(storedTotal)) return preload + storedTotal;
        const list = Array.isArray(entry.hydration?.entries) ? entry.hydration.entries : [];
        const quickAdds = list.reduce((sum, sample) => sum + (Number(sample.volumeL) || 0), 0);
        return preload + quickAdds;
      },
      { label: 'Fluid Intake (L)', color: '#38bdf8' }
    );
    drawDailyMetricChart(
      caffeineCanvas,
      lastWeekWindow,
      (entry) => {
        const metrics = entry.metrics?.caffeine;
        return metrics ? caffeineToMg(metrics.value, metrics.unit) : 0;
      },
      { label: 'Caffeine (mg)', color: '#f97316' }
    );
    drawDailyMetricChart(
      alcoholCanvas,
      lastWeekWindow,
      (entry) => Number(entry.metrics?.alcohol) || 0,
      { label: 'Alcohol (drinks)', color: '#a855f7' }
    );
    drawUrineTrendChart(urineTrendCanvas, lastWeekWindow);
  }

  function drawChart(canvas, logs) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || (canvas.parentElement ? canvas.parentElement.clientWidth : 0) || 0;
    const cssH = canvas.clientHeight || 0;
    if (cssW > 0 && cssH > 0) {
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (dpr !== 1) ctx.scale(dpr, dpr);

    // Clear in CSS pixel space
    ctx.clearRect(0, 0, cssW, cssH);
    if (logs.length === 0) return;

    // Plot plan need vs actualIntakeL over time (newest on the right)
    const points = logs.map((l, i) => ({
      x: i,
      ts: l.ts,
      need: planNeedValue(l.plan),
      actual: l.actualIntakeL ?? 0
    }));
    const maxY = Math.max(1, ...points.map(p => Math.max(p.need, p.actual)));
    const padTop = 30;
    const padLeft = 30;
    const padRight = 20;
    const padBottom = 50; // extra space for date/time labels
    const W = Math.max(0, cssW - padLeft - padRight);
    const H = Math.max(0, cssH - padTop - padBottom);

    // X scale with inner padding; center if only one point
    function xScale(i) {
      if (points.length === 1) return padLeft + W / 2;
      const innerPad = Math.min(40, W / 8); // pixel padding on each side
      const t = i / Math.max(1, points.length - 1);
      return padLeft + innerPad + t * (W - innerPad * 2);
    }
    function yScale(v) { return padTop + H - (v / maxY) * H; }

    // Axes
    ctx.strokeStyle = '#27406e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, padTop + H);
    ctx.lineTo(padLeft + W, padTop + H);
    ctx.stroke();

    // Prepare hit targets per activity (choose y = actual if provided, else need)
    const hitPoints = [];

    // Lines (flip x so newest is on the right)
    function line(color, key) {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      points.forEach((p, i) => {
        const xi = (points.length - 1 - i);
        const x = xScale(xi);
        const y = yScale(p[key]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    line('#5aa9ff', 'need');
    line('#42d392', 'actual');

    // Legend
    ctx.fillStyle = '#9bb0d3';
    ctx.fillText('Need (L)', padLeft + 6, padTop + 12);
    ctx.fillText('Actual (L)', padLeft + 90, padTop + 12);
    ctx.fillStyle = '#5aa9ff'; ctx.fillRect(padLeft - 8, padTop + 4, 6, 6);
    ctx.fillStyle = '#42d392'; ctx.fillRect(padLeft + 76, padTop + 4, 6, 6);

    // Draw activity dots and collect hit targets
    const dotRadius = 6;
    points.forEach((p, i) => {
      const xi = (points.length - 1 - i);
      const x = xScale(xi);
      const hasActual = p.actual != null && !isNaN(p.actual);
      const y = yScale(hasActual ? p.actual : p.need);
      const color = hasActual ? '#42d392' : '#5aa9ff';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
      hitPoints.push({ x, y, r: dotRadius + 3, index: i });
    });

    // X-axis date/time labels along the bottom
    const labelY = padTop + H + 18;
    ctx.fillStyle = '#9bb0d3';
    ctx.font = '10px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const maxLabels = 8;
    const step = Math.max(1, Math.ceil(points.length / maxLabels));
    points.forEach((p, i) => {
      if (i % step !== 0 && i !== points.length - 1) return;
      const xi = (points.length - 1 - i);
      const x = xScale(xi);
      // Tick
      ctx.beginPath();
      ctx.moveTo(x, padTop + H);
      ctx.lineTo(x, padTop + H + 4);
      ctx.strokeStyle = '#27406e';
      ctx.stroke();
      // Label (e.g., "Nov 1 14:30")
      const d = new Date(p.ts);
      const label = `${d.toLocaleString(undefined, { month: 'short' })} ${d.getDate()}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      ctx.fillText(label, x, labelY);
    });

    // Expose hit targets on the canvas for click handling (CSS pixel coordinates)
    canvas._chartHitPoints = hitPoints;
    canvas._chartLogs = logs;
  }

  function renderLogs(email) {
    const list = $('#logs-list');
    const canvas = $('#logs-chart');
    const logs = Store.getLogs(email);
    if (canvas) {
      const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const recentLogs = logs.filter(log => (log?.ts || 0) >= cutoff);
      drawChart(canvas, recentLogs);
    }
    renderDailyCharts(email);
    if (!list) {
      return;
    }
    const prefs = getCurrentPreferences();
    list.innerHTML = logs.map(l => {
      const plan = l.plan || {};
      const sodiumRange = plan.sodium ? `${plan.sodium.low}–${plan.sodium.high} mg/L` : (plan.sodiumMgPerL ? `${plan.sodiumMgPerL} mg/L` : 'n/a');
      const duringValue = plan.drinkDuring ?? plan.duringL;
      const postValue = plan.drinkPost ?? plan.postL;
      const sweatLossValue = plan.sweatLoss ?? plan.grossLossL;
      const during = Number.isFinite(duringValue) ? formatVolume(duringValue, { prefs }) : '—';
      const post = Number.isFinite(postValue) ? formatVolume(postValue, { prefs }) : '—';
      const sweatLoss = Number.isFinite(sweatLossValue) ? formatVolume(sweatLossValue, { prefs }) : '—';
      const actual = Number.isFinite(l.actualIntakeL) ? formatVolume(l.actualIntakeL, { prefs }) : '—';
      const when = new Date(l.ts).toLocaleString();
      const tempText = formatTemperature(l.input.tempC, { prefs });
      return `
        <div class="log-item">
          <div><strong>${when}</strong></div>
          <div>RPE ${l.input.rpe}, ${l.input.durationMin} min, ${tempText}, ${l.input.humidityPct}%</div>
          <div>Plan: During ${during} • Post ${post} (sweat ${sweatLoss}) • Sodium ${sodiumRange}</div>
          <div>Actual: ${actual}</div>
        </div>
      `;
    }).join('');
  }

  function refreshCalendars() {
    ['dash-calendar', 'dash-calendar-logs'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && typeof el._render === 'function') {
        el._render();
      }
    });
    const me = Auth.me();
    if (me && document.getElementById('daily-calendar')) {
      renderDaily(me.email);
    }
    const logsView = document.getElementById('view-logs');
    if (me && logsView && !logsView.classList.contains('hidden')) {
      renderDailyCharts(me.email);
    }
    HydrationTracker.refresh();
  }

  function switchTab(which) {
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === which));
    $$('.tab-content').forEach(c => c.classList.add('hidden'));
    $(`#tab-${which}`).classList.remove('hidden');
  }

  // --- Color helpers ---
function hexToRgb(h){
  const s = h.replace('#','');
  const b = s.length === 3
    ? s.split('').map(x => x + x).join('')
    : s;
  const n = parseInt(b, 16);
  return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 };
}
function rgbToHex({r,g,b}){
  const to2 = v => v.toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}
function lerp(a,b,t){ return a + (b-a)*t; }
function mixColors(c1, c2, t){
  // Accept hex or css color; normalize via canvas for non-hex
  const toRGB = (c) => {
    if(/^#/.test(c)) return hexToRgb(c);
    const el = document.createElement('div');
    el.style.color = c;
    document.body.appendChild(el);
    const rgb = getComputedStyle(el).color; // "rgb(r, g, b)"
    document.body.removeChild(el);
    const m = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
    return { r:+m[1], g:+m[2], b:+m[3] };
  };
  const A = toRGB(c1), B = toRGB(c2);
  return rgbToHex({
    r: Math.round(lerp(A.r, B.r, t)),
    g: Math.round(lerp(A.g, B.g, t)),
    b: Math.round(lerp(A.b, B.b, t)),
  });
}

const clamp = (val, min, max) => Math.min(max, Math.max(min, val));

function pickTextColor(hex){
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
  return luminance > 170 ? '#0f172a' : '#ffffff';
}

const URINE_LEVELS = [
  { value: 1, color: '#f7fadc', status: 'Very Hydrated', description: 'Crystal clear' },
  { value: 2, color: '#f2f5b0', status: 'Very Hydrated', description: 'Pale lemonade' },
  { value: 3, color: '#ecef96', status: 'Hydrated', description: 'Light straw' },
  { value: 4, color: '#e6e06a', status: 'Hydrated', description: 'Sunflower' },
  { value: 5, color: '#ddc34d', status: 'Normal', description: 'Golden' },
  { value: 6, color: '#d1a83a', status: 'Monitor', description: 'Amber' },
  { value: 7, color: '#c18a2c', status: 'Monitor', description: 'Copper' },
  { value: 8, color: '#ab6b23', status: 'Dehydrated', description: 'Tea' },
  { value: 9, color: '#924c19', status: 'Dehydrated', description: 'Dark tea' },
  { value: 10, color: '#783512', status: 'Severely Dehydrated', description: 'Brown' }
];

function getUrineLevelMeta(value){
  const numeric = Number(value);
  return URINE_LEVELS.find((level) => level.value === numeric) || URINE_LEVELS[URINE_LEVELS.length - 1];
}

  const UrinePanel = (() => {
    const elements = {};
    let entries = [];

    const todayKey = () => formatDateInputValue(new Date());

    function ensureElements() {
      if (elements.initialized) return !!elements.panel;
      elements.panel = document.getElementById('urine-panel');
      if (!elements.panel) return false;
      elements.slider = document.getElementById('urine-panel-slider');
      elements.label = document.getElementById('urine-panel-label');
      elements.logBtn = document.getElementById('urine-panel-log');
      elements.latest = document.getElementById('urine-panel-latest');
      bindEvents();
      updateSliderUi();
      elements.initialized = true;
      return true;
    }

    function bindEvents() {
      if (elements.bound) return;
      if (elements.slider) elements.slider.addEventListener('input', updateSliderUi);
      if (elements.logBtn) elements.logBtn.addEventListener('click', logSample);
      elements.bound = true;
    }

    function updateSliderUi() {
      if (!elements.slider || !elements.label) return;
      const val = Number(elements.slider.value || 5);
      const meta = getUrineLevelMeta(val);
      elements.label.textContent = `Level ${val} • ${meta.status}`;
      elements.label.style.background = meta.color;
      elements.label.style.color = pickTextColor(meta.color);
      const lighten = `color-mix(in srgb, ${meta.color} 35%, white)`;
      elements.slider.style.setProperty('--track-base', lighten);
      updateRangeStyle(elements.slider, {
        startColor: meta.color,
        endColor: meta.color,
        thumbColor: meta.color
      });
    }

    function renderLatest(entry, message) {
      if (!elements.latest) return;
      if (!entry) {
        elements.latest.textContent = message || 'No sample logged today.';
        elements.latest.style.background = 'color-mix(in srgb, var(--primary) 15%, var(--surface))';
        elements.latest.style.color = 'var(--muted)';
        return;
      }
      const level = Number(entry.level) || 5;
      const meta = getUrineLevelMeta(level);
      const when = entry.recordedAt
        ? new Date(entry.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Just now';
      elements.latest.innerHTML = `<strong>${meta.status}</strong> • ${when}`;
      const swatch = meta.color;
      elements.latest.style.background = swatch;
      elements.latest.style.color = pickTextColor(swatch);
      elements.latest.style.border = '2px solid #000';
      if (elements.slider) {
        elements.slider.value = level;
        updateSliderUi();
      }
    }

    function loadEntries() {
      const me = Auth.me();
      const date = todayKey();
      if (!me) {
        entries = [];
        renderLatest(null, 'Login to log samples.');
        if (elements.logBtn) elements.logBtn.disabled = true;
        return;
      }
      if (elements.logBtn) elements.logBtn.disabled = false;
      const record = Store.findDailyByDate(me.email, date);
      entries = record?.urine?.entries
        ? record.urine.entries.slice().sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
        : [];
      renderLatest(entries[0] || null);
    }

    function logSample() {
      const me = Auth.me();
      if (!me) { Ui.toast('Please login to log a urine sample'); return; }
      const val = Number(elements.slider?.value || 5);
      const now = new Date();
      const recordedAtIso = now.toISOString();
      const entry = {
        level: val,
        recordedAt: recordedAtIso
      };
      const date = todayKey();
      const existing = Store.ensureDailyRecord(me.email, date);
      const mergedEntries = [...(existing?.urine?.entries || []), entry];
      Store.upsertDaily(me.email, { date, urine: { entries: mergedEntries } });
      loadEntries();
      refreshCalendars();
      flashPanel();
    }

    function flashPanel() {
      if (!elements.panel) return;
      elements.panel.classList.remove('flash-success');
      void elements.panel.offsetWidth;
      elements.panel.classList.add('flash-success');
    }

    function refresh() {
      if (!ensureElements()) return;
      updateSliderUi();
      loadEntries();
    }

    function latestLevel(date) {
      const me = Auth.me();
      if (!me) return null;
      const record = Store.findDailyByDate(me.email, date || todayKey());
      const list = record?.urine?.entries || [];
      if (!list.length) return null;
      return list.slice().sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))[0];
    }

    return {
      init: () => refresh(),
      refresh,
      latestLevel,
      currentSliderLevel() { return Number(elements.slider?.value) || 5; }
    };
  })();

  const HydrationTracker = (() => {
    const PRESET_DEFAULTS_L = [0.25, 0.4, 0.6];
    const elements = {};
    let presetsCache = PRESET_DEFAULTS_L.slice();
    let cachedEmail = null;

    const todayKey = () => formatDateInputValue(new Date());
    const presetKey = (email) => `hc_water_presets_${email}`;

    function ensureElements() {
      if (elements.initialized) return !!elements.panel;
      elements.panel = document.getElementById('hydration-panel');
      if (!elements.panel) return false;
      elements.goal = document.getElementById('hydration-goal-label');
      elements.goalMeta = document.getElementById('hydration-goal-meta');
      elements.consumed = document.getElementById('hydration-consumed');
      elements.remaining = document.getElementById('hydration-remaining');
      elements.percent = document.getElementById('hydration-percent-label');
      elements.preload = document.getElementById('hydration-preload-note');
      elements.progress = document.getElementById('hydration-progress');
      elements.bar = elements.progress?.parentElement || null;
      elements.reset = document.getElementById('hydration-reset-btn');
      elements.presetButtons = Array.from(document.querySelectorAll('.hydration-preset-btn'));
      elements.presetValues = Array.from(document.querySelectorAll('.preset-value'));
      elements.editMode = document.getElementById('hydration-edit-mode');
      elements.editBtn = document.getElementById('hydration-edit-presets-btn');
      elements.editInputs = Array.from(document.querySelectorAll('.hydration-edit-input'));
      elements.editUnits = Array.from(document.querySelectorAll('[id^="hydration-edit-unit-"]'));
      elements.editCancel = document.getElementById('hydration-edit-cancel');
      elements.editSave = document.getElementById('hydration-edit-save');
      bindEvents();
      elements.initialized = true;
      return true;
    }

    function bindEvents() {
      if (elements.bound) return;
      elements.presetButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          if (elements.editMode && elements.editMode.classList.contains('hidden')) {
            handlePresetAdd(btn);
          }
        });
      });
      if (elements.editBtn) {
        elements.editBtn.addEventListener('click', () => {
          if (elements.editMode && elements.editMode.classList.contains('hidden')) {
            showEditMode();
          } else {
            hideEditMode();
          }
        });
      }
      if (elements.editCancel) elements.editCancel.addEventListener('click', hideEditMode);
      if (elements.editSave) elements.editSave.addEventListener('click', savePresetsFromEdit);
      if (elements.reset) elements.reset.addEventListener('click', resetToday);
      elements.bound = true;
    }

    function loadPresets(email) {
      if (!email) return PRESET_DEFAULTS_L.slice();
      try {
        const raw = localStorage.getItem(presetKey(email));
        if (!raw) return PRESET_DEFAULTS_L.slice();
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === PRESET_DEFAULTS_L.length) {
          return parsed.map((val, idx) => {
            const numeric = Number(val);
            return Number.isFinite(numeric) && numeric > 0 ? numeric : PRESET_DEFAULTS_L[idx];
          });
        }
      } catch {}
      return PRESET_DEFAULTS_L.slice();
    }

    function getPresets(email) {
      if (!email) return PRESET_DEFAULTS_L.slice();
      if (cachedEmail !== email) {
        presetsCache = loadPresets(email);
        cachedEmail = email;
      }
      if (!Array.isArray(presetsCache) || presetsCache.length !== PRESET_DEFAULTS_L.length) {
        presetsCache = PRESET_DEFAULTS_L.slice();
      }
      return presetsCache.slice();
    }

    function savePresets(email, list) {
      if (!email) return;
      localStorage.setItem(presetKey(email), JSON.stringify(list));
      cachedEmail = email;
      presetsCache = list.slice();
    }

    function updatePresetValue(email, index, liters) {
      if (!email) return;
      const next = getPresets(email);
      next[index] = liters;
      savePresets(email, next);
    }

    function unitLabel(prefs = getCurrentPreferences()) {
      return isImperialUnits(prefs) ? UNIT_LABELS.imperial.volume : UNIT_LABELS.metric.volume;
    }

    function convertLitersToDisplay(liters, prefs = getCurrentPreferences()) {
      const raw = isImperialUnits(prefs) ? liters * LITER_TO_FLOZ : liters;
      const decimals = isImperialUnits(prefs) ? 1 : 2;
      return Number(raw.toFixed(decimals));
    }

    function convertDisplayToLiters(value, prefs = getCurrentPreferences()) {
      if (!Number.isFinite(value)) return NaN;
      return isImperialUnits(prefs) ? (value / LITER_TO_FLOZ) : value;
    }

    function showEditMode() {
      if (!elements.editMode) return;
      const me = Auth.me();
      if (!me) {
        Ui.toast('Login to edit presets');
        return;
      }
      const prefs = getCurrentPreferences();
      const presets = getPresets(me.email);
      const unit = unitLabel(prefs);
      elements.editUnits.forEach((el) => { el.textContent = unit; });
      elements.editInputs.forEach((input) => {
        const idx = Number(input.dataset.doseIndex);
        const liters = presets[idx] ?? PRESET_DEFAULTS_L[idx];
        const display = convertLitersToDisplay(liters, prefs);
        input.value = Number.isFinite(display) ? display : '';
      });
      elements.editMode.classList.remove('hidden');
    }

    function hideEditMode() {
      if (!elements.editMode) return;
      elements.editMode.classList.add('hidden');
    }

    function savePresetsFromEdit() {
      const me = Auth.me();
      if (!me) {
        Ui.toast('Login to save presets');
        return;
      }
      const prefs = getCurrentPreferences();
      const newPresets = [];
      let hasError = false;
      elements.editInputs.forEach((input) => {
        const idx = Number(input.dataset.doseIndex);
        if (!Number.isInteger(idx) || idx < 0 || idx >= PRESET_DEFAULTS_L.length) return;
        const val = parseFloat(input.value);
        const liters = convertDisplayToLiters(val, prefs);
        if (!Number.isFinite(liters) || liters <= 0) {
          hasError = true;
          return;
        }
        newPresets[idx] = Number(liters.toFixed(4));
      });
      if (hasError || newPresets.length !== PRESET_DEFAULTS_L.length) {
        Ui.toast('Enter positive amounts for all presets');
        return;
      }
      savePresets(me.email, newPresets);
      hideEditMode();
      refresh();
    }

    function handlePresetAdd(btn) {
      const me = Auth.me();
      if (!me) { Ui.toast('Login to log water'); return; }
      const idx = Number(btn.dataset.doseIndex);
      if (!Number.isInteger(idx)) return;
      const presets = getPresets(me.email);
      const amount = presets[idx];
      if (!Number.isFinite(amount) || amount <= 0) {
        Ui.toast('Set a preset amount first');
        return;
      }
      logIntakeLiters(amount);
    }

    function logIntakeLiters(amountL) {
      const me = Auth.me();
      if (!me) { Ui.toast('Login to log water'); return; }
      if (!Number.isFinite(amountL) || amountL <= 0) {
        Ui.toast('Enter a positive amount');
        return;
      }
      const date = todayKey();
      const existing = Store.ensureDailyRecord(me.email, date);
      const prevEntries = Array.isArray(existing?.hydration?.entries) ? existing.hydration.entries : [];
      const entry = { volumeL: Number(amountL.toFixed(3)), recordedAt: new Date().toISOString() };
      const newEntries = [...prevEntries, entry];
      const total = newEntries.reduce((sum, item) => sum + (Number(item.volumeL) || 0), 0);
      Store.upsertDaily(me.email, {
        date,
        hydration: {
          entries: newEntries,
          totalL: Number(total.toFixed(3))
        }
      });
      refresh();
    }

    function resetToday() {
      const me = Auth.me();
      if (!me) { Ui.toast('Login to reset'); return; }
      const date = todayKey();
      const record = Store.findDailyByDate(me.email, date);
      const hasEntries = record?.hydration?.entries?.length;
      if (!hasEntries) {
        Ui.toast('No water logs to reset today');
        return;
      }
      Store.upsertDaily(me.email, { date, hydration: { entries: [], totalL: 0 } });
      refresh();
    }

    function sumSweatLossForDate(email, dateKey) {
      if (!email) return 0;
      const logs = Store.getLogs(email) || [];
      return logs.reduce((sum, log) => {
        if (!log?.ts) return sum;
        const when = formatDateInputValue(new Date(log.ts));
        if (when !== dateKey) return sum;
        const need = planNeedValue(log.plan);
        return sum + (Number(need) || 0);
      }, 0);
    }

    function computeGoalLiters(profile, email, dateKey) {
      if (!email) {
        return { goal: 0, baseGoal: Number(profile?.hydrationGoalL) || 0, sweatBonus: 0 };
      }
      const baseGoal = Number(profile?.hydrationGoalL) || 0;
      const sweatBonus = sumSweatLossForDate(email, dateKey);
      const goal = Math.max(0, Number((baseGoal + sweatBonus).toFixed(2)));
      return { goal, baseGoal, sweatBonus: Number(sweatBonus.toFixed(2)) };
    }


    function refresh() {
      if (!ensureElements()) return;
      const me = Auth.me();
      const prefs = getCurrentPreferences();
      const loggedIn = !!me;
      const unit = unitLabel(prefs);
      if (elements.editBtn) elements.editBtn.disabled = !loggedIn;
      if (elements.reset) elements.reset.disabled = !loggedIn;
      if (!loggedIn) {
        cachedEmail = null;
        elements.presetButtons.forEach((btn) => {
          const idx = Number(btn.dataset.doseIndex);
          const valueEl = document.getElementById(`hydration-preset-value-${idx}`);
          if (valueEl) valueEl.textContent = '—';
          btn.disabled = true;
        });
        elements.goal.textContent = 'Login to start';
        elements.goalMeta.textContent = 'Base goal uses your profile';
        elements.consumed.textContent = '—';
        elements.remaining.textContent = '—';
        elements.percent.textContent = '';
        elements.preload.textContent = '';
        if (elements.progress) elements.progress.style.setProperty('--fill', '0%');
        if (elements.bar) elements.bar.setAttribute('aria-valuenow', '0');
        return;
      }

      const date = todayKey();
      const record = Store.findDailyByDate(me.email, date);
      const hydration = record?.hydration;
      const entries = Array.isArray(hydration?.entries)
        ? hydration.entries.slice().sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
        : [];
      const loggedTotal = Number(hydration?.totalL);
      const quickTotal = Number.isFinite(loggedTotal)
        ? loggedTotal
        : entries.reduce((sum, item) => sum + (Number(item.volumeL) || 0), 0);
      const preload = Number(record?.metrics?.fluidL) || 0;
      const consumedL = Number((quickTotal + preload).toFixed(3));
      const profile = getActiveProfile();
      const goalMeta = computeGoalLiters(profile, me.email, date);
      const goalL = goalMeta.goal;
      const baseGoal = goalMeta.baseGoal;
      const sweatBonus = Math.max(0, goalMeta.sweatBonus);
      const remainingL = goalL > 0 ? Math.max(goalL - consumedL, 0) : 0;
      const percent = goalL > 0 ? Math.min(100, Math.round((consumedL / goalL) * 100)) : 0;
      const presets = getPresets(me.email);

      elements.presetButtons.forEach((btn) => {
        const idx = Number(btn.dataset.doseIndex);
        const liters = presets[idx] ?? PRESET_DEFAULTS_L[idx];
        const display = convertLitersToDisplay(liters, prefs);
        const valueEl = document.getElementById(`hydration-preset-value-${idx}`);
        if (valueEl) {
          valueEl.textContent = Number.isFinite(display) ? formatVolume(liters, { prefs }) : '—';
        }
        btn.disabled = !loggedIn || !Number.isFinite(liters) || liters <= 0;
      });

      if (elements.goal) {
        elements.goal.textContent = goalL > 0
          ? formatVolume(goalL, { prefs })
          : 'Set a hydration goal';
      }
      if (elements.goalMeta) {
        const baseText = baseGoal > 0 ? formatVolume(baseGoal, { prefs }) : '0';
        const sweatText = sweatBonus > 0 ? formatVolume(sweatBonus, { prefs }) : '0';
        elements.goalMeta.textContent = `Base ${baseText} + Sweat ${sweatText}`;
      }
      if (elements.consumed) {
        elements.consumed.textContent = consumedL > 0
          ? formatVolume(consumedL, { prefs })
          : formatVolume(0, { prefs });
      }
      if (elements.remaining) {
        elements.remaining.textContent = goalL > 0
          ? formatVolume(remainingL, { prefs })
          : '—';
      }
      if (elements.percent) {
        elements.percent.textContent = goalL > 0
          ? `${percent}% of goal`
          : 'Goal not set';
      }
      if (elements.preload) {
        elements.preload.textContent = preload > 0
          ? `Includes morning preload ${formatVolume(preload, { prefs })}`
          : '';
      }
      if (elements.progress) elements.progress.style.setProperty('--fill', `${percent}%`);
      if (elements.bar) elements.bar.setAttribute('aria-valuenow', String(percent));
      if (elements.reset) elements.reset.disabled = entries.length === 0;
    }

    return {
      init() { if (ensureElements()) refresh(); },
      refresh,
      logIntake(liters) { logIntakeLiters(liters); }
    };
  })();

function updateRangeStyle(inputEl, opts){
  if (!inputEl) return;

  const min = Number(inputEl.min || 0);
  const max = Number(inputEl.max || 100);
  const val = Number(inputEl.value || 0);
  const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
  const percent = `${(t * 100).toFixed(2)}%`;

  // Per-slider endpoints (priority: opts -> data-attrs -> CSS vars -> defaults)
  const styles = getComputedStyle(inputEl);
  const startColor = (opts?.startColor)
    || inputEl.dataset.start
    || styles.getPropertyValue('--track-start').trim()
    || '#22c55e';
  const endColor   = (opts?.endColor)
    || inputEl.dataset.end
    || styles.getPropertyValue('--track-end').trim()
    || '#ef4444';
  const thumbFixed = opts?.thumbColor || inputEl.dataset.thumb || null;

  // Live color at current position
  const live = mixColors(startColor, endColor, t);

  // Push vars for both WebKit layered background and Firefox progress
  inputEl.style.setProperty('--percent', percent);
  inputEl.style.setProperty('--track-start', startColor);
  inputEl.style.setProperty('--track-end', endColor);
  inputEl.style.setProperty('--fill-color', live);
  inputEl.style.setProperty('--thumb-color', thumbFixed || live);
}

  function formatDateInputValue(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatTimeInputValue(date = new Date()) {
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${min}`;
  }

  function buildRecentDateWindow(entries = [], daysBack = 6) {
    const byDate = new Map();
    entries.forEach((entry) => {
      if (entry?.date) byDate.set(entry.date, entry);
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const window = [];
    for (let offset = daysBack; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setDate(today.getDate() - offset);
      const key = formatDateInputValue(day);
      window.push(byDate.get(key) || { date: key, metrics: {}, urine: null });
    }
    return window;
  }

  // --- Log details modal helper ---
  // Define openModalWithLog at the top level so it can be used outside of the wire() closure.
  // This function populates and displays the log details modal with a two-column layout showing
  // both the activity details and the hydration plan plus an optional input for actual intake.
  function openModalWithLog(log, index) {
    const me = Auth.me();
    const modal = document.getElementById('logs-modal');
    const modalContent = document.getElementById('logs-modal-content');
    const modalClose = document.getElementById('logs-modal-close');
    const modalOk = document.getElementById('logs-modal-ok');
    if (!modal || !modalContent) return;
    const prefs = getCurrentPreferences();
    // Compose date/time string for display
    const when = new Date(log.ts).toLocaleString();
    const plan = log.plan || {};
    const workoutMetaSource = { ...(log.workout || {}), ...(log.input || {}) };
    const workoutMeta = getWorkoutDisplayMeta(workoutMetaSource);
    const leftParts = [
      `<div style="font-weight:600;">${when}</div>`,
      workoutMeta ? `Workout: <strong>${workoutMeta.icon ? `${workoutMeta.icon} ` : ''}${workoutMeta.label}</strong>` : '',
      `RPE: <strong>${log.input.rpe}</strong>/10`,
      `Pre-hydration slider: <strong>${log.input.pre}</strong>/5`,
      log.input.urineColor ? `Urine color: <strong>Level ${log.input.urineColor}${log.input.urineStatus ? ` (${log.input.urineStatus})` : ''}</strong>` : '',
      typeof log.input.fluidsPrior === 'number' ? `Pre-drank: <strong>${formatVolume(log.input.fluidsPrior, { prefs })}</strong>` : '',
      typeof log.input.caffeineMg === 'number' ? `Caffeine: <strong>${log.input.caffeineMg} mg</strong>` : '',
      typeof log.input.alcoholDrinks === 'number' ? `Alcohol: <strong>${log.input.alcoholDrinks} drinks</strong>` : '',
      `Duration: <strong>${log.input.durationMin}</strong> min`,
      `Environment: <strong>${formatTemperature(log.input.tempC, { prefs })}</strong> • <strong>${log.input.humidityPct}% RH</strong> • UV <strong>${log.input.uvIndex ?? log.weather?.uvIndex ?? 'n/a'}</strong>`
    ].filter(Boolean).map(item => `<div>${item}</div>`).join('');
    const left = `<div style="display:grid; gap:8px;">${leftParts}</div>`;
    const sodiumRange = plan.sodium ? `${plan.sodium.low}–${plan.sodium.high} mg/L` : (plan.sodiumMgPerL ? `${plan.sodiumMgPerL} mg/L` : 'n/a');
    const totalTargetRaw = plan.totalTargetL ?? plan.netNeedL;
    const totalTargetFormatted = Number.isFinite(totalTargetRaw) ? formatVolume(totalTargetRaw, { prefs }) : '—';
    const sweatLossFormatted = Number.isFinite(plan.sweatLoss ?? plan.grossLossL)
      ? formatVolume(plan.sweatLoss ?? plan.grossLossL, { prefs })
      : '—';
    const duringFormatted = Number.isFinite(plan.drinkDuring ?? plan.duringL)
      ? formatVolume(plan.drinkDuring ?? plan.duringL, { prefs })
      : '—';
    const postFormatted = Number.isFinite(plan.drinkPost ?? plan.postL)
      ? formatVolume(plan.drinkPost ?? plan.postL, { prefs })
      : '—';
    const volumeUnitLabel = (UNIT_LABELS[prefs.units] || UNIT_LABELS.metric).volume;
    const rightTop = `
      <div style="display:grid; gap:8px;">
        <div>Total target: <span class="highlight">${totalTargetFormatted}</span>
          <small class="muted">Sweat loss ${sweatLossFormatted}</small></div>
        <div>During <strong>${duringFormatted}</strong> • Post <strong>${postFormatted}</strong></div>
        <div>Sodium guidance: <strong>${sodiumRange}</strong></div>
      </div>
    `;
    // Determine whether actual intake has been recorded
    const hasActual = log.actualIntakeL != null && !isNaN(log.actualIntakeL);
    let form;
    if (hasActual) {
      // If actual intake is already recorded, show it and disable further input
      form = `
        <div style="margin-top:10px;">Actual intake: <strong>${formatVolume(log.actualIntakeL, { prefs })}</strong></div>
        <small class="muted">Actual already recorded; further submissions disabled.</small>
      `;
    } else {
      // Otherwise, render a form to submit the actual intake
      form = `
        <form id="log-actual-form" class="form" style="margin-top:10px;">
          <label>Actual Fluid Intake (${volumeUnitLabel})
            <input type="number" id="modal-input-actual" min="0" step="0.1" required />
          </label>
          <button type="submit" class="primary">Save Actual</button>
        </form>
      `;
    }
    // Populate the modal content with a two-column layout
    modalContent.innerHTML = `
      <div class="modal-2col">
        <div class="card">${left}</div>
        <div class="card">${rightTop}${form}</div>
      </div>
    `;
    // Helper to close the modal
    const close = () => modal.classList.add('hidden');
    // Bind close actions on the X and OK buttons
    if (modalClose) modalClose.onclick = close;
    if (modalOk) modalOk.onclick = close;
    // Close when clicking outside the dialog
    modal.onclick = (e) => { if (e.target === modal) close(); };
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
    }, { once: true });
    // Show the modal
    modal.classList.remove('hidden');
    // If actual intake isn't recorded, wire up the form submission
    if (!hasActual) {
      const f = document.getElementById('log-actual-form');
      if (f) {
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          const val = parseFloat(document.getElementById('modal-input-actual').value);
          if (isNaN(val)) {
            Ui.toast('Enter a valid number');
            return;
          }
          const currentPrefs = getCurrentPreferences();
          const valueInLiters = isImperialUnits(currentPrefs) ? (val / LITER_TO_FLOZ) : val;
          // Persist the actual intake in the store
          Store.updateLog(me.email, index, (orig) => ({ ...orig, actualIntakeL: valueInLiters }));
          Ui.toast('Actual intake saved');
          // Re-render logs and update calendar
          renderLogs(me.email);
          refreshCalendars();
          // Close the modal
          close();
        });
      }
    }
  }


  // Event wiring
  function wire() {
    // Tabs
    $$('.tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

    // Auth
    $('#register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#register-name').value.trim();
      const email = $('#register-email').value.trim().toLowerCase();
      const password = $('#register-password').value;
      try {
        await Auth.register(name, email, password);
        await Auth.login(email, password);
        Ui.setAuthed(true);
        Ui.show(Views.dashboard);
      } catch (err) { Ui.toast(err.message || 'Registration failed'); }
    });

    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#login-email').value.trim().toLowerCase();
      const password = $('#login-password').value;
      try {
        await Auth.login(email, password);
        Ui.setAuthed(true);
        Ui.show(Views.dashboard);
      } catch (err) { Ui.toast('Invalid email or password'); }
    });

    // Nav
    Nav.dash.addEventListener('click', () => {
      Ui.show(Views.dashboard);
      // Refresh calendar when switching to dashboard
      const cal = document.getElementById('dash-calendar');
      if (cal && typeof cal._render === 'function') cal._render();
    });
    const openDailyBtn = document.getElementById('open-daily-btn');
    if (openDailyBtn) openDailyBtn.addEventListener('click', openDailyTrackerModal);
    UrinePanel.init();
    HydrationTracker.init();
    
    // Dropdown menu for profile/logout
    const userMenuBtn = document.getElementById('nav-user-menu');
    const dropdownMenu = document.getElementById('nav-dropdown-menu');
    if (userMenuBtn && dropdownMenu) {
      userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('hidden');
      });
      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!userMenuBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
          dropdownMenu.classList.add('hidden');
        }
      });
    }

    const profileDisplay = document.getElementById('profile-display');
    const profileFormEl = document.getElementById('profile-form');
    const profileEditBtn = document.getElementById('profile-edit-btn');
    const profileCancelBtn = document.getElementById('profile-cancel-btn');
    const toggleProfileEdit = (isEditing) => {
      if (profileDisplay) profileDisplay.classList.toggle('hidden', !!isEditing);
      if (profileFormEl) profileFormEl.classList.toggle('hidden', !isEditing);
      if (isEditing && profileFormEl) {
        hydrateUiFromUser();
        profileFormEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    profileEditBtn?.addEventListener('click', () => toggleProfileEdit(true));
    profileCancelBtn?.addEventListener('click', () => toggleProfileEdit(false));
    
    Nav.profile.addEventListener('click', () => {
      if (dropdownMenu) dropdownMenu.classList.add('hidden');
      toggleProfileEdit(false);
      hydrateUiFromUser();
      Ui.show(Views.profile);
    });
    Nav.logs.addEventListener('click', () => {
      Ui.show(Views.logs);
      const me = Auth.getCurrent();
      if (me) {
        renderLogs(me.email);
        // Render calendar on logs page
        const calLogs = document.getElementById('dash-calendar-logs');
        if (calLogs) {
          if (typeof calLogs._render === 'function') {
            calLogs._render();
          } else {
            // Initialize calendar if not already done
            wireDashboardCalendarForLogs(me.email);
          }
        }
      }
    });
    Nav.logout.addEventListener('click', () => {
      if (dropdownMenu) dropdownMenu.classList.add('hidden');
      Auth.clearCurrent();
      Ui.setAuthed(false);
    });

    // Modal controls: log details
    const modal = document.getElementById('logs-modal');
    const modalClose = document.getElementById('logs-modal-close');
    const modalOk = document.getElementById('logs-modal-ok');
    const modalContent = document.getElementById('logs-modal-content');
    function closeModal(){ modal.classList.add('hidden'); }
    // openModalWithLog is now defined at the top level (see below)

    modalClose.addEventListener('click', closeModal);
    modalOk.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal(); });

    // Canvas click handler for dot hit detection
    const canvas = document.getElementById('logs-chart');
    if (canvas) {
      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const pts = canvas._chartHitPoints || [];
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const dx = x - p.x;
          const dy = y - p.y;
          if ((dx*dx + dy*dy) <= (p.r*p.r)) {
            const logsArr = canvas._chartLogs || [];
            const log = logsArr[p.index];
            if (log) openModalWithLog(log, p.index);
            break;
          }
        }
      });
    }
    Nav.logout.addEventListener('click', () => { Auth.clearCurrent(); Ui.setAuthed(false); });

    if (profileFormEl) {
      profileFormEl.addEventListener('submit', (e) => {
        e.preventDefault();
        const getValue = (id) => {
          const el = document.getElementById(id);
          return el ? el.value : '';
        };
        const getNumber = (id) => {
          const raw = getValue(id).trim();
          if (!raw) return null;
          const parsed = Number(raw);
          return Number.isFinite(parsed) ? parsed : null;
        };
        const payload = {
          name: getValue('profile-name').trim(),
          tagline: getValue('profile-tagline-input').trim(),
          age: getNumber('profile-age'),
          location: getValue('profile-location').trim(),
          massKg: getNumber('profile-mass'),
          heightCm: getNumber('profile-height'),
          sweatRateLph: getNumber('profile-sweat'),
          restingHr: getNumber('profile-hr'),
          hydrationGoalL: getNumber('profile-goal'),
          trainingFocus: getValue('profile-focus'),
          accentColor: getValue('profile-accent') || '#2563eb',
          preferences: {
            theme: getValue('profile-theme') || PROFILE_PREF_DEFAULTS.theme,
            units: getValue('profile-units') || PROFILE_PREF_DEFAULTS.units,
            dashboardDensity: getValue('profile-density') || PROFILE_PREF_DEFAULTS.dashboardDensity,
            browserPrompts: getValue('profile-browser-prompts') || PROFILE_PREF_DEFAULTS.browserPrompts,
            reduceMotion: !!document.getElementById('profile-reduce-motion')?.checked
          }
        };
        Auth.saveProfile(payload);
        Ui.toast('Profile saved');
        hydrateUiFromUser();
        toggleProfileEdit(false);
      });
    }

    // Geolocation removed

    // Slider value displays
    const rpeInput = $('#input-rpe');
    const rpeVal = $('#rpe-value');
    const preInput = $('#input-pre');
    const preVal = $('#pre-value');
    if (rpeInput && rpeVal) {
      const syncRpe = () => {
        rpeVal.textContent = rpeInput.value;
        updateRangeStyle(rpeInput, { startColor: '#16a34a', endColor: '#dc2626' });
      };
      rpeInput.addEventListener('input', syncRpe); syncRpe();
    }
    if (preInput && preVal) {
      const syncPre = () => {
        preVal.textContent = preInput.value;
        updateRangeStyle(preInput, { startColor: '#dc2626', endColor: '#16a34a' });
      };
      preInput.addEventListener('input', syncPre); syncPre();
    }
    // Daily slider styling
    const dailyInput = document.getElementById('daily-rating');
    if (dailyInput) {
      const syncDaily = () => { updateRangeStyle(dailyInput, { type: 'daily' }); };
      dailyInput.addEventListener('input', syncDaily); syncDaily();
    }

    // Dashboard calendar and plan modal wiring
    wireDashboardCalendar();

    // Daily tracker form (extensible metrics)
    const dailyForm = document.getElementById('daily-form');
    if (dailyForm) {
      dailyForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const me = Auth.me();
        if (!me) return;
        const date = document.getElementById('daily-date').value;
        const rating = parseInt(document.getElementById('daily-rating').value, 10);
        const note = document.getElementById('daily-note').value.trim();
        const alcohol = !!document.getElementById('daily-alcohol').checked;
        if (!date) { Ui.toast('Please select a date'); return; }
        Store.upsertDaily(me.email, { date, rating, note, metrics: { alcohol } });
        Ui.toast('Daily hydration saved');
        renderDaily(me.email);
      });
    }
  }

  function formatNumber(value, digits = 1) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Number(num.toFixed(digits)).toString();
  }

  function hydrateUiFromUser() {
    const me = Auth.me();
    if (!me) {
      applyPreferenceEffects(normalizeProfile({}, ''));
      UrinePanel.refresh();
      HydrationTracker.refresh();
      return;
    }
    const profile = normalizeProfile(me.profile, me.name);
    applyPreferenceEffects(profile);
    const prefs = profile.preferences || PROFILE_PREF_DEFAULTS;
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = value ?? '';
    };
    const setChecked = (id, checked) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.checked = !!checked;
    };
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el && text != null) el.textContent = text;
    };
    setValue('profile-name', profile.name || me.name || '');
    setValue('profile-tagline-input', profile.tagline || '');
    setValue('profile-age', profile.age ?? '');
    setValue('profile-location', profile.location || '');
    setValue('profile-mass', profile.massKg ?? '');
    setValue('profile-height', profile.heightCm ?? '');
    setValue('profile-sweat', profile.sweatRateLph ?? '');
    setValue('profile-hr', profile.restingHr ?? '');
    setValue('profile-goal', profile.hydrationGoalL ?? '');
    setValue('profile-focus', profile.trainingFocus || '');
    setValue('profile-accent', profile.accentColor || '#2563eb');
    setValue('profile-theme', prefs.theme);
    setValue('profile-units', prefs.units);
    setValue('profile-density', prefs.dashboardDensity);
    setValue('profile-browser-prompts', prefs.browserPrompts);
    setChecked('profile-reduce-motion', prefs.reduceMotion);

    const hero = document.getElementById('profile-hero');
    if (hero) hero.style.setProperty('--profile-accent', profile.accentColor || '#2563eb');
    const displayName = profile.name || me.name || 'Hydration athlete';
    const avatarEl = document.getElementById('profile-avatar');
    if (avatarEl) {
      const initials = displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase() || '')
        .join('') || 'HC';
      avatarEl.textContent = initials;
    }
    const setDisplay = (id, value, { placeholder = '—', formatter } = {}) => {
      const el = document.getElementById(id);
      if (!el) return;
      const hasValue = !(value === null || value === undefined || value === '');
      if (!hasValue) {
        el.textContent = placeholder;
        return;
      }
      el.textContent = formatter ? formatter(value) : value;
    };

    const unitConfig = UNIT_LABELS[prefs.units] || UNIT_LABELS.metric;
    setText('profile-unit-mass', unitConfig.mass);
    setText('profile-unit-height', unitConfig.height);
    setText('profile-unit-sweat', isImperialUnits(prefs) ? UNIT_LABELS.imperial.volumeRate : UNIT_LABELS.metric.volumeRate);

    setDisplay('profile-display-name', displayName, { placeholder: 'Add your name' });
    setDisplay('profile-display-tagline', profile.tagline, { placeholder: 'Dial in your hydration game.' });
    setDisplay('profile-display-age', profile.age, {
      placeholder: 'Add age',
      formatter: (v) => `${v} yrs`
    });
    setDisplay('profile-display-location', profile.location, { placeholder: 'Add location' });
    setDisplay('profile-display-mass', profile.massKg, {
      placeholder: '—',
      formatter: (v) => formatMass(v, { prefs, withUnit: false })
    });
    setDisplay('profile-display-height', profile.heightCm, {
      placeholder: '—',
      formatter: (v) => formatHeight(v, { prefs, withUnit: false })
    });
    setDisplay('profile-display-sweat', profile.sweatRateLph, {
      placeholder: '—',
      formatter: (v) => formatVolumeRate(v, { prefs, withUnit: false })
    });
    setDisplay('profile-display-hr', profile.restingHr, {
      placeholder: '—',
      formatter: (v) => formatNumber(v, 0) ?? '—'
    });
    setDisplay('profile-display-goal', profile.hydrationGoalL, {
      placeholder: 'Set goal',
      formatter: (v) => formatVolume(v, { prefs })
    });
    setDisplay('profile-display-focus', profile.trainingFocus, {
      placeholder: 'Set focus',
      formatter: (v) => PROFILE_FOCUS_LABELS[v] || v
    });
    setDisplay('profile-display-units', prefs.units, {
      placeholder: PROFILE_UNIT_LABELS.metric,
      formatter: (v) => PROFILE_UNIT_LABELS[v] || PROFILE_UNIT_LABELS.metric
    });
    setDisplay('profile-display-theme', prefs.theme, {
      placeholder: PROFILE_THEME_LABELS.auto,
      formatter: (v) => PROFILE_THEME_LABELS[v] || PROFILE_THEME_LABELS.auto
    });
    setDisplay('profile-display-density', prefs.dashboardDensity, {
      placeholder: PROFILE_DENSITY_LABELS.comfortable,
      formatter: (v) => PROFILE_DENSITY_LABELS[v] || PROFILE_DENSITY_LABELS.comfortable
    });
    setDisplay('profile-display-browser', prefs.browserPrompts, {
      placeholder: PROFILE_PROMPT_LABELS.off,
      formatter: (v) => PROFILE_PROMPT_LABELS[v] || PROFILE_PROMPT_LABELS.off
    });

    UrinePanel.refresh();
    HydrationTracker.refresh();
    if (me.email) {
      renderLogs(me.email);
    }
  }

  function renderDaily(email) {
    const listEl = document.getElementById('daily-list');
    const calEl = document.getElementById('daily-calendar');
    if (!listEl || !calEl) return;
    const entries = Store.getDaily(email);
    const dateInput = document.getElementById('daily-date');
    if (dateInput && !dateInput.value) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      dateInput.value = `${yyyy}-${mm}-${dd}`;
    }
    // List recent (sorted newest first by date)
    const sorted = [...entries].sort((a,b) => (a.date < b.date ? 1 : -1));
    listEl.innerHTML = sorted.slice(0, 20).map(e => {
      const alcohol = e.metrics?.alcohol ? ' — Alcohol' : '';
      const urineCount = e.urine?.entries?.length || 0;
      const urineTag = urineCount ? ` — ${urineCount} urine log${urineCount === 1 ? '' : 's'}` : '';
      return `<div class="daily-item"><strong>${e.date}</strong> — Rating ${e.rating}${alcohol}${urineTag}${e.note ? ` — ${e.note}` : ''}</div>`;
    }).join('');

    // Calendar for current month
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-based
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startWeekday = first.getDay(); // 0=Sun
    const daysInMonth = last.getDate();

    const map = new Map(entries.map(e => [e.date, e]));
    const yyyy = String(year);
    const mm = String(month + 1).padStart(2, '0');

    let cells = '';
    for (let i = 0; i < startWeekday; i++) cells += '<div class="cal-cell empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dd = String(d).padStart(2, '0');
      const key = `${yyyy}-${mm}-${dd}`;
      const e = map.get(key);
      const rating = e?.rating;
      let cls = 'neutral';
      if (rating != null) {
        if (rating <= 2) cls = 'low';
        else if (rating === 3) cls = 'mid';
        else cls = 'high';
      }
      cells += `<div class="cal-cell ${cls}" title="${key}${e?.note ? `: ${e.note}` : ''}"><span class="day">${d}</span>${rating != null ? `<span class=\"dot\"></span>` : ''}</div>`;
    }
    calEl.innerHTML = `
      <div class="cal-header">${now.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</div>
      <div class="cal-grid">${cells}</div>
    `;
  }

  function wireDashboardCalendar() {
    const calEl = document.getElementById('dash-calendar');
    if (!calEl) return;
    // Track month offset from current month
    if (typeof calEl._monthOffset !== 'number') calEl._monthOffset = 0;
    const render = () => {
      const me = Auth.me();
      const offset = calEl._monthOffset;
      const now = new Date();
      const view = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const year = view.getFullYear();
      const month = view.getMonth();
      const first = new Date(year, month, 1);
      const last = new Date(year, month + 1, 0);
      const startWeekday = first.getDay();
      const daysInMonth = last.getDate();
      const yyyy = String(year);
      const mm = String(month + 1).padStart(2, '0');

      // Map logs by YYYY-MM-DD
      const logs = me ? Store.getLogs(me.email) : [];
      const byDate = new Map();
      logs.forEach((l, index) => {
        const d = new Date(l.ts);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key).push({ log: l, index });
      });

      let cells = '';
      for (let i = 0; i < startWeekday; i++) cells += '<div class="cal-cell empty"></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const dd = String(d).padStart(2, '0');
        const key = `${yyyy}-${mm}-${dd}`;
        const dateObj = new Date(year, month, d, 12, 0, 0, 0);
        const inCurrentMonth = offset === 0;
        const today = new Date();
        const isToday = inCurrentMonth && d === today.getDate();
        const isFuture = inCurrentMonth && dateObj > new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
        const cls = ['cal-cell', isFuture ? 'disabled' : '', isToday ? 'today' : ''].filter(Boolean).join(' ');
        const logsForDay = byDate.get(key) || [];
        // Build inner content: day row + log chips
        const chips = logsForDay.map(({ log, index }) => {
          const c = hydrationChipColor(log);
          return `
            <div
              class="log-chip"
              data-log-index="${index}"
              title="${c.label}"
              style="background:${c.bg}; border-color:${c.border}; color:#fff;"
            >
              RPE ${log.input.rpe}, ${log.input.durationMin}m
              ${log.actualIntakeL != null && !Number.isNaN(log.actualIntakeL)
                ? ` • ${Math.round((log.actualIntakeL / (planNeedValue(log.plan) || 1)) * 100)}%`
                : ' • ?'}
            </div>
          `;
        }).join('');
        cells += `<div class=\"${cls}\" data-date=\"${key}\" ${isToday && !isFuture ? 'data-today="1"' : ''}>
          <div class=\"day-row\"><span class=\"day\">${d}</span></div>
          <div class=\"logs-mini\">${chips}</div>
        </div>`;
      }
      const monthLabel = new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
      const disableNext = calEl._monthOffset >= 0; // cannot go to future months
      calEl.innerHTML = `
        <div class=\"cal-header\">
          <div class=\"nav\">
            <button class=\"btn\" id=\"cal-prev\">◀</button>
            <div>${monthLabel}</div>
            <div>
              <button class=\"btn\" id=\"cal-today\" ${offset===0 ? 'disabled' : ''}>Today</button>
              <button class=\"btn\" id=\"cal-next\" ${disableNext ? 'disabled' : ''}>▶</button>
            </div>
          </div>
        </div>
        <div class=\"cal-grid\">${cells}</div>
      `;

      // Wire nav
      const prev = document.getElementById('cal-prev');
      const next = document.getElementById('cal-next');
      const todayBtn = document.getElementById('cal-today');
      prev.onclick = () => { calEl._monthOffset -= 1; render(); };
      if (next) next.onclick = () => { if (!disableNext) { calEl._monthOffset += 1; render(); } };
      if (todayBtn) todayBtn.onclick = () => { calEl._monthOffset = 0; render(); };

      // Wire log chip clicks
      calEl.querySelectorAll('.log-chip').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = Number(el.getAttribute('data-log-index'));
          const logsArr = Store.getLogs(me.email);
          const log = logsArr[idx];
          if (log) openModalWithLog(log, idx);
        });
      });
      // Wire plan on clicking today's empty area only if no log chip is clicked
      calEl.querySelectorAll('[data-today="1"]').forEach(cell => {
        cell.addEventListener('click', (e) => {
          // If user clicked a chip, skip (handled above). Otherwise open planner.
          if ((e.target && e.target.closest && e.target.closest('.log-chip'))) return;
          openPlanModalForToday();
        });
      });
    };
    calEl._render = render;
    render();
  }

  function wireDashboardCalendarForLogs(email) {
    const calEl = document.getElementById('dash-calendar-logs');
    if (!calEl) return;
    // Track month offset from current month
    if (typeof calEl._monthOffset !== 'number') calEl._monthOffset = 0;
    const render = () => {
      const offset = calEl._monthOffset;
      const now = new Date();
      const view = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const year = view.getFullYear();
      const month = view.getMonth();
      const first = new Date(year, month, 1);
      const last = new Date(year, month + 1, 0);
      const startWeekday = first.getDay();
      const daysInMonth = last.getDate();
      const yyyy = String(year);
      const mm = String(month + 1).padStart(2, '0');

      // Map logs by YYYY-MM-DD
      const logs = Store.getLogs(email);
      const byDate = new Map();
      logs.forEach((l, index) => {
        const d = new Date(l.ts);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key).push({ log: l, index });
      });

      let cells = '';
      for (let i = 0; i < startWeekday; i++) cells += '<div class="cal-cell empty"></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const dd = String(d).padStart(2, '0');
        const key = `${yyyy}-${mm}-${dd}`;
        const dateObj = new Date(year, month, d, 12, 0, 0, 0);
        const inCurrentMonth = offset === 0;
        const today = new Date();
        const isToday = inCurrentMonth && d === today.getDate();
        const isFuture = inCurrentMonth && dateObj > new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
        const cls = ['cal-cell', isFuture ? 'disabled' : '', isToday ? 'today' : ''].filter(Boolean).join(' ');
        const logsForDay = byDate.get(key) || [];
        // Build inner content: day row + log chips
        const chips = logsForDay.map(({ log, index }) => {
          const c = hydrationChipColor(log);
          return `
            <div
              class="log-chip"
              data-log-index="${index}"
              title="${c.label}"
              style="background:${c.bg}; border-color:${c.border}; color:#fff;"
            >
              RPE ${log.input.rpe}, ${log.input.durationMin}m
              ${log.actualIntakeL != null && !Number.isNaN(log.actualIntakeL)
                ? ` • ${Math.round((log.actualIntakeL / (planNeedValue(log.plan) || 1)) * 100)}%`
                : ' • ?'}
            </div>
          `;
        }).join('');
        cells += `<div class=\"${cls}\" data-date=\"${key}\" ${isToday && !isFuture ? 'data-today="1"' : ''}>
          <div class=\"day-row\"><span class=\"day\">${d}</span></div>
          <div class=\"logs-mini\">${chips}</div>
        </div>`;
      }
      const monthLabel = new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
      const disableNext = calEl._monthOffset >= 0; // cannot go to future months
      calEl.innerHTML = `
        <div class=\"cal-header\">
          <div class=\"nav\">
            <button class=\"btn\" id=\"cal-prev-logs\">◀</button>
            <div>${monthLabel}</div>
            <div>
              <button class=\"btn\" id=\"cal-today-logs\" ${offset===0 ? 'disabled' : ''}>Today</button>
              <button class=\"btn\" id=\"cal-next-logs\" ${disableNext ? 'disabled' : ''}>▶</button>
            </div>
          </div>
        </div>
        <div class=\"cal-grid\">${cells}</div>
      `;

      // Wire nav
      const prev = document.getElementById('cal-prev-logs');
      const next = document.getElementById('cal-next-logs');
      const todayBtn = document.getElementById('cal-today-logs');
      prev.onclick = () => { calEl._monthOffset -= 1; render(); };
      if (next) next.onclick = () => { if (!disableNext) { calEl._monthOffset += 1; render(); } };
      if (todayBtn) todayBtn.onclick = () => { calEl._monthOffset = 0; render(); };

      // Wire log chip clicks
      calEl.querySelectorAll('.log-chip').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = Number(el.getAttribute('data-log-index'));
          const logsArr = Store.getLogs(email);
          const log = logsArr[idx];
          if (log) openModalWithLog(log, idx);
        });
      });
    };
    calEl._render = render;
    render();
  }

  function pickNumber(...values) {
    for (const v of values) {
      if (typeof v === 'number' && !Number.isNaN(v)) return v;
    }
    return null;
  }

  function normalizeWeatherData(raw) {
    if (!raw || typeof raw !== 'object' || raw.error === true) return null;
    const current = raw.raw?.current || raw.current || {};
    const location = raw.location || raw.raw?.location || {};

    const tempC = pickNumber(raw.tempC, raw.temp_c, current.temp_c);
    const feelslikeC = pickNumber(raw.feelslikeC, raw.feelslike_c, current.feelslike_c, tempC);
    const humidityPct = pickNumber(raw.humidityPct, raw.humidity, current.humidity);
    const uvIndex = pickNumber(raw.uvIndex, raw.uv, current.uv);
    const windKph = pickNumber(raw.windKph, raw.wind_kph, current.wind_kph);
    const windMps = pickNumber(raw.windMps, raw.wind_mps, windKph != null ? windKph / 3.6 : null);
    const windDir = raw.windDir ?? raw.wind_dir ?? current.wind_dir ?? null;
    const pressureMb = pickNumber(raw.pressureMb, raw.pressure_mb, current.pressure_mb);
    const cloudPct = pickNumber(raw.cloudPct, raw.cloud, current.cloud);
    const visibilityKm = pickNumber(raw.visibilityKm, raw.vis_km, current.vis_km);
    const city = raw.city ?? location.name ?? null;
    const region = raw.region ?? location.region ?? null;
    const country = raw.country ?? location.country ?? null;

    return {
      ...raw,
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
    };
  }

  function hydrationChipColor(log) {
  const need = planNeedValue(log?.plan);
  const actual = log?.actualIntakeL;

  // Unanswered
  if (actual == null || Number.isNaN(actual)) {
    return {
      bg: 'hsl(265 80% 34%)',      // purple
      border: 'hsl(265 80% 44%)',
      label: 'Unanswered'
    };
  }

  if (!need || need <= 0) {
    return {
      bg: 'hsl(0 0% 35%)',         // neutral gray if plan missing
      border: 'hsl(0 0% 45%)',
      label: 'No plan value'
    };
  }

  // Clamp ratio 0..1; 1+ stays green
  const ratio = Math.max(0, Math.min(actual / need, 1));
  // Hue 0 (red) → 120 (green)
  const hue = Math.round(120 * ratio);
  const bg = `hsl(${hue} 65% 30%)`;
  const border = `hsl(${hue} 65% 40%)`;

  return {
    bg,
    border,
    label: `${Math.round((actual / need) * 100)}% of plan`
  };
}

  

  function openDailyTrackerModal() {
    const modal = document.getElementById('daily-modal');
    const form = document.getElementById('daily-modal-form');
    const closeBtn = document.getElementById('daily-modal-close');
    const cancelBtn = document.getElementById('daily-modal-cancel');
    const dateEl = document.getElementById('dt-date');
    const timeEl = document.getElementById('dt-time');
    const alcoholEl = document.getElementById('dt-alcohol');
    const caffeineEl = document.getElementById('dt-caffeine');
    const caffeineUnitEl = document.getElementById('dt-caffeine-unit');
    const fluidEl = document.getElementById('dt-fluidL');
    const notesEl = document.getElementById('dt-notes');
    const me = Auth.me();
    if (!modal || !form || !me) return;

    const today = formatDateInputValue();
    if (dateEl && !dateEl.value) dateEl.value = today;

    const fillFormForDate = (date) => {
      if (!date) return;
      const entry = Store.findDailyByDate(me.email, date);
      const metrics = entry?.metrics || {};
      if (timeEl) timeEl.value = entry?.time || formatTimeInputValue();
      if (alcoholEl) alcoholEl.value = metrics.alcohol ?? '';
      if (caffeineEl) caffeineEl.value = metrics.caffeine?.value ?? '';
      if (caffeineUnitEl) caffeineUnitEl.value = metrics.caffeine?.unit || 'mg';
      if (fluidEl) fluidEl.value = metrics.fluidL ?? '';
      if (notesEl) notesEl.value = entry?.note || '';
    };

    const selectedDate = dateEl?.value || today;
    fillFormForDate(selectedDate);

    const handleDateChange = () => {
      const targetDate = dateEl?.value || today;
      fillFormForDate(targetDate);
    };
    if (dateEl) dateEl.addEventListener('change', handleDateChange);

    const onClose = () => {
      if (dateEl) dateEl.removeEventListener('change', handleDateChange);
      modal.classList.add('hidden');
      form.reset();
    };
    if (closeBtn) closeBtn.onclick = onClose;
    if (cancelBtn) cancelBtn.onclick = onClose;
    modal.onclick = (e) => { if (e.target === modal) onClose(); };

    ['dt-saltiness','dt-sleepQual','dt-stress','dt-thirst'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const sync = () => updateRangeStyle(el);
        el.addEventListener('input', sync);
        sync();
      }
    });

    form.onsubmit = (e) => {
      e.preventDefault();
      const date = dateEl.value;
      if (!date) { Ui.toast('Please select a date'); return; }

      const alcohol = parseFloat(alcoholEl.value || 0) || 0;
      const caffeine = parseFloat(caffeineEl.value || 0) || 0;
      const caffeineUnit = caffeineUnitEl.value || 'mg';
      const fluidL = parseFloat(fluidEl.value || 0) || 0;
      const notes = (notesEl.value || '').trim();
      const time = (timeEl.value || '');

      Store.upsertDaily(me.email, {
        date,
        time,
        note: notes,
        metrics: {
          alcohol,
          caffeine: { value: caffeine, unit: caffeineUnit },
          fluidL
        }
      });
      refreshCalendars();
      UrinePanel.refresh();
      if (document.getElementById('view-logs')?.classList.contains('hidden') === false) {
        renderDaily(me.email);
        renderDailyCharts(me.email);
      }
      Ui.toast('Daily tracker saved');
      onClose();
    };

    modal.classList.remove('hidden');
  }

  function openPlanModalForToday() {
    const modal = document.getElementById('plan-modal');
    const closeBtn = document.getElementById('plan-modal-close');
    const form = document.getElementById('plan-modal-form');
    const resultSection = document.getElementById('plan-result');
    const resultBody = document.getElementById('plan-result-body');
    const resultClose = document.getElementById('plan-result-close');
    const resultAnother = document.getElementById('plan-result-another');
    const me = Auth.me();
    if (!modal || !form || !me) return;
    const rpeInput = document.getElementById('modal-input-rpe');
    const rpeVal = document.getElementById('modal-rpe-value');
    const preInput = document.getElementById('modal-input-pre');
    const preVal = document.getElementById('modal-pre-value');
    const durationInput = document.getElementById('modal-input-duration');
    const workoutInputs = Array.from(form.querySelectorAll('input[name="plan-workout-type"]'));
    if (!rpeInput || !preInput || !durationInput) return;
    const weatherStatusEl = document.getElementById('weather-status');
    const submitBtn = form.querySelector('button[type="submit"]');
    const weatherDataRef = { data: null };
    const syncWorkoutCards = () => {
      workoutInputs.forEach((input) => {
        const card = input.closest('.workout-type-option');
        if (card) card.classList.toggle('selected', input.checked);
      });
    };
    workoutInputs.forEach((input) => {
      if (!input.dataset.bound) {
        input.dataset.bound = 'true';
        input.addEventListener('change', syncWorkoutCards);
      }
    });
    const getSelectedWorkoutType = () => {
      const selected = workoutInputs.find((input) => input.checked);
      return selected?.value || DEFAULT_WORKOUT_TYPE;
    };

    const statusColors = {
      error: '#822626ff',
      info: '#1b2740'
    };

    const planContextForToday = () => {
      const today = formatDateInputValue(new Date());
      const ctx = getDailyHydrationContext(me.email, today);
      const panelSample = UrinePanel.latestLevel(today);
      const urineEntry = ctx.urineEntry || panelSample;
      const fallback = UrinePanel.currentSliderLevel();
      const urineColor = urineEntry?.level ?? fallback ?? 5;
      const urineStatus = urineEntry?.status ?? getUrineLevelMeta(urineColor).status;
      return {
        date: today,
        record: ctx.record,
        fluidPriorL: ctx.fluidPriorL,
        alcoholDrinks: ctx.alcoholDrinks,
        caffeineMg: ctx.caffeineMg,
        urineColor,
        urineStatus
      };
    };

    const setWeatherStatus = (text, tone = 'info') => {
      if (!weatherStatusEl) return;
      weatherStatusEl.style.display = 'block';
      weatherStatusEl.textContent = text;
      weatherStatusEl.style.background = statusColors[tone] || statusColors.info;
    };

    const syncSliders = () => {
      if (rpeInput && rpeVal) {
        const syncRpe = () => {
          rpeVal.textContent = rpeInput.value;
          updateRangeStyle(rpeInput, { startColor: '#16a34a', endColor: '#dc2626' });
        };
        rpeInput.oninput = syncRpe;
        syncRpe();
      }
      if (preInput && preVal) {
        const syncPre = () => {
          preVal.textContent = preInput.value;
          updateRangeStyle(preInput, { startColor: '#dc2626', endColor: '#16a34a' });
        };
        preInput.oninput = syncPre;
        syncPre();
      }
    };

    const resetView = () => {
      form.classList.remove('hidden');
      form.reset();
      syncSliders();
      syncWorkoutCards();
      weatherDataRef.data = null;
      if (submitBtn) submitBtn.disabled = true;
      if (resultSection) resultSection.classList.add('hidden');
      if (resultBody) resultBody.innerHTML = '';
      if (weatherStatusEl) {
        weatherStatusEl.style.display = 'none';
        weatherStatusEl.textContent = 'Weather data will be fetched automatically...';
        weatherStatusEl.style.background = statusColors.info;
      }
    };

    const setResultVisible = (visible) => {
      if (!resultSection) return;
      resultSection.classList.toggle('hidden', !visible);
      form.classList.toggle('hidden', visible);
    };

    const handleWeatherSuccess = (weather, location) => {
      const hasValidTemp = typeof weather?.tempC === 'number' && !isNaN(weather.tempC);
      const hasValidHumidity = typeof weather?.humidityPct === 'number' && !isNaN(weather.humidityPct);
      if (weather && hasValidTemp && hasValidHumidity) {
        weatherDataRef.data = weather;
        console.log('[Weather] Normalized Location:', {
          city: weather.city,
          region: weather.region,
          country: weather.country,
          coordinates: location
        });
        console.log('[Weather] Normalized Metrics:', weather);
        if (weatherStatusEl) {
          const prefs = getCurrentPreferences();
          const tempText = formatTemperature(weather.tempC, { prefs });
          const windMps = weather.windMps ?? (typeof weather.windKph === 'number' ? weather.windKph / 3.6 : null);
          const windText = formatWindSpeed(windMps, { prefs }) ?? 'N/A';
          setWeatherStatus(`Weather: ${tempText}, ${weather.humidityPct}% RH, UV ${weather.uvIndex ?? 'N/A'}, Wind ${windText} (${weather.city || 'Location'})`, 'success');
        }
        if (submitBtn) submitBtn.disabled = false;
      } else {
        console.error('[Weather] Invalid weather data after normalization:', {
          weather,
          hasValidTemp,
          hasValidHumidity
        });
        setWeatherStatus('Weather data incomplete. Try again shortly.', 'error');
        if (submitBtn) submitBtn.disabled = true;
      }
    };

    const requestWeather = () => {
      if (submitBtn) submitBtn.disabled = true;
      setWeatherStatus('Fetching weather data...', 'info');
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const location = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            try {
              const weatherRaw = await Api.getWeather(location.lat, location.lon);
              
              // Check if the response indicates an error
              if (weatherRaw && weatherRaw.error) {
                if (weatherRaw.code === 'MISSING_API_KEY') {
                  setWeatherStatus('Weather service is not configured. Please contact support.', 'error');
                } else {
                  setWeatherStatus(weatherRaw.message || 'Weather service unavailable. Please try again later.', 'error');
                }
                if (submitBtn) submitBtn.disabled = true;
                return;
              }
              
              const weather = normalizeWeatherData(weatherRaw);
              handleWeatherSuccess(weather, location);
            } catch (err) {
              console.error('[Weather] Error fetching weather:', err);
              setWeatherStatus('Weather fetch failed. Please retry.', 'error');
              if (submitBtn) submitBtn.disabled = true;
            }
          },
          () => {
            setWeatherStatus('Location permission denied - cannot fetch weather data', 'error');
            if (submitBtn) submitBtn.disabled = true;
          },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
        );
      } else {
        setWeatherStatus('Geolocation not available - cannot fetch weather data', 'error');
        if (submitBtn) submitBtn.disabled = true;
      }
    };

    const onClose = () => {
      resetView();
      modal.classList.add('hidden');
    };

    if (closeBtn) closeBtn.onclick = onClose;
    modal.onclick = (e) => { if (e.target === modal) onClose(); };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) onClose();
    }, { once: true });
    if (resultClose) resultClose.onclick = onClose;
    if (resultAnother) {
      resultAnother.onclick = () => {
        resetView();
        requestWeather();
      };
    }

    resetView();
    requestWeather();

    form.onsubmit = async (e) => {
      e.preventDefault();
      const weatherData = weatherDataRef.data;
      if (!weatherData || weatherData.tempC == null || weatherData.humidityPct == null) {
        Ui.toast('Weather data is required. Please allow location access and try again.');
        return;
      }

      const context = planContextForToday();
      if (!context.record) {
        Ui.toast('Tip: log your morning tracker for more precise guidance.');
      }

      const rpe = parseInt(rpeInput.value, 10);
      const durationMin = parseInt(durationInput.value, 10);
      const preScore = parseInt(preInput.value, 10);
      const tempC = weatherData.tempC;
      const humidityPct = weatherData.humidityPct;
      const apparentTempC = weatherData.feelslikeC ?? null;
      const uvIndex = weatherData.uvIndex ?? null;
      const windSpeedMps = weatherData.windMps ?? null;
      const workoutType = getSelectedWorkoutType();

      const plan = Recommendation.planLiters({
        rpe,
        durationMin,
        tempC,
        humidityPct,
        preScore,
        userBaselineLph: me.profile?.sweatRateLph,
        massKg: me.profile?.massKg,
        apparentTempC,
        uvIndex,
        windSpeedMps,
        fluidPriorL: context.fluidPriorL,
        caffeineMg: context.caffeineMg,
        alcoholDrinks: context.alcoholDrinks,
        urineColor: context.urineColor
      });

      const logEntry = {
        ts: Date.now(),
        input: {
          rpe,
          durationMin,
          tempC,
          humidityPct,
          pre: preScore,
          preScore: preScore,
          urineColor: context.urineColor,
          urineStatus: context.urineStatus,
          fluidsPrior: context.fluidPriorL,
          caffeineMg: context.caffeineMg,
          alcoholDrinks: context.alcoholDrinks,
          uvIndex,
          workoutType
        },
        plan,
        actualIntakeL: null,
        weather: {
          tempC: weatherData.tempC,
          feelslikeC: weatherData.feelslikeC,
          humidityPct: weatherData.humidityPct,
          uvIndex: weatherData.uvIndex,
          windKph: weatherData.windKph,
          windMps: weatherData.windMps,
          windDir: weatherData.windDir,
          pressureMb: weatherData.pressureMb,
          cloudPct: weatherData.cloudPct,
          visibilityKm: weatherData.visibilityKm,
          location: {
            city: weatherData.city,
            region: weatherData.region,
            country: weatherData.country
          }
        }
      };

      Store.addLog(me.email, logEntry);
      refreshCalendars();
      renderLogs(me.email);

      if (resultBody) {
        renderPlanDetails(resultBody, {
          plan,
          input: {
            rpe,
            durationMin,
            pre: preScore,
            tempC,
            humidityPct,
            urineColor: context.urineColor,
            urineStatus: context.urineStatus,
            fluidsPrior: context.fluidPriorL,
            caffeineMg: context.caffeineMg,
            alcoholDrinks: context.alcoholDrinks,
            uvIndex,
            workoutType
          },
          weather: weatherData
        });
      }
      setResultVisible(true);
      requestAnimationFrame(() => {
        if (resultSection) {
          resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    };

    modal.classList.remove('hidden');
  }

  // Init
  (function init() {
    wire();
    // Try to hydrate from server on startup
    Api.loadUsers().then((serverUsers) => {
      if (serverUsers && typeof serverUsers === 'object' && Object.keys(serverUsers).length > 0) {
        console.log('[Init] Loading data from database...');
        // Persist users
        Auth.setUsers(serverUsers);
        // Persist logs per user for local views
        Object.values(serverUsers).forEach(u => {
          if (u && u.email) {
            const logs = Array.isArray(u.logs) ? u.logs : [];
            localStorage.setItem(Store.logsKey(u.email), JSON.stringify(logs));
            const daily = Array.isArray(u.daily) ? u.daily : [];
            localStorage.setItem(Store.dailyKey(u.email), JSON.stringify(daily));
          }
        });
        hydrateUiFromUser();
        console.log('[Init] Successfully loaded data from database');
      } else {
        // Check if we have local data as fallback
        const localUsers = Auth.getUsers();
        if (localUsers && Object.keys(localUsers).length > 0) {
          console.warn('[Init] Database unavailable, using local storage data. Some features may not work correctly.');
          hydrateUiFromUser();
        } else {
          console.log('[Init] No data available (neither database nor local storage)');
        }
      }
    }).catch((err) => {
      console.error('[Init] Failed to load users from database:', err);
      // Fallback to local storage if available
      const localUsers = Auth.getUsers();
      if (localUsers && Object.keys(localUsers).length > 0) {
        console.warn('[Init] Using local storage data as fallback');
        hydrateUiFromUser();
      }
    });
    const me = Auth.getCurrent();
    if (me) {
      Ui.setAuthed(true);
      Ui.show(Views.dashboard);
      wireDashboardCalendar();
    } else {
      Ui.setAuthed(false);
    }
    hydrateUiFromUser();
  })();
})();

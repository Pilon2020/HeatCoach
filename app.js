(function() {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  // Weather fetching removed; inputs are manual now

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
        profile: { massKg: null, sweatRateLph: 1.0 },
      };
      this.setUsers(users);
      // Best-effort server sync
      Api.upsertUser(users[email]).catch(() => {});
      return { email, name };
    },
    async login(email, password) {
      const users = this.getUsers();
      const user = users[email];
      if (!user) throw new Error('Invalid credentials');
      const passwordHash = await this.hash(password);
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
    saveProfile(profile) {
      const current = this.getCurrent();
      if (!current) return;
      const users = this.getUsers();
      const user = users[current.email];
      if (!user) return;
      user.profile = { ...user.profile, ...profile };
      this.setUsers(users);
      // Best-effort server sync
      Api.upsertUser(users[current.email]).catch(() => {});
    }
  };

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
      if (!entry || !entry.date) return;
      const list = this.getDaily(email);
      const idx = list.findIndex(d => d.date === entry.date);
      const base = idx >= 0 ? list[idx] : { date: entry.date };
      const merged = mergeDailyRecords(base, entry);
      if (idx >= 0) list[idx] = merged; else list.push(merged);
      localStorage.setItem(this.dailyKey(email), JSON.stringify(list));
      Api.addDaily(email, merged).catch(() => {});
    },
    findDailyByDate(email, date) {
      if (!date) return null;
      const list = this.getDaily(email);
      return list.find((d) => d.date === date) || null;
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
      merged.urine = { entries: incomingUrine ?? existingUrine ?? [] };
    }
    return merged;
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
      try { const r = await fetch('/api/ping'); return r.ok; } catch { return false; }
    },
    async getWeather(lat, lon) {
      try {
        console.log('[Weather API] Requesting weather for:', { lat, lon });
        const r = await fetch(`/api/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
        if (!r.ok) {
          const errorText = await r.text().catch(() => 'Unknown error');
          console.error('[Weather API] Server error:', r.status, errorText);
          throw new Error(`Weather fetch failed: ${r.status} ${errorText}`);
        }
        const data = await r.json();
        console.log('[Weather API] Server response:', data);
        return data;
      } catch (e) {
        console.error('[Weather API] Error:', e);
        return null;
      }
    },
    async loadUsers() {
      try {
        const r = await fetch('/api/users');
        if (!r.ok) throw new Error('fail');
        return await r.json();
      } catch {
        return null;
      }
    },
    async upsertUser(user) {
      try {
        await fetch('/api/users', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(user)
        });
      } catch {}
    },
    async replaceAllUsers(users) {
      try {
        await fetch('/api/users', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(users)
        });
      } catch {}
    },
    async addLog(email, log) {
      try {
        await fetch('/api/logs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, log })
        });
      } catch {}
    },
    async addDaily(email, entry) {
      try {
        await fetch('/api/daily', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, entry })
        });
      } catch {}
    },
    async updateLog(email, ts, actualIntakeL) {
      try {
        await fetch('/api/logs/update', {
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
    const badge = Recommendation.statusBadge(plan.pctBodyMassLoss);
    const schedule = buildDrinkSchedule(input.durationMin, plan.drinkDuring ?? plan.duringL);
    const adjustments = plan.adjustments || {};
    const sodiumGuide = plan.sodium || (plan.sodiumMgPerL
      ? { low: plan.sodiumMgPerL, high: plan.sodiumMgPerL }
      : { low: 300, high: 600 });
    const metaParts = [
      `RPE ${input.rpe}/10`,
      `${input.durationMin} min`,
      `${input.tempC}°C`,
      `${input.humidityPct}% RH`,
      `UV ${input.uvIndex ?? weather?.uvIndex ?? 'n/a'}`,
      input.urineColor ? `Urine Lv ${input.urineColor}${input.urineStatus ? ` (${input.urineStatus})` : ''}` : '',
      weather?.city || weather?.region || weather?.country || ''
    ].filter(Boolean);
    const scheduleList = schedule.length
      ? schedule.map((slot) => `
        <li>
          <span>${slot.atMin} min</span>
          <div>
            <strong>${slot.volumeL} L</strong>
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
    const duringNote = plan.drinkDuring > 0
      ? 'Aim to finish this volume by the start of cooldown.'
      : 'Session is short enough that mid-session sipping is optional.';
    const drinkDuring = plan.drinkDuring ?? plan.duringL ?? 0;
    const drinkPost = plan.drinkPost ?? plan.postL ?? 0;
    const totalTarget = plan.totalTargetL ?? plan.netNeedL ?? planNeedValue(plan);
    const sodiumRange = `${sodiumGuide.low}–${sodiumGuide.high} mg/L`;
    const avgSodium = (sodiumGuide.low + sodiumGuide.high) / 2;
    const perHalfValue = Number.isFinite(avgSodium) ? Math.round(avgSodium * 0.5) : null;
    const totalSodiumLow = Number.isFinite(sodiumGuide.low * drinkDuring) ? Math.round(drinkDuring * sodiumGuide.low) : null;
    const totalSodiumHigh = Number.isFinite(sodiumGuide.high * drinkDuring) ? Math.round(drinkDuring * sodiumGuide.high) : null;
    const totalRange = drinkDuring > 0 && totalSodiumLow != null && totalSodiumHigh != null
      ? `${totalSodiumLow}–${totalSodiumHigh} mg total for the during volume`
      : 'Add electrolytes if you sip during this session.';
    const perHalfText = perHalfValue != null ? `${perHalfValue} mg` : 'n/a';
    const sliderAdj = typeof adjustments.slider === 'number'
      ? `${adjustments.slider >= 0 ? '+' : ''}${adjustments.slider} L self-check`
      : 'Self-check slider unavailable';
    const urineAdj = typeof adjustments.urine === 'number'
      ? `${adjustments.urine >= 0 ? '+' : ''}${adjustments.urine} L urine signal`
      : 'Urine signal unavailable';
    const caffeineAdj = typeof adjustments.caffeine === 'number'
      ? `-${adjustments.caffeine} L caffeine penalty`
      : 'Caffeine penalty unavailable';
    const alcoholAdj = typeof adjustments.alcohol === 'number'
      ? `-${adjustments.alcohol} L alcohol penalty`
      : 'Alcohol penalty unavailable';
    const fluidAdj = typeof adjustments.fluidPrior === 'number'
      ? `${adjustments.fluidPrior} L already consumed`
      : 'Pre-drank value unavailable';
    const blendedAdj = typeof adjustments.blendedStart === 'number'
      ? `${adjustments.blendedStart >= 0 ? '+' : ''}${adjustments.blendedStart} L combined preload`
      : null;
    out.innerHTML = `
      <div class="plan-result-card">
        <div class="plan-result-head">
          <div>
            <p class="eyebrow">Hydration plan saved to calendar</p>
            <h4>${input.durationMin}-minute session</h4>
            <div class="plan-result-meta">${metaParts.join(' • ')}</div>
          </div>
          <span class="${badge.cls}">${badge.text}</span>
        </div>
        <div class="plan-metrics-grid">
          <div>
            <span>Expected sweat loss</span>
            <strong>${plan.sweatLoss ?? plan.grossLossL ?? '—'} L</strong>
          </div>
          <div>
            <span>Sweat rate</span>
            <strong>${plan.sweatRate} L/hr</strong>
          </div>
          <div>
            <span>During target</span>
            <strong>${drinkDuring} L</strong>
          </div>
          <div>
            <span>Post target</span>
            <strong>${drinkPost} L</strong>
          </div>
        </div>
        <div class="plan-breakdown">
          <article>
            <p>During</p>
            <strong>${drinkDuring} L</strong>
            <small>${duringNote}</small>
          </article>
          <article>
            <p>Post</p>
            <strong>${drinkPost} L</strong>
            <small>Replace remaining loss within 60 minutes</small>
          </article>
          <article>
            <p>Total target</p>
            <strong>${totalTarget} L</strong>
            <small>Excludes what you already drank</small>
          </article>
        </div>
        <div class="plan-block">
          <div class="plan-block-title">Pre-hydration impact</div>
          <p>Effective preload: <strong>${adjustments.effectivePre ?? '—'} L</strong></p>
          <ul class="plan-list">
            ${[fluidAdj, sliderAdj, urineAdj, blendedAdj, caffeineAdj, alcoholAdj]
              .filter(Boolean)
              .map(item => `<li>${item}</li>`)
              .join('')}
          </ul>
        </div>
        <div class="plan-block">
          <div class="plan-block-title">Electrolyte targets</div>
          <p>Keep mixes between <strong>${sodiumRange}</strong> (~${perHalfText} per 500 mL). ${totalRange}</p>
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

  const MAX_DAILY_POINTS = 14;
  const MAX_URINE_DAYS = 12;

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
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#9bb0d3';
    ctx.fillText(`max ${maxValue.toFixed(1)}`, width - pad.right - 60, pad.top - 8);
  }

  function renderUrineSequence(entries) {
    const container = document.getElementById('urine-sequence');
    if (!container) return;
    const rows = entries
      .map(entry => ({
        date: entry.date,
        samples: Array.isArray(entry.urine?.entries)
          ? [...entry.urine.entries].sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt))
          : []
      }))
      .filter(day => day.samples.length > 0);
    if (!rows.length) {
      container.innerHTML = '<p class="empty-state">No urine samples logged yet.</p>';
      return;
    }
    const recent = rows.slice(-MAX_URINE_DAYS);
    container.innerHTML = recent.map(day => {
      const chips = day.samples.map(sample => {
        const color = sample.color || getUrineLevelMeta(sample.level).color;
        const tooltip = `${day.date} • Level ${sample.level} ${sample.status || ''} ${sample.recordedAt ? new Date(sample.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`;
        return `<span class="urine-seq-dot" style="background:${color};" title="${tooltip.trim()}"></span>`;
      }).join('');
      return `
        <div class="urine-seq-row">
          <div class="urine-seq-date">${day.date}</div>
          <div class="urine-seq-track">${chips}</div>
        </div>
      `;
    }).join('');
  }

  function renderDailyCharts(email) {
    const fluidCanvas = document.getElementById('daily-fluid-chart');
    const caffeineCanvas = document.getElementById('daily-caffeine-chart');
    const alcoholCanvas = document.getElementById('daily-alcohol-chart');
    const urineContainer = document.getElementById('urine-sequence');
    if (!fluidCanvas && !caffeineCanvas && !alcoholCanvas && !urineContainer) return;
    if (!email) {
      drawDailyMetricChart(fluidCanvas, [], () => 0, { label: 'Fluid Intake (L)', emptyMessage: 'Login to view data' });
      drawDailyMetricChart(caffeineCanvas, [], () => 0, { label: 'Caffeine (mg)', emptyMessage: 'Login to view data' });
      drawDailyMetricChart(alcoholCanvas, [], () => 0, { label: 'Alcohol (drinks)', emptyMessage: 'Login to view data' });
      if (urineContainer) urineContainer.innerHTML = '<p class="empty-state">Login to view urine trend.</p>';
      return;
    }
    const entries = Store.getDaily(email) || [];
    const chronological = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    drawDailyMetricChart(
      fluidCanvas,
      chronological,
      (entry) => Number(entry.metrics?.fluidL) || 0,
      { label: 'Fluid Intake (L)', color: '#38bdf8' }
    );
    drawDailyMetricChart(
      caffeineCanvas,
      chronological,
      (entry) => {
        const metrics = entry.metrics?.caffeine;
        return metrics ? caffeineToMg(metrics.value, metrics.unit) : 0;
      },
      { label: 'Caffeine (mg)', color: '#f97316' }
    );
    drawDailyMetricChart(
      alcoholCanvas,
      chronological,
      (entry) => Number(entry.metrics?.alcohol) || 0,
      { label: 'Alcohol (drinks)', color: '#a855f7' }
    );
    renderUrineSequence(chronological);
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
    drawChart(canvas, logs);
    list.innerHTML = logs.map(l => {
      const plan = l.plan || {};
      const sodiumRange = plan.sodium ? `${plan.sodium.low}–${plan.sodium.high} mg/L` : (plan.sodiumMgPerL ? `${plan.sodiumMgPerL} mg/L` : 'n/a');
      const during = plan.drinkDuring ?? plan.duringL ?? '—';
      const post = plan.drinkPost ?? plan.postL ?? '—';
      const sweatLoss = plan.sweatLoss ?? plan.grossLossL ?? '—';
      const when = new Date(l.ts).toLocaleString();
      return `
        <div class="log-item">
          <div><strong>${when}</strong></div>
          <div>RPE ${l.input.rpe}, ${l.input.durationMin} min, ${l.input.tempC}°C, ${l.input.humidityPct}%</div>
          <div>Plan: During ${during} L • Post ${post} L (sweat ${sweatLoss} L) • Sodium ${sodiumRange}</div>
          <div>Actual: ${l.actualIntakeL ?? '-'} L</div>
        </div>
      `;
    }).join('');
    renderDailyCharts(email);
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
      const when = entry.recordedAt
        ? new Date(entry.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Just now';
      elements.latest.innerHTML = `<strong>${entry.status}</strong> • ${when}`;
      const swatch = entry.color || getUrineLevelMeta(entry.level).color;
      elements.latest.style.background = swatch;
      elements.latest.style.color = pickTextColor(swatch);
      elements.latest.style.border = '2px solid #000';
      if (elements.slider) {
        elements.slider.value = entry.level;
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
      const meta = getUrineLevelMeta(val);
      const entry = {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `urine-${Date.now()}`,
        level: val,
        status: meta.status,
        color: meta.color,
        textColor: pickTextColor(meta.color),
        recordedAt: new Date().toISOString()
      };
      const date = todayKey();
      const existing = Store.findDailyByDate(me.email, date);
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
    // Compose date/time string for display
    const when = new Date(log.ts).toLocaleString();
    const plan = log.plan || {};
    const leftParts = [
      `<div style="font-weight:600;">${when}</div>`,
      `RPE: <strong>${log.input.rpe}</strong>/10`,
      `Pre-hydration slider: <strong>${log.input.pre}</strong>/5`,
      log.input.urineColor ? `Urine color: <strong>Level ${log.input.urineColor}${log.input.urineStatus ? ` (${log.input.urineStatus})` : ''}</strong>` : '',
      typeof log.input.fluidsPrior === 'number' ? `Pre-drank: <strong>${log.input.fluidsPrior} L</strong>` : '',
      typeof log.input.caffeineMg === 'number' ? `Caffeine: <strong>${log.input.caffeineMg} mg</strong>` : '',
      typeof log.input.alcoholDrinks === 'number' ? `Alcohol: <strong>${log.input.alcoholDrinks} drinks</strong>` : '',
      `Duration: <strong>${log.input.durationMin}</strong> min`,
      `Environment: <strong>${log.input.tempC}°C</strong> • <strong>${log.input.humidityPct}% RH</strong> • UV <strong>${log.input.uvIndex ?? log.weather?.uvIndex ?? 'n/a'}</strong>`
    ].filter(Boolean).map(item => `<div>${item}</div>`).join('');
    const left = `<div style="display:grid; gap:8px;">${leftParts}</div>`;
    const sodiumRange = plan.sodium ? `${plan.sodium.low}–${plan.sodium.high} mg/L` : (plan.sodiumMgPerL ? `${plan.sodiumMgPerL} mg/L` : 'n/a');
    const rightTop = `
      <div style="display:grid; gap:8px;">
        <div>Total target: <span class="highlight">${plan.totalTargetL ?? plan.netNeedL ?? '—'} L</span>
          <small class="muted">Sweat loss ${plan.sweatLoss ?? plan.grossLossL ?? '—'} L</small></div>
        <div>During <strong>${plan.drinkDuring ?? plan.duringL ?? '—'} L</strong> • Post <strong>${plan.drinkPost ?? plan.postL ?? '—'} L</strong></div>
        <div>Sodium guidance: <strong>${sodiumRange}</strong></div>
      </div>
    `;
    // Determine whether actual intake has been recorded
    const hasActual = log.actualIntakeL != null && !isNaN(log.actualIntakeL);
    let form;
    if (hasActual) {
      // If actual intake is already recorded, show it and disable further input
      form = `
        <div style="margin-top:10px;">Actual intake: <strong>${log.actualIntakeL}</strong> L</div>
        <small class="muted">Actual already recorded; further submissions disabled.</small>
      `;
    } else {
      // Otherwise, render a form to submit the actual intake
      form = `
        <form id="log-actual-form" class="form" style="margin-top:10px;">
          <label>Actual Fluid Intake (L)
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
          // Persist the actual intake in the store
          Store.updateLog(me.email, index, (orig) => ({ ...orig, actualIntakeL: val }));
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
    
    Nav.profile.addEventListener('click', () => {
      if (dropdownMenu) dropdownMenu.classList.add('hidden');
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

    // Profile save
    $('#profile-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#profile-name').value.trim();
      const mass = parseFloat($('#profile-mass').value) || null;
      const sweat = parseFloat($('#profile-sweat').value) || null;
      Auth.saveProfile({ name, massKg: mass, sweatRateLph: sweat });
      Ui.toast('Profile saved');
    });

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

  function hydrateUiFromUser() {
    const me = Auth.me();
    if (!me) {
      UrinePanel.refresh();
      return;
    }
    $('#profile-name').value = me.name || '';
    $('#profile-mass').value = me.profile?.massKg ?? '';
    $('#profile-sweat').value = me.profile?.sweatRateLph ?? '';
    UrinePanel.refresh();
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
    if (!raw || typeof raw !== 'object') return null;
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

  if (dateEl && !dateEl.value) dateEl.value = formatDateInputValue();
  if (timeEl && !timeEl.value) timeEl.value = formatTimeInputValue();

  const onClose = () => {
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
    if (!rpeInput || !preInput || !durationInput) return;
    const weatherStatusEl = document.getElementById('weather-status');
    const submitBtn = form.querySelector('button[type="submit"]');
    const weatherDataRef = { data: null };

    const statusColors = {
      error: '#822626ff'
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
          const displayWind = weather.windKph != null ? `${Math.round(weather.windKph)} km/h` : 'N/A';
          setWeatherStatus(`Weather: ${weather.tempC}°C, ${weather.humidityPct}% RH, UV ${weather.uvIndex ?? 'N/A'}, Wind ${displayWind} (${weather.city || 'Location'})`, 'success');
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
      const urineMeta = getUrineLevelMeta(context.urineColor);

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
          uvIndex
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
      renderLogs(me.email);
      refreshCalendars();

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
            uvIndex
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
      if (serverUsers && typeof serverUsers === 'object') {
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
      }
    }).catch(() => {});
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

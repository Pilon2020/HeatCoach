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
      const list = this.getDaily(email);
      const idx = list.findIndex(d => d.date === entry.date);
      if (idx >= 0) list[idx] = entry; else list.push(entry);
      localStorage.setItem(this.dailyKey(email), JSON.stringify(list));
      Api.addDaily(email, entry).catch(() => {});
    }
  };

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
    planLiters({ rpe, durationMin, tempC, humidityPct, preScore, userBaselineLph, massKg, apparentTempC, uvIndex, windSpeedMps }) {
      const sweatRate = this.estimateSweatRateLph({ rpe, tempC, humidityPct, apparentTempC, uvIndex, windSpeedMps, userBaselineLph });
      const hours = durationMin / 60;
      const grossLossL = sweatRate * hours;
      const preAdj = (preScore - 3) * 0.2; // -0.4L..+0.4L
      const netNeedL = Math.max(0, grossLossL - preAdj);
      const duringPerHour = Math.min(sweatRate, 1.0 + (tempC > 30 ? 0.3 : 0));
      const sodiumMgPerL = 400 + Math.max(0, (sweatRate - 1.0)) * 300; // 400–700 mg/L
      // Pre/During/Post split
      const preL = Math.max(0, 0.3 + (preScore <= 2 ? 0.2 : 0));
      const duringL = Math.min(netNeedL, duringPerHour * hours);
      const postL = Math.max(0, netNeedL - duringL);
      const pctBodyMassLoss = massKg ? (grossLossL / massKg) * 100 : null;
      return {
        sweatRate,
        grossLossL: Number(grossLossL.toFixed(2)),
        netNeedL: Number(netNeedL.toFixed(2)),
        preL: Number(preL.toFixed(2)),
        duringL: Number(duringL.toFixed(2)),
        postL: Number(postL.toFixed(2)),
        sodiumMgPerL: Math.round(sodiumMgPerL),
        pctBodyMassLoss: pctBodyMassLoss !== null ? Number(pctBodyMassLoss.toFixed(2)) : null,
      };
    },
    statusBadge(pctLoss) {
      if (pctLoss == null) return { cls: 'badge', text: 'Set body mass for % loss' };
      if (pctLoss < 2) return { cls: 'badge ok', text: `${pctLoss}% est. loss (OK)` };
      if (pctLoss < 3) return { cls: 'badge warn', text: `${pctLoss}% est. loss (Monitor)` };
      return { cls: 'badge danger', text: `${pctLoss}% est. loss (High)` };
    }
  };

  function renderPlan(out, plan) {
    const badge = Recommendation.statusBadge(plan.pctBodyMassLoss);
    out.innerHTML = `
      <div>Estimated sweat rate: <span class="highlight">${plan.sweatRate} L/hr</span></div>
      <div>Total fluid need: <span class="highlight">${plan.netNeedL} L</span> (gross ${plan.grossLossL} L)</div>
      <div>Pre: <span class="highlight">${plan.preL} L</span> • During: <span class="highlight">${plan.duringL} L</span> • Post: <span class="highlight">${plan.postL} L</span></div>
      <div>Sodium target: <span class="highlight">${plan.sodiumMgPerL} mg/L</span></div>
      <div><span class="${badge.cls}">${badge.text}</span></div>
    `;
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

    // Plot netNeedL vs actualIntakeL over time (newest should appear on the right)
    const points = logs.map((l, i) => ({ x: i, ts: l.ts, need: l.plan.netNeedL, actual: l.actualIntakeL ?? 0 }));
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
    list.innerHTML = logs.map(l => `
      <div class="log-item">
        <div><strong>${new Date(l.ts).toLocaleString()}</strong></div>
        <div>RPE ${l.input.rpe}, ${l.input.durationMin} min, ${l.input.tempC}°C, ${l.input.humidityPct}%</div>
        <div>Plan: ${l.plan.netNeedL} L (pre ${l.plan.preL}, during ${l.plan.duringL}, post ${l.plan.postL}) • Sodium ${l.plan.sodiumMgPerL} mg/L</div>
        <div>Actual: ${l.actualIntakeL ?? '-'} L</div>
      </div>
    `).join('');
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

function updateRangeStyle(inputEl, opts){
  if (!inputEl) return;

  const min = Number(inputEl.min || 0);
  const max = Number(inputEl.max || 100);
  const val = Number(inputEl.value || 0);
  const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
  const percent = `${(t * 100).toFixed(2)}%`;

  // Per-slider endpoints (priority: opts -> data-attrs -> CSS vars -> defaults)
  const startColor = (opts?.startColor) || inputEl.dataset.start || getComputedStyle(inputEl).getPropertyValue('--min-color').trim() || '#22c55e';
  const endColor   = (opts?.endColor)   || inputEl.dataset.end   || getComputedStyle(inputEl).getPropertyValue('--max-color').trim() || '#ef4444';
  const thumbFixed = opts?.thumbColor || inputEl.dataset.thumb || null;

  // Live color at current position
  const live = mixColors(startColor, endColor, t);

  // Push vars for both WebKit layered background and Firefox progress
  inputEl.style.setProperty('--percent', percent);
  inputEl.style.setProperty('--min-color', startColor);
  inputEl.style.setProperty('--max-color', endColor);
  inputEl.style.setProperty('--fill-color', live);
  inputEl.style.setProperty('--thumb-color', thumbFixed || live);
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
    // Build the left-hand column: details about the activity input
    const left = `
      <div style="display:grid; gap:8px;">
        <div style="font-weight:600;">${when}</div>
        <div>RPE: <strong>${log.input.rpe}</strong>/10</div>
        <div>Pre-hydration level (PHL): <strong>${log.input.pre}</strong>/5</div>
        <div>Duration: <strong>${log.input.durationMin}</strong> min</div>
        <div>Environment: <strong>${log.input.tempC}°C</strong> • <strong>${log.input.humidityPct}% RH</strong></div>
      </div>
    `;
    // Build the right-hand column: recommendation plan
    const rightTop = `
      <div style="display:grid; gap:8px;">
        <div>Total need: <span class="highlight">${log.plan.netNeedL} L</span>
          <small class="muted">(gross ${log.plan.grossLossL} L)</small></div>
        <div>Split — Pre <strong>${log.plan.preL} L</strong> • During <strong>${log.plan.duringL} L</strong> • Post <strong>${log.plan.postL} L</strong></div>
        <div>Recommended sodium: <strong>${log.plan.sodiumMgPerL}</strong> mg/L</div>
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
          const cal = document.getElementById('dash-calendar');
          if (cal && typeof cal._render === 'function') cal._render();
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
      const syncRpe = () => { rpeVal.textContent = rpeInput.value; updateRangeStyle(rpeInput, { type: 'rpe' }); };
      rpeInput.addEventListener('input', syncRpe); syncRpe();
    }
    if (preInput && preVal) {
      const syncPre = () => { preVal.textContent = preInput.value; updateRangeStyle(preInput, { type: 'pre' }); };
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
    if (!me) return;
    $('#profile-name').value = me.name || '';
    $('#profile-mass').value = me.profile?.massKg ?? '';
    $('#profile-sweat').value = me.profile?.sweatRateLph ?? '';
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
      return `<div class="daily-item"><strong>${e.date}</strong> — Rating ${e.rating}${alcohol}${e.note ? ` — ${e.note}` : ''}</div>`;
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
                ? ` • ${Math.round((log.actualIntakeL / (log.plan?.netNeedL || 1)) * 100)}%`
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
                ? ` • ${Math.round((log.actualIntakeL / (log.plan?.netNeedL || 1)) * 100)}%`
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
  const need = log?.plan?.netNeedL;
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
  const me = Auth.me();
  if (!me) return;

  // Set default date/time (today, now) if empty
  const dateEl = document.getElementById('dt-date');
  const timeEl = document.getElementById('dt-time');
  if (dateEl && !dateEl.value) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    dateEl.value = `${yyyy}-${mm}-${dd}`;
  }
  if (timeEl && !timeEl.value) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    timeEl.value = `${hh}:${min}`;
  }

  const onClose = () => { modal.classList.add('hidden'); form.reset(); };
  if (closeBtn) closeBtn.onclick = onClose;
  if (cancelBtn) cancelBtn.onclick = onClose;
  modal.onclick = (e) => { if (e.target === modal) onClose(); };

  // Style ranges
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

    // Collect simplified values
    const alcohol = parseFloat(document.getElementById('dt-alcohol').value || 0) || 0;
    const caffeine = parseFloat(document.getElementById('dt-caffeine').value || 0) || 0;
    const caffeineUnit = document.getElementById('dt-caffeine-unit').value || 'mg';
    const fluidL = parseFloat(document.getElementById('dt-fluidL').value || 0) || 0;
    const notes = (document.getElementById('dt-notes').value || '').trim();
    const time = (document.getElementById('dt-time').value || '');

    const entry = {
      date,
      time,
      note: notes,
      metrics: {
        alcohol,
        caffeine: {
          value: caffeine,
          unit: caffeineUnit
        },
        fluidL
      }
    };

    Store.upsertDaily(me.email, entry);
    // Re-render Logs->Daily calendar if currently visible
    const logsView = document.getElementById('view-logs');
    if (logsView && !logsView.classList.contains('hidden')) {
      renderDaily(me.email);
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
    const me = Auth.me();
    if (!me) return;
    const rpeInput = document.getElementById('modal-input-rpe');
    const rpeVal = document.getElementById('modal-rpe-value');
    const preInput = document.getElementById('modal-input-pre');
    const preVal = document.getElementById('modal-pre-value');
    const weatherStatusEl = document.getElementById('weather-status');
    const submitBtn = form.querySelector('button[type="submit"]');
    
    const syncRpe = () => { rpeVal.textContent = rpeInput.value; updateRangeStyle(rpeInput, { type: 'rpe' }); };
    const syncPre = () => { preVal.textContent = preInput.value; updateRangeStyle(preInput, { type: 'pre' }); };
    rpeInput.addEventListener('input', syncRpe); syncRpe();
    preInput.addEventListener('input', syncPre); syncPre();
    
    const onClose = () => {
      modal.classList.add('hidden');
      form.reset();
      if (weatherStatusEl) {
        weatherStatusEl.style.display = 'none';
        weatherStatusEl.textContent = 'Weather data will be fetched automatically...';
      }
    };
    closeBtn.onclick = onClose;
    modal.onclick = (e) => { if (e.target === modal) onClose(); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) onClose(); }, { once: true });
    
    // Fetch weather data when modal opens - REQUIRED
    // Store weatherData in a way accessible to the submit handler
    const weatherDataRef = { data: null };
    if (weatherStatusEl) {
      weatherStatusEl.style.display = 'block';
      weatherStatusEl.textContent = 'Fetching weather data...';
      weatherStatusEl.style.background = '#1b2740';
    }
    if (submitBtn) submitBtn.disabled = true;
    
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const location = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude
          };
          console.log('[Weather] Fetching weather for location:', location);
          
          try {
            const weatherRaw = await Api.getWeather(pos.coords.latitude, pos.coords.longitude);
            console.log('[Weather] Received weather data:', weatherRaw);

            const weather = normalizeWeatherData(weatherRaw);
            const hasValidTemp = typeof weather?.tempC === 'number' && !isNaN(weather.tempC);
            const hasValidHumidity = typeof weather?.humidityPct === 'number' && !isNaN(weather.humidityPct);

            if (weather && hasValidTemp && hasValidHumidity) {
              weatherDataRef.data = weather;

              // Log complete weather info to console
              console.log('[Weather] Normalized Location:', {
                city: weather.city,
                region: weather.region,
                country: weather.country,
                coordinates: location
              });
              console.log('[Weather] Normalized Metrics:', {
                temperature: `${weather.tempC}°C`,
                feelsLike: `${weather.feelslikeC ?? weather.tempC}°C`,
                humidity: `${weather.humidityPct}%`,
                uvIndex: weather.uvIndex ?? 'N/A',
                windSpeed: weather.windKph != null ? `${weather.windKph} km/h (${weather.windMps?.toFixed(2) ?? '0.00'} m/s)` : 'N/A',
                windDirection: weather.windDir ?? 'N/A',
                pressure: weather.pressureMb != null ? `${weather.pressureMb} mb` : 'N/A',
                cloudCover: weather.cloudPct != null ? `${weather.cloudPct}%` : 'N/A',
                visibility: weather.visibilityKm != null ? `${weather.visibilityKm} km` : 'N/A'
              });

              if (weatherStatusEl) {
                const displayWind = weather.windKph != null ? `${Math.round(weather.windKph)} km/h` : 'N/A';
                weatherStatusEl.textContent = `Weather: ${weather.tempC}°C, ${weather.humidityPct}% RH, UV ${weather.uvIndex ?? 'N/A'}, Wind ${displayWind} (${weather.city || 'Location'})`;
                weatherStatusEl.style.background = '#1a3a2a';
              }
              if (submitBtn) submitBtn.disabled = false;
            } else {
              console.error('[Weather] Invalid weather data after normalization:', {
                weatherRaw,
                normalized: weather,
                hasValidTemp,
                hasValidHumidity,
                tempC: weather?.tempC ?? weatherRaw?.tempC ?? weatherRaw?.raw?.current?.temp_c,
                humidityPct: weather?.humidityPct ?? weatherRaw?.humidityPct ?? weatherRaw?.raw?.current?.humidity
              });
              if (weatherStatusEl) {
                weatherStatusEl.textContent = `Weather data incomplete - temp: ${weather?.tempC ?? weatherRaw?.raw?.current?.temp_c ?? 'missing'}, humidity: ${weather?.humidityPct ?? weatherRaw?.raw?.current?.humidity ?? 'missing'}`;
                weatherStatusEl.style.background = '#3a1a1a';
              }
              if (submitBtn) submitBtn.disabled = true;
            }
          } catch (err) {
            console.error('[Weather] Error fetching weather:', err);
            if (weatherStatusEl) {
              weatherStatusEl.textContent = 'Weather fetch failed: ' + (err.message || 'Unknown error');
              weatherStatusEl.style.background = '#3a1a1a';
            }
            if (submitBtn) submitBtn.disabled = true;
          }
        },
        () => {
          if (weatherStatusEl) {
            weatherStatusEl.textContent = 'Location permission denied - cannot fetch weather data';
            weatherStatusEl.style.background = '#3a1a1a';
          }
          if (submitBtn) submitBtn.disabled = true;
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      );
    } else {
      if (weatherStatusEl) {
        weatherStatusEl.textContent = 'Geolocation not available - cannot fetch weather data';
        weatherStatusEl.style.background = '#3a1a1a';
      }
      if (submitBtn) submitBtn.disabled = true;
    }
    
    form.onsubmit = async (e) => {
      e.preventDefault();
      
      // Require weather data
      const weatherData = weatherDataRef.data;
      if (!weatherData || weatherData.tempC == null || weatherData.humidityPct == null) {
        Ui.toast('Weather data is required. Please allow location access and try again.');
        return;
      }
      
      const rpe = parseInt(document.getElementById('modal-input-rpe').value, 10);
      const durationMin = parseInt(document.getElementById('modal-input-duration').value, 10);
      const preScore = parseInt(document.getElementById('modal-input-pre').value, 10);
      
      // Use weather data automatically
      const tempC = weatherData.tempC;
      const humidityPct = weatherData.humidityPct;
      const apparentTempC = weatherData.feelslikeC ?? null;
      const uvIndex = weatherData.uvIndex ?? null;
      const windSpeedMps = weatherData.windMps ?? null;
      
      const plan = Recommendation.planLiters({
        rpe, durationMin, tempC, humidityPct, preScore,
        userBaselineLph: me.profile?.sweatRateLph,
        massKg: me.profile?.massKg,
        apparentTempC,
        uvIndex,
        windSpeedMps,
      });
      renderPlan(document.getElementById('plan-output'), plan);
      
      // Save weather data in the log entry (always present since it's required)
      const logEntry = {
        ts: Date.now(),
        input: { rpe, durationMin, tempC, humidityPct, preScore },
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
      
      // Update calendar
      const cal = document.getElementById('dash-calendar');
      if (cal && typeof cal._render === 'function') cal._render();
      
      Ui.toast('Activity planned and added to logs');
      onClose();
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
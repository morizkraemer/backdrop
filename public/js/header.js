// The header at the top of every page (control, visuals and grid.html): the
// player, the tabs for what the wall shows (server.js setWallMode), DMX, the
// HDMI source, LED brightness, Bluetooth, the Pi speakers' source, disk space and the connection. It's
// the same on every tab, so switching tabs doesn't move anything. Each page
// fills <header id="appHeader" data-page="..."> by loading this script first,
// then calls appHeader.update(state, connected) on every WebSocket update.
(function () {
  const PAGES = { cues: '/control', visuals: '/visuals', grid: '/grid' };
  const el = document.getElementById('appHeader');
  const page = el.dataset.page;
  el.classList.add('header');
  el.innerHTML = `
  <div class="header-left">
    <h1>backdrop</h1>
    <div class="player-pill" id="playerPill">
      <span class="dot"></span>
      <span id="playerText">Connecting…</span>
    </div>
    <nav class="wall-tabs" id="wallTabs" aria-label="What the wall shows">
      <a href="/control" data-mode="cues">Cues</a>
      <a href="/visuals" data-mode="visuals">Visuals</a>
      <a href="/grid" data-mode="grid">Grid</a>
    </nav>
  </div>
  <div class="header-right">
    <div class="dmx" id="dmx" hidden>
      <button type="button" class="btn-led" id="btnDmx" aria-expanded="false" aria-controls="dmxPopover" title="DMX control (Art-Net)">
        <span class="sig" id="dmxSig"></span>
        <span>DMX</span>
      </button>
      <div class="dmx-popover" id="dmxPopover" hidden>
        <div class="led-head">
          <span class="field-label">DMX control</span>
          <span class="dmx-state" id="hdrDmxState"></span>
        </div>
        <label class="dmx-start">
          <span class="field-label">Start address</span>
          <input type="number" id="hdrDmxStart" min="1" max="510" step="1" inputmode="numeric" placeholder="—" aria-label="Control fixture start address">
          <span class="field-hint" id="hdrDmxStartHint"></span>
        </label>
        <div class="dmx-channels" id="hdrDmxChannels">
          <div class="dmx-ch dmx-ch-head"><span>Channel</span><span>Function</span><span></span><span>Value</span></div>
        </div>
        <div class="dmx-fixture" id="hdrDmxFixture"></div>
        <div class="led-status" id="hdrDmxStatus"></div>
      </div>
    </div>
    <div class="hdmi" id="hdmi" hidden>
      <button type="button" class="btn-led" id="btnHdmi" aria-expanded="false" aria-controls="hdmiPopover" title="LED wall source (HDMI matrix)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
        <span id="hdmiText">—</span>
      </button>
      <div class="hdmi-popover" id="hdmiPopover" hidden>
        <span class="field-label" id="lblHdmi">LED wall source</span>
        <div class="hdmi-sources" id="hdmiSources" role="radiogroup" aria-labelledby="lblHdmi"></div>
        <div class="led-status" id="hdmiStatus"></div>
      </div>
    </div>
    <div class="led" id="led" hidden>
      <button type="button" class="btn-led" id="btnLed" aria-expanded="false" aria-controls="ledPopover" title="LED panel brightness">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.93 19.07l1.41-1.41"/><path d="M17.66 6.34l1.41-1.41"/></svg>
        <span id="ledText">—</span>
      </button>
      <div class="led-popover" id="ledPopover" hidden>
        <div class="led-head">
          <span class="field-label" id="lblLed">LED brightness</span>
          <span class="led-value" id="ledValue">—</span>
        </div>
        <input type="range" id="ledSlider" min="0" max="100" step="1" aria-labelledby="lblLed">
        <div class="led-presets" id="ledPresets">
          <button type="button" data-value="0">Off</button>
          <button type="button" data-value="25">25</button>
          <button type="button" data-value="50">50</button>
          <button type="button" data-value="75">75</button>
          <button type="button" data-value="100">100</button>
        </div>
        <div class="led-status" id="ledStatus"></div>
      </div>
    </div>
    <button type="button" class="btn-bt" id="btnBluetooth" hidden aria-pressed="false" title="Bluetooth pairing mode">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7l10 10-5 5V2l5 5L7 17"/></svg>
      <span id="btText">BT pairing</span>
    </button>
    <div class="hdmi" id="piAudio" hidden>
      <button type="button" class="btn-led" id="btnPiAudio" aria-expanded="false" aria-controls="piAudioPopover" title="What the Pi speakers play">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
        <span id="piAudioText">Speakers</span>
      </button>
      <div class="hdmi-popover" id="piAudioPopover" hidden>
        <span class="field-label" id="lblPiAudio">Speakers play</span>
        <div class="hdmi-sources" id="piAudioSources" role="radiogroup" aria-labelledby="lblPiAudio"></div>
        <div class="led-status" id="piAudioStatus"></div>
      </div>
    </div>
    <span id="diskSpace">—</span>
    <span class="conn" id="connStatus"><span class="dot"></span><span id="connText">Connecting…</span></span>
  </div>`;

  const $ = (id) => document.getElementById(id);
  let state = {};
  let connected = false;

  function api(method, path, body) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    return fetch(`/api${path}`, opts);
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s ?? '';
    return div.innerHTML;
  }

  function formatBytes(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
    if (n >= 1e3) return Math.round(n / 1e3) + ' KB';
    return n + ' B';
  }

  // --- what the wall shows: picking a tab switches the wall for everyone, and
  // every open page follows to the tab that's on the wall ---

  const nav = $('wallTabs');
  nav.querySelector(`a[data-mode="${page}"]`).setAttribute('aria-current', 'page');
  nav.addEventListener('click', (e) => {
    const tab = e.target.closest('a[data-mode]');
    if (!tab) return;
    e.preventDefault();
    if (tab.dataset.mode === page) return;
    api('PUT', '/wall', { mode: tab.dataset.mode }).then((res) => {
      if (res.ok) location.href = tab.href;
    }).catch(() => {});
  });

  function renderStatus() {
    const online = state.mpvConnected !== false;
    const pill = $('playerPill');
    pill.classList.toggle('offline', !online);
    pill.querySelector('.dot').className = `dot ${online ? 'on' : 'off'}`;
    $('playerText').textContent = online ? 'LED panel · 2304×768 · player online' : 'Player offline';
    $('diskSpace').textContent = `${formatBytes(state.diskFree)} free`;
    $('connStatus').querySelector('.dot').className = `dot ${connected ? 'on' : 'off'}`;
    $('connText').textContent = connected ? 'Connected' : 'Reconnecting…';
  }

  // --- Bluetooth pairing (only shown when the server has BT_HOST configured) ---

  const btnBluetooth = $('btnBluetooth');
  let btDiscoverable = false;

  function renderBluetooth(available) {
    btnBluetooth.hidden = !available;
    btnBluetooth.classList.toggle('active', btDiscoverable);
    btnBluetooth.setAttribute('aria-pressed', String(btDiscoverable));
    $('btText').textContent = btDiscoverable ? 'BT pairing on' : 'BT pairing';
  }

  api('GET', '/bluetooth/status')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      btDiscoverable = !!data.discoverable;
      renderBluetooth(!!data.available);
    })
    .catch(() => {});

  btnBluetooth.addEventListener('click', () => {
    api('POST', '/bluetooth/pairing', { enabled: !btDiscoverable })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) btDiscoverable = !!data.discoverable;
        renderBluetooth(true);
      })
      .catch(() => {});
  });

  // --- Pi speakers: which player gets the Pi's sound card. Only shown when
  // the server has BT_HOST configured ---

  const PI_SOURCES = { backdrop: 'backdrop', spotify: 'Spotify', airplay: 'AirPlay', bluetooth: 'Bluetooth' };
  const piAudioEl = $('piAudio');
  const btnPiAudio = $('btnPiAudio');
  const piAudioPopover = $('piAudioPopover');
  const piAudioSources = $('piAudioSources');
  let piSource = null;
  let piPending = null; // source sent but not yet confirmed
  let piError = null;

  function renderPiAudio() {
    btnPiAudio.classList.toggle('external', !!piSource && piSource !== 'backdrop');
    $('piAudioText').textContent = piSource === 'mixed' ? 'Speakers: mixed'
      : piSource ? PI_SOURCES[piSource] : 'Speakers off';
    const status = $('piAudioStatus');
    status.classList.toggle('error', !!piError || piSource === 'mixed');
    status.textContent = piError ? piError
      : piPending ? 'Switching…'
      : piSource === 'mixed' ? 'Several players are on and fight over the speakers. Pick one.'
      : '';
    piAudioSources.innerHTML = Object.entries(PI_SOURCES).map(([key, name]) => {
      const active = piSource === key;
      return `<button type="button" role="radio" aria-checked="${active}" data-source="${key}" class="${active ? 'active' : ''}${piPending === key ? ' pending' : ''}">
        <span class="hdmi-name">${name}</span>
      </button>`;
    }).join('');
  }

  api('GET', '/pi-audio/status')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || !data.available) return;
      piSource = data.source;
      piAudioEl.hidden = false;
      renderPiAudio();
    })
    .catch(() => {});

  function sendPiSource(source) {
    piPending = source;
    piError = null;
    renderPiAudio();
    api('POST', '/pi-audio/source', { source })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Could not switch');
        piSource = data.source;
      })
      .catch((err) => { piError = err.message; })
      .finally(() => {
        if (piPending === source) piPending = null;
        renderPiAudio();
      });
  }

  function setPiAudioOpen(open) {
    piAudioPopover.hidden = !open;
    btnPiAudio.setAttribute('aria-expanded', String(open));
    if (open) renderPiAudio();
  }

  btnPiAudio.addEventListener('click', () => setPiAudioOpen(piAudioPopover.hidden));
  document.addEventListener('click', (e) => {
    if (!piAudioPopover.hidden && !e.composedPath().includes(piAudioEl)) setPiAudioOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !piAudioPopover.hidden) setPiAudioOpen(false);
  });
  piAudioSources.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-source]');
    if (b && !piPending) sendPiSource(b.dataset.source);
  });

  // --- LED panel brightness (NovaStar controller, proxied by the server) ---

  const ledEl = $('led');
  const btnLed = $('btnLed');
  const ledPopover = $('ledPopover');
  const ledSlider = $('ledSlider');
  let ledDragging = false;
  let ledPending = null; // value sent but not yet confirmed
  let ledError = null;
  let ledSendTimer = null;

  function renderLed() {
    const led = state.led || {};
    ledEl.hidden = !led.configured;
    const online = !!led.available;
    const shown = ledDragging || ledPending !== null ? Number(ledSlider.value) : led.brightness;
    btnLed.classList.toggle('offline', !online);
    $('ledText').textContent = online && shown != null ? `${shown}%` : 'LED offline';
    $('ledValue').textContent = shown != null ? `${shown}%` : '—';
    if (!ledDragging && ledPending === null && led.brightness != null) ledSlider.value = led.brightness;
    ledSlider.disabled = !online;
    $('ledPresets').querySelectorAll('button').forEach((b) => {
      b.disabled = !online;
      b.classList.toggle('active', Number(b.dataset.value) === shown);
    });
    const status = $('ledStatus');
    status.classList.toggle('error', !!ledError || !online);
    status.textContent = !online ? 'Controller unreachable'
      : ledError ? ledError
      : ledPending !== null ? 'Applying…'
      : '';
  }

  function sendLed(value) {
    ledPending = value;
    ledError = null;
    renderLed();
    api('PUT', '/led/brightness', { brightness: value })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not set brightness');
      })
      .catch((err) => { ledError = err.message; })
      .finally(() => {
        if (ledPending === value) ledPending = null;
        renderLed();
      });
  }

  function setLedOpen(open) {
    ledPopover.hidden = !open;
    btnLed.setAttribute('aria-expanded', String(open));
    if (open) renderLed();
  }

  btnLed.addEventListener('click', () => setLedOpen(ledPopover.hidden));
  document.addEventListener('click', (e) => {
    if (!ledPopover.hidden && !ledEl.contains(e.target)) setLedOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ledPopover.hidden) setLedOpen(false);
  });

  // Sends while dragging (throttled) so the panel follows the slider
  ledSlider.addEventListener('input', () => {
    ledDragging = true;
    renderLed();
    if (!ledSendTimer) {
      ledSendTimer = setTimeout(() => {
        ledSendTimer = null;
        if (ledDragging) sendLed(Number(ledSlider.value));
      }, 250);
    }
  });
  ledSlider.addEventListener('change', () => {
    ledDragging = false;
    clearTimeout(ledSendTimer);
    ledSendTimer = null;
    sendLed(Number(ledSlider.value));
  });
  $('ledPresets').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    ledSlider.value = b.dataset.value;
    sendLed(Number(b.dataset.value));
  });

  // --- LED wall source (HDMI matrix output, proxied by the server) ---

  const hdmiEl = $('hdmi');
  const btnHdmi = $('btnHdmi');
  const hdmiPopover = $('hdmiPopover');
  const hdmiSources = $('hdmiSources');
  let hdmiPending = null; // input sent but not yet confirmed
  let hdmiError = null;

  function renderHdmi() {
    const h = state.hdmi || {};
    hdmiEl.hidden = !h.configured;
    if (!h.configured) return;
    const online = !!h.available;
    const sources = h.sources || [];
    const current = sources[h.current - 1];
    btnHdmi.classList.toggle('offline', !online);
    // Input 1 is backdrop itself; anything else means the wall isn't showing the cues
    btnHdmi.classList.toggle('external', online && h.current > 1);
    $('hdmiText').textContent = !online ? 'Source offline' : current ? current.name : '—';

    const status = $('hdmiStatus');
    status.classList.toggle('error', !!hdmiError || !online);
    status.textContent = !online ? 'HDMI matrix unreachable'
      : hdmiError ? hdmiError
      : hdmiPending ? 'Switching…'
      : '';

    hdmiSources.innerHTML = sources.map((src, i) => {
      const input = i + 1;
      const active = h.current === input;
      const signal = src.signal == null ? ''
        : `<span class="sig${src.signal ? ' on' : ''}"></span><span class="hdmi-signal">${src.signal ? 'Signal' : 'No signal'}</span>`;
      return `<button type="button" role="radio" aria-checked="${active}" data-input="${input}" class="${active ? 'active' : ''}${hdmiPending === input ? ' pending' : ''}" ${online ? '' : 'disabled'}>
        <span class="hdmi-name">${escapeHtml(src.name)}</span>${signal}
      </button>`;
    }).join('');
  }

  function sendHdmiSource(input) {
    hdmiPending = input;
    hdmiError = null;
    renderHdmi();
    api('PUT', '/hdmi/source', { input })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not switch');
      })
      .catch((err) => { hdmiError = err.message; })
      .finally(() => {
        if (hdmiPending === input) hdmiPending = null;
        renderHdmi();
      });
  }

  function setHdmiOpen(open) {
    hdmiPopover.hidden = !open;
    btnHdmi.setAttribute('aria-expanded', String(open));
    if (open) renderHdmi();
  }

  btnHdmi.addEventListener('click', () => setHdmiOpen(hdmiPopover.hidden));
  document.addEventListener('click', (e) => {
    // composedPath: the clicked button may already be replaced by a re-render
    if (!hdmiPopover.hidden && !e.composedPath().includes(hdmiEl)) setHdmiOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !hdmiPopover.hidden) setHdmiOpen(false);
  });
  hdmiSources.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-input]');
    if (b && !b.disabled) sendHdmiSource(Number(b.dataset.input));
  });

  // --- DMX control (Art-Net input; channels are saved on the server) ---

  const dmxEl = $('dmx');
  const btnDmx = $('btnDmx');
  const dmxPopover = $('dmxPopover');
  const dmxChannels = $('hdrDmxChannels');
  // backdrop's Control fixture on the desk, in channel order (server.js DMX_FIXTURES)
  const DMX_FUNCTIONS = [
    { key: 'go', name: 'GO', show: (v) => (v >= 128 ? 'On' : 'Off') },
    { key: 'back', name: 'BACK', show: (v) => (v >= 128 ? 'On' : 'Off') },
    { key: 'brightness', name: 'Brightness', show: (v) => `${Math.round((v * 100) / 255)}%` },
  ];
  let dmxError = null;

  dmxChannels.insertAdjacentHTML('beforeend', DMX_FUNCTIONS.map((fn) => `<div class="dmx-ch">
    <input type="number" data-fn="${fn.key}" min="0" max="512" step="1" inputmode="numeric" placeholder="off" aria-label="${fn.name} channel">
    <span class="dmx-name">${fn.name}</span>
    <span class="dmx-bar"><span></span></span>
    <span class="dmx-val">—</span>
  </div>`).join(''));

  function renderDmx() {
    const d = state.dmx || {};
    dmxEl.hidden = !d.configured;
    if (!d.configured) return;
    const on = !!d.receiving;
    btnDmx.classList.toggle('offline', !on);
    $('dmxSig').classList.toggle('on', on);
    btnDmx.title = on ? 'DMX: receiving' : 'DMX: no signal';
    $('hdrDmxState').textContent = on ? 'Receiving' : 'No signal';
    $('hdrDmxState').classList.toggle('on', on);
    DMX_FUNCTIONS.forEach((fn) => {
      const row = dmxChannels.querySelector(`input[data-fn="${fn.key}"]`).closest('.dmx-ch');
      const input = row.querySelector('input');
      const ch = d.channels?.[fn.key] || 0;
      if (document.activeElement !== input) input.value = ch || '';
      const v = on && ch ? d.values?.[fn.key] : null;
      row.classList.toggle('unused', !ch);
      row.querySelector('.dmx-bar span').style.width = `${v == null ? 0 : (v * 100) / 255}%`;
      row.querySelector('.dmx-val').textContent = v == null ? '—' : fn.show(v);
    });
    // The Visuals fixture is set up in the Visuals lab
    const at = (f) => (f?.start ? `: channels ${f.start}-${f.start + f.size - 1}` : '');
    // Their pages are the wall's tabs, so opening one would switch the wall: no links
    $('hdrDmxFixture').textContent = `Visuals fixture${at(d.fixtures?.visuals)} and Grid fixture${at(d.fixtures?.grid)}, `
      + 'set up on the Visuals and Grid tabs.';
    const ctl = d.fixtures?.control;
    const startInput = $('hdrDmxStart');
    if (document.activeElement !== startInput) startInput.value = ctl?.start || '';
    $('hdrDmxStartHint').textContent = ctl?.start ? `Channels ${ctl.start}-${ctl.start + ctl.size - 1}` : 'Set one by one';
    const status = $('hdrDmxStatus');
    status.classList.toggle('error', !!dmxError);
    status.textContent = dmxError || (on ? '' : `Waiting for Art-Net on universe ${d.universe ?? 0}`);
  }

  $('hdrDmxStart').addEventListener('change', (e) => {
    const start = Math.round(Number(e.target.value));
    if (start) sendDmxConfig({ fixture: 'control', start });
    else renderDmx();
  });

  function sendDmxConfig(patch) {
    dmxError = null;
    api('PUT', '/dmx', patch)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not save');
      })
      .catch((err) => { dmxError = err.message; })
      .finally(renderDmx);
  }

  dmxChannels.addEventListener('change', (e) => {
    const input = e.target.closest('input[data-fn]');
    if (!input) return;
    const ch = Math.max(0, Math.round(Number(input.value) || 0));
    sendDmxConfig({ channels: { [input.dataset.fn]: ch } });
  });

  function setDmxOpen(open) {
    dmxPopover.hidden = !open;
    btnDmx.setAttribute('aria-expanded', String(open));
    if (open) renderDmx();
  }

  btnDmx.addEventListener('click', () => setDmxOpen(dmxPopover.hidden));
  document.addEventListener('click', (e) => {
    if (!dmxPopover.hidden && !dmxEl.contains(e.target)) setDmxOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dmxPopover.hidden) setDmxOpen(false);
  });

  window.appHeader = {
    // state: backdrop's state over the WebSocket; connected: the WebSocket is open
    update(next, isConnected) {
      state = next || {};
      connected = !!isConnected;
      if (PAGES[state.wallMode] && state.wallMode !== page) location.replace(PAGES[state.wallMode]);
      renderStatus();
      renderLed();
      renderHdmi();
      renderDmx();
    },
  };
  window.appHeader.update({}, false);
})();

// Hidden coin menu for Golf Orbit (Unity WebGL).
//
// Trigger: press keys in CHEAT_CONFIG.sequence in order within CHEAT_CONFIG.windowMs.
// Adds coins by broadcasting Unity SendMessage to ALL candidate GameObject/method
// pairs in CHEAT_CONFIG.sendMessageTargets. Unity's SendMessage silently logs a
// warning when the GameObject doesn't exist (it does NOT throw), so we have to
// fan out and let the right target respond -- we can't probe by catching errors.
//
// GameDatas marks itself dirty on coin change and auto-saves to PlayerPrefs
// ("Pinpin_SavedData") -> IndexedDB, so changes persist across reloads.

(function () {
  // ---------------------------------------------------------------------------
  // CONFIG -- edit anything here to retune the menu. No other code should need
  // to change for normal tweaks.
  // ---------------------------------------------------------------------------
  const CHEAT_CONFIG = {
    sequence: ['0', '6', '8'],
    windowMs: 3000,

    // GameObject names to try for ADD-style methods (AddCoins, AddCurrencies).
    // Every entry is called on every grant; SendMessage logs a harmless warning
    // for the names that don't exist in the scene. Whichever ones do exist and
    // expose AddCoins / AddCurrencies will receive the value.
    addTargets: [
      'MainSceneManager', 'GameManager', 'GameDatas', 'MainSceneUIManager',
      'UIManager', 'GameController', 'MSStartIntegration', 'CoinManager',
      'Player', 'PlayerData', 'Manager', 'MainScene', 'Game', 'GameMaster',
      'Master', 'Main', 'Singletons', '_Singletons', 'GameMain', 'Pinpin',
      'GameDatasManager', 'CurrencyManager', 'WalletManager', 'Wallet',
    ],
    addMethods: ['AddCoins', 'AddCurrencies', 'AddCoin', 'GiveCoins'],

    // Property-setter list. SendMessage can call set_coins (the IL backing
    // method for the `coins` property) directly. This SETS an absolute value
    // rather than adding -- used by the "Set total" button in the menu.
    setTargets: [
      'GameDatas', 'GameManager', 'MainSceneManager', 'PlayerData',
    ],
    setMethod: 'set_coins',

    // Optional save nudge after granting (most builds auto-save when GameDatas
    // is dirty; these are belt-and-suspenders no-ops if not present).
    saveTargets: [
      { gameObject: 'GameDatas', method: 'Save' },
      { gameObject: 'GameDatas', method: 'ForceSave' },
      { gameObject: 'GameDatas', method: 'SaveData' },
      { gameObject: 'GameManager', method: 'Save' },
    ],

    presetAmounts: [100, 1000, 10000, 100000, 1000000],
    defaultCustomAmount: 5000,
    maxAmount: 1_000_000_000,

    menuTitle: 'Coin Menu',
    debug: true,
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function log(...args) {
    if (CHEAT_CONFIG.debug) console.log('[cheat-menu]', ...args);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  // ---------------------------------------------------------------------------
  // Coin granting -- broadcast to every candidate. SendMessage doesn't throw
  // on a missing GameObject in WebGL (it logs a warning and returns), so we
  // can't tell from JS which target actually received the call. We just send
  // them all and let the user verify via the in-game coin counter or the
  // Diagnose button.
  // ---------------------------------------------------------------------------
  function getInstance() {
    const inst = window.gameInstance;
    return (inst && typeof inst.SendMessage === 'function') ? inst : null;
  }

  function broadcast(targets, methods, amount) {
    const inst = getInstance();
    if (!inst) return { ok: false, error: 'Unity not ready yet -- wait for the game to load.' };
    let attempts = 0;
    for (const go of targets) {
      for (const m of methods) {
        try {
          inst.SendMessage(go, m, amount);
          attempts++;
          log('  sent', go + '.' + m, amount);
        } catch (e) {
          log('  threw on', go + '.' + m, e);
        }
      }
    }
    return { ok: attempts > 0, attempts };
  }

  function grantCoins(amount) {
    if (!Number.isFinite(amount) || amount <= 0 || amount > CHEAT_CONFIG.maxAmount) {
      return { ok: false, error: 'Amount must be between 1 and ' + CHEAT_CONFIG.maxAmount };
    }
    amount = Math.floor(amount);
    const r = broadcast(CHEAT_CONFIG.addTargets, CHEAT_CONFIG.addMethods, amount);
    if (r.ok) {
      const inst = getInstance();
      for (const s of CHEAT_CONFIG.saveTargets) {
        try { inst.SendMessage(s.gameObject, s.method); } catch (_) { /* ignore */ }
      }
    }
    return r;
  }

  // Sets the absolute coin total via the property setter (set_coins). Useful
  // when AddCoins doesn't reach the right MonoBehaviour but GameDatas exists.
  function setCoinsTotal(amount) {
    if (!Number.isFinite(amount) || amount < 0 || amount > CHEAT_CONFIG.maxAmount) {
      return { ok: false, error: 'Amount must be between 0 and ' + CHEAT_CONFIG.maxAmount };
    }
    amount = Math.floor(amount);
    const r = broadcast(CHEAT_CONFIG.setTargets, [CHEAT_CONFIG.setMethod], amount);
    if (r.ok) {
      const inst = getInstance();
      for (const s of CHEAT_CONFIG.saveTargets) {
        try { inst.SendMessage(s.gameObject, s.method); } catch (_) { /* ignore */ }
      }
    }
    return r;
  }

  // ---------------------------------------------------------------------------
  // IndexedDB diagnostic -- enumerates the /idbfs database (where Unity stores
  // PlayerPrefs as a virtual file) and dumps the file paths plus a hex/ascii
  // preview of any PlayerPrefs blob. This is what tells us how the game is
  // actually persisting coin data.
  // ---------------------------------------------------------------------------
  async function diagnoseStorage() {
    const lines = [];
    lines.push('Unity gameInstance ready: ' + !!(window.gameInstance && window.gameInstance.SendMessage));
    try {
      const dbs = (indexedDB.databases ? await indexedDB.databases() : []);
      lines.push('IndexedDB databases: ' + (dbs.length ? dbs.map(d => d.name).join(', ') : '(none reported)'));
      for (const d of dbs) {
        if (!d.name) continue;
        try {
          lines.push('');
          lines.push('=== ' + d.name + ' ===');
          const detail = await readDbDetail(d.name);
          lines.push(detail);
        } catch (e) {
          lines.push('  error: ' + e);
        }
      }
    } catch (e) {
      lines.push('Could not list databases: ' + e);
    }
    return lines.join('\n');
  }

  function readDbDetail(dbName) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const stores = Array.from(db.objectStoreNames);
        if (!stores.length) { db.close(); return resolve('  (no object stores)'); }
        const tx = db.transaction(stores, 'readonly');
        const out = [];
        let pending = stores.length;
        const finish = () => { db.close(); resolve(out.join('\n')); };
        for (const storeName of stores) {
          const store = tx.objectStore(storeName);
          const keysReq = store.getAllKeys();
          keysReq.onsuccess = () => {
            const keys = keysReq.result || [];
            out.push('  store ' + storeName + ' (' + keys.length + ' keys):');
            if (!keys.length) { if (--pending === 0) finish(); return; }
            let perKey = keys.length;
            keys.forEach(k => {
              const valReq = store.get(k);
              valReq.onsuccess = () => {
                out.push('    [' + JSON.stringify(k) + '] -> ' + describeValue(valReq.result));
                if (--perKey === 0 && --pending === 0) finish();
              };
              valReq.onerror = () => {
                out.push('    [' + JSON.stringify(k) + '] -> read error');
                if (--perKey === 0 && --pending === 0) finish();
              };
            });
          };
          keysReq.onerror = () => {
            out.push('  store ' + storeName + ' -> error reading keys');
            if (--pending === 0) finish();
          };
        }
      };
    });
  }

  function describeValue(v) {
    if (v == null) return String(v);
    if (typeof v === 'string') return 'string(' + v.length + '): ' + v.slice(0, 200);
    if (v instanceof Uint8Array) return 'Uint8Array(' + v.length + '): ' + previewBytes(v);
    if (v instanceof ArrayBuffer) return 'ArrayBuffer(' + v.byteLength + '): ' + previewBytes(new Uint8Array(v));
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      const parts = keys.slice(0, 6).map(k => {
        const sub = v[k];
        if (sub instanceof Uint8Array) return k + '=Uint8Array(' + sub.length + '): ' + previewBytes(sub);
        if (sub instanceof ArrayBuffer) return k + '=ArrayBuffer(' + sub.byteLength + '): ' + previewBytes(new Uint8Array(sub));
        if (typeof sub === 'object') return k + '={' + Object.keys(sub).slice(0, 4).join(',') + '}';
        return k + '=' + String(sub).slice(0, 60);
      });
      return 'object{' + parts.join('; ') + '}';
    }
    return typeof v + ' ' + String(v).slice(0, 80);
  }

  function previewBytes(u8) {
    const n = Math.min(u8.length, 80);
    const hex = [];
    let ascii = '';
    for (let i = 0; i < n; i++) {
      hex.push(u8[i].toString(16).padStart(2, '0'));
      ascii += (u8[i] >= 32 && u8[i] < 127) ? String.fromCharCode(u8[i]) : '.';
    }
    return hex.join('') + ' | ' + ascii + (u8.length > n ? ' ...' : '');
  }

  // ---------------------------------------------------------------------------
  // Menu UI (built once, hidden until triggered)
  // ---------------------------------------------------------------------------
  let backdrop, panel, statusEl, customInput, diagBox;

  function buildMenu() {
    backdrop = document.createElement('div');
    backdrop.id = 'cheat-menu-backdrop';
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.6)',
      display: 'none', alignItems: 'center', justifyContent: 'center',
      zIndex: '999999', fontFamily: 'system-ui, sans-serif',
    });

    panel = document.createElement('div');
    Object.assign(panel.style, {
      background: '#fff', color: '#222', borderRadius: '12px', padding: '20px 24px',
      width: 'min(640px, 95vw)', boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
      position: 'relative', maxHeight: '92vh', overflowY: 'auto',
    });
    panel.addEventListener('click', e => e.stopPropagation());

    const header = document.createElement('div');
    Object.assign(header.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' });
    const title = document.createElement('h3');
    title.textContent = CHEAT_CONFIG.menuTitle;
    Object.assign(title.style, { margin: '0', fontSize: '18px' });
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'X';
    Object.assign(closeBtn.style, { border: 'none', background: 'transparent', fontSize: '18px', cursor: 'pointer', color: '#666' });
    closeBtn.addEventListener('click', closeMenu);
    header.append(title, closeBtn);

    const presetRow = document.createElement('div');
    Object.assign(presetRow.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' });
    for (const amt of CHEAT_CONFIG.presetAmounts) {
      const b = document.createElement('button');
      b.textContent = '+' + formatAmount(amt);
      Object.assign(b.style, presetButtonStyle());
      b.addEventListener('click', () => submit(amt));
      presetRow.appendChild(b);
    }

    const customRow = document.createElement('div');
    Object.assign(customRow.style, { display: 'flex', gap: '6px', marginBottom: '12px' });
    customInput = document.createElement('input');
    customInput.type = 'number';
    customInput.min = '1';
    customInput.value = String(CHEAT_CONFIG.defaultCustomAmount);
    Object.assign(customInput.style, { flex: '1', padding: '8px 10px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px' });
    customInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(parseInt(customInput.value, 10)); });
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add coins';
    Object.assign(addBtn.style, primaryButtonStyle());
    addBtn.addEventListener('click', () => submit(parseInt(customInput.value, 10)));
    const setBtn = document.createElement('button');
    setBtn.textContent = 'Set total';
    setBtn.title = 'Use the property setter to overwrite the absolute coin total. Try this if Add coins did nothing.';
    Object.assign(setBtn.style, primaryButtonStyle(), { background: '#7a3eff' });
    setBtn.addEventListener('click', () => submitSet(parseInt(customInput.value, 10)));
    customRow.append(customInput, addBtn, setBtn);

    statusEl = document.createElement('div');
    Object.assign(statusEl.style, { fontSize: '13px', color: '#555', minHeight: '18px', marginBottom: '12px' });

    const diagRow = document.createElement('div');
    Object.assign(diagRow.style, { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' });
    const diagBtn = document.createElement('button');
    diagBtn.textContent = 'Diagnose storage';
    Object.assign(diagBtn.style, presetButtonStyle());
    diagBtn.addEventListener('click', async () => {
      diagBox.value = 'Inspecting...';
      diagBox.value = await diagnoseStorage();
    });
    const note = document.createElement('span');
    note.textContent = 'If coins didn\'t change, click this and check console.';
    Object.assign(note.style, { fontSize: '11px', color: '#888' });
    diagRow.append(diagBtn, note);

    diagBox = document.createElement('textarea');
    diagBox.readOnly = true;
    diagBox.rows = 14;
    diagBox.placeholder = 'Diagnose output appears here. You can select-all + copy.';
    Object.assign(diagBox.style, {
      width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '11px',
      border: '1px solid #ddd', borderRadius: '6px', padding: '6px', resize: 'vertical',
      whiteSpace: 'pre',
    });

    panel.append(header, presetRow, customRow, statusEl, diagRow, diagBox);
    backdrop.appendChild(panel);
    backdrop.addEventListener('click', closeMenu);
    document.body.appendChild(backdrop);
  }

  function presetButtonStyle() {
    return {
      flex: '1 1 auto', padding: '8px 10px', fontSize: '14px',
      background: '#f4f4f4', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer',
    };
  }
  function primaryButtonStyle() {
    return {
      padding: '8px 14px', fontSize: '14px', background: '#2d8cff', color: '#fff',
      border: 'none', borderRadius: '6px', cursor: 'pointer',
    };
  }

  function formatAmount(n) {
    if (n >= 1_000_000) return (n / 1_000_000) + 'M';
    if (n >= 1_000) return (n / 1_000) + 'k';
    return String(n);
  }

  function submit(amount) {
    log('grantCoins ->', amount);
    const result = grantCoins(amount);
    if (result.ok) {
      statusEl.style.color = '#1a7f37';
      statusEl.textContent = 'Broadcast +' + amount + ' to ' + result.attempts + ' targets. Check the in-game counter.';
    } else {
      statusEl.style.color = '#c62828';
      statusEl.textContent = result.error;
    }
  }

  function submitSet(amount) {
    log('setCoinsTotal ->', amount);
    const result = setCoinsTotal(amount);
    if (result.ok) {
      statusEl.style.color = '#1a7f37';
      statusEl.textContent = 'Tried set_coins=' + amount + ' on ' + result.attempts + ' targets.';
    } else {
      statusEl.style.color = '#c62828';
      statusEl.textContent = result.error;
    }
  }

  function openMenu() {
    if (!backdrop) buildMenu();
    backdrop.style.display = 'flex';
    statusEl.textContent = '';
    diagBox.value = '';
    customInput.focus();
    customInput.select();
    log('menu opened');
  }

  function closeMenu() {
    if (backdrop) backdrop.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // Trigger detection -- strict in-order sequence within windowMs
  // ---------------------------------------------------------------------------
  let matchIndex = 0;
  let startTime = 0;

  function detectSequence(e) {
    if (isTypingTarget(e.target)) return;
    if (e.key === 'Escape' && backdrop && backdrop.style.display !== 'none') {
      closeMenu();
      return;
    }
    const expected = CHEAT_CONFIG.sequence[matchIndex];
    const now = Date.now();

    if (matchIndex > 0 && now - startTime > CHEAT_CONFIG.windowMs) {
      matchIndex = 0;
    }

    if (e.key === expected) {
      if (matchIndex === 0) startTime = now;
      matchIndex++;
      if (matchIndex >= CHEAT_CONFIG.sequence.length) {
        matchIndex = 0;
        openMenu();
      }
    } else {
      matchIndex = (e.key === CHEAT_CONFIG.sequence[0]) ? 1 : 0;
      if (matchIndex === 1) startTime = now;
    }
  }

  window.addEventListener('keydown', detectSequence);
  log('listener installed; sequence =', CHEAT_CONFIG.sequence.join(','));

  // -------------------------------------------------------------------------
  // window.cheat -- DevTools console helpers for manual probing. Lets us
  // experiment with method/GameObject combinations without rebuilding the
  // page. Examples:
  //   cheat.add(1000)                      // run the configured broadcast
  //   cheat.set(999999)                    // run the set_coins broadcast
  //   cheat.send('GameDatas', 'set_coins', 999999)
  //   cheat.try('AddCoins', 1000)          // try every addTargets GO with that method
  //   cheat.config                         // see/edit the live config
  //   cheat.diagnose()                     // promise -> diagnose string
  // -------------------------------------------------------------------------
  window.cheat = {
    config: CHEAT_CONFIG,
    open: openMenu,
    add: grantCoins,
    set: setCoinsTotal,
    send(go, method, param) {
      const inst = getInstance();
      if (!inst) { console.warn('Unity not ready'); return false; }
      try {
        if (param === undefined) inst.SendMessage(go, method);
        else inst.SendMessage(go, method, param);
        console.log('[cheat] sent', go + '.' + method, param);
        return true;
      } catch (e) {
        console.error('[cheat] threw', e);
        return false;
      }
    },
    try(method, param) {
      return broadcast(CHEAT_CONFIG.addTargets, [method], param);
    },
    diagnose: diagnoseStorage,
  };
  log('window.cheat helpers exposed');
})();

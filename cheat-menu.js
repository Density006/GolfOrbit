// Hidden coin menu for Golf Orbit (Unity WebGL).
// Triggered by pressing the keys listed in CHEAT_CONFIG.sequence in order
// within CHEAT_CONFIG.windowMs milliseconds. Adds coins by calling Unity
// SendMessage on the GameObject/method pairs in CHEAT_CONFIG.sendMessageTargets.
// GameDatas marks itself dirty when coins change and auto-saves to PlayerPrefs
// (Pinpin_SavedData) -> IndexedDB, so no extra save call is needed.

(function () {
  // ---------------------------------------------------------------------------
  // CONFIG -- edit anything in here to retune the menu. No other code should
  // need to change for normal tweaks.
  // ---------------------------------------------------------------------------
  const CHEAT_CONFIG = {
    sequence: ['0', '6', '8'],
    windowMs: 3000,

    // SendMessage targets, tried in order until one succeeds. If a future
    // version of the game uses a different GameObject name, just add it here.
    sendMessageTargets: [
      { gameObject: 'MainSceneManager', method: 'AddCoins' },
      { gameObject: 'GameManager',      method: 'AddCoins' },
      { gameObject: 'GameDatas',        method: 'AddCoins' },
    ],

    // Optional save nudge after granting (most builds auto-save, this is a
    // belt-and-suspenders no-op if the GameObject/method don't exist).
    saveTargets: [
      { gameObject: 'GameDatas', method: 'Save' },
      { gameObject: 'GameDatas', method: 'ForceSave' },
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
  // Coin granting
  // ---------------------------------------------------------------------------
  function grantCoins(amount) {
    if (!Number.isFinite(amount) || amount <= 0 || amount > CHEAT_CONFIG.maxAmount) {
      return { ok: false, error: 'Amount must be between 1 and ' + CHEAT_CONFIG.maxAmount };
    }
    amount = Math.floor(amount);

    const inst = window.gameInstance;
    if (!inst || typeof inst.SendMessage !== 'function') {
      return { ok: false, error: 'Unity not ready yet' };
    }

    for (const t of CHEAT_CONFIG.sendMessageTargets) {
      try {
        inst.SendMessage(t.gameObject, t.method, amount);
        log('granted via', t.gameObject + '.' + t.method, amount);
        // Try save nudge -- failures are silently ignored.
        for (const s of CHEAT_CONFIG.saveTargets) {
          try { inst.SendMessage(s.gameObject, s.method); } catch (_) { /* ignore */ }
        }
        return { ok: true, via: t.gameObject + '.' + t.method };
      } catch (e) {
        log('SendMessage failed on', t.gameObject + '.' + t.method, e);
      }
    }
    return { ok: false, error: 'No SendMessage target accepted the call. See console.' };
  }

  // ---------------------------------------------------------------------------
  // Menu UI (built once, hidden until triggered)
  // ---------------------------------------------------------------------------
  let backdrop, panel, statusEl, customInput;

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
      width: 'min(360px, 90vw)', boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
      position: 'relative',
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
    customRow.append(customInput, addBtn);

    statusEl = document.createElement('div');
    Object.assign(statusEl.style, { fontSize: '13px', color: '#555', minHeight: '18px' });

    panel.append(header, presetRow, customRow, statusEl);
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
    const result = grantCoins(amount);
    if (result.ok) {
      statusEl.style.color = '#1a7f37';
      statusEl.textContent = 'Added ' + amount + ' coins via ' + result.via;
    } else {
      statusEl.style.color = '#c62828';
      statusEl.textContent = result.error;
    }
  }

  function openMenu() {
    if (!backdrop) buildMenu();
    backdrop.style.display = 'flex';
    statusEl.textContent = '';
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
    // Esc closes the menu when it's open
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
      // Allow restarting the sequence if the wrong key happens to be the first one.
      matchIndex = (e.key === CHEAT_CONFIG.sequence[0]) ? 1 : 0;
      if (matchIndex === 1) startTime = now;
    }
  }

  window.addEventListener('keydown', detectSequence);
  log('listener installed; sequence =', CHEAT_CONFIG.sequence.join(','));
})();

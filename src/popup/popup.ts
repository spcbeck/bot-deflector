import {
  BackgroundMessage,
  BackgroundResponse,
  CaughtBotsResponse,
  DeflectorStats,
  ExtensionSettings,
  ScoredUser
} from '../types';

document.addEventListener('DOMContentLoaded', async () => {
  const deflectedEl = document.getElementById('stat-deflected');
  const blockedEl = document.getElementById('stat-blocked');
  const scannedEl = document.getElementById('stat-scanned');
  const cacheEl = document.getElementById('stat-cache');
  const quotaWarning = document.getElementById('quota-warning');

  const threatsBadge = document.getElementById('threats-badge');
  const tabBtnCurrent = document.getElementById('tab-btn-current') as HTMLButtonElement | null;
  const tabBtnRecent = document.getElementById('tab-btn-recent') as HTMLButtonElement | null;
  const threatsList = document.getElementById('threats-list');
  const threatsEmpty = document.getElementById('threats-empty');

  const modeButtons = document.querySelectorAll<HTMLButtonElement>('.bd-segment-btn');
  const slider = document.getElementById('threshold-slider') as HTMLInputElement;
  const sliderVal = document.getElementById('threshold-val');
  const toggleBlock = document.getElementById('toggle-block') as HTMLInputElement;
  const toggleRepost = document.getElementById('toggle-repost') as HTMLInputElement;
  const toggleCadence = document.getElementById('toggle-cadence') as HTMLInputElement;

  const whitelistInput = document.getElementById('whitelist-input') as HTMLInputElement;
  const whitelistAddBtn = document.getElementById('whitelist-add-btn');
  const whitelistTags = document.getElementById('whitelist-tags');

  const tabBanner = document.getElementById('tab-banner');
  const tabDeflectedCount = document.getElementById('tab-deflected-count');
  const versionEl = document.getElementById('app-version');

  // Dynamic manifest version
  if (versionEl && typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    const manifest = chrome.runtime.getManifest();
    if (manifest?.version) {
      versionEl.textContent = `V${manifest.version} • LOCAL SCAN ONLY`;
    }
  }

  // Load Active Tab Stats
  async function loadTabStats() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id && tabBanner && tabDeflectedCount) {
        const res = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<{ tabDeflectedCount: number }>>({
          type: 'GET_TAB_STATS',
          tabId: activeTab.id
        });
        if (res?.success && res.data) {
          tabDeflectedCount.textContent = String(res.data.tabDeflectedCount);
          tabBanner.style.display = 'flex';
        }
      }
    } catch (err) {
      console.warn('[BotDeflector Popup] Could not load tab stats:', err);
    }
  }
  await loadTabStats();

  // Load Global Lifetime Stats
  try {
    const statsRes = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<DeflectorStats>>({
      type: 'GET_STATS'
    });
    if (statsRes?.success && statsRes.data) {
      if (deflectedEl) deflectedEl.textContent = String(statsRes.data.deflectedCount);
      if (blockedEl) blockedEl.textContent = String(statsRes.data.blockedCount);
      if (scannedEl) scannedEl.textContent = String(statsRes.data.scannedCount);
      if (cacheEl) cacheEl.textContent = String(statsRes.data.cacheHitCount);
      if (quotaWarning && statsRes.data.quotaExceeded) {
        quotaWarning.style.display = 'flex';
      }
    }
  } catch (err) {
    console.warn('[BotDeflector Popup] Could not load stats:', err);
  }

  // Live storage updates (reactive dashboard)
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        if (changes['deflector_stats']?.newValue) {
          const newStats = changes['deflector_stats'].newValue as DeflectorStats;
          if (deflectedEl) deflectedEl.textContent = String(newStats.deflectedCount);
          if (blockedEl) blockedEl.textContent = String(newStats.blockedCount);
          if (scannedEl) scannedEl.textContent = String(newStats.scannedCount);
          if (cacheEl) cacheEl.textContent = String(newStats.cacheHitCount);
          if (quotaWarning) {
            quotaWarning.style.display = newStats.quotaExceeded ? 'flex' : 'none';
          }
        }
        const hasThreatChange = Object.keys(changes).some((k) => k.startsWith('threat_user_'));
        if (hasThreatChange) {
          loadCaughtBots();
        }
      }
      if (areaName === 'session') {
        loadTabStats();
        loadCaughtBots();
      }
    });
  }

  // Caught Threats State & Rendering
  let activeThreatsView: 'current' | 'recent' = 'current';
  let hasUserSwitchedView = false;
  let currentTabBots: ScoredUser[] = [];
  let allRecentBots: ScoredUser[] = [];

  async function loadCaughtBots() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const res = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<CaughtBotsResponse>>({
        type: 'GET_CAUGHT_BOTS',
        tabId: activeTab?.id
      });
      if (res?.success && res.data) {
        currentTabBots = res.data.tabBots || [];
        allRecentBots = res.data.recentBots || [];

        if (!hasUserSwitchedView) {
          if (currentTabBots.length === 0 && allRecentBots.length > 0) {
            activeThreatsView = 'recent';
          } else {
            activeThreatsView = 'current';
          }
        }
        renderThreatsUI();
      }
    } catch (err) {
      console.warn('[BotDeflector Popup] Could not load caught bots:', err);
    }
  }

  function renderThreatsUI() {
    if (tabBtnCurrent) {
      tabBtnCurrent.textContent = `THIS TAB (${currentTabBots.length})`;
      if (activeThreatsView === 'current') {
        tabBtnCurrent.classList.add('active');
      } else {
        tabBtnCurrent.classList.remove('active');
      }
    }
    if (tabBtnRecent) {
      tabBtnRecent.textContent = `ALL RECENT (${allRecentBots.length})`;
      if (activeThreatsView === 'recent') {
        tabBtnRecent.classList.add('active');
      } else {
        tabBtnRecent.classList.remove('active');
      }
    }

    const list = activeThreatsView === 'current' ? currentTabBots : allRecentBots;
    if (threatsBadge) {
      threatsBadge.textContent = String(list.length);
    }

    if (!threatsList || !threatsEmpty) return;
    threatsList.innerHTML = '';

    if (list.length === 0) {
      threatsEmpty.style.display = 'flex';
      return;
    }

    threatsEmpty.style.display = 'none';

    list.forEach((bot) => {
      const card = document.createElement('div');
      card.className = 'bd-threat-card';

      const main = document.createElement('div');
      main.className = 'bd-threat-main';

      const info = document.createElement('div');
      info.className = 'bd-threat-info';

      const badge = document.createElement('span');
      badge.className = 'bd-threat-badge';
      badge.textContent = `${bot.score} PTS`;
      info.appendChild(badge);

      const userLink = document.createElement('a');
      userLink.className = 'bd-threat-user-link';
      userLink.href = `https://www.reddit.com/user/${encodeURIComponent(bot.username)}`;
      userLink.target = '_blank';
      userLink.rel = 'noopener noreferrer';
      userLink.textContent = `u/${bot.username}`;
      info.appendChild(userLink);

      if (bot.isBlockedOnReddit) {
        const blockedBadge = document.createElement('span');
        blockedBadge.className = 'bd-threat-blocked-badge';
        blockedBadge.textContent = 'BLOCKED';
        info.appendChild(blockedBadge);
      }

      main.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'bd-threat-actions';

      const whitelistBtn = document.createElement('button');
      whitelistBtn.className = 'bd-threat-whitelist-btn';
      whitelistBtn.textContent = 'WHITELIST';
      whitelistBtn.title = 'Add user to whitelist';
      whitelistBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        whitelistBtn.disabled = true;
        whitelistBtn.textContent = '...';
        const res = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<ExtensionSettings>>({
          type: 'ADD_WHITELIST',
          username: bot.username
        });
        if (res?.success && res.data) {
          renderWhitelist(res.data.whitelist);
          await chrome.runtime.sendMessage({
            type: 'INVALIDATE_USER',
            username: bot.username
          });
          currentTabBots = currentTabBots.filter((b) => b.username.toLowerCase() !== bot.username.toLowerCase());
          allRecentBots = allRecentBots.filter((b) => b.username.toLowerCase() !== bot.username.toLowerCase());
          renderThreatsUI();
        }
      });
      actions.appendChild(whitelistBtn);

      const expandBtn = document.createElement('button');
      expandBtn.className = 'bd-threat-expand-btn';
      expandBtn.textContent = '▼';
      expandBtn.title = 'Toggle heuristic breakdown';
      actions.appendChild(expandBtn);

      main.appendChild(actions);
      card.appendChild(main);

      const topReasons = (bot.breakdown || [])
        .filter((b) => b.points > 0)
        .slice(0, 2)
        .map((b) => b.name)
        .join(' • ');

      if (topReasons) {
        const reasonsEl = document.createElement('div');
        reasonsEl.className = 'bd-threat-reasons';
        reasonsEl.textContent = `[ ${topReasons} ]`;
        card.appendChild(reasonsEl);
      }

      const details = document.createElement('div');
      details.className = 'bd-threat-details';
      details.style.display = 'none';

      if (bot.breakdown && bot.breakdown.length > 0) {
        bot.breakdown
          .filter((b) => b.points > 0)
          .forEach((rule) => {
            const row = document.createElement('div');
            row.className = 'bd-detail-row';

            const ruleName = document.createElement('span');
            ruleName.className = 'bd-detail-rule';
            ruleName.textContent = rule.name;

            const pts = document.createElement('span');
            pts.className = 'bd-detail-pts';
            pts.textContent = `+${rule.points} PTS`;

            row.appendChild(ruleName);
            row.appendChild(pts);
            details.appendChild(row);
          });
      }

      if (bot.evaluatedAt) {
        const timeRow = document.createElement('div');
        timeRow.className = 'bd-detail-row';
        timeRow.style.color = '#666';
        timeRow.style.marginTop = '3px';
        const dateStr = new Date(bot.evaluatedAt).toLocaleDateString();
        const timeStr = new Date(bot.evaluatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        timeRow.textContent = `Evaluated: ${dateStr} ${timeStr}`;
        details.appendChild(timeRow);
      }

      card.appendChild(details);

      expandBtn.addEventListener('click', () => {
        const isExpanded = details.style.display === 'flex';
        details.style.display = isExpanded ? 'none' : 'flex';
        expandBtn.textContent = isExpanded ? '▼' : '▲';
      });

      threatsList.appendChild(card);
    });
  }

  tabBtnCurrent?.addEventListener('click', () => {
    hasUserSwitchedView = true;
    activeThreatsView = 'current';
    renderThreatsUI();
  });

  tabBtnRecent?.addEventListener('click', () => {
    hasUserSwitchedView = true;
    activeThreatsView = 'recent';
    renderThreatsUI();
  });

  await loadCaughtBots();

  // Load Settings
  let currentSettings: ExtensionSettings | null = null;
  try {
    const settingsRes = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<ExtensionSettings>>({
      type: 'GET_SETTINGS'
    });
    if (settingsRes?.success && settingsRes.data) {
      currentSettings = settingsRes.data;
      applySettingsToUI(currentSettings);
    }
  } catch (err) {
    console.warn('[BotDeflector Popup] Could not load settings:', err);
  }

  function applySettingsToUI(settings: ExtensionSettings) {
    // Mode
    modeButtons.forEach((btn) => {
      if (btn.dataset.mode === settings.mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Slider
    if (slider && sliderVal) {
      slider.value = String(settings.deflectThreshold);
      sliderVal.textContent = `${settings.deflectThreshold} PTS`;
    }

    // Checkboxes
    if (toggleBlock) toggleBlock.checked = settings.autoBlockReddit;
    if (toggleRepost) toggleRepost.checked = settings.enableSubmissionCheck;
    if (toggleCadence) toggleCadence.checked = settings.enableCadenceCheck;

    // Whitelist
    renderWhitelist(settings.whitelist);
  }

  function renderWhitelist(list: string[]) {
    if (!whitelistTags) return;
    whitelistTags.innerHTML = '';

    if (list.length === 0) {
      const emptySpan = document.createElement('span');
      emptySpan.style.color = '#666';
      emptySpan.style.fontSize = '10px';
      emptySpan.textContent = 'No custom whitelisted users';
      whitelistTags.appendChild(emptySpan);
      return;
    }

    list.forEach((user) => {
      const tag = document.createElement('div');
      tag.className = 'bd-whitelist-tag';

      const name = document.createElement('span');
      name.textContent = `u/${user}`;

      const remove = document.createElement('span');
      remove.className = 'bd-tag-remove';
      remove.textContent = '×';
      remove.title = 'Remove';
      remove.addEventListener('click', async () => {
        const res = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<ExtensionSettings>>({
          type: 'REMOVE_WHITELIST',
          username: user
        });
        if (res?.success && res.data) {
          renderWhitelist(res.data.whitelist);
        }
      });

      tag.appendChild(name);
      tag.appendChild(remove);
      whitelistTags.appendChild(tag);
    });
  }

  // Mode Selection Listeners
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode as any;
      modeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<ExtensionSettings>>({
        type: 'UPDATE_SETTINGS',
        settings: { mode }
      });
    });
  });

  // Slider Listener
  slider?.addEventListener('input', async () => {
    const val = parseInt(slider.value, 10);
    if (sliderVal) sliderVal.textContent = `${val} PTS`;
  });

  slider?.addEventListener('change', async () => {
    const val = parseInt(slider.value, 10);
    await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<ExtensionSettings>>({
      type: 'UPDATE_SETTINGS',
      settings: { deflectThreshold: val }
    });
  });

  // Toggle Listeners
  toggleBlock?.addEventListener('change', async () => {
    await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<ExtensionSettings>>({
      type: 'UPDATE_SETTINGS',
      settings: { autoBlockReddit: toggleBlock.checked }
    });
  });

  toggleRepost?.addEventListener('change', async () => {
    await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<ExtensionSettings>>({
      type: 'UPDATE_SETTINGS',
      settings: { enableSubmissionCheck: toggleRepost.checked }
    });
  });

  toggleCadence?.addEventListener('change', async () => {
    await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<ExtensionSettings>>({
      type: 'UPDATE_SETTINGS',
      settings: { enableCadenceCheck: toggleCadence.checked }
    });
  });

  // Whitelist Add
  const addWhitelist = async () => {
    const user = whitelistInput.value.trim().replace(/^u\//, '');
    if (!user) return;
    whitelistInput.value = '';

    const res = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<ExtensionSettings>>({
      type: 'ADD_WHITELIST',
      username: user
    });
    if (res?.success && res.data) {
      renderWhitelist(res.data.whitelist);
    }
  };

  whitelistAddBtn?.addEventListener('click', addWhitelist);
  whitelistInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addWhitelist();
  });
});

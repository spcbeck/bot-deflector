import { BackgroundMessage, BackgroundResponse, DeflectorStats, ExtensionSettings } from '../types';

document.addEventListener('DOMContentLoaded', async () => {
  const deflectedEl = document.getElementById('stat-deflected');
  const blockedEl = document.getElementById('stat-blocked');
  const scannedEl = document.getElementById('stat-scanned');
  const cacheEl = document.getElementById('stat-cache');
  const quotaWarning = document.getElementById('quota-warning');

  const modeButtons = document.querySelectorAll<HTMLButtonElement>('.bd-segment-btn');
  const slider = document.getElementById('threshold-slider') as HTMLInputElement;
  const sliderVal = document.getElementById('threshold-val');
  const toggleBlock = document.getElementById('toggle-block') as HTMLInputElement;
  const toggleRepost = document.getElementById('toggle-repost') as HTMLInputElement;
  const toggleCadence = document.getElementById('toggle-cadence') as HTMLInputElement;

  const whitelistInput = document.getElementById('whitelist-input') as HTMLInputElement;
  const whitelistAddBtn = document.getElementById('whitelist-add-btn');
  const whitelistTags = document.getElementById('whitelist-tags');

  // Load Stats
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

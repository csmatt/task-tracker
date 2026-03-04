// Background service worker - keeps timers running even when popup is closed

const ALARM_NAME = 'timerTick';

// Initialize alarms on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1/60 }); // every ~1 second
});

// Restart alarm on service worker startup
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1/60 });
});

// Ensure alarm exists
chrome.alarms.get(ALARM_NAME, (alarm) => {
  if (!alarm) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1/60 });
  }
});

// On each alarm tick, update running timers
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  chrome.storage.local.get('timers', (data) => {
    const timers = data.timers || [];
    const now = Date.now();
    let changed = false;

    const updated = timers.map(timer => {
      if (timer.running) {
        const elapsed = now - timer.lastTick;
        timer.elapsed += elapsed;
        timer.lastTick = now;
        changed = true;
      }
      return timer;
    });

    if (changed) {
      chrome.storage.local.set({ timers: updated });
    }
  });
});

/**
 * WikiBridge Manifest V3 Background Service Worker
 * Opens the Side Panel on toolbar click and navigates + highlights disputed
 * passages directly inside FI, SV, and RU Wikipedia tabs.
 */

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

function stripHashAndQuery(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `${u.origin}${u.pathname}`.toLowerCase();
  } catch {
    return (rawUrl || '').split('#')[0].toLowerCase();
  }
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    const timer = setTimeout(finish, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        setTimeout(finish, 200);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function getOrNavigateWikipediaTab(targetUrl) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (activeTab && activeTab.id) {
    const currentBase = stripHashAndQuery(activeTab.url || '');
    const targetBase = stripHashAndQuery(targetUrl);

    if (currentBase === targetBase) {
      return activeTab.id;
    }

    await chrome.tabs.update(activeTab.id, { url: targetUrl, active: true });
    await waitForTabComplete(activeTab.id);
    return activeTab.id;
  }

  const created = await chrome.tabs.create({ url: targetUrl, active: true });
  if (created.id) {
    await waitForTabComplete(created.id);
    return created.id;
  }
  throw new Error('Unable to open Wikipedia tab.');
}

async function sendHighlightMessageWithRetry(tabId, payload) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, payload);
    } catch {
      if (attempt === 1) {
        try {
          await chrome.scripting.insertCSS({
            target: { tabId },
            files: ['src/content/contentStyles.css'],
          });
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['src/content/contentScript.js'],
          });
        } catch {
          // Ignore if already injected
        }
      }
      await new Promise((r) => setTimeout(r, 220 * (attempt + 1)));
    }
  }
  throw new Error('Could not connect to Wikipedia page script.');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'NAVIGATE_AND_HIGHLIGHT') return false;

  (async () => {
    try {
      const { targetUrl, discrepancy } = message;
      const tabId = await getOrNavigateWikipediaTab(targetUrl);
      if (!discrepancy) {
        sendResponse({ ok: true, result: null });
        return;
      }
      const res = await sendHighlightMessageWithRetry(tabId, {
        type: 'APPLY_DISCREPANCY_HIGHLIGHT',
        discrepancy,
      });
      sendResponse({ ok: true, result: res });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : 'Navigation failed.',
      });
    }
  })();

  return true;
});

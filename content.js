console.log('[FPS Content] Ready');

const processedMessages = new Set();

window.addEventListener('message', async (event) => {
  const message = event.data;

  if (!message || !message.type) return;
  if (!message.type.startsWith('FPS_')) return;
  if (message.type.endsWith('_RESPONSE')) return;

  const backgroundToPageMessages = [
    'FPS_CONNECTED', 'FPS_DISCONNECTED', 'FPS_GAME_STATE', 'FPS_PLAYER_JOINED',
    'FPS_PLAYER_LEFT', 'FPS_PLAYER_MOVED', 'FPS_BULLET_FIRED', 'FPS_PLAYER_DAMAGED',
    'FPS_PLAYER_KILLED', 'FPS_PLAYER_RESPAWNED', 'FPS_PLAYER_STATS', 'FPS_GLOBAL_STATS',
    'FPS_TEAM_ASSIGNED', 'FPS_BOT_SPAWNED', 'FPS_BOT_REMOVED', 'FPS_BOTS_UPDATED',
    'FPS_ROUND_START', 'FPS_ROUND_ACTIVE', 'FPS_ROUND_END', 'FPS_MATCH_END',
    'FPS_RELOAD_START', 'FPS_RELOAD_COMPLETE', 'yourSocketId', 'playerStats'
  ];
  if (backgroundToPageMessages.includes(message.type)) return;

  const messageKey = `${message.type}_${message.requestId}`;
  if (processedMessages.has(messageKey)) {
    console.log('[FPS Content] Ignoring duplicate:', messageKey);
    return;
  }
  processedMessages.add(messageKey);

  if (processedMessages.size > 100) {
    const firstKey = processedMessages.values().next().value;
    processedMessages.delete(firstKey);
  }

  console.log('[FPS Content] Message from page:', message.type);

  try {
    const backgroundMessage = { type: message.type, ...message };
    const response = await chrome.runtime.sendMessage(backgroundMessage);

    if (!response) {
      console.log('[FPS Content] No response from background for:', message.type);
      return;
    }

    const responseMessage = {
      type: message.type + '_RESPONSE',
      requestId: message.requestId,
      success: response.success || false,
      error: response.error,
      ...response
    };

    window.postMessage(responseMessage, '*');

    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage(responseMessage, '*'); } catch (e) {}
    }

    if (window.top && window.top !== window) {
      try { window.top.postMessage(responseMessage, '*'); } catch (e) {}
    }

    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((iframe) => {
      try { iframe.contentWindow.postMessage(responseMessage, '*'); } catch (e) {}
    });

  } catch (error) {
    console.error('[FPS Content] Error forwarding message:', error);

    const errorMessage = {
      type: message.type + '_RESPONSE',
      requestId: message.requestId,
      success: false,
      error: error.message
    };

    window.postMessage(errorMessage, '*');
    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage(errorMessage, '*'); } catch (e) {}
    }
    if (window.top && window.top !== window) {
      try { window.top.postMessage(errorMessage, '*'); } catch (e) {}
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[FPS Content] Message from background:', message.type);

  window.postMessage(message, '*');

  if (window.parent && window.parent !== window) {
    try { window.parent.postMessage(message, '*'); } catch (e) {}
  }

  if (window.top && window.top !== window) {
    try { window.top.postMessage(message, '*'); } catch (e) {}
  }

  const iframes = document.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    try { iframe.contentWindow.postMessage(message, '*'); } catch (e) {}
  });

  sendResponse({ received: true });
  return true;
});

console.log('[FPS Content] Ready to relay messages');

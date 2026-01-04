console.log('[FPS Extension] Background service worker started');

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[FPS Extension] Extension installed/updated', details.reason);
  if (details.reason === 'install') {
    chrome.storage.local.set({ fpsBackendUrl: 'http://localhost:3003' });
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[FPS Extension] Browser startup - service worker active');
});

importScripts('socket.io.min.js');

let backendUrl = null;
const tabSockets = new Map();

console.log('[FPS Background] Socket.io loaded');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  console.log('[FPS Background] Message:', message.type, 'from tab:', tabId);

  if (message.type === 'FPS_INIT') {
    handleGameInit(tabId).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('[FPS Background] Init error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  const tabSocket = tabSockets.get(tabId);
  if (!tabSocket || !tabSocket.socket || !tabSocket.socket.connected) {
    sendResponse({ success: false, error: 'Not connected to backend' });
    return true;
  }

  if (message.type === 'FPS_JOIN_GAME') {
    tabSocket.socket.emit('joinGame', { playerName: message.playerName });
    console.log('[FPS Background] Tab', tabId, 'joining game as:', message.playerName);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'FPS_SET_PLAYER_NAME') {
    tabSocket.socket.emit('setPlayerName', message.playerName);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'FPS_PLAYER_MOVE') {
    tabSocket.socket.emit('playerMove', {
      position: message.position,
      rotation: message.rotation
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'FPS_PLAYER_SHOOT') {
    tabSocket.socket.emit('playerShoot', {
      position: message.position,
      direction: message.direction,
      isHeadshot: message.isHeadshot
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'FPS_PLAYER_HIT') {
    tabSocket.socket.emit('playerHit', {
      attackerId: message.attackerId,
      victimId: message.victimId,
      damage: message.damage,
      isHeadshot: message.isHeadshot
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'FPS_PLAYER_RESPAWN') {
    tabSocket.socket.emit('playerRespawn');
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'FPS_RELOAD') {
    tabSocket.socket.emit('reload');
    sendResponse({ success: true });
    return true;
  }

  console.log('[FPS Background] Unhandled message type:', message.type);
  sendResponse({ success: true, unhandled: true });
  return true;
});

async function handleGameInit(tabId) {
  console.log('[FPS Background] FPS_INIT for tab:', tabId);

  if (!backendUrl) {
    const stored = await chrome.storage.local.get('fpsBackendUrl');
    backendUrl = stored.fpsBackendUrl || 'http://localhost:3003';
    console.log('[FPS Background] Using backend URL:', backendUrl);
  }

  if (tabSockets.has(tabId)) {
    const existing = tabSockets.get(tabId);
    if (existing.socket && existing.socket.connected) {
      console.log('[FPS Background] Tab', tabId, 'already has active socket');
      sendToTab(tabId, { type: 'FPS_CONNECTED' });
      return;
    } else {
      if (existing.socket) existing.socket.disconnect();
      tabSockets.delete(tabId);
    }
  }

  await createSocketForTab(tabId);
}

async function createSocketForTab(tabId) {
  console.log('[FPS Background] Creating socket for tab:', tabId);

  const socketConfig = {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 10
  };

  const socket = io(backendUrl, socketConfig);

  tabSockets.set(tabId, { socket: socket });

  socket.on('connect', () => {
    console.log('[FPS Background] Tab', tabId, 'WebSocket connected, Socket ID:', socket.id);
    sendToTab(tabId, { type: 'FPS_CONNECTED' });
  });

  socket.on('disconnect', (reason) => {
    console.log('[FPS Background] Tab', tabId, 'WebSocket disconnected:', reason);
    sendToTab(tabId, { type: 'FPS_DISCONNECTED' });
    if (reason === 'io server disconnect' || reason === 'io client disconnect') {
      tabSockets.delete(tabId);
    }
  });

  socket.on('connect_error', (error) => {
    console.error('[FPS Background] Tab', tabId, 'connection error:', error.message);
  });

  socket.on('yourSocketId', (socketId) => {
    console.log('[FPS Background] Tab', tabId, 'received socket ID:', socketId);
    sendToTab(tabId, { type: 'yourSocketId', id: socketId });
  });

  socket.on('teamAssigned', (data) => {
    console.log('[FPS Background] Tab', tabId, 'assigned to team:', data.team);
    sendToTab(tabId, { type: 'FPS_TEAM_ASSIGNED', ...data });
  });

  socket.on('gameState', (state) => {
    console.log('[FPS Background] Tab', tabId, 'received gameState');
    sendToTab(tabId, { type: 'FPS_GAME_STATE', state });
  });

  socket.on('playerJoined', (data) => {
    console.log('[FPS Background] Tab', tabId, 'player joined:', data.playerName);
    sendToTab(tabId, { type: 'FPS_PLAYER_JOINED', ...data });
  });

  socket.on('playerLeft', (id) => {
    console.log('[FPS Background] Tab', tabId, 'player left:', id);
    sendToTab(tabId, { type: 'FPS_PLAYER_LEFT', id });
  });

  socket.on('playerMoved', (data) => {
    sendToTab(tabId, { type: 'FPS_PLAYER_MOVED', ...data });
  });

  socket.on('bulletFired', (bullet) => {
    sendToTab(tabId, { type: 'FPS_BULLET_FIRED', bullet });
  });

  socket.on('playerDamaged', (data) => {
    sendToTab(tabId, { type: 'FPS_PLAYER_DAMAGED', ...data });
  });

  socket.on('playerKilled', (data) => {
    console.log('[FPS Background] Tab', tabId, 'kill:', data.killerName, '->', data.victimName);
    sendToTab(tabId, { type: 'FPS_PLAYER_KILLED', ...data });
  });

  socket.on('playerRespawned', (data) => {
    sendToTab(tabId, { type: 'FPS_PLAYER_RESPAWNED', ...data });
  });

  socket.on('playerStats', (stats) => {
    sendToTab(tabId, { type: 'FPS_PLAYER_STATS', stats });
  });

  socket.on('globalStats', (stats) => {
    sendToTab(tabId, { type: 'FPS_GLOBAL_STATS', stats });
  });

  socket.on('botSpawned', (data) => {
    console.log('[FPS Background] Tab', tabId, 'bot spawned:', data.playerName);
    sendToTab(tabId, { type: 'FPS_BOT_SPAWNED', ...data });
  });

  socket.on('botRespawned', (data) => {
    console.log('[FPS Background] Tab', tabId, 'bot respawned:', data.id);
    sendToTab(tabId, { type: 'FPS_BOT_RESPAWNED', ...data });
  });

  socket.on('botRemoved', (data) => {
    console.log('[FPS Background] Tab', tabId, 'bot removed:', data.id);
    sendToTab(tabId, { type: 'FPS_BOT_REMOVED', ...data });
  });

  socket.on('botsUpdated', (bots) => {
    sendToTab(tabId, { type: 'FPS_BOTS_UPDATED', bots });
  });

  socket.on('roundStart', (data) => {
    console.log('[FPS Background] Tab', tabId, 'round start:', data.roundNumber);
    sendToTab(tabId, { type: 'FPS_ROUND_START', ...data });
  });

  socket.on('roundActive', () => {
    console.log('[FPS Background] Tab', tabId, 'round active');
    sendToTab(tabId, { type: 'FPS_ROUND_ACTIVE' });
  });

  socket.on('roundEnd', (data) => {
    console.log('[FPS Background] Tab', tabId, 'round end, winner:', data.winner);
    sendToTab(tabId, { type: 'FPS_ROUND_END', ...data });
  });

  socket.on('matchEnd', (data) => {
    console.log('[FPS Background] Tab', tabId, 'match end, winner:', data.winner);
    sendToTab(tabId, { type: 'FPS_MATCH_END', ...data });
  });

  socket.on('reloadStart', (data) => {
    sendToTab(tabId, { type: 'FPS_RELOAD_START', ...data });
  });

  socket.on('reloadComplete', (data) => {
    sendToTab(tabId, { type: 'FPS_RELOAD_COMPLETE', ...data });
  });
}

async function sendToTab(tabId, data) {
  try {
    await chrome.tabs.sendMessage(tabId, data);
  } catch (error) {
    console.log('[FPS Background] Failed to send to tab', tabId);
    const tabSocket = tabSockets.get(tabId);
    if (tabSocket && tabSocket.socket) tabSocket.socket.disconnect();
    tabSockets.delete(tabId);
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const tabSocket = tabSockets.get(tabId);
  if (tabSocket) {
    console.log('[FPS Background] Tab', tabId, 'closed, disconnecting');
    if (tabSocket.socket) tabSocket.socket.disconnect();
    tabSockets.delete(tabId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tabSockets.has(tabId)) {
    console.log('[FPS Background] Tab', tabId, 'reloading, disconnecting');
    const tabSocket = tabSockets.get(tabId);
    if (tabSocket && tabSocket.socket) tabSocket.socket.disconnect();
    tabSockets.delete(tabId);
  }
});

console.log('[FPS Extension] Background service worker ready');

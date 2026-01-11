console.log('[Game Hub] Background service worker started');

// ===== GAME SERVER CONFIGURATION =====
let serverConfig = {
  fps: 'http://localhost:3003',
  chess: 'http://localhost:3004'
};

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Game Hub] Extension installed/updated', details.reason);
  if (details.reason === 'install') {
    chrome.storage.local.set({
      fpsBackendUrl: 'http://localhost:3003',
      chessBackendUrl: 'http://localhost:3004'
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Game Hub] Browser startup - service worker active');
});

importScripts('socket.io.min.js');

// Tab sockets now store game type
const tabSockets = new Map(); // tabId -> { socket, gameType }

console.log('[Game Hub] Socket.io loaded');

// Load server config from storage
async function loadServerConfig() {
  const stored = await chrome.storage.local.get(['fpsBackendUrl', 'chessBackendUrl']);
  serverConfig = {
    fps: stored.fpsBackendUrl || 'http://localhost:3003',
    chess: stored.chessBackendUrl || 'http://localhost:3004'
  };
  console.log('[Game Hub] Loaded server config:', serverConfig);
}

loadServerConfig();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  console.log('[Game Hub] Message:', message.type, 'from tab:', tabId);

  // ===== FPS GAME INIT =====
  if (message.type === 'FPS_INIT') {
    handleFpsInit(tabId).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('[Game Hub] FPS Init error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // ===== CHESS GAME INIT =====
  if (message.type === 'GAME_INIT' && message.gameType === 'chess') {
    handleChessInit(tabId).then(() => {
      sendResponse({ success: true, gameType: 'chess' });
    }).catch(error => {
      console.error('[Game Hub] Chess Init error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // Get tab socket info
  const tabSocket = tabSockets.get(tabId);
  if (!tabSocket || !tabSocket.socket || !tabSocket.socket.connected) {
    sendResponse({ success: false, error: 'Not connected to backend' });
    return true;
  }

  const gameType = tabSocket.gameType;

  // ===== FPS MESSAGES =====
  if (gameType === 'fps') {
    if (message.type === 'FPS_JOIN_GAME') {
      tabSocket.socket.emit('joinGame', { playerName: message.playerName });
      console.log('[Game Hub] Tab', tabId, 'joining FPS as:', message.playerName);
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
  }

  // ===== CHESS MESSAGES =====
  if (gameType === 'chess') {
    if (message.type === 'GAME_SET_PLAYER_NAME') {
      tabSocket.socket.emit('setPlayerName', message.playerName);
      console.log('[Game Hub] Tab', tabId, 'set chess player name:', message.playerName);
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'GAME_FIND_MATCH') {
      tabSocket.socket.emit('findMatch');
      console.log('[Game Hub] Tab', tabId, 'finding chess match');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'GAME_CANCEL_MATCHMAKING') {
      tabSocket.socket.emit('cancelMatchmaking');
      console.log('[Game Hub] Tab', tabId, 'cancelled chess matchmaking');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'GAME_MAKE_MOVE') {
      tabSocket.socket.emit('makeMove', {
        fromRow: message.fromRow,
        fromCol: message.fromCol,
        toRow: message.toRow,
        toCol: message.toCol
      });
      console.log('[Game Hub] Tab', tabId, 'made chess move');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'GAME_GET_LEGAL_MOVES') {
      tabSocket.socket.emit('getLegalMoves', {
        row: message.row,
        col: message.col
      });
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'GAME_RESIGN') {
      tabSocket.socket.emit('resign');
      console.log('[Game Hub] Tab', tabId, 'resigned');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'GAME_OFFER_DRAW') {
      tabSocket.socket.emit('offerDraw');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'GAME_ACCEPT_DRAW') {
      tabSocket.socket.emit('acceptDraw');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'GAME_DECLINE_DRAW') {
      tabSocket.socket.emit('declineDraw');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'GAME_REQUEST_GLOBAL_STATS') {
      tabSocket.socket.emit('requestGlobalStats', { playerName: message.playerName });
      sendResponse({ success: true });
      return true;
    }
  }

  console.log('[Game Hub] Unhandled message type:', message.type, 'for game:', gameType);
  sendResponse({ success: true, unhandled: true });
  return true;
});

// ===== FPS INIT =====
async function handleFpsInit(tabId) {
  console.log('[Game Hub] FPS_INIT for tab:', tabId);
  await loadServerConfig();

  if (tabSockets.has(tabId)) {
    const existing = tabSockets.get(tabId);
    if (existing.socket && existing.socket.connected && existing.gameType === 'fps') {
      console.log('[Game Hub] Tab', tabId, 'already has active FPS socket');
      sendToTab(tabId, { type: 'FPS_CONNECTED' });
      return;
    } else {
      if (existing.socket) existing.socket.disconnect();
      tabSockets.delete(tabId);
    }
  }

  await createFpsSocket(tabId);
}

// ===== CHESS INIT =====
async function handleChessInit(tabId) {
  console.log('[Game Hub] GAME_INIT (chess) for tab:', tabId);
  await loadServerConfig();

  if (tabSockets.has(tabId)) {
    const existing = tabSockets.get(tabId);
    if (existing.socket && existing.socket.connected && existing.gameType === 'chess') {
      console.log('[Game Hub] Tab', tabId, 'already has active chess socket');
      sendToTab(tabId, { type: 'GAME_CONNECTED', gameType: 'chess' });
      return;
    } else {
      if (existing.socket) existing.socket.disconnect();
      tabSockets.delete(tabId);
    }
  }

  await createChessSocket(tabId);
}

// ===== FPS SOCKET =====
async function createFpsSocket(tabId) {
  console.log('[Game Hub] Creating FPS socket for tab:', tabId, 'URL:', serverConfig.fps);

  const socketConfig = {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 10
  };

  const socket = io(serverConfig.fps, socketConfig);
  tabSockets.set(tabId, { socket: socket, gameType: 'fps' });

  socket.on('connect', () => {
    console.log('[Game Hub] Tab', tabId, 'FPS connected, Socket ID:', socket.id);
    sendToTab(tabId, { type: 'FPS_CONNECTED' });
  });

  socket.on('disconnect', (reason) => {
    console.log('[Game Hub] Tab', tabId, 'FPS disconnected:', reason);
    sendToTab(tabId, { type: 'FPS_DISCONNECTED' });
    if (reason === 'io server disconnect' || reason === 'io client disconnect') {
      tabSockets.delete(tabId);
    }
  });

  socket.on('connect_error', (error) => {
    console.error('[Game Hub] Tab', tabId, 'FPS connection error:', error.message);
  });

  socket.on('yourSocketId', (socketId) => {
    sendToTab(tabId, { type: 'yourSocketId', id: socketId });
  });

  socket.on('teamAssigned', (data) => {
    sendToTab(tabId, { type: 'FPS_TEAM_ASSIGNED', ...data });
  });

  socket.on('gameState', (state) => {
    sendToTab(tabId, { type: 'FPS_GAME_STATE', state });
  });

  socket.on('playerJoined', (data) => {
    sendToTab(tabId, { type: 'FPS_PLAYER_JOINED', ...data });
  });

  socket.on('playerLeft', (id) => {
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
    sendToTab(tabId, { type: 'FPS_BOT_SPAWNED', ...data });
  });

  socket.on('botRespawned', (data) => {
    sendToTab(tabId, { type: 'FPS_BOT_RESPAWNED', ...data });
  });

  socket.on('botRemoved', (data) => {
    sendToTab(tabId, { type: 'FPS_BOT_REMOVED', ...data });
  });

  socket.on('botsUpdated', (bots) => {
    sendToTab(tabId, { type: 'FPS_BOTS_UPDATED', bots });
  });

  socket.on('roundStart', (data) => {
    sendToTab(tabId, { type: 'FPS_ROUND_START', ...data });
  });

  socket.on('roundActive', () => {
    sendToTab(tabId, { type: 'FPS_ROUND_ACTIVE' });
  });

  socket.on('roundEnd', (data) => {
    sendToTab(tabId, { type: 'FPS_ROUND_END', ...data });
  });

  socket.on('matchEnd', (data) => {
    sendToTab(tabId, { type: 'FPS_MATCH_END', ...data });
  });

  socket.on('reloadStart', (data) => {
    sendToTab(tabId, { type: 'FPS_RELOAD_START', ...data });
  });

  socket.on('reloadComplete', (data) => {
    sendToTab(tabId, { type: 'FPS_RELOAD_COMPLETE', ...data });
  });
}

// ===== CHESS SOCKET =====
async function createChessSocket(tabId) {
  console.log('[Game Hub] Creating Chess socket for tab:', tabId, 'URL:', serverConfig.chess);

  const socketConfig = {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 10
  };

  const socket = io(serverConfig.chess, socketConfig);
  tabSockets.set(tabId, { socket: socket, gameType: 'chess' });

  socket.on('connect', () => {
    console.log('[Game Hub] Tab', tabId, 'Chess connected, Socket ID:', socket.id);
    sendToTab(tabId, { type: 'GAME_CONNECTED', gameType: 'chess' });
  });

  socket.on('disconnect', (reason) => {
    console.log('[Game Hub] Tab', tabId, 'Chess disconnected:', reason);
    sendToTab(tabId, { type: 'GAME_DISCONNECTED', gameType: 'chess' });
    if (reason === 'io server disconnect' || reason === 'io client disconnect') {
      tabSockets.delete(tabId);
    }
  });

  socket.on('connect_error', (error) => {
    console.error('[Game Hub] Tab', tabId, 'Chess connection error:', error.message);
  });

  socket.on('yourSocketId', (socketId) => {
    console.log('[Game Hub] Tab', tabId, 'Chess socket ID:', socketId);
    sendToTab(tabId, { type: 'yourSocketId', id: socketId });
  });

  socket.on('globalStats', (stats) => {
    sendToTab(tabId, { type: 'GAME_GLOBAL_STATS', stats });
  });

  socket.on('waitingForOpponent', () => {
    console.log('[Game Hub] Tab', tabId, 'waiting for chess opponent');
    sendToTab(tabId, { type: 'CHESS_WAITING_FOR_OPPONENT' });
  });

  socket.on('matchmakingCancelled', () => {
    sendToTab(tabId, { type: 'CHESS_MATCHMAKING_CANCELLED' });
  });

  socket.on('matchFound', (data) => {
    console.log('[Game Hub] Tab', tabId, 'chess match found:', data.matchId);
    sendToTab(tabId, { type: 'CHESS_MATCH_FOUND', matchId: data.matchId });
  });

  socket.on('matchState', (state) => {
    console.log('[Game Hub] Tab', tabId, 'received chess match state');
    sendToTab(tabId, { type: 'CHESS_MATCH_STATE', ...state });
  });

  socket.on('moveMade', (data) => {
    console.log('[Game Hub] Tab', tabId, 'chess move made');
    sendToTab(tabId, { type: 'CHESS_MOVE_MADE', ...data });
  });

  socket.on('invalidMove', (data) => {
    sendToTab(tabId, { type: 'CHESS_INVALID_MOVE', reason: data.reason });
  });

  socket.on('legalMoves', (data) => {
    sendToTab(tabId, { type: 'CHESS_LEGAL_MOVES', ...data });
  });

  socket.on('matchEnded', (data) => {
    console.log('[Game Hub] Tab', tabId, 'chess match ended:', data.reason);
    sendToTab(tabId, { type: 'CHESS_MATCH_ENDED', ...data });
  });

  socket.on('opponentDisconnected', (data) => {
    sendToTab(tabId, { type: 'CHESS_OPPONENT_DISCONNECTED', ...data });
  });

  socket.on('opponentReconnected', () => {
    sendToTab(tabId, { type: 'CHESS_OPPONENT_RECONNECTED' });
  });

  socket.on('drawOffered', (data) => {
    sendToTab(tabId, { type: 'CHESS_DRAW_OFFERED', ...data });
  });

  socket.on('drawDeclined', () => {
    sendToTab(tabId, { type: 'CHESS_DRAW_DECLINED' });
  });
}

async function sendToTab(tabId, data) {
  try {
    await chrome.tabs.sendMessage(tabId, data);
  } catch (error) {
    console.log('[Game Hub] Failed to send to tab', tabId);
    const tabSocket = tabSockets.get(tabId);
    if (tabSocket && tabSocket.socket) tabSocket.socket.disconnect();
    tabSockets.delete(tabId);
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const tabSocket = tabSockets.get(tabId);
  if (tabSocket) {
    console.log('[Game Hub] Tab', tabId, 'closed, disconnecting');
    if (tabSocket.socket) tabSocket.socket.disconnect();
    tabSockets.delete(tabId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tabSockets.has(tabId)) {
    console.log('[Game Hub] Tab', tabId, 'reloading, disconnecting');
    const tabSocket = tabSockets.get(tabId);
    if (tabSocket && tabSocket.socket) tabSocket.socket.disconnect();
    tabSockets.delete(tabId);
  }
});

console.log('[Game Hub] Background service worker ready');

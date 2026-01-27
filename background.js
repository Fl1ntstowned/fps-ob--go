console.log('[Game Hub] Background service worker started');

let serverConfig = {
  fps: 'https://fps-game-backend-production.up.railway.app',
  chess: 'https://chess-game-backend-production.up.railway.app',
  poker: 'https://poker-backend.up.railway.app',
  lobby: 'http://localhost:3006'
};

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Game Hub] Extension installed/updated', details.reason);
  if (details.reason === 'install') {
    chrome.storage.local.set({
      fpsBackendUrl: 'https://fps-game-backend-production.up.railway.app',
      chessBackendUrl: 'https://chess-game-backend-production.up.railway.app',
      pokerBackendUrl: 'https://poker-backend.up.railway.app',
      lobbyBackendUrl: 'http://localhost:3006'
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Game Hub] Browser startup - service worker active');
});

importScripts('socket.io.min.js');

const tabSockets = new Map();

const processedRequests = new Map();
const REQUEST_EXPIRY_MS = 5000;

function isRequestProcessed(tabId, requestId) {
  if (!requestId) return false;

  if (!processedRequests.has(tabId)) {
    processedRequests.set(tabId, new Map());
  }

  const tabRequests = processedRequests.get(tabId);

  if (tabRequests.has(requestId)) {
    console.log('[Game Hub] Skipping duplicate request:', requestId);
    return true;
  }

  tabRequests.set(requestId, Date.now());

  const now = Date.now();
  for (const [id, timestamp] of tabRequests.entries()) {
    if (now - timestamp > REQUEST_EXPIRY_MS) {
      tabRequests.delete(id);
    }
  }

  return false;
}

console.log('[Game Hub] Socket.io loaded');

async function loadServerConfig() {
  const stored = await chrome.storage.local.get(['fpsBackendUrl', 'chessBackendUrl', 'pokerBackendUrl', 'lobbyBackendUrl']);
  serverConfig = {
    fps: stored.fpsBackendUrl || 'https://fps-game-backend-production.up.railway.app',
    chess: stored.chessBackendUrl || 'https://chess-game-backend-production.up.railway.app',
    poker: stored.pokerBackendUrl || 'https://poker-backend.up.railway.app',
    lobby: stored.lobbyBackendUrl || 'http://localhost:3006'
  };
  console.log('[Game Hub] Loaded server config:', serverConfig);
}

loadServerConfig();

const tabAuthTokens = new Map();

async function handlePokerLogin(tabId, username, password) {
  const backendUrl = serverConfig.poker;
  console.log('[Game Hub] Tab', tabId, 'attempting poker login for:', username);

  try {
    const response = await fetch(`${backendUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const result = await response.json();

    if (result.success) {
      tabAuthTokens.set(tabId, result.token);
      console.log('[Game Hub] Tab', tabId, 'poker login successful:', result.username, 'Balance:', result.balance, 'Admin:', result.isAdmin);
    } else {
      console.log('[Game Hub] Tab', tabId, 'poker login failed:', result.error);
    }

    sendToTab(tabId, { type: 'POKER_AUTH_RESULT', ...result });

  } catch (error) {
    console.error('[Game Hub] Tab', tabId, 'poker login error:', error);
    sendToTab(tabId, { type: 'POKER_AUTH_RESULT', success: false, error: 'Connection error' });
  }
}

async function handlePokerLogout(tabId) {
  const backendUrl = serverConfig.poker;
  const token = tabAuthTokens.get(tabId);

  console.log('[Game Hub] Tab', tabId, 'logging out of poker');

  if (token) {
    try {
      await fetch(`${backendUrl}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
    } catch (error) {
      console.log('[Game Hub] Tab', tabId, 'logout error (ignored):', error.message);
    }
    tabAuthTokens.delete(tabId);
  }

  sendToTab(tabId, { type: 'POKER_LOGGED_OUT' });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  console.log('[Game Hub] Message:', message.type, 'from tab:', tabId, 'requestId:', message.requestId);

  if (message.requestId && isRequestProcessed(tabId, message.requestId)) {
    sendResponse({ success: true, duplicate: true });
    return true;
  }

  if (message.type === 'FPS_INIT') {
    handleFpsInit(tabId).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('[Game Hub] FPS Init error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (message.type === 'GAME_INIT' && message.gameType === 'chess') {
    handleChessInit(tabId).then(() => {
      sendResponse({ success: true, gameType: 'chess' });
    }).catch(error => {
      console.error('[Game Hub] Chess Init error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (message.type === 'GAME_INIT' && message.gameType === 'poker') {
    handlePokerInit(tabId).then(() => {
      sendResponse({ success: true, gameType: 'poker' });
    }).catch(error => {
      console.error('[Game Hub] Poker Init error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (message.type === 'LOBBY_INIT') {
    handleLobbyInit(tabId).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('[Game Hub] Lobby Init error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  const tabSocket = tabSockets.get(tabId);
  if (!tabSocket || !tabSocket.socket || !tabSocket.socket.connected) {
    sendResponse({ success: false, error: 'Not connected to backend' });
    return true;
  }

  const gameType = tabSocket.gameType;

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

    if (message.type === 'FPS_RADIO_STATE') {
      tabSocket.socket.emit('radioState', { playing: message.playing });
      sendResponse({ success: true });
      return true;
    }
  }

  if (gameType === 'lobby') {
    if (message.type === 'LOBBY_JOIN') {
      tabSocket.socket.emit('joinLobby', { playerName: message.playerName });
      console.log('[Game Hub] Tab', tabId, 'joining lobby as:', message.playerName);
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'LOBBY_PLAYER_MOVE') {
      tabSocket.socket.emit('playerMove', {
        position: message.position,
        rotation: message.rotation
      });
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'LOBBY_RADIO_STATE') {
      tabSocket.socket.emit('radioState', { playing: message.playing });
      sendResponse({ success: true });
      return true;
    }
  }

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

  if (gameType === 'poker') {
    if (message.type === 'POKER_LOGIN') {
      handlePokerLogin(tabId, message.username, message.password);
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'POKER_LOGOUT') {
      handlePokerLogout(tabId);
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'POKER_AUTHENTICATE') {
      tabSocket.socket.emit('authenticate', { token: message.token });
      console.log('[Game Hub] Tab', tabId, 'authenticating socket');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'GAME_SET_PLAYER_NAME') {
      tabSocket.socket.emit('setPlayerName', message.playerName);
      console.log('[Game Hub] Tab', tabId, 'set poker player name:', message.playerName);
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'POKER_JOIN_QUEUE') {
      tabSocket.socket.emit('joinQueue', { maxSeats: message.maxSeats || 6 });
      console.log('[Game Hub] Tab', tabId, 'joining poker queue, maxSeats:', message.maxSeats || 6);
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'POKER_LEAVE_TABLE') {
      tabSocket.socket.emit('leaveTable');
      console.log('[Game Hub] Tab', tabId, 'leaving poker table');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'POKER_FOLD') {
      tabSocket.socket.emit('fold');
      console.log('[Game Hub] Tab', tabId, 'folds');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'POKER_CHECK') {
      tabSocket.socket.emit('check');
      console.log('[Game Hub] Tab', tabId, 'checks');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'POKER_CALL') {
      tabSocket.socket.emit('call');
      console.log('[Game Hub] Tab', tabId, 'calls');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'POKER_BET') {
      tabSocket.socket.emit('bet', { amount: message.amount });
      console.log('[Game Hub] Tab', tabId, 'bets', message.amount);
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'POKER_RAISE') {
      tabSocket.socket.emit('raise', { amount: message.amount });
      console.log('[Game Hub] Tab', tabId, 'raises to', message.amount);
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'POKER_ALL_IN') {
      tabSocket.socket.emit('allIn');
      console.log('[Game Hub] Tab', tabId, 'goes all-in');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'POKER_CHAT_MESSAGE') {
      tabSocket.socket.emit('chatMessage', { message: message.message });
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'POKER_EMOJI') {
      tabSocket.socket.emit('emojiReaction', { emoji: message.emoji });
      sendResponse({ success: true });
      return true;
    }
  }

  console.log('[Game Hub] Unhandled message type:', message.type, 'for game:', gameType);
  sendResponse({ success: true, unhandled: true });
  return true;
});

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

  socket.on('radioState', (data) => {
    sendToTab(tabId, { type: 'FPS_RADIO_STATE', ...data });
  });
}

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

async function handlePokerInit(tabId) {
  console.log('[Game Hub] GAME_INIT (poker) for tab:', tabId);
  await loadServerConfig();

  if (tabSockets.has(tabId)) {
    const existing = tabSockets.get(tabId);
    if (existing.socket && existing.socket.connected && existing.gameType === 'poker') {
      console.log('[Game Hub] Tab', tabId, 'already has active poker socket');
      sendToTab(tabId, { type: 'GAME_CONNECTED', gameType: 'poker' });
      return;
    } else {
      if (existing.socket) existing.socket.disconnect();
      tabSockets.delete(tabId);
    }
  }

  await createPokerSocket(tabId);
}

async function createPokerSocket(tabId) {
  console.log('[Game Hub] Creating Poker socket for tab:', tabId, 'URL:', serverConfig.poker);

  const socketConfig = {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 10
  };

  const socket = io(serverConfig.poker, socketConfig);
  tabSockets.set(tabId, { socket: socket, gameType: 'poker' });

  socket.on('connect', () => {
    console.log('[Game Hub] Tab', tabId, 'Poker connected, Socket ID:', socket.id);
    sendToTab(tabId, { type: 'GAME_CONNECTED', gameType: 'poker' });
  });

  socket.on('disconnect', (reason) => {
    console.log('[Game Hub] Tab', tabId, 'Poker disconnected:', reason);
    sendToTab(tabId, { type: 'GAME_DISCONNECTED', gameType: 'poker' });
    if (reason === 'io server disconnect' || reason === 'io client disconnect') {
      tabSockets.delete(tabId);
    }
  });

  socket.on('connect_error', (error) => {
    console.error('[Game Hub] Tab', tabId, 'Poker connection error:', error.message);
  });

  socket.on('yourSocketId', (data) => {
    console.log('[Game Hub] Tab', tabId, 'Poker socket ID:', data.id);
    sendToTab(tabId, { type: 'yourSocketId', id: data.id });
  });

  socket.on('authResult', (data) => {
    console.log('[Game Hub] Tab', tabId, 'socket auth result:', data.success ? 'success' : 'failed');
    sendToTab(tabId, { type: 'POKER_SOCKET_AUTH_RESULT', ...data });
  });

  socket.on('seated', (data) => {
    console.log('[Game Hub] Tab', tabId, 'seated at poker table:', data.tableId, 'balance:', data.balance);
    sendToTab(tabId, { type: 'POKER_SEATED', ...data });
  });

  socket.on('tableState', (state) => {
    sendToTab(tabId, { type: 'POKER_TABLE_STATE', ...state });
  });

  socket.on('playerAction', (data) => {
    sendToTab(tabId, { type: 'POKER_PLAYER_ACTION', ...data });
  });

  socket.on('handResult', (data) => {
    console.log('[Game Hub] Tab', tabId, 'poker hand result');
    sendToTab(tabId, { type: 'POKER_HAND_RESULT', ...data });
  });

  socket.on('invalidAction', (data) => {
    sendToTab(tabId, { type: 'POKER_INVALID_ACTION', reason: data.reason });
  });

  socket.on('outOfChips', (data) => {
    sendToTab(tabId, { type: 'POKER_OUT_OF_CHIPS', message: data?.message || 'You are out of chips!' });
  });

  socket.on('error', (data) => {
    console.error('[Game Hub] Tab', tabId, 'poker error:', data.message);
    sendToTab(tabId, { type: 'POKER_ERROR', message: data.message });
  });

  socket.on('globalStats', (stats) => {
    sendToTab(tabId, { type: 'POKER_GLOBAL_STATS', stats });
  });

  socket.on('spectating', (data) => {
    console.log('[Game Hub] Tab', tabId, 'spectating poker table:', data.tableId);
    sendToTab(tabId, { type: 'POKER_SPECTATING', ...data });
  });

  socket.on('spectatorToPlayer', (data) => {
    console.log('[Game Hub] Tab', tabId, 'promoted from spectator to player');
    sendToTab(tabId, { type: 'POKER_SPECTATOR_TO_PLAYER', ...data });
  });

  socket.on('leftTable', (data) => {
    console.log('[Game Hub] Tab', tabId, 'left poker table');
    sendToTab(tabId, { type: 'POKER_LEFT_TABLE', ...data });
  });

  socket.on('chatMessage', (data) => {
    sendToTab(tabId, { type: 'POKER_CHAT_MESSAGE', ...data });
  });

  socket.on('emojiReaction', (data) => {
    sendToTab(tabId, { type: 'POKER_EMOJI_REACTION', ...data });
  });
}

async function handleLobbyInit(tabId) {
  console.log('[Game Hub] Lobby init for tab:', tabId);

  const existing = tabSockets.get(tabId);
  if (existing) {
    if (existing.socket && existing.socket.connected && existing.gameType === 'lobby') {
      console.log('[Game Hub] Tab', tabId, 'already connected to lobby');
      sendToTab(tabId, { type: 'LOBBY_CONNECTED' });
      return;
    }
    if (existing.socket) {
      existing.socket.disconnect();
    }
    tabSockets.delete(tabId);
  }

  await createLobbySocket(tabId);
}

async function createLobbySocket(tabId) {
  console.log('[Game Hub] Creating Lobby socket for tab:', tabId, 'URL:', serverConfig.lobby);

  const socketConfig = {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 10000
  };

  const socket = io(serverConfig.lobby, socketConfig);

  tabSockets.set(tabId, { socket, gameType: 'lobby' });

  socket.on('connect', () => {
    console.log('[Game Hub] Lobby connected for tab:', tabId);
    sendToTab(tabId, { type: 'LOBBY_CONNECTED' });
  });

  socket.on('disconnect', (reason) => {
    console.log('[Game Hub] Lobby disconnected for tab:', tabId, 'reason:', reason);
    sendToTab(tabId, { type: 'LOBBY_DISCONNECTED', reason });
  });

  socket.on('connect_error', (error) => {
    console.log('[Game Hub] Lobby connection error for tab:', tabId, error.message);
  });

  socket.on('yourSocketId', (data) => {
    sendToTab(tabId, { type: 'yourSocketId', id: data.id });
  });

  socket.on('lobbyState', (state) => {
    sendToTab(tabId, { type: 'LOBBY_STATE', state });
  });

  socket.on('playerJoined', (data) => {
    sendToTab(tabId, { type: 'LOBBY_PLAYER_JOINED', ...data });
  });

  socket.on('playerLeft', (id) => {
    sendToTab(tabId, { type: 'LOBBY_PLAYER_LEFT', id });
  });

  socket.on('playerMoved', (data) => {
    sendToTab(tabId, { type: 'LOBBY_PLAYER_MOVED', ...data });
  });

  socket.on('radioState', (data) => {
    sendToTab(tabId, { type: 'LOBBY_RADIO_STATE', ...data });
  });

  socket.on('playerCount', (data) => {
    sendToTab(tabId, { type: 'LOBBY_PLAYER_COUNT', ...data });
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
  processedRequests.delete(tabId);
  tabAuthTokens.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tabSockets.has(tabId)) {
    console.log('[Game Hub] Tab', tabId, 'reloading, disconnecting');
    const tabSocket = tabSockets.get(tabId);
    if (tabSocket && tabSocket.socket) tabSocket.socket.disconnect();
    tabSockets.delete(tabId);
    processedRequests.delete(tabId);
  }
});

console.log('[Game Hub] Background service worker ready');

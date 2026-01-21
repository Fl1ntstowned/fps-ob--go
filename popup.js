const FPS_LOCAL_URL = 'http://localhost:3003';
const FPS_PRODUCTION_URL = 'https://fps-game-backend-production.up.railway.app';

const CHESS_LOCAL_URL = 'http://localhost:3004';
const CHESS_PRODUCTION_URL = 'https://chess-game-backend-production.up.railway.app';

const POKER_LOCAL_URL = 'http://localhost:3005';
const POKER_PRODUCTION_URL = 'https://poker-backend.up.railway.app';

let backendUrl = FPS_LOCAL_URL;
let chessBackendUrl = CHESS_LOCAL_URL;
let pokerBackendUrl = POKER_LOCAL_URL;

const backendUrlInput = document.getElementById('backendUrl');
const chessBackendUrlInput = document.getElementById('chessBackendUrl');
const pokerBackendUrlInput = document.getElementById('pokerBackendUrl');
const useLocalBtn = document.getElementById('useLocalBtn');
const useProductionBtn = document.getElementById('useProductionBtn');
const testBtn = document.getElementById('testBtn');
const statusDiv = document.getElementById('status');
const helpText = document.getElementById('helpText');
const connectionIndicator = document.getElementById('connectionIndicator');
const connectionText = document.getElementById('connectionText');

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get(['fpsBackendUrl', 'chessBackendUrl', 'pokerBackendUrl']);

  if (stored.fpsBackendUrl) {
    backendUrl = stored.fpsBackendUrl;
  } else {
    backendUrl = await detectEnvironment();
  }

  if (stored.chessBackendUrl) {
    chessBackendUrl = stored.chessBackendUrl;
  } else {
    chessBackendUrl = backendUrl === FPS_LOCAL_URL ? CHESS_LOCAL_URL : CHESS_PRODUCTION_URL;
  }

  if (stored.pokerBackendUrl) {
    pokerBackendUrl = stored.pokerBackendUrl;
  } else {
    pokerBackendUrl = backendUrl === FPS_LOCAL_URL ? POKER_LOCAL_URL : POKER_PRODUCTION_URL;
  }

  backendUrlInput.value = backendUrl;
  chessBackendUrlInput.value = chessBackendUrl;
  pokerBackendUrlInput.value = pokerBackendUrl;
  await chrome.storage.local.set({ fpsBackendUrl: backendUrl, chessBackendUrl: chessBackendUrl, pokerBackendUrl: pokerBackendUrl });

  updateButtonStates();
  await testAllConnections();
});

async function detectEnvironment() {
  const fpsLocal = await testBackendHealth(FPS_LOCAL_URL);
  const chessLocal = await testBackendHealth(CHESS_LOCAL_URL);
  const pokerLocal = await testBackendHealth(POKER_LOCAL_URL);

  if (fpsLocal || chessLocal || pokerLocal) {
    helpText.textContent = 'Local development servers';
    return FPS_LOCAL_URL;
  }
  helpText.textContent = 'Railway production servers';
  return FPS_PRODUCTION_URL;
}

async function testBackendHealth(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json();
      return data.status === 'healthy' ? data : false;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function updateButtonStates() {
  if (backendUrl === FPS_LOCAL_URL) {
    useLocalBtn.classList.add('active');
    useProductionBtn.classList.remove('active');
    helpText.textContent = 'FPS :3003 | Chess :3004 | Poker :3005';
  } else {
    useLocalBtn.classList.remove('active');
    useProductionBtn.classList.add('active');
    helpText.textContent = 'Railway production servers';
  }
}

useLocalBtn.addEventListener('click', async () => {
  backendUrl = FPS_LOCAL_URL;
  chessBackendUrl = CHESS_LOCAL_URL;
  pokerBackendUrl = POKER_LOCAL_URL;
  backendUrlInput.value = FPS_LOCAL_URL;
  chessBackendUrlInput.value = CHESS_LOCAL_URL;
  pokerBackendUrlInput.value = POKER_LOCAL_URL;
  await chrome.storage.local.set({
    fpsBackendUrl: FPS_LOCAL_URL,
    chessBackendUrl: CHESS_LOCAL_URL,
    pokerBackendUrl: POKER_LOCAL_URL
  });
  updateButtonStates();
  showStatus('info', 'Switched to local. Testing...');
  await testAllConnections();
});

useProductionBtn.addEventListener('click', async () => {
  backendUrl = FPS_PRODUCTION_URL;
  chessBackendUrl = CHESS_PRODUCTION_URL;
  pokerBackendUrl = POKER_PRODUCTION_URL;
  backendUrlInput.value = FPS_PRODUCTION_URL;
  chessBackendUrlInput.value = CHESS_PRODUCTION_URL;
  pokerBackendUrlInput.value = POKER_PRODUCTION_URL;
  await chrome.storage.local.set({
    fpsBackendUrl: FPS_PRODUCTION_URL,
    chessBackendUrl: CHESS_PRODUCTION_URL,
    pokerBackendUrl: POKER_PRODUCTION_URL
  });
  updateButtonStates();
  showStatus('info', 'Switched to production. Testing...');
  await testAllConnections();
});

testBtn.addEventListener('click', async () => {
  showStatus('info', 'Testing all backends...');
  await testAllConnections();
});

async function testAllConnections() {
  connectionText.textContent = 'Testing...';
  connectionIndicator.className = 'connection-indicator checking';

  const [fpsResult, chessResult, pokerResult] = await Promise.all([
    testBackendHealth(backendUrl),
    testBackendHealth(chessBackendUrl),
    testBackendHealth(pokerBackendUrl)
  ]);

  const results = [];
  let anyOnline = false;

  if (fpsResult) {
    results.push(`FPS: Online (${fpsResult.players || 0} players)`);
    anyOnline = true;
  } else {
    results.push('FPS: Offline');
  }

  if (chessResult) {
    results.push(`Chess: Online`);
    anyOnline = true;
  } else {
    results.push('Chess: Offline');
  }

  if (pokerResult) {
    results.push(`Poker: Online (${pokerResult.tables || 0} tables)`);
    anyOnline = true;
  } else {
    results.push('Poker: Offline');
  }

  if (anyOnline) {
    showStatus('success', results.join('\n'));
    connectionIndicator.className = 'connection-indicator online';
    connectionText.textContent = 'Backend(s) Online';
  } else {
    showStatus('error', results.join('\n') + '\n\nStart a backend:\n  cd [game]-backend\n  yarn start');
    connectionIndicator.className = 'connection-indicator offline';
    connectionText.textContent = 'All Offline';
  }
}

function showStatus(type, message) {
  statusDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
}

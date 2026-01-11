// FPS Backend URLs
const FPS_LOCAL_URL = 'http://localhost:3003';
const FPS_PRODUCTION_URL = 'https://fps-game-backend-production.up.railway.app';

// Chess Backend URLs
const CHESS_LOCAL_URL = 'http://localhost:3004';
const CHESS_PRODUCTION_URL = 'https://chess-game-backend-production.up.railway.app';

let backendUrl = FPS_LOCAL_URL;
let chessBackendUrl = CHESS_LOCAL_URL;

const backendUrlInput = document.getElementById('backendUrl');
const chessBackendUrlInput = document.getElementById('chessBackendUrl');
const useLocalBtn = document.getElementById('useLocalBtn');
const useProductionBtn = document.getElementById('useProductionBtn');
const testBtn = document.getElementById('testBtn');
const statusDiv = document.getElementById('status');
const helpText = document.getElementById('helpText');
const connectionIndicator = document.getElementById('connectionIndicator');
const connectionText = document.getElementById('connectionText');

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get(['fpsBackendUrl', 'chessBackendUrl']);

  if (stored.fpsBackendUrl) {
    backendUrl = stored.fpsBackendUrl;
  } else {
    backendUrl = await detectEnvironment();
  }

  // Set chess URL based on environment (local or production)
  if (stored.chessBackendUrl) {
    chessBackendUrl = stored.chessBackendUrl;
  } else {
    // Match chess environment to FPS environment
    chessBackendUrl = backendUrl === FPS_LOCAL_URL ? CHESS_LOCAL_URL : CHESS_PRODUCTION_URL;
  }

  backendUrlInput.value = backendUrl;
  chessBackendUrlInput.value = chessBackendUrl;
  await chrome.storage.local.set({ fpsBackendUrl: backendUrl, chessBackendUrl: chessBackendUrl });

  updateButtonStates();
  await testConnection();
});

async function detectEnvironment() {
  const isLocal = await testBackendHealth(FPS_LOCAL_URL);
  if (isLocal) {
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
      return data.status === 'healthy';
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
    helpText.textContent = 'FPS :3003 | Chess :3004';
  } else {
    useLocalBtn.classList.remove('active');
    useProductionBtn.classList.add('active');
    helpText.textContent = 'Railway production servers';
  }
}

useLocalBtn.addEventListener('click', async () => {
  backendUrl = FPS_LOCAL_URL;
  chessBackendUrl = CHESS_LOCAL_URL;
  backendUrlInput.value = FPS_LOCAL_URL;
  chessBackendUrlInput.value = CHESS_LOCAL_URL;
  await chrome.storage.local.set({
    fpsBackendUrl: FPS_LOCAL_URL,
    chessBackendUrl: CHESS_LOCAL_URL
  });
  updateButtonStates();
  showStatus('info', 'Switched to local. Testing...');
  await testConnection();
});

useProductionBtn.addEventListener('click', async () => {
  backendUrl = FPS_PRODUCTION_URL;
  chessBackendUrl = CHESS_PRODUCTION_URL;
  backendUrlInput.value = FPS_PRODUCTION_URL;
  chessBackendUrlInput.value = CHESS_PRODUCTION_URL;
  await chrome.storage.local.set({
    fpsBackendUrl: FPS_PRODUCTION_URL,
    chessBackendUrl: CHESS_PRODUCTION_URL
  });
  updateButtonStates();
  showStatus('info', 'Switched to production. Testing...');
  await testConnection();
});

testBtn.addEventListener('click', async () => {
  showStatus('info', 'Testing...');
  await testConnection();
});

async function testConnection() {
  connectionText.textContent = 'Testing...';
  connectionIndicator.className = 'connection-indicator checking';

  try {
    const response = await fetch(`${backendUrl}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    if (data.status === 'healthy') {
      showStatus('success', `Connected!\n\nPlayers: ${data.players || 0}\nBots: ${data.bots || 0}\nRound: ${data.round || 1}\nScore: Red ${data.scores?.red || 0} - Blue ${data.scores?.blue || 0}`);
      connectionIndicator.className = 'connection-indicator online';
      connectionText.textContent = 'Server Online';
      return true;
    } else {
      throw new Error('Health check failed');
    }
  } catch (error) {
    showStatus('error', `Failed: ${error.message}\n\nStart backend:\n  cd fps-backend\n  yarn install\n  yarn start`);
    connectionIndicator.className = 'connection-indicator offline';
    connectionText.textContent = 'Server Offline';
    return false;
  }
}

function showStatus(type, message) {
  statusDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
}

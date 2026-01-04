const LOCAL_URL = 'http://localhost:3003';
// Railway auto-deploy URL - update this after Railway deployment is configured
const PRODUCTION_URL = 'https://fps-game-backend-production.up.railway.app';

let backendUrl = LOCAL_URL;

const backendUrlInput = document.getElementById('backendUrl');
const useLocalBtn = document.getElementById('useLocalBtn');
const useProductionBtn = document.getElementById('useProductionBtn');
const testBtn = document.getElementById('testBtn');
const statusDiv = document.getElementById('status');
const helpText = document.getElementById('helpText');
const connectionIndicator = document.getElementById('connectionIndicator');
const connectionText = document.getElementById('connectionText');

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get(['fpsBackendUrl']);

  if (stored.fpsBackendUrl) {
    backendUrl = stored.fpsBackendUrl;
    backendUrlInput.value = backendUrl;
  } else {
    backendUrl = await detectEnvironment();
    backendUrlInput.value = backendUrl;
    await chrome.storage.local.set({ fpsBackendUrl: backendUrl });
  }

  updateButtonStates();
  await testConnection();
});

async function detectEnvironment() {
  const isLocal = await testBackendHealth(LOCAL_URL);
  if (isLocal) {
    helpText.textContent = 'localhost:3003 - development';
    return LOCAL_URL;
  }
  helpText.textContent = 'Railway production server';
  return PRODUCTION_URL;
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
  if (backendUrl === LOCAL_URL) {
    useLocalBtn.classList.add('active');
    useProductionBtn.classList.remove('active');
    helpText.textContent = 'localhost:3003 - development';
  } else {
    useLocalBtn.classList.remove('active');
    useProductionBtn.classList.add('active');
    helpText.textContent = 'Railway production server';
  }
}

useLocalBtn.addEventListener('click', async () => {
  backendUrl = LOCAL_URL;
  backendUrlInput.value = LOCAL_URL;
  await chrome.storage.local.set({ fpsBackendUrl: LOCAL_URL });
  updateButtonStates();
  showStatus('info', 'Switched to local. Testing...');
  await testConnection();
});

useProductionBtn.addEventListener('click', async () => {
  backendUrl = PRODUCTION_URL;
  backendUrlInput.value = PRODUCTION_URL;
  await chrome.storage.local.set({ fpsBackendUrl: PRODUCTION_URL });
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

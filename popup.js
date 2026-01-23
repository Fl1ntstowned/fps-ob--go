const FPS_URL = 'https://fps-game-backend-production.up.railway.app';
const CHESS_URL = 'https://chess-game-backend-production.up.railway.app';
const POKER_URL = 'https://poker-backend.up.railway.app';

const testBtn = document.getElementById('testBtn');
const statusDiv = document.getElementById('status');
const connectionIndicator = document.getElementById('connectionIndicator');
const connectionText = document.getElementById('connectionText');

document.addEventListener('DOMContentLoaded', async () => {
  await chrome.storage.local.set({
    fpsBackendUrl: FPS_URL,
    chessBackendUrl: CHESS_URL,
    pokerBackendUrl: POKER_URL
  });
  await testAllConnections();
});

async function testBackendHealth(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
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

testBtn.addEventListener('click', async () => {
  showStatus('info', 'Testing all backends...');
  await testAllConnections();
});

async function testAllConnections() {
  connectionText.textContent = 'Testing...';
  connectionIndicator.className = 'connection-indicator checking';

  const [fpsResult, chessResult, pokerResult] = await Promise.all([
    testBackendHealth(FPS_URL),
    testBackendHealth(CHESS_URL),
    testBackendHealth(POKER_URL)
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
    showStatus('error', results.join('\n') + '\n\nServers may be starting up. Try again in a moment.');
    connectionIndicator.className = 'connection-indicator offline';
    connectionText.textContent = 'All Offline';
  }
}

function showStatus(type, message) {
  statusDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
}

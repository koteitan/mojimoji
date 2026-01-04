// Remote console logging via WebSocket
// Usage:
//   ?ws=8080              → ws://(same host):8080
//   ?ws=5:8080            → ws://192.168.1.5:8080 (if host is 192.168.1.xxx)
//   ?ws=192.168.1.5:8080  → ws://192.168.1.5:8080

let ws: WebSocket | null = null;
let messageQueue: string[] = [];
let isConnected = false;
let connectionChangeCallback: ((connected: boolean) => void) | null = null;

// Parse ws query parameter and build WebSocket URL
function getWsUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const wsParam = params.get('ws');
  if (!wsParam) return null;

  // Port only (no colon) → same host
  if (/^\d+$/.test(wsParam)) {
    return `ws://${window.location.hostname}:${wsParam}`;
  }

  const [addr, port] = wsParam.split(':');
  if (!port) return null;

  // Check if addr is a single number (last octet only)
  if (/^\d{1,3}$/.test(addr)) {
    // Use host's first 3 octets + provided last octet
    const hostParts = window.location.hostname.split('.');
    if (hostParts.length === 4) {
      const baseAddr = hostParts.slice(0, 3).join('.');
      return `ws://${baseAddr}.${addr}:${port}`;
    }
  }

  // Full address provided
  return `ws://${addr}:${port}`;
}

// Update title bar indicator and notify callback
// Uses current isConnected state at update time to avoid race conditions
function updateTitleBarIndicator(): void {
  // Notify callback
  connectionChangeCallback?.(isConnected);

  const tryUpdate = () => {
    const titleBar = document.querySelector('.title-bar');
    if (!titleBar) {
      // Retry after 100ms if title bar not ready
      setTimeout(tryUpdate, 100);
      return;
    }

    // Find or create indicator span
    let indicator = document.getElementById('ws-indicator');
    if (!indicator) {
      indicator = document.createElement('span');
      indicator.id = 'ws-indicator';
      indicator.style.marginLeft = '4px';
      titleBar.appendChild(indicator);
    }

    // Use current connection state (not a stale parameter)
    indicator.textContent = isConnected ? '+' : '-';
  };
  tryUpdate();
}

// Initialize WebSocket connection
function initWebSocket(): void {
  const wsUrl = getWsUrl();
  if (!wsUrl) return;

  // Clean up any existing connection
  if (ws) {
    ws.onclose = null;  // Remove handler to prevent retry loop
    ws.onerror = null;
    ws.onopen = null;
    ws.close();
    ws = null;
  }

  // Show "-" while connecting
  updateTitleBarIndicator();

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      isConnected = true;
      updateTitleBarIndicator();
      // Send queued messages
      while (messageQueue.length > 0) {
        const msg = messageQueue.shift();
        if (msg && ws) {
          ws.send(msg);
        }
      }
    };

    ws.onclose = () => {
      isConnected = false;
      updateTitleBarIndicator();
    };

    ws.onerror = () => {
      isConnected = false;
      updateTitleBarIndicator();
    };
  } catch {
    // Silently fail
  }
}

// Format arguments for logging (strips %c CSS formatting for WebSocket output)
function formatArgs(args: unknown[]): string {
  // Filter out CSS style arguments (used with %c in console.log)
  // Pattern: string with %c, followed by style strings
  const filtered: unknown[] = [];
  let skipNext = 0;

  for (let i = 0; i < args.length; i++) {
    if (skipNext > 0) {
      skipNext--;
      continue;
    }

    const arg = args[i];
    if (typeof arg === 'string') {
      // Count %c occurrences and skip that many following arguments (CSS styles)
      const matches = arg.match(/%c/g);
      if (matches) {
        skipNext = matches.length;
        // Remove %c from the string
        filtered.push(arg.replace(/%c/g, ''));
      } else {
        filtered.push(arg);
      }
    } else {
      filtered.push(arg);
    }
  }

  return filtered.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
}

// Send log message via WebSocket
function sendLog(level: string, args: unknown[]): void {
  const formattedMessage = formatArgs(args);
  // Skip empty messages
  if (!formattedMessage) return;

  const message = JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    message: formattedMessage,
  });

  if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(message);
  } else if (getWsUrl()) {
    // Queue message if not connected but wss is specified
    messageQueue.push(message);
    if (messageQueue.length > 100) {
      messageQueue.shift(); // Limit queue size
    }
  }
}

// Auto-connect with short delay
setTimeout(initWebSocket, 100);

// Check if ws query param exists
export function hasWsParam(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('ws');
}

// Check if WebSocket is connected
export function isWsConnected(): boolean {
  return isConnected;
}

// Register callback for connection state changes
export function onWsConnectionChange(callback: (connected: boolean) => void): () => void {
  connectionChangeCallback = callback;
  // Return cleanup function
  return () => {
    connectionChangeCallback = null;
  };
}

// Connect WebSocket
export function connectWs(): void {
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    initWebSocket();
  }
}

// Disconnect WebSocket
export function disconnectWs(): void {
  if (ws) {
    ws.close();
    ws = null;
    isConnected = false;
    updateTitleBarIndicator();
  }
}

// Export myconsole object
export const myconsole = {
  log: (...args: unknown[]): void => {
    console.log(...args);
    sendLog('log', args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args);
    sendLog('warn', args);
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
    sendLog('error', args);
  },
  info: (...args: unknown[]): void => {
    console.info(...args);
    sendLog('info', args);
  },
  debug: (...args: unknown[]): void => {
    console.debug(...args);
    sendLog('debug', args);
  },
};

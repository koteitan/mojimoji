#!/usr/bin/env node
// WebSocket Console Server (ws://, no SSL)
// Usage: node server.js [port] [--verbose]
// Default port: 8080
// --verbose: Show log level and timestamp (e.g., [LOG] 12:34:56 message)

const { WebSocketServer } = require('ws');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const portArg = args.find(a => !a.startsWith('-'));
const port = parseInt(portArg) || 8080;

// Create WebSocket server
const wss = new WebSocketServer({ port, host: '0.0.0.0' });

let connectionCount = 0;

// Color codes for log levels
const colors = {
  log: '\x1b[0m',     // default
  info: '\x1b[36m',   // cyan
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
  debug: '\x1b[90m',  // gray
  reset: '\x1b[0m',
};

wss.on('connection', (ws, req) => {
  connectionCount++;
  const connId = connectionCount;
  const clientIp = req.socket.remoteAddress;
  console.log(`\x1b[32m[CONNECTED #${connId}]\x1b[0m ${clientIp}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (verbose) {
        const color = colors[msg.level] || colors.log;
        const time = new Date(msg.timestamp).toLocaleTimeString();
        console.log(`${color}[${msg.level.toUpperCase()}]${colors.reset} ${time} ${msg.message}`);
      } else {
        console.log(msg.message);
      }
    } catch (e) {
      console.log(`[RAW] ${data.toString()}`);
    }
  });

  ws.on('close', () => {
    console.log(`\x1b[31m[DISCONNECTED #${connId}]\x1b[0m ${clientIp}`);
  });

  ws.on('error', (err) => {
    console.error(`[ERROR] ${err.message}`);
  });
});

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Error: Port ${port} is already in use.`);
    console.error(`Try: node server.js ${port + 1}`);
  } else {
    console.error(`Error: ${err.message}`);
  }
  process.exit(1);
});

wss.on('listening', () => {
  console.log(`WS Console Server running on port ${port}`);

  // Show actual IP addresses
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`  ws://${iface.address}:${port}`);
      }
    }
  }

  console.log('\nWaiting for connections...\n');
});

'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { fork } = require('node:child_process');

const isDev = !app.isPackaged;
const DEV_PORT = 3000;

let serverProcess = null;
let serverPort = DEV_PORT;

/** Ask the OS for a free port rather than guessing one that may be taken. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`Server did not start on port ${port}`));
        else setTimeout(attempt, 250);
      });
      req.on('timeout', () => req.destroy());
    };
    attempt();
  });
}

/**
 * In a packaged app the Next server runs as a child process using Electron's
 * own Node (ELECTRON_RUN_AS_NODE), so there is no separate Node requirement on
 * the user's machine. In dev we assume `next dev` is already running.
 */
async function startServer() {
  if (isDev) {
    serverPort = DEV_PORT;
    await waitForServer(serverPort);
    return;
  }

  const root = path.join(process.resourcesPath, 'app');
  serverPort = await findFreePort();

  serverProcess = fork(path.join(root, 'server.js'), [], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(serverPort),
      HOSTNAME: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  serverProcess.stdout?.on('data', (d) => process.stdout.write(`[next] ${d}`));
  serverProcess.stderr?.on('data', (d) => process.stderr.write(`[next] ${d}`));

  await waitForServer(serverPort);
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1340,
    height: 940,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0a0618',
    title: 'Dance Exercise Chart Maker',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // The page is local; it needs no Node access of its own.
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://127.0.0.1:${serverPort}`);

  // Keep real navigation inside the app; send outbound links to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (err) {
    const { dialog } = require('electron');
    dialog.showErrorBox('Could not start', String(err && err.message ? err.message : err));
    app.quit();
    return;
  }

  createWindow();

  // macOS convention: clicking the dock icon reopens a window.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// macOS convention: the app stays running with no windows open.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopServer);
process.on('exit', stopServer);

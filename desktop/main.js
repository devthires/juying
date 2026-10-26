const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs');

// 与主站 .env 保持一致的预置采集源（均为实测支持搜索的源）
const PRESET_SOURCES = JSON.stringify([
  { name: '暴风资源', url: 'https://bfzyapi.com/api.php/provide/vod' },
  { name: '360资源', url: 'https://360zy.com/api.php/provide/vod' },
  { name: '非凡资源', url: 'https://api.ffzyapi.com/api.php/provide/vod' },
  { name: '最大资源', url: 'https://api.zuidapi.com/api.php/provide/vod' },
  { name: '量子资源', url: 'https://cj.lziapi.com/api.php/provide/vod' },
  { name: '红牛资源', url: 'https://www.hongniuzy2.com/api.php/provide/vod' },
  { name: '电影天堂资源', url: 'https://caiji.dyttzyapi.com/api.php/provide/vod' },
  { name: '极速资源', url: 'https://jszyapi.com/api.php/provide/vod' },
  { name: '360资源备用', url: 'https://360zy5.com/api.php/provide/vod' },
  { name: '非凡资源备用', url: 'https://cj.ffzyapi.com/api.php/provide/vod' },
]);

// 预置直播源（/live 页使用）
const PRESET_LIVE_SOURCES = JSON.stringify([
  { name: 'IPTV中文频道', url: 'https://iptv-org.github.io/iptv/countries/cn.m3u' },
]);

let serverProc = null;
let mainWindow = null;

/** 随机取一个空闲本地端口（pickPort 的最后兜底） */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** 探测端口是否空闲 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

/**
 * 端口必须跨启动稳定：页面数据（IndexedDB / localStorage）按 origin（含端口）隔离，
 * 端口一变历史记录、搜索记录和设置就会整体「消失」。优先沿用上次使用的端口，
 * 被其他程序占用时向后顺延并记住新端口；顺延也失败才退回随机端口。
 */
async function pickPort(preferred) {
  for (let port = preferred; port < preferred + 100; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) return port;
  }
  return getFreePort();
}

/** 可选的用户配置：%APPDATA%/聚影/config.json，目前支持 password 字段 */
function readConfig() {
  const defaults = { password: '123456', port: 27182 };
  try {
    const p = path.join(app.getPath('userData'), 'config.json');
    return { ...defaults, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch {
    return defaults;
  }
}

/** 把端口等变更写回用户配置，供下次启动沿用 */
function writeConfig(patch) {
  try {
    const p = path.join(app.getPath('userData'), 'config.json');
    fs.writeFileSync(p, JSON.stringify({ ...readConfig(), ...patch }, null, 2));
  } catch {
    // 写不进配置只影响下次端口偏好，不阻断启动
  }
}

function serverDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(__dirname, 'server-bundle');
}

/** 以 ELECTRON_RUN_AS_NODE 方式用 Electron 自带 Node 运行 Next standalone 服务 */
function startServer(port) {
  const dir = serverDir();
  const proc = spawn(process.execPath, [path.join(dir, 'server.js')], {
    cwd: dir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      PASSWORD: readConfig().password,
      DEFAULT_SOURCES: PRESET_SOURCES,
      DEFAULT_LIVE_SOURCES: PRESET_LIVE_SOURCES,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const logPath = path.join(app.getPath('userData'), 'server.log');
  const log = fs.createWriteStream(logPath, { flags: 'a' });
  log.write(`\n===== ${new Date().toISOString()} server starting on 127.0.0.1:${port} =====\n`);
  proc.stdout.pipe(log);
  proc.stderr.pipe(log);
  serverProc = proc;
}

/** 轮询 /api/status 直到服务就绪 */
function waitForServer(port, timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/status', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) reject(new Error('内置服务启动超时'));
      else setTimeout(attempt, 400);
    };
    attempt();
  });
}

async function createWindow() {
  const preferred = Number.isFinite(readConfig().port) ? readConfig().port : 27182;
  const port = await pickPort(preferred);
  if (port !== preferred) writeConfig({ port });
  startServer(port);
  await waitForServer(port);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: '聚影',
    autoHideMenuBar: true,
    backgroundColor: '#0b101a',
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // 键盘快捷键：Alt+← / Alt+→ 后退 / 前进；F5 / Ctrl+R 刷新
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const nav = mainWindow.webContents.navigationHistory;
    if (input.alt && input.key === 'ArrowLeft') {
      if (nav.canGoBack()) nav.goBack();
      event.preventDefault();
    } else if (input.alt && input.key === 'ArrowRight') {
      if (nav.canGoForward()) nav.goForward();
      event.preventDefault();
    } else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
      mainWindow.webContents.reload();
      event.preventDefault();
    }
  });
  // 页面自带 <title>，但保持窗口标题为「聚影」
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // 外部链接一律交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

const gotLock = app.requestSingleInstanceLock();

// 鼠标侧键历史导航（preload 转发）
ipcMain.on('nav-mouse', (_event, button) => {
  const wc = mainWindow ? mainWindow.webContents : null;
  if (!wc) return;
  const nav = wc.navigationHistory;
  if (button === 3 && nav.canGoBack()) nav.goBack();
  if (button === 4 && nav.canGoForward()) nav.goForward();
});

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow).catch((err) => {
    dialog.showErrorBox('聚影启动失败', String((err && err.stack) || err));
    app.quit();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (serverProc) {
      try {
        serverProc.kill();
      } catch {}
      serverProc = null;
    }
  });
}

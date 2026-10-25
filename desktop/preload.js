const { ipcRenderer } = require('electron');

// 鼠标侧键（后退=3 / 前进=4）转发给主进程执行历史导航，并阻止 Chromium 默认行为避免双重导航
window.addEventListener(
  'mousedown',
  (e) => {
    if (e.button === 3 || e.button === 4) {
      e.preventDefault();
      ipcRenderer.send('nav-mouse', e.button);
    }
  },
  true
);

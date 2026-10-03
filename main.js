const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { UsageTracker } = require('./usage')

if (!app.requestSingleInstanceLock()) app.quit()

const W = 300
const H = 440
const cfgFile = () => path.join(app.getPath('userData'), 'config.json')
const DEFAULTS = {
  x: null, y: null, scale: 1, sound: true, volume: 0.5,
  turnBubble: true, turnSound: true, turnSeconds: 8,
  currency: 'USD', cnyRate: 7.1,
  followClaude: true,
  // 每周额度：周四 1:00 重置；weeklyBudget 为空时，用 calibrateUsedPct（当前已用百分比）自动反推
  resetDay: 4, resetHour: 1, weeklyBudget: null, calibrateUsedPct: null,
}
let cfg = { ...DEFAULTS }
try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) } } catch (e) { /* 首次启动 */ }
const saveCfg = () => { try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 1)) } catch (e) { /* ignore */ } }

let win
let tray
let tracker
let lastStats = null

// 最近一次重置时刻（本地时间 resetDay 星期几 resetHour 点）
function periodStart(now = Date.now()) {
  const d = new Date(now)
  d.setHours(cfg.resetHour, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() - cfg.resetDay + 7) % 7))
  if (d.getTime() > now) d.setDate(d.getDate() - 7)
  return d.getTime()
}

function withQuota(st) {
  if (!cfg.weeklyBudget && cfg.calibrateUsedPct && st.period > 0) {
    cfg.weeklyBudget = Math.round(st.period / (cfg.calibrateUsedPct / 100))
    cfg.calibrateUsedPct = null
    saveCfg()
  }
  return { ...st, budget: cfg.weeklyBudget, nextReset: periodStart() + 7 * 86400e3 }
}

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data) }

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea
  const x = cfg.x ?? wa.x + wa.width - W - 20
  const y = cfg.y ?? wa.y + wa.height - H
  win = new BrowserWindow({
    width: W, height: H, x, y,
    frame: false, transparent: true, resizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  win.loadFile('index.html')
  win.webContents.on('did-finish-load', () => {
    send('config', cfg)
    if (lastStats) send('stats', lastStats)
  })
}

function setCfg(patch) {
  Object.assign(cfg, patch)
  saveCfg()
  send('config', cfg)
  rebuildTray()
}

function menuTemplate() {
  const autostart = app.getLoginItemSettings(loginArgs()).openAtLogin
  return [
    { label: '看看账本', click: () => send('show-stats') },
    { label: '问 Claude…（双击小克）', click: () => openQuick() },
    { label: '校准每周额度…', click: () => send('calibrate-ui') },
    { label: '戳一下', click: () => send('poke') },
    { type: 'separator' },
    {
      label: '大小', submenu: [0.7, 0.85, 1, 1.2, 1.4].map(s => ({
        label: `${Math.round(s * 100)}%`, type: 'radio', checked: cfg.scale === s, click: () => setCfg({ scale: s }),
      })),
    },
    {
      label: '货币', submenu: [
        { label: '美元 $', type: 'radio', checked: cfg.currency === 'USD', click: () => setCfg({ currency: 'USD' }) },
        { label: `人民币 ¥（汇率 ${cfg.cnyRate}）`, type: 'radio', checked: cfg.currency === 'CNY', click: () => setCfg({ currency: 'CNY' }) },
      ],
    },
    { label: '按压音效', type: 'checkbox', checked: cfg.sound, click: m => setCfg({ sound: m.checked }) },
    { label: '每轮结束冒泡', type: 'checkbox', checked: cfg.turnBubble, click: m => setCfg({ turnBubble: m.checked }) },
    { label: '每轮结束提示音', type: 'checkbox', checked: cfg.turnSound, click: m => setCfg({ turnSound: m.checked }) },
    { label: '跟着 Claude Code 开关', type: 'checkbox', checked: cfg.followClaude, click: m => setCfg({ followClaude: m.checked }) },
    { label: '开机自启', type: 'checkbox', checked: autostart, click: m => { app.setLoginItemSettings({ ...loginArgs(), openAtLogin: m.checked }); rebuildTray() } },
    { type: 'separator' },
    { label: '编辑台词 (lines.json)', click: () => shell.openPath(path.join(__dirname, 'lines.json')) },
    { label: '编辑价格 (pricing.json)', click: () => shell.openPath(path.join(__dirname, 'pricing.json')) },
    { label: '重新加载台词和价格', click: () => { tracker.loadPricing(); tracker.entries = {}; tracker.files = {}; tracker.live = false; tracker.scan(); send('reload-lines') } },
    { label: '回到右下角', click: () => { const wa = screen.getPrimaryDisplay().workArea; win.setPosition(wa.x + wa.width - W - 20, wa.y + wa.height - H); setCfg({ x: null, y: null }) } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]
}

function loginArgs() {
  // 开发模式下 execPath 是 electron.exe，需要把应用目录作为参数传进去
  return app.isPackaged ? {} : { path: process.execPath, args: [path.resolve(__dirname)] }
}

function rebuildTray() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()))
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'xiaoke1.png')).resize({ width: 16, height: 16 })
  tray = new Tray(img)
  tray.setToolTip('小克 · Claude Code 记账')
  tray.on('click', () => { win.show(); send('poke') })
  rebuildTray()
}

// ---------- 双击小克：仿 Claude 快捷输入框，回车后交给 Claude 桌面版开新对话 ----------
let quick = null
function openQuick() {
  if (quick && !quick.isDestroyed()) { quick.show(); quick.focus(); return }
  const wa = screen.getDisplayMatching(win.getBounds()).workArea
  const QW = 640, QH = 96
  quick = new BrowserWindow({
    width: QW, height: QH, x: Math.round(wa.x + (wa.width - QW) / 2), y: Math.round(wa.y + wa.height * 0.32),
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  })
  quick.setAlwaysOnTop(true, 'screen-saver')
  quick.loadFile('quick.html')
  let shownAt = Infinity
  quick.once('ready-to-show', () => { quick.show(); quick.focus(); shownAt = Date.now() })
  // 点到别处就收起；刚弹出时 Windows 可能抢不到焦点，前 0.6 秒的失焦忽略
  quick.on('blur', () => { if (Date.now() - shownAt > 600 && quick && !quick.isDestroyed()) quick.close() })
  quick.on('closed', () => { quick = null })
}
ipcMain.on('quick-open', () => openQuick())
ipcMain.on('quick-close', () => { if (quick && !quick.isDestroyed()) quick.close() })
ipcMain.on('quick-submit', (e, text) => {
  if (quick && !quick.isDestroyed()) quick.close()
  text = String(text || '').trim()
  if (!text) return
  shell.openExternal('claude://claude.ai/new?q=' + encodeURIComponent(text.slice(0, 8000)))
  send('asked')
})
ipcMain.on('calibrate', (e, pct) => {
  pct = Number(pct)
  if (!(pct > 0 && pct <= 100) || !lastStats || !(lastStats.period > 0)) return
  cfg.weeklyBudget = Math.round(lastStats.period / (pct / 100))
  saveCfg()
  lastStats = withQuota(lastStats)
  send('stats', lastStats)
})

ipcMain.on('set-ignore', (e, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true })
})
ipcMain.handle('get-pos', () => win.getPosition())
ipcMain.on('move-to', (e, [x, y]) => win.setPosition(Math.round(x), Math.round(y)))
ipcMain.on('move-end', () => { const [x, y] = win.getPosition(); cfg.x = x; cfg.y = y; saveCfg() })
ipcMain.on('menu', () => Menu.buildFromTemplate(menuTemplate()).popup({ window: win }))
// 角色图的不透明区域（降采样成 1/4 网格），用来判断鼠标是否点在小克身上
ipcMain.handle('mask', () => {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'xiaoke1.png'))
  const { width, height } = img.getSize()
  const bmp = img.toBitmap() // BGRA
  const step = 4
  const w = Math.ceil(width / step), h = Math.ceil(height / step)
  const data = new Array(w * h).fill(0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y * step) * width + x * step) * 4 + 3
      data[y * w + x] = bmp[i] > 30 ? 1 : 0
    }
  }
  return { w, h, data }
})
ipcMain.handle('lines', () => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'lines.json'), 'utf8')) } catch (e) { return [{ text: '台词文件坏掉了...', weight: 1 }] }
})

// ---------- 跟着 Claude Code 开关 ----------
// hook.js 在 sessions/ 下为每个 Claude Code 会话放一个文件，会话结束时删掉。
// 文件和对话记录都超过 STALE_MS 没动静的，当作已关闭（兜底 Claude Code 异常退出没触发 SessionEnd）。
// 曾经有过会话、现在一个都不剩 → 小克下班。手动启动且从没有会话时不会自动退出。
const STALE_MS = 2 * 3600e3
const sessDir = () => path.join(app.getPath('userData'), 'sessions')
let hadSession = false
let emptyChecks = 0
let leaving = false

function liveSessions() {
  let files = []
  try { files = fs.readdirSync(sessDir()).filter(f => f.endsWith('.json')) } catch (e) { return 0 }
  let n = 0
  for (const f of files) {
    const p = path.join(sessDir(), f)
    try {
      let last = fs.statSync(p).mtimeMs
      const info = JSON.parse(fs.readFileSync(p, 'utf8'))
      try { if (info.transcript) last = Math.max(last, fs.statSync(info.transcript).mtimeMs) } catch (e) { /* 记录还没生成 */ }
      if (Date.now() - last > STALE_MS) fs.rmSync(p, { force: true })
      else n++
    } catch (e) { /* 文件正被写 */ }
  }
  return n
}

function checkSessions() {
  if (leaving) return
  const n = liveSessions()
  if (n > 0) { hadSession = true; emptyChecks = 0; return }
  if (!cfg.followClaude || !hadSession) return
  if (++emptyChecks < 2) return
  leaving = true
  send('bye')
  setTimeout(() => app.quit(), 2500)
}

app.whenReady().then(() => {
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'pid'), String(process.pid)) } catch (e) { /* ignore */ }
  setInterval(checkSessions, 5000)
  createWindow()
  createTray()
  tracker = new UsageTracker({
    pricingFile: path.join(__dirname, 'pricing.json'),
    cacheFile: path.join(app.getPath('userData'), 'usage-cache.json'),
  })
  tracker.periodStart = () => periodStart()
  tracker.on('stats', s => { lastStats = withQuota(s); send('stats', lastStats) })
  tracker.on('turn', t => send('turn', t))
  tracker.start(3000)
})

app.on('second-instance', () => { if (win) { win.show(); send('poke') } })
app.on('before-quit', () => {
  if (tracker) tracker.stop()
  try { const p = path.join(app.getPath('userData'), 'pid'); if (fs.readFileSync(p, 'utf8') === String(process.pid)) fs.rmSync(p) } catch (e) { /* ignore */ }
})
app.on('window-all-closed', () => app.quit())

// 自检：XK_SELFTEST=1 时依次截图「待机 / 戳一下 / 账本 / 一轮结束」，存到 selftest/ 后退出
if (process.env.XK_SELFTEST) {
  app.whenReady().then(async () => {
    const dir = path.join(__dirname, 'selftest')
    fs.mkdirSync(dir, { recursive: true })
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const shot = async name => fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG())
    for (let i = 0; i < 60 && !lastStats; i++) await wait(1000)
    await wait(1500); await shot('1-idle')
    send('poke'); await wait(800); await shot('2-poke')
    send('show-stats'); await wait(800); await shot('3-stats')
    send('turn', { cost: 0.4213, cwd: 'D:/projects/demo', model: 'claude-opus-5-5' }); await wait(800); await shot('4-turn')
    openQuick(); await wait(400); if (quick) fs.writeFileSync(path.join(dir, '5-quick.png'), (await quick.webContents.capturePage()).toPNG())
    app.quit()
  })
}

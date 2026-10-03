// 把「跟着 Claude Code 一起开关」的 hook 写进 ~/.claude/settings.json，或者移除。
//   node scripts/hooks.js install
//   node scripts/hooks.js uninstall
// 只增删本项目自己的三条 hook，其它设置原样保留；写入前先备份。
const fs = require('fs')
const os = require('os')
const path = require('path')

const file = path.join(os.homedir(), '.claude', 'settings.json')
const hookJs = path.resolve(__dirname, '..', 'hook.js').split(path.sep).join('/')
const MARK = 'xiaoke-cc'
const EVENTS = { SessionStart: ['start', true], UserPromptSubmit: ['ping', true], SessionEnd: ['end', false] }

const mode = process.argv[2]
let s = {}
if (fs.existsSync(file)) {
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) {
    console.error(`${file} 不是合法 JSON，先修好再来。`)
    process.exit(1)
  }
  fs.copyFileSync(file, file + '.bak-xiaoke')
}
s.hooks = s.hooks || {}

// 先删掉旧的（路径变了也能清干净）
for (const ev of Object.keys(EVENTS)) {
  const list = (s.hooks[ev] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !String(h.command || '').includes(MARK)) }))
    .filter(g => g.hooks.length)
  if (list.length) s.hooks[ev] = list; else delete s.hooks[ev]
}

if (mode === 'install') {
  for (const [ev, [arg, async]] of Object.entries(EVENTS)) {
    const h = { type: 'command', command: `node "${hookJs}" ${arg} ${MARK}`, timeout: 10 }
    if (async) h.async = true
    ;(s.hooks[ev] = s.hooks[ev] || []).push({ hooks: [h] })
  }
} else if (mode !== 'uninstall') {
  console.log('用法：node scripts/hooks.js install | uninstall')
  process.exit(1)
}
if (!Object.keys(s.hooks).length) delete s.hooks
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n')
console.log(mode === 'install' ? `已写入 hook → ${file}` : `已移除 hook → ${file}`)

// 读取 Claude Code 本地对话记录（~/.claude/projects/**/*.jsonl），按 API 价格估算花费。
// - 只扫最近 KEEP_DAYS 天改动过的文件；按偏移量增量读取，结果缓存到磁盘，重启不用重扫。
// - 同一条回复会分多行写入（message.id + requestId 相同），以最后一行的 usage 为准。
// - 主对话里出现 stop_reason=end_turn 时视为「一轮结束」，把这一轮（含子代理）的花费发出去。
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const os = require('os')
const { EventEmitter } = require('events')

const KEEP_DAYS = 8
const CHUNK = 4 * 1024 * 1024

function localDate(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

class UsageTracker extends EventEmitter {
  constructor({ pricingFile, cacheFile, root }) {
    super()
    this.root = root || path.join(os.homedir(), '.claude', 'projects')
    this.pricingFile = pricingFile
    this.cacheFile = cacheFile
    this.loadPricing()
    this.files = {}   // path -> { offset }
    this.entries = {} // key -> { d: date, c: cost, m: model, s: sessionId }
    this.turnAcc = {} // sessionId -> 本轮累计
    this.ended = new Set()
    this.live = false // 首次扫描期间不发「一轮结束」
    this.periodStart = () => Date.now() - 7 * 86400e3 // 额度周期起点，由外部设置
    this.busy = false
    this.loadCache()
  }

  loadPricing() {
    try {
      this.pricing = JSON.parse(fs.readFileSync(this.pricingFile, 'utf8'))
    } catch (e) {
      this.pricing = { models: {}, _family: {} }
    }
  }

  priceFor(model) {
    const p = this.pricing
    if (p.models[model]) return p.models[model]
    for (const fam of Object.keys(p._family || {})) {
      if (model && model.includes(fam)) return p.models[p._family[fam]]
    }
    return null
  }

  cost(model, u) {
    const p = this.priceFor(model)
    if (!p || !u) return 0
    const cc = u.cache_creation || {}
    let w1h = cc.ephemeral_1h_input_tokens || 0
    let w5m = cc.ephemeral_5m_input_tokens || 0
    if (!w1h && !w5m) w5m = u.cache_creation_input_tokens || 0
    const usd = ((u.input_tokens || 0) * p.input + (u.output_tokens || 0) * p.output +
      w5m * p.cacheWrite5m + w1h * p.cacheWrite1h +
      (u.cache_read_input_tokens || 0) * p.cacheRead) / 1e6
    return u.speed === 'fast' ? usd * 2 : usd
  }

  loadCache() {
    try {
      const c = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'))
      if (c.v === 3) { this.files = c.files || {}; this.entries = c.entries || {} }
    } catch (e) { /* 没有缓存就全量扫 */ }
  }

  saveCache() {
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify({ v: 3, files: this.files, entries: this.entries }))
    } catch (e) { /* ignore */ }
  }

  prune() {
    const cutoff = localDate(Date.now() - KEEP_DAYS * 86400e3)
    for (const k of Object.keys(this.entries)) if (this.entries[k].d < cutoff) delete this.entries[k]
  }

  async listFiles() {
    const out = []
    const cutoff = Date.now() - KEEP_DAYS * 86400e3
    const walk = async (dir, depth) => {
      let items
      try { items = await fsp.readdir(dir, { withFileTypes: true }) } catch (e) { return }
      for (const it of items) {
        const p = path.join(dir, it.name)
        if (it.isDirectory()) { if (depth < 6) await walk(p, depth + 1) }
        else if (it.name.endsWith('.jsonl')) {
          try {
            const st = await fsp.stat(p)
            if (st.mtimeMs >= cutoff) out.push({ p, size: st.size })
          } catch (e) { /* ignore */ }
        }
      }
    }
    await walk(this.root, 0)
    return out
  }

  handleLine(line, file) {
    if (line.indexOf('"assistant"') < 0 || line.indexOf('"usage"') < 0) return
    let o
    try { o = JSON.parse(line) } catch (e) { return }
    if (o.type !== 'assistant' || !o.message || !o.message.usage) return
    const m = o.message
    if (m.model === '<synthetic>') return
    const key = (m.id || o.uuid) + ':' + (o.requestId || '')
    const c = this.cost(m.model, m.usage)
    const prev = this.entries[key]
    const delta = c - (prev ? prev.c : 0)
    const t = Date.parse(o.timestamp) || Date.now()
    this.entries[key] = { d: localDate(t), t, c, m: m.model, s: o.sessionId }

    if (!this.live) return
    const sid = o.sessionId || file
    if (delta) this.turnAcc[sid] = (this.turnAcc[sid] || 0) + delta
    if (m.stop_reason === 'end_turn' && !o.isSidechain && !this.ended.has(key)) {
      this.ended.add(key)
      const turn = this.turnAcc[sid] || 0
      this.turnAcc[sid] = 0
      this.emit('turn', { sessionId: sid, cost: turn, model: m.model, cwd: o.cwd })
    }
  }

  async readFile(p, size) {
    const st = this.files[p] || { offset: 0 }
    if (size < st.offset) st.offset = 0 // 文件被截断/重写
    if (size === st.offset) { this.files[p] = st; return false }
    const fh = await fsp.open(p, 'r')
    try {
      let pos = st.offset
      let rest = ''
      const buf = Buffer.alloc(CHUNK)
      while (pos < size) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - pos), pos)
        if (!bytesRead) break
        pos += bytesRead
        const text = rest + buf.toString('utf8', 0, bytesRead)
        const lines = text.split('\n')
        rest = lines.pop()
        for (const l of lines) this.handleLine(l, p)
      }
      // 最后不完整的一行留到下次再读
      st.offset = pos - Buffer.byteLength(rest, 'utf8')
    } finally {
      await fh.close()
    }
    this.files[p] = st
    return true
  }

  async scan() {
    if (this.busy) return
    this.busy = true
    try {
      const list = await this.listFiles()
      let changed = false
      for (const f of list) {
        try { if (await this.readFile(f.p, f.size)) changed = true } catch (e) { /* 文件正被写，下次再读 */ }
      }
      const alive = new Set(list.map(f => f.p))
      for (const p of Object.keys(this.files)) if (!alive.has(p)) delete this.files[p]
      if (changed || !this.live) {
        this.prune()
        this.emit('stats', this.stats())
      }
      if (changed && Date.now() - (this.lastSave || 0) > 30e3) { this.saveCache(); this.lastSave = Date.now() }
      this.live = true
    } finally {
      this.busy = false
    }
  }

  stats() {
    const today = localDate(Date.now())
    const days = {}
    for (let i = 6; i >= 0; i--) days[localDate(Date.now() - i * 86400e3)] = 0
    const byModel = {}
    let todayCost = 0
    let todayMsgs = 0
    let period = 0
    const since = this.periodStart()
    for (const e of Object.values(this.entries)) {
      if (e.d in days) days[e.d] += e.c
      if (e.t >= since) period += e.c
      if (e.d === today) {
        todayCost += e.c
        todayMsgs++
        byModel[e.m] = (byModel[e.m] || 0) + e.c
      }
    }
    const week = Object.values(days).reduce((a, b) => a + b, 0)
    return { today: todayCost, todayMsgs, week, days, byModel, period, periodStart: since }
  }

  start(intervalMs = 3000) {
    this.scan()
    this.timer = setInterval(() => this.scan(), intervalMs)
  }

  stop() {
    clearInterval(this.timer)
    this.saveCache()
  }
}

module.exports = { UsageTracker }

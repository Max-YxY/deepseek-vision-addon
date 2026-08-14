// ensure-edge.js：确保豆包登录窗口的 CDP 端口可用（复用或自动拉起）
// 用法: node ensure-edge.js
// 登录态已持久化在 edge-profile-login，窗口关闭后会自动用有头模式重新拉起，登录态自动恢复
const { spawn } = require('child_process')
const path = require('path')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9991
const BASE = 'E:/ASUS/Documents/deepseek配置/vision-chain'
const PROFILE = path.join(BASE, 'edge-profile-login')
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function cdpAlive() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    if (res.ok) { const v = await res.json(); return v.Browser }
  } catch (e) { /* not up */ }
  return null
}

;(async () => {
  // 1. 若已可用，直接复用
  const existing = await cdpAlive()
  if (existing) {
    console.log(`CDP_ALREADY_UP: ${existing}`)
    process.exit(0)
  }

  // 2. 杀干净占用该 profile 的旧 Edge 进程（仅命令行含 edge-profile-login 的）
  try {
    const { execSync } = require('child_process')
    const ps = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \'Name=\\\"msedge.exe\\\"\' | Where-Object { $_.CommandLine -like \\\"*edge-profile-login*\\\" } | ForEach-Object { $_.ProcessId }"', { encoding: 'utf8' })
    const pids = ps.split(/\s+/).map(s => s.trim()).filter(Boolean)
    for (const pid of pids) {
      try { process.kill(Number(pid)) } catch (e) { /* already gone */ }
    }
    if (pids.length) console.log('KILLED_STALE:', pids.join(','))
  } catch (e) { /* ignore */ }
  await sleep(2500)

  // 3. 启动新的 Edge 窗口（有头模式！登录态在 profile 中，有头模式重启自动恢复）
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=msEdgeSidebarV2,msEdgeTranslateButton',
    '--window-size=1400,950',
    '--new-window',
    'https://www.doubao.com/chat/',
  ]
  const child = spawn(EDGE, args, { stdio: 'ignore', detached: true })
  child.unref()
  console.log('EDGE_SPAWNED pid=', child.pid)

  // 4. 轮询等 CDP 就绪
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const ver = await cdpAlive()
    if (ver) {
      console.log(`CDP_READY: ${ver}`)
      process.exit(0)
    }
    await sleep(1500)
  }
  console.error('CDP_TIMEOUT: Edge did not come up; please log in to Doubao in the window')
  process.exit(1)
})()

// restart-dsh.js：重启 DSH Harness（web 模式）v3
// 用法: node restart-dsh.js
// 需要环境变量 DSH_HOME（默认取本机常见位置，可通过 env 覆盖）
const { spawn, execFileSync } = require('child_process')
const path = require('path')

const DSH_HOME = process.env.DSH_HOME || 'E:/DeepSeek-Harness/home'
const NPM_CACHE = process.env.NPM_CONFIG_CACHE || (DSH_HOME.replace(/\/home$/, '') + '/npm-cache')
const FIND_SCRIPT = path.join(__dirname, 'find-dsh.ps1')

function getPids() {
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', FIND_SCRIPT,
    ], { encoding: 'utf8' })
    return out.split(/\s+/).map(s => s.trim()).filter(Boolean)
  } catch (e) {
    console.error('FIND_FAIL:', e.message)
    return []
  }
}

// 1. 收集并杀掉 dsh web 进程树
const pids = getPids()
console.log('DSH_PIDS:', pids.join(',') || '(none)')
for (const pid of pids) {
  try {
    execFileSync('taskkill.exe', ['/PID', pid, '/T', '/F'], { encoding: 'utf8', stdio: 'ignore' })
    console.log('KILLED:', pid)
  } catch (e) { /* already gone */ }
}

// 2. 等端口释放 + 重新启动
setTimeout(() => {
  let listening = 1
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      '(Get-NetTCPConnection -State Listen -LocalPort 3080 -ErrorAction SilentlyContinue | Measure-Object).Count',
    ], { encoding: 'utf8' })
    listening = parseInt(out.trim(), 10) || 0
  } catch (e) {}
  console.log('PORT_3080_LISTENING:', listening)

  const child = spawn('cmd.exe', [
    '/c', 'set', `"DSH_HOME=${DSH_HOME}"`, '&&', 'set', `"npm_config_cache=${NPM_CACHE}"`, '&&',
    'npx.cmd --yes @deepseek-ai/dsh web',
  ], {
    cwd: DSH_HOME,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, DSH_HOME, npm_config_cache: NPM_CACHE },
  })
  child.unref()
  console.log('SPAWNED_PID:', child.pid)
  console.log('RESTART_DONE')
}, 4000)

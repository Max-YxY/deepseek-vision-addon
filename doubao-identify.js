// doubao-identify.js：识图入口（供插件工具调用），输出 JSON
// 用法: node doubao-identify.js <图1> [图2 ...] --prompt "<提示词>" [--mode brief|detail] [--new-conversation true|false]
// 输出: {"ok":true,"reply":"..."} 或 {"ok":false,"error":"..."}
const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const BASE = 'E:/ASUS/Documents/deepseek配置/vision-chain'

function fail(msg) {
  console.log(JSON.stringify({ ok: false, error: msg }))
  process.exit(0)
}

// 收集图片参数（其余透传给 core）
const args = process.argv.slice(2)
if (!args.length) return fail('缺少图片路径参数')

// 1. 确保登录窗口可用（自动拉起）
try {
  execFileSync('node', [path.join(BASE, 'ensure-edge.js')], {
    encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (e) {
  return fail('无法启动/连接豆包窗口: ' + (e.message || ''))
}

// 2. 执行核心识图
let out
try {
  out = execFileSync('node', [path.join(BASE, 'doubao-vision-core.js'), ...args], {
    encoding: 'utf8', timeout: 330000, stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (e) {
  return fail('识图执行失败: ' + (e.message || '') + (e.stdout ? ' ' + String(e.stdout).slice(0, 300) : ''))
}

// 3. 解析最后一行 JSON
const lines = out.trim().split('\n')
for (let i = lines.length - 1; i >= 0; i--) {
  const line = lines[i].trim()
  if (!line) continue
  try {
    const parsed = JSON.parse(line)
    if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
      console.log(JSON.stringify(parsed))
      process.exit(0)
    }
  } catch (e) { /* not json, keep scanning */ }
}
fail('无法解析识图输出: ' + out.slice(0, 400))

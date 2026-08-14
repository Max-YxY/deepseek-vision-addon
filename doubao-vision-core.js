// doubao-vision-core.js：核心识图引擎（优化版）
// 特性：条件等待提速 / 自动新对话 / 简要·详细模式 / 批量识图 / 失败重试 / 风控检测
// 用法: node doubao-vision-core.js <图1> [图2] [图3...] --prompt "<提示词>" [--mode brief|detail] [--new-conversation true|false]
// 输出: 最后一行 JSON { ok, reply, error, warning? }
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

// playwright-core 解析：优先项目本地 node_modules（npm install playwright-core），
// 其次从 npx 缓存向上解析（兜底，路径自动探测不硬编码用户名）
const req = createRequire(path.join(__dirname, 'package.json'))
let chromium
try {
  // eslint-disable-next-line global-require
  chromium = require('playwright-core').chromium
} catch (e1) {
  try {
    // eslint-disable-next-line global-require
    chromium = req('playwright-core').chromium
  } catch (e2) {
    console.error('playwright-core 未找到，请在本目录执行: npm install playwright-core')
    process.exit(1)
  }
}

const PORT = 9991
// 项目根目录：默认取脚本自身所在目录，可用环境变量 VISION_CHAIN_HOME 覆盖
const BASE = process.env.VISION_CHAIN_HOME || __dirname
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---- 解析参数 ----
const argv = process.argv.slice(2)
const images = []
let prompt = '请用中文仔细描述这张图片的内容，包括其中的文字、物体、布局等所有细节。'
let mode = 'detail' // detail | brief
let newConversation = true

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--prompt') { prompt = argv[++i] ?? '' }
  else if (a === '--mode') { mode = argv[++i] ?? 'detail' }
  else if (a === '--new-conversation') { newConversation = (argv[++i] ?? 'true') !== 'false' }
  else if (fs.existsSync(a)) images.push(a)
}
if (mode === 'brief' && prompt === '请用中文仔细描述这张图片的内容，包括其中的文字、物体、布局等所有细节。') {
  prompt = '请用中文简要概括这张图片的内容，一两句话即可。'
}
if (images.length === 0) {
  console.log(JSON.stringify({ ok: false, error: '未提供有效的图片路径' }))
  process.exit(0)
}

// ---- 工具 ----
async function waitFor(predicate, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await predicate()) return true } catch (e) { /* retry */ }
    await sleep(intervalMs)
  }
  return false
}

function riskDetect(text) {
  if (/验证码|滑动验证|安全验证|人机验证/.test(text)) return '豆包触发了人机验证，可能需要手动处理'
  if (/操作频繁|请求过多|频率限制|too many/i.test(text)) return '豆包频率限制，请稍后再试'
  if (/登录已过期|请重新登录|登录状态已失效/.test(text)) return '豆包登录已过期，需要重新登录'
  return null
}

;(async () => {
  let browser
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
    let page = null
    for (const c of browser.contexts()) {
      for (const p of c.pages()) {
        if (p.url().includes('doubao')) page = p
      }
    }
    if (!page) { console.log(JSON.stringify({ ok: false, error: '豆包页面未找到' })); process.exit(0) }

    // ---- 准备新对话（可选）----
    if (newConversation) {
      const clicked = await page.evaluate(() => {
        // 找"新对话"按钮
        const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
        const target = btns.find(b => (b.innerText || '').trim() === '新对话')
        if (target) { target.click(); return true }
        return false
      }).catch(() => false)
      if (clicked) await sleep(2500)
    }

    // ---- 上传图片（带重试）----
    const fileInput = page.locator('input[type="file"]').first()
    let uploaded = false
    for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
      try {
        await fileInput.setInputFiles(images.map(p => path.resolve(p)), { timeout: 30000 })
        uploaded = true
      } catch (e) {
        if (attempt === 2) break
        await sleep(3000)
      }
    }
    if (!uploaded) { console.log(JSON.stringify({ ok: false, error: '图片上传失败（file input 未就绪）' })); process.exit(0) }

    // 条件等待：上传处理完成（出现 blob 预览图 或 "解释图片" 按钮）
    const uploadOk = await waitFor(async () => {
      const state = await page.evaluate(() => {
        const blobs = Array.from(document.querySelectorAll('img')).filter(i => (i.src || '').startsWith('blob:')).length
        const text = document.body ? document.body.innerText : ''
        return { blobs, hasExplain: text.includes('解释图片') }
      }).catch(() => ({ blobs: 0, hasExplain: false }))
      return state.blobs > 0 || state.hasExplain
    }, 30000, 1500)
    if (!uploadOk) { console.log(JSON.stringify({ ok: false, error: '图片上传后未检测到预览' })); process.exit(0) }

    // 风控检测
    const pageText0 = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')
    const risk0 = riskDetect(pageText0)
    if (risk0) { console.log(JSON.stringify({ ok: false, error: risk0 })); process.exit(0) }

    // ---- 输入提示词 ----
    const ta = page.locator('textarea:visible').first()
    await ta.click().catch(() => {})
    await ta.fill(prompt)

    // 记录发送前的最后一条消息文本（用于识别新回复）
    const beforeLast = await page.evaluate(() => {
      const items = document.querySelector('[class*="list_items"]')
      if (!items) return ''
      const rows = Array.from(items.querySelectorAll('.v_list_row')).filter(r => (r.innerText || '').trim().length > 0)
      const last = rows[rows.length - 1]
      return last ? last.innerText.trim() : ''
    }).catch(() => '')

    // ---- 发送 ----
    await sleep(800)
    const clickedSend = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const target = btns.find(b => {
        const cls = (b.className && typeof b.className === 'string') ? b.className : ''
        return /send-msg-btn/.test(cls) && !b.disabled
      })
      if (target) { target.click(); return true }
      return false
    }).catch(() => false)
    if (!clickedSend) await page.keyboard.press('Enter')

    // ---- 条件轮询回复（等"最后一条消息"变化为新回复）----
    let replyBlocks = []
    let stableCount = 0
    let lastCandidate = null
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      const rowText = await page.evaluate((beforeLast) => {
        const items = document.querySelector('[class*="list_items"]')
        if (!items) return null
        const rows = Array.from(items.querySelectorAll('.v_list_row')).filter(r => (r.innerText || '').trim().length > 0)
        if (!rows.length) return null
        const last = rows[rows.length - 1]
        const t = (last.innerText || '').trim()
        if (!t || t === beforeLast) return null // 还是发送前的消息，等待新回复
        const suggestEl = last.querySelector('[class*="suggest-message"]')
        let text = t
        if (suggestEl) {
          const sugText = (suggestEl.innerText || '').trim()
          text = t.replace(sugText, '').trim()
        }
        return text
      }, beforeLast).catch(() => null)

      if (rowText) {
        const risk = riskDetect(rowText)
        if (risk) { console.log(JSON.stringify({ ok: false, error: risk })); process.exit(0) }
        const thinking = /正在|思考|生成中/.test(rowText)
        if (!thinking) {
          if (rowText !== lastCandidate) {
            lastCandidate = rowText
            replyBlocks = [rowText]
            stableCount = 0
          } else {
            stableCount++
          }
          // 回复稳定 2 次即认为完成（约 2-4 秒），大幅提速
          if (stableCount >= 2) break
        }
      }
      await sleep(1500)
    }

    const finalReply = replyBlocks.join('\n')
    if (!finalReply) {
      console.log(JSON.stringify({ ok: false, error: '未捕获到豆包回复（可能超时）' }))
    } else {
      console.log(JSON.stringify({ ok: true, reply: finalReply }))
    }
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err && err.message ? err.message.slice(0, 500) : String(err) }))
  } finally {
    process.exit(0)
  }
})()

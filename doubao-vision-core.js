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

    // ---- 等待页面空闲：若上次回复仍在流式输出，先等它完成（避免状态冲突）----
    await waitFor(async () => {
      // 有"停止"按钮 = 正在生成；轮询直到它消失
      const text = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')
      return !/停止|stop/i.test(text)
    }, 30000, 1500)

    // ---- 准备新对话（可选）----
    if (newConversation) {
      const clicked = await page.evaluate(() => {
        // 找"新对话"按钮
        const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
        const target = btns.find(b => (b.innerText || '').trim() === '新对话')
        if (target) { target.click(); return true }
        return false
      }).catch(() => false)
      if (clicked) {
        // 等待新对话真正就绪：输入框可输入 + 消息区清空 + 无"正在思考"
        await waitFor(async () => {
          const state = await page.evaluate(() => {
            const ta = document.querySelector('textarea')
            const items = document.querySelector('[class*="list_items"]')
            const rows = items ? Array.from(items.querySelectorAll('.v_list_row')).filter(r => (r.innerText || '').trim().length > 0) : []
            const text = document.body ? document.body.innerText : ''
            return { taReady: !!ta, rowCount: rows.length, thinking: /正在|思考|生成中/.test(text) }
          }).catch(() => ({ taReady: false, rowCount: -1, thinking: true }))
          return state.taReady && state.rowCount <= 1 && !state.thinking // 新对话：无旧消息、无流式输出
        }, 20000, 1000)
        // 额外等待页面稳定（新对话动画/请求完成）
        await sleep(2000)
      }
    }

    // ---- 上传图片（带重试）----
    const fileInput = page.locator('input[type="file"]').first()
    let uploaded = false
    for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
      try {
        await fileInput.setInputFiles(images.map(p => path.resolve(p)), { timeout: 30000 })
        // 上传后验证：等待图片进入待发送区域（blob 预览 或 "解释图片" 按钮出现）
        const attachOk = await waitFor(async () => {
          const state = await page.evaluate(() => {
            const blobs = Array.from(document.querySelectorAll('img')).filter(i => (i.src || '').startsWith('blob:')).length
            const text = document.body ? document.body.innerText : ''
            return { blobs, hasExplain: text.includes('解释图片') }
          }).catch(() => ({ blobs: 0, hasExplain: false }))
          return state.blobs > 0 || state.hasExplain
        }, 15000, 1500)
        if (attachOk) {
          uploaded = true
        } else {
          console.log('  upload attempt ' + (attempt + 1) + ': no preview detected, retrying')
          // 清理可能的失败残留（清空输入框重来）
          await page.keyboard.press('Escape').catch(() => {})
          await sleep(2000)
        }
      } catch (e) {
        console.log('  upload attempt ' + (attempt + 1) + ' error: ' + e.message.slice(0, 80))
        if (attempt === 2) break
        await sleep(3000)
      }
    }
    if (!uploaded) { console.log(JSON.stringify({ ok: false, error: '图片上传失败（多次尝试后未检测到图片预览）' })); process.exit(0) }

    // 上传确认：确保图片已在待发送区域（再次确认，防抖动）
    const finalCheck = await page.evaluate(() => {
      const blobs = Array.from(document.querySelectorAll('img')).filter(i => (i.src || '').startsWith('blob:')).length
      return blobs > 0
    }).catch(() => false)
    if (!finalCheck) { console.log(JSON.stringify({ ok: false, error: '图片上传后预览丢失' })); process.exit(0) }

    // 风控检测
    const pageText0 = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')
    const risk0 = riskDetect(pageText0)
    if (risk0) { console.log(JSON.stringify({ ok: false, error: risk0 })); process.exit(0) }

    // ---- 输入提示词 ----
    const ta = page.locator('textarea:visible').first()
    await ta.click().catch(() => {})
    await ta.fill(prompt)

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

    // 发送后记录"最后一条消息"：此刻最后一行 = 刚发出的用户提示词（含图片消息在其上）
    // 轮询时只认"不等于提示词"的新行（AI 回复）
    const promptNormalized = prompt.replace(/\s+/g, '').trim()
    const beforeLast = await page.evaluate((pn) => {
      const items = document.querySelector('[class*="list_items"]')
      if (!items) return pn || '__none__'
      const rows = Array.from(items.querySelectorAll('.v_list_row')).filter(r => (r.innerText || '').trim().length > 0)
      const last = rows[rows.length - 1]
      if (!last) return pn || '__none__'
      const t = last.innerText.trim()
      // 若最后一行含提示词（用户消息），用它作基准；否则用提示词文本
      return t.replace(/\s+/g, '').includes(pn) ? t : (pn || '__none__')
    }, promptNormalized).catch(() => promptNormalized || '__none__')

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
        // 关键：排除"提示词复读"（用户消息本身成为最后一行的情况）——AI 回复必须与提示词不同
        const promptNormalized = prompt.replace(/\s+/g, '').trim()
        const replyNormalized = (rowText || '').replace(/\s+/g, '').trim()
        const isPromptEcho = promptNormalized.length > 5 && replyNormalized === promptNormalized
        if (!thinking && !isPromptEcho) {
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
      // 防复读保护：豆包回复如果只是重复提示词（图片未被理解），报明确错误
      const promptNormalized = prompt.replace(/\s+/g, '').trim()
      const replyNormalized = finalReply.replace(/\s+/g, '').trim()
      if (promptNormalized.length > 5 && replyNormalized === promptNormalized) {
        console.log(JSON.stringify({ ok: false, error: '豆包未能理解图片（回复仅为提示词复读），可能图片上传失败或图片内容异常' }))
      } else {
        console.log(JSON.stringify({ ok: true, reply: finalReply }))
      }
    }
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err && err.message ? err.message.slice(0, 500) : String(err) }))
  } finally {
    process.exit(0)
  }
})()

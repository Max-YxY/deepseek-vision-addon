// dsh-plugin-doubao-vision: 通过豆包网页版自动识图（DeepSeek 视觉外挂）
// Host 插件：注册 doubao_vision 工具，调用 shell 执行识图脚本
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'tool-doubao-vision'

export const inject = ['tools', 'shell']

export const Config = z.object({})

// 识图脚本目录：默认取插件所在目录，可用环境变量覆盖（VISION_CHAIN_HOME）
const BASE = process.env.VISION_CHAIN_HOME || (new URL('.', import.meta.url)).pathname.replace(/\/+$/, '')

export function apply(ctx) {
  const shell = ctx.shell
  if (shell === undefined) {
    console.error('[doubao-vision] shell service not available (inject failed)')
    return
  }
  const sandboxPolicySvc = ctx.get('sandboxPolicy')

  const tool = defineTool({
    name: 'doubao_vision',
    description: '调用豆包网页版视觉能力识别图片，返回豆包对图片内容的文字描述。当用户提供图片路径、粘贴图片路径、或需要查看/理解图片时使用。支持：image_paths 传一个或多个图片路径（数组）；prompt 自定义识图要求；mode=detail（默认，详细）或 brief（简要）；new_conversation 默认 true（每次识图自动开新对话，避免污染豆包历史）。豆包登录窗口会自动拉起并保持登录态。',
    parameters: {
      image_paths: {
        type: 'array',
        required: true,
        description: '图片路径数组，支持单张或多张（最多 9 张）',
        items: { type: 'string' },
      },
      prompt: {
        type: 'string',
        description: '可选的识图提示词，例如“描述图中文字”“提取表格内容”。默认：详细描述图片内容',
      },
      mode: {
        type: 'string',
        enum: ['detail', 'brief'],
        description: '识别详细度：detail 详细描述（默认），brief 简要概括',
      },
      new_conversation: {
        type: 'boolean',
        description: '是否每次自动开新对话，默认 true（避免豆包历史堆积）',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          reply: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (args, value) => {
        if (value.ok) return [{ type: 'text', text: '【豆包识图】\n' + value.reply }]
        return [{ type: 'text', text: '【豆包识图失败】' + (value.error || '未知错误') }]
      },
    },
    timeoutMs: 360000,
    async execute(args, exec) {
      const paths = Array.isArray(args.image_paths) ? args.image_paths.map(String).map((s) => s.trim()).filter(Boolean) : []
      if (!paths.length) return { ok: false, error: '缺少 image_paths 参数' }
      const prompt = args.prompt ? String(args.prompt).trim() : ''
      const mode = args.mode === 'brief' ? 'brief' : 'detail'
      const nc = args.new_conversation === false ? 'false' : 'true'
      const script = BASE + '/doubao-identify.js'
      const esc = (s) => '"' + String(s).replace(/"/g, '\\"') + '"'
      const parts = paths.map((p) => esc(p))
      if (prompt) parts.push('--prompt', esc(prompt))
      if (mode === 'brief') parts.push('--mode', 'brief')
      parts.push('--new-conversation', nc)
      const cmd = 'node ' + esc(script) + ' ' + parts.join(' ')
      const request = {
        command: cmd,
        workdir: BASE,
        timeoutMs: 330000,
        signal: exec.signal,
        stdoutMaxBytes: 30000,
      }
      if (sandboxPolicySvc !== undefined) {
        const policy = sandboxPolicySvc.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
        if (policy && policy.mode !== undefined && policy.mode !== 'read-only') {
          request.sandboxPolicy = policy
        }
      }
      const spec = shell.resolve(request)
      const result = await shell.run(spec)
      if (result.aborted) {
        const err = new Error('tool call aborted')
        err.name = 'AbortError'
        throw err
      }
      const stdout = (result.stdout && result.stdout.text) || ''
      if (result.exitCode !== 0) {
        return { ok: false, error: '执行失败 exit=' + result.exitCode + ' stderr=' + ((result.stderr && result.stderr.text) || '').slice(0, 300) }
      }
      const lines = stdout.trim().split('\n')
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim()
        if (!line) continue
        try {
          const parsed = JSON.parse(line)
          if (parsed && typeof parsed === 'object' && 'ok' in parsed) return parsed
        } catch (e) { /* keep scanning */ }
      }
      return { ok: false, error: '解析输出失败: ' + stdout.slice(0, 300) }
    },
  })

  const dispose = ctx.tools.register(tool)
  console.log('[doubao-vision] doubao_vision tool registered')
  ctx.effect(() => dispose)
}

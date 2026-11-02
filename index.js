/**
 * Host half of the idea-review bundle.
 *
 * Three contributions, all registered as effects so unloading the row removes
 * them:
 *  - the `idea-review` skill, so the agent knows the workflow;
 *  - the `idea_review` tool, which drives the deterministic steps of the
 *    bundled python scripts (`skill/scripts/ir.py`, `skill/scripts/report.py`);
 *  - three HTTP routes that back the Web panel.
 *
 * Only `node:` builtins are imported on purpose: a profile-installed bundle
 * cannot resolve the dsh installation's packages, so this file avoids
 * `defineTool`, `schemastery` and any `@deepseek-ai/*` import. Consequently it
 * exports no `Config`; configuration is read defensively from the row's
 * `config` and every field has a default.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runCommand } from './lib/py.js'
import { defaultStateDir, findRun, indexPathFor, listRuns, makeRunKey, summarizeRun, upsertRun } from './lib/runs.js'

const SKILL_DIR = fileURLToPath(new URL('./skill/', import.meta.url)).replace(/[/\\]+$/, '')
const SKILL_FILE = path.join(SKILL_DIR, 'SKILL.md')
const IR_SCRIPT = path.join(SKILL_DIR, 'scripts', 'ir.py')
const REPORT_SCRIPT = path.join(SKILL_DIR, 'scripts', 'report.py')

const ACTIONS = ['init', 'next', 'search', 'fetch', 'review', 'reviewers', 'report']
const WRITERS = ['anthropic', 'openai', 'google', 'tencent', 'other']

const DEFAULT_CONFIG = {
  /** Interpreter used to run the bundled scripts. "uv run" also works. */
  python: 'python3',
  /** Where the run index lives; empty means $DSH_HOME/idea-review. */
  stateDir: '',
  /** Per-invocation wall clock for the scripts, in seconds. */
  stepTimeoutSec: 1500,
}

/** Fallback when SKILL.md carries no frontmatter description. */
const SKILL_DESCRIPTION =
  '给一个还很粗糙的研究 idea 做文献调研和可行性审查：拆检索词，在 Semantic Scholar、arXiv、OpenAlex 上检索，' +
  '按摘要初筛，下载开放获取的全文精读并评质量，找出有论文证据的空白，写 proposal，再请别家的模型做元评审，' +
  '最后出一份 HTML 报告。用户说"这个 idea 有没有人做过""帮我查查相关文献""这个研究想法靠不靠谱""找找这个方向还有什么空白"' +
  '"把这个想法写成 proposal 再找人挑毛病"，或者 review my research idea、is this idea novel、find literature gaps 时，都用这个 skill。'

const TOOL_DESCRIPTION = [
  'Drive the idea-review pipeline for one research idea: an auditable literature survey plus independent peer review.',
  'Deterministic work (search, full-text download, progress checks, peer-review calls, HTML report) runs in bundled scripts;',
  'the analytical work (decompose queries, screen, read papers, find gaps, write proposals, chair reviews) is yours.',
  '`init` creates a run directory and returns its absolute path; pass that path as `run` to every later action.',
  '`next` is the loop driver: it validates the files written so far and returns what to do next; follow it instead of guessing.',
  'It stops on weak evidence (fewer than 3 full texts read, or all low quality) unless `force` is set — do not force without the user asking.',
  'Writes notes as JSON files inside the run directory. `report` renders a self-contained HTML report and returns its URL.',
  'Peer review calls other vendors\' local CLI models (codex, gemini, claude, codebuddy) or an OpenAI-compatible endpoint;',
  'run `reviewers` first to see what this machine has, and use `dump` when none is available so the reviews can be delegated instead.',
].join(' ')

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ACTIONS,
      description:
        'init: create the run. next: validate progress and get the next step. search: run the queries from 01_plan.json. ' +
        'fetch: download full texts for screened candidates. reviewers: list available peer-review models. ' +
        'review: call them for meta review. report: render the HTML report.',
    },
    run: {
      type: 'string',
      description:
        'Run directory: absolute, or relative to the session working directory. Required for every action except `init` (generated) and `reviewers`.',
    },
    idea: { type: 'string', description: 'init only: the user\'s research idea, verbatim, one or two sentences.' },
    lang: {
      type: 'string',
      enum: ['zh', 'en'],
      description: 'init only: language of notes, proposals and the report. Defaults to zh; match the language the user writes in.',
    },
    refs: { type: 'integer', description: 'init only: how many full texts to read closely (default 8).' },
    writer: {
      type: 'string',
      enum: WRITERS,
      description:
        'init only: which model family writes the proposals, so peer review excludes it. This harness is neither anthropic, openai, google nor tencent: use other unless the model is known.',
    },
    writerModel: { type: 'string', description: 'init only: the writer model name recorded in the report.' },
    queries: {
      type: 'array',
      items: { type: 'string' },
      description: 'search only: English search queries to use instead of the ones in 01_plan.json.',
    },
    papersDir: {
      type: 'string',
      description: 'search only: directory of PDFs the user already has; they are read as L01, L02, … and do not use up `refs`.',
    },
    reviewers: {
      type: 'array',
      items: { type: 'string' },
      description: 'review only: reviewer names, optionally as `name:model` (e.g. codex:gpt-5). Defaults to every available reviewer.',
    },
    timeoutSec: { type: 'integer', description: 'review only: per-call timeout for one reviewer, default 900.' },
    force: { type: 'boolean', description: 'next only: continue despite weak evidence. Set it only when the user said to.' },
    again: { type: 'boolean', description: 'search only: discard existing candidates and search again.' },
    dump: {
      type: 'boolean',
      description: 'review only: only write the review materials under review_prompts/ instead of calling a model.',
    },
  },
  required: ['action'],
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'action', 'output', 'message'],
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    runDir: { type: 'string' },
    exitCode: { type: 'integer' },
    output: { type: 'string' },
    message: { type: 'string' },
    reportUrl: { type: 'string' },
  },
}

export const name = 'idea-review'
export const inject = ['tools', 'skills', 'webServer']

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULT_CONFIG, ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}) }
  const stateDir = config.stateDir ? path.resolve(String(config.stateDir)) : defaultStateDir()
  const indexPath = indexPathFor(stateDir)

  registerSkill(ctx)
  registerTool(ctx, { config, indexPath })
  registerRoutes(ctx, { indexPath })
}

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

function registerSkill(ctx) {
  let source = ''
  try {
    source = fs.readFileSync(SKILL_FILE, 'utf8')
  } catch (error) {
    ctx.logger?.warn?.(`idea-review: 读不到 ${SKILL_FILE}，跳过技能注册（${error?.message ?? error}）`)
    return
  }
  const { description, body } = splitFrontmatter(source)
  ctx.effect(() =>
    ctx.skills.register({
      name: 'idea-review',
      description: description || SKILL_DESCRIPTION,
      content: body.trim(),
      source: 'bundled',
      resourceBase: { kind: 'directory', path: SKILL_DIR },
    }),
  )
}

function splitFrontmatter(source) {
  const text = String(source).replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) return { description: '', body: text }
  const end = text.indexOf('\n---', 4)
  if (end < 0) return { description: '', body: text }
  const header = text.slice(3, end)
  const body = text.slice(end + 4).replace(/^\r?\n/, '')
  const line = header.split(/\r?\n/).find(item => /^description\s*:/.test(item.trim()))
  let description = ''
  if (line) {
    description = line
      .replace(/^description\s*:/, '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
  }
  return { description, body }
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

function registerTool(ctx, { config, indexPath }) {
  ctx.effect(() =>
    ctx.tools.register({
      name: 'idea_review',
      description: TOOL_DESCRIPTION,
      parameters: PARAMETERS,
      output: {
        schema: OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
      },
      timeoutMs: (Math.max(60, numberOr(config.stepTimeoutSec, 1500)) + 120) * 1000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        return executeAction(ctx, { config, indexPath }, args && typeof args === 'object' ? args : {}, exec)
      },
    }),
  )
}

async function executeAction(ctx, { config, indexPath }, args, exec) {
  const action = ACTIONS.includes(args.action) ? args.action : ''
  const base = { action: action || String(args.action ?? ''), output: '', message: '' }
  if (!action) {
    return { ...base, ok: false, exitCode: 2, message: `未知 action。可用：${ACTIONS.join(' / ')}` }
  }

  const cwd = await resolveWorkingDirectory(ctx, exec)
  const skillCheck = checkSkill()
  if (skillCheck) return { ...base, ok: false, exitCode: 2, message: skillCheck }

  let runDir = null
  if (action !== 'reviewers') {
    const requested = typeof args.run === 'string' ? args.run.trim() : ''
    if (requested) runDir = path.resolve(cwd, requested)
    else if (action === 'init') runDir = nextRunDirectory(cwd, args.idea)
    else {
      return {
        ...base,
        ok: false,
        exitCode: 2,
        message: '缺少 run：所有 action（reviewers 除外）都要传运行目录。第一次用 action=init 拿到 runDir，之后原样传回来。',
      }
    }
  }

  const timeoutMs = Math.max(60, numberOr(config.stepTimeoutSec, 1500)) * 1000
  const invocation = buildInvocation({ action, args, runDir, cwd, config })
  const result = await runCommand({
    command: invocation.command,
    args: invocation.args,
    cwd,
    timeoutMs,
    signal: exec?.signal,
    // report.py imports ir.py, so without this Python writes __pycache__ next to
    // the shipped scripts (the bundle directory is not ours to pollute).
    env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' },
  })

  const ok = result.code === 0
  const message = ok ? '' : (lastLines(result.stderr) || lastLines(result.stdout) || `脚本以退出码 ${result.code} 结束。`)
  const value = {
    ok,
    action,
    exitCode: result.code,
    output: result.stdout.trim(),
    message,
  }
  if (runDir) value.runDir = runDir

  // Record the run so the Web panel lists it. Bookkeeping must never fail the call.
  if (runDir) {
    try {
      const recorded = recordRun(indexPath, runDir, action)
      if (action === 'report' && ok) value.reportUrl = reportUrlFor(ctx, recorded?.key ?? makeRunKey(runDir))
    } catch (error) {
      value.message = [value.message, `(运行记录没写成功：${error?.message ?? error})`].filter(Boolean).join(' ')
    }
  }
  if (result.timedOut) {
    value.ok = false
    value.message = `脚本超过 ${Math.round(timeoutMs / 1000)} 秒被终止。review 这一步很慢，可以先把 timeoutSec 调小，或者改用 dump。`
  }
  return value
}

function buildInvocation({ action, args, runDir, cwd, config }) {
  const command = String(config.python || 'python3')
  if (action === 'report') {
    return { command, args: [REPORT_SCRIPT, runDir] }
  }
  const argv = [IR_SCRIPT]
  switch (action) {
    case 'init': {
      argv.push('init', runDir, '--writer', WRITERS.includes(args.writer) ? args.writer : 'other')
      argv.push('--lang', args.lang === 'en' ? 'en' : 'zh')
      if (typeof args.idea === 'string' && args.idea.trim()) argv.push('--idea', args.idea.trim())
      if (Number.isFinite(args.refs)) argv.push('--refs', String(Math.trunc(args.refs)))
      if (typeof args.writerModel === 'string' && args.writerModel.trim()) argv.push('--writer-model', args.writerModel.trim())
      break
    }
    case 'next': {
      argv.push('next', runDir)
      if (args.force === true) argv.push('--force')
      break
    }
    case 'search': {
      argv.push('search', runDir)
      for (const query of Array.isArray(args.queries) ? args.queries : []) {
        if (typeof query === 'string' && query.trim()) argv.push('--query', query.trim())
      }
      if (typeof args.papersDir === 'string' && args.papersDir.trim()) {
        argv.push('--papers-dir', path.resolve(cwd, args.papersDir.trim()))
      }
      if (args.again === true) argv.push('--again')
      break
    }
    case 'fetch': {
      argv.push('fetch', runDir)
      break
    }
    case 'reviewers': {
      argv.push('reviewers')
      if (WRITERS.includes(args.writer)) argv.push('--writer', args.writer)
      break
    }
    case 'review': {
      argv.push('review', runDir)
      for (const reviewer of Array.isArray(args.reviewers) ? args.reviewers : []) {
        if (typeof reviewer === 'string' && reviewer.trim()) argv.push('--reviewer', reviewer.trim())
      }
      if (Number.isFinite(args.timeoutSec)) argv.push('--timeout', String(Math.trunc(args.timeoutSec)))
      if (args.dump === true) argv.push('--dump')
      break
    }
    default:
      break
  }
  return { command, args: argv }
}

function checkSkill() {
  if (!fs.existsSync(IR_SCRIPT)) return `找不到 ${IR_SCRIPT}：这个 bundle 的 skill/scripts 不完整，需要重新安装插件。`
  if (!fs.existsSync(REPORT_SCRIPT)) return `找不到 ${REPORT_SCRIPT}：这个 bundle 的 skill/scripts 不完整，需要重新安装插件。`
  return ''
}

/** `ir.py init` wants a run directory; derive one when the model did not pass it. */
function nextRunDirectory(cwd, idea) {
  const stamp = new Date().toISOString().slice(0, 10)
  const slug = slugFrom(idea)
  const base = path.join(cwd, 'idea-review-runs', `${stamp}-${slug}`)
  let candidate = base
  for (let index = 2; fs.existsSync(candidate) && index < 50; index += 1) candidate = `${base}-${index}`
  return candidate
}

function slugFrom(idea) {
  const words = String(idea ?? '')
    .toLowerCase()
    .match(/[a-z][a-z0-9]+/g)
  return (words ?? []).slice(0, 4).join('-') || 'idea'
}

function recordRun(indexPath, runDir, action) {
  const entry = {
    key: makeRunKey(runDir),
    dir: runDir,
    lastAction: action,
  }
  const existing = findRun(indexPath, entry.key)
  const stored = existing ? { ...existing, ...entry } : entry
  const summary = summarizeRun(stored)
  return upsertRun(indexPath, { ...summary, lastAction: action })
}

function reportUrlFor(ctx, key) {
  let origin = ''
  try {
    origin = ctx.webServer.getOrigin()
  } catch {
    origin = ''
  }
  return `${origin}/idea-review/report/${encodeURIComponent(key)}`
}

async function resolveWorkingDirectory(ctx, exec) {
  const workingDirectory = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined
  if (workingDirectory && exec?.agent) {
    try {
      return await workingDirectory.ensure(exec.agent, exec.signal)
    } catch {
      /* fall through to the process directory */
    }
  }
  return process.cwd()
}

function renderResult(value) {
  const head = value.ok ? `idea_review ${value.action} ok` : `idea_review ${value.action} 失败`
  const where = value.runDir ? `\nrun: ${value.runDir}` : ''
  const body = value.output ? `\n\n${value.output}` : ''
  const message = value.message ? `\n\n${value.message}` : ''
  const report = value.reportUrl ? `\n报告：${value.reportUrl}` : ''
  return `${head}${where}${report}${body}${message}`.trim()
}

function lastLines(text, count = 12) {
  const lines = String(text ?? '')
    .trim()
    .split(/\r?\n/)
    .filter(line => line.trim())
  return lines.slice(-count).join('\n')
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// ---------------------------------------------------------------------------
// HTTP routes for the Web panel
// ---------------------------------------------------------------------------

function registerRoutes(ctx, { indexPath }) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/idea-review/api/runs',
      handler: (req, res) => handleJson(req, res, () => ({ runs: listRuns(indexPath) })),
    }),
  )
  ctx.effect(() =>
    ctx.webServer.register({
      // The route table matches a prefix as `pathname === prefix || pathname.startsWith(prefix + '/')`,
      // so a prefix row never carries its own trailing slash; the exact row above wins for the list.
      kind: 'prefix',
      path: '/idea-review/api/runs',
      handler: (req, res) =>
        handleJson(req, res, () => {
          const key = decodeKey(req, '/idea-review/api/runs/')
          const entry = key ? findRun(indexPath, key) : null
          if (!entry) return { status: 404, value: { error: '没有这个运行。面板里的列表可能已经过期，刷新一次。' } }
          return { run: summarizeRun(entry) }
        }),
    }),
  )
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/idea-review/report',
      handler: (req, res) => handleReport(req, res, indexPath),
    }),
  )
}

function handleJson(req, res, produce) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  let payload
  try {
    payload = produce()
  } catch (error) {
    sendJson(res, 500, { error: String(error?.message ?? error) })
    return
  }
  const status = typeof payload?.status === 'number' ? payload.status : 200
  const value = payload && typeof payload === 'object' && 'value' in payload ? payload.value : payload
  sendJson(res, status, value)
}

function handleReport(req, res, indexPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'method not allowed', 'text/plain; charset=utf-8')
    return
  }
  const key = decodeKey(req, '/idea-review/report/')
  const entry = key ? findRun(indexPath, key) : null
  if (!entry) {
    sendText(res, 404, '没有这个运行。', 'text/plain; charset=utf-8')
    return
  }
  const file = path.join(path.resolve(entry.dir), 'report.html')
  let html
  try {
    html = fs.readFileSync(file, 'utf8')
  } catch {
    sendText(res, 404, '这个运行还没有生成报告。让 agent 先运行 idea_review action=report。', 'text/plain; charset=utf-8')
    return
  }
  sendText(res, 200, html, 'text/html; charset=utf-8', { 'cache-control': 'no-cache' })
}

function decodeKey(req, prefix) {
  let pathname = '/'
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  } catch {
    return ''
  }
  if (!pathname.startsWith(prefix)) return ''
  const raw = pathname.slice(prefix.length).replace(/\/+$/, '')
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return ''
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  sendText(res, status, body, 'application/json; charset=utf-8', { 'cache-control': 'no-store' })
}

function sendText(res, status, body, contentType, extraHeaders = {}) {
  try {
    res.writeHead(status, {
      'content-type': contentType,
      'content-length': Buffer.byteLength(body),
      ...extraHeaders,
    })
    res.end(body)
  } catch {
    /* the peer may already be gone */
  }
}

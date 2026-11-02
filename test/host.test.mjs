/**
 * Host-half regression test: fake Cordis context, real python scripts, real run
 * directory, real HTTP handlers. No Harness packages are involved, so it runs
 * with plain node:
 *
 *   cd dsh-idea-review && node test/host.test.mjs
 *
 * It exercises the same code path the installed plugin uses: skill registration,
 * tool registration, init -> next -> report, the run index, and the three HTTP
 * routes (including the host's exact-then-longest-prefix route matching).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BUNDLE = path.dirname(path.dirname(new URL(import.meta.url).pathname))
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-host-'))
process.chdir(work)

const captured = { skill: null, tool: null, routes: [] }
const ctx = {
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  logger: { warn: m => console.log('WARN', m), info: () => {}, error: m => console.log('ERR', m) },
  get() {
    return undefined
  },
  skills: { register(definition) { captured.skill = definition; return () => {} } },
  tools: { register(definition) { captured.tool = definition; return () => {} } },
  webServer: {
    register(route) { captured.routes.push(route); return () => {} },
    getOrigin: () => 'http://127.0.0.1:61898',
  },
}

const mod = await import(`${BUNDLE}/index.js`)
mod.apply(ctx, { stateDir: path.join(work, 'state'), finalReviewer: 'claude:opus-4.5' })

let failures = 0
const check = (label, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${condition ? '' : ` :: ${detail}`}`)
  if (!condition) failures += 1
}

check('skill registered', captured.skill?.name === 'idea-review')
check('skill has a body', typeof captured.skill?.content === 'string' && captured.skill.content.length > 500)
check('skill has a description', typeof captured.skill?.description === 'string' && captured.skill.description.length > 20)
check('skill resourceBase points at the shipped skill dir', captured.skill?.resourceBase?.kind === 'directory' && fs.existsSync(captured.skill.resourceBase.path))
check('tool registered', captured.tool?.name === 'idea_review')
check('tool parameters are an object schema with required action', captured.tool?.parameters?.type === 'object' && captured.tool.parameters.required.includes('action'))
const actionEnum = captured.tool?.parameters?.properties?.action?.enum ?? []
check('tool exposes the chair action', actionEnum.includes('chair'), actionEnum.join(','))
check('tool takes a finalReviewer parameter', Boolean(captured.tool?.parameters?.properties?.finalReviewer))
check('tool output render', typeof captured.tool?.output?.render === 'function')
check('three routes registered', captured.routes.length === 3, String(captured.routes.length))

const exec = { signal: undefined, agent: undefined }
const init = await captured.tool.execute({ action: 'init', idea: '让大模型代替真人填调查问卷', lang: 'zh', refs: 3 }, exec)
check('init ok', init.ok === true, init.message)
check('init reports an existing runDir', typeof init.runDir === 'string' && fs.existsSync(init.runDir))
check('init returns script output', typeof init.output === 'string' && init.output.length > 0)

// The final-review model comes from the plugin config unless the call overrides it.
const initMeta = JSON.parse(fs.readFileSync(path.join(init.runDir, 'meta.json'), 'utf8'))
check('init records the configured final reviewer', initMeta.final_review?.reviewer === 'claude:opus-4.5', JSON.stringify(initMeta.final_review))
const override = await captured.tool.execute({ action: 'init', idea: '另一个 idea', run: path.join(work, 'override-run'), finalReviewer: 'codex:gpt-5.5' }, exec)
const overrideMeta = JSON.parse(fs.readFileSync(path.join(override.runDir, 'meta.json'), 'utf8'))
check('init parameter overrides the config', overrideMeta.final_review?.reviewer === 'codex:gpt-5.5', JSON.stringify(overrideMeta.final_review))

const chairTooEarly = await captured.tool.execute({ action: 'chair', run: init.runDir }, exec)
check('chair before proposals fails cleanly', chairTooEarly.ok === false && chairTooEarly.message.includes('proposal'), chairTooEarly.message)
const chairNoRun = await captured.tool.execute({ action: 'chair' }, exec)
check('chair without run fails cleanly', chairNoRun.ok === false && chairNoRun.message.includes('run'), chairNoRun.message)

const next = await captured.tool.execute({ action: 'next', run: init.runDir }, exec)
check('next ok', next.ok === true, next.message)
check('next render mentions the plan file', captured.tool.output.render({}, next)[0].text.includes('01_plan'))

const report = await captured.tool.execute({ action: 'report', run: init.runDir }, exec)
check('report ok', report.ok === true, report.message)
check('report returns an absolute url', typeof report.reportUrl === 'string' && report.reportUrl.includes('/idea-review/report/'))

const indexFile = path.join(work, 'state', 'runs.json')
check('run index written', fs.existsSync(indexFile))
const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
check('index holds both runs', index.runs.length === 2, JSON.stringify(index.runs.map(r => r.dir)))
check('index summary has counts', typeof index.runs[0].counts?.candidates === 'number')
check('index records the last action', index.runs[0].lastAction === 'report', index.runs[0].lastAction)

const call = (route, url) =>
  new Promise(resolve => {
    const res = {
      status: 0,
      headers: null,
      body: '',
      writeHead(status, headers) { this.status = status; this.headers = headers },
      end(body) { this.body = body ?? ''; resolve(this) },
    }
    route.handler({ method: 'GET', url }, res)
  })

const listRoute = captured.routes.find(r => r.kind === 'exact' && r.path === '/idea-review/api/runs')
const detailRoute = captured.routes.find(r => r.kind === 'prefix' && r.path === '/idea-review/api/runs')
const reportRoute = captured.routes.find(r => r.kind === 'prefix' && r.path === '/idea-review/report')

const list = await call(listRoute, '/idea-review/api/runs')
check('list route 200', list.status === 200, `${list.status} ${list.body}`)
const listJson = JSON.parse(list.body)
const mainRun = listJson.runs?.find(run => run.dir === path.resolve(init.runDir))
check('list route returns the run', Boolean(mainRun) && mainRun.idea.includes('大模型'), JSON.stringify(listJson.runs?.map(r => r.idea)))
const key = mainRun?.key

const detail = await call(detailRoute, `/idea-review/api/runs/${encodeURIComponent(key)}`)
check('detail route 200', detail.status === 200, `${detail.status}`)
check('detail has a file list', Array.isArray(JSON.parse(detail.body).run?.files))
check('unknown key 404', (await call(detailRoute, '/idea-review/api/runs/nope-deadbeef')).status === 404)

const page = await call(reportRoute, `/idea-review/report/${encodeURIComponent(key)}`)
check('report route 200 html', page.status === 200 && /text\/html/.test(page.headers['content-type']))
check('report html is self-contained', page.body.includes('<html') && page.body.includes('<style'))
check('unknown report 404', (await call(reportRoute, '/idea-review/report/nope-deadbeef')).status === 404)

// Mirror the host route table: exact first, then longest prefix.
function resolveRoute(pathname) {
  const exact = captured.routes.find(route => route.kind === 'exact' && route.path === pathname)
  if (exact) return exact
  let best
  for (const route of captured.routes) {
    if (route.kind !== 'prefix') continue
    if (pathname !== route.path && !pathname.startsWith(`${route.path}/`)) continue
    if (!best || route.path.length > best.path.length) best = route
  }
  return best
}
check('list path resolves to the exact route', resolveRoute('/idea-review/api/runs')?.kind === 'exact')
check('detail path resolves to the runs prefix', resolveRoute(`/idea-review/api/runs/${key}`)?.path === '/idea-review/api/runs')
check('report path resolves to the report prefix', resolveRoute(`/idea-review/report/${key}`)?.path === '/idea-review/report')

const bad = await captured.tool.execute({ action: 'nope' }, exec)
check('unknown action fails cleanly', bad.ok === false && bad.message.includes('action'))
const noRun = await captured.tool.execute({ action: 'next' }, exec)
check('next without run fails cleanly', noRun.ok === false && noRun.message.includes('run'))

fs.rmSync(work, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exitCode = failures === 0 ? 0 : 1

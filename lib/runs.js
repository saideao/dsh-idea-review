/**
 * Run index and run summaries for the idea-review panel.
 *
 * A run is a directory produced by `ir.py init` (see skill/SKILL.md). This module
 * keeps a small index of runs the tool has touched and derives the summary the
 * Web panel renders. Everything here is defensive: a damaged or half-written run
 * directory must never break the panel or the tool.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const INDEX_VERSION = 1
const MAX_RUNS = 200
/** Files larger than this are counted but not parsed for the panel. */
const MAX_PARSE_BYTES = 12 * 1024 * 1024

/** `$DSH_HOME/idea-review`, or `~/.dsh/idea-review` when the variable is unset. */
export function defaultStateDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'idea-review')
}

export function indexPathFor(stateDir) {
  return path.join(stateDir, 'runs.json')
}

/** Stable id for one run directory: folder name plus a short path hash. */
export function makeRunKey(dir) {
  const absolute = path.resolve(dir)
  const hash = crypto.createHash('sha1').update(absolute).digest('hex').slice(0, 8)
  const base = path.basename(absolute).replace(/[^a-zA-Z0-9._-]+/g, '-') || 'run'
  return `${base}-${hash}`
}

export function readIndex(indexPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    const runs = Array.isArray(parsed?.runs) ? parsed.runs.filter(entry => entry && typeof entry.dir === 'string') : []
    return { version: INDEX_VERSION, runs }
  } catch {
    return { version: INDEX_VERSION, runs: [] }
  }
}

function writeIndex(indexPath, index) {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true })
  const temp = `${indexPath}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify({ version: INDEX_VERSION, runs: index.runs }, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, indexPath)
}

/**
 * Record (or refresh) one run. The stored entry carries the derived summary so
 * listing many runs does not re-read every JSON file on each panel refresh.
 * @returns the stored entry
 */
export function upsertRun(indexPath, run) {
  const index = readIndex(indexPath)
  const entry = {
    ...run,
    key: run.key || makeRunKey(run.dir),
    dir: path.resolve(run.dir),
    updatedAt: run.updatedAt || new Date().toISOString(),
  }
  const runs = index.runs.filter(item => path.resolve(item.dir) !== entry.dir && item.key !== entry.key)
  runs.unshift(entry)
  writeIndex(indexPath, { version: INDEX_VERSION, runs: runs.slice(0, MAX_RUNS) })
  return entry
}

export function findRun(indexPath, key) {
  return readIndex(indexPath).runs.find(entry => entry.key === key) ?? null
}

/** Summaries with `hasReport` / `reportMtime` refreshed from the filesystem. */
export function listRuns(indexPath) {
  return readIndex(indexPath).runs.map(entry => {
    const report = statOrNull(path.join(entry.dir, 'report.html'))
    return {
      ...normalizeEntry(entry),
      hasReport: Boolean(report),
      reportMtime: report ? report.mtime.toISOString() : null,
    }
  })
}

/** Full summary of one run, read from disk. */
export function summarizeRun(entry) {
  const dir = path.resolve(entry.dir)
  const meta = readJson(path.join(dir, 'meta.json'), null) ?? {}
  const candidates = asArray(readJson(path.join(dir, '02_candidates.json'), null))
  const screen = asArray(readJson(path.join(dir, '03_screen.json'), null))
  const fulltexts = readJson(path.join(dir, '04_fulltext.json'), null)
  const reviews = asArray(readJson(path.join(dir, '05_reviews.json'), null))
  const landscape = readJson(path.join(dir, '06_landscape.json'), null) ?? {}
  const seeds = readJson(path.join(dir, '07_seeds.json'), null) ?? {}
  const proposals = asArray(readJson(path.join(dir, '08_proposals.json'), null))
  const peerReviews = asArray(readJson(path.join(dir, '09_meta_reviews.json'), null))
  const chair = asArray(readJson(path.join(dir, '10_chair.json'), null))

  const tiers = qualityTiers(reviews, dir)
  const report = statOrNull(path.join(dir, 'report.html'))

  return normalizeEntry({
    ...entry,
    idea: str(meta.idea) || entry.idea || '',
    lang: meta.lang === 'en' ? 'en' : meta.lang === 'zh' ? 'zh' : entry.lang === 'en' ? 'en' : 'zh',
    createdAt: str(meta.created) || entry.createdAt || null,
    counts: {
      candidates: candidates.length,
      screened: screen.length,
      fulltexts: countFulltexts(fulltexts),
      notes: tiers.total,
      gaps: asArray(landscape.gaps).length,
      seeds: asArray(seeds.seeds).length,
      proposals: proposals.filter(item => item && item.proposal).length,
      peerReviews: peerReviews.filter(item => item && item.review).length,
      chair: chair.length,
    },
    quality: { high: tiers.high, medium: tiers.medium, low: tiers.low },
    hasReport: Boolean(report),
    reportMtime: report ? report.mtime.toISOString() : null,
    files: listFiles(dir),
  })
}

function normalizeEntry(entry) {
  return {
    key: str(entry.key) || makeRunKey(entry.dir),
    dir: path.resolve(str(entry.dir)),
    idea: str(entry.idea),
    lang: entry.lang === 'en' ? 'en' : 'zh',
    createdAt: entry.createdAt ?? null,
    updatedAt: entry.updatedAt ?? null,
    lastAction: entry.lastAction ?? null,
    counts: {
      candidates: num(entry.counts?.candidates),
      screened: num(entry.counts?.screened),
      fulltexts: num(entry.counts?.fulltexts),
      notes: num(entry.counts?.notes),
      gaps: num(entry.counts?.gaps),
      seeds: num(entry.counts?.seeds),
      proposals: num(entry.counts?.proposals),
      peerReviews: num(entry.counts?.peerReviews),
      chair: num(entry.counts?.chair),
    },
    quality: {
      high: num(entry.quality?.high),
      medium: num(entry.quality?.medium),
      low: num(entry.quality?.low),
    },
    hasReport: Boolean(entry.hasReport),
    reportMtime: entry.reportMtime ?? null,
    files: Array.isArray(entry.files) ? entry.files : [],
  }
}

function qualityTiers(reviews, dir) {
  const tiers = { high: 0, medium: 0, low: 0, total: 0 }
  const seen = new Set()
  for (const item of reviews) {
    const tier = item?.review?.quality?.tier
    if (item?.paper_id) seen.add(item.paper_id)
    countTier(tiers, tier)
  }
  // Notes may exist before `next` folds them into 05_reviews.json.
  for (const name of readdirSafe(path.join(dir, 'notes'))) {
    if (!name.endsWith('.json')) continue
    const paperId = name.slice(0, -'.json'.length)
    if (seen.has(paperId)) continue
    const note = readJson(path.join(dir, 'notes', name), null)
    if (note) countTier(tiers, note?.quality?.tier)
  }
  return tiers
}

function countTier(tiers, tier) {
  if (tier === 'high' || tier === 'medium' || tier === 'low') {
    tiers[tier] += 1
    tiers.total += 1
  }
}

function countFulltexts(fulltexts) {
  if (!fulltexts || typeof fulltexts !== 'object') return 0
  return Object.values(fulltexts).filter(item => item && item.status === 'ok').length
}

function listFiles(dir) {
  const names = []
  for (const name of readdirSafe(dir)) {
    if (name.startsWith('.')) continue
    names.push(name)
  }
  const papers = readdirSafe(path.join(dir, 'papers')).filter(name => name.toLowerCase().endsWith('.pdf')).length
  const texts = readdirSafe(path.join(dir, 'text')).length
  const notes = readdirSafe(path.join(dir, 'notes')).filter(name => name.endsWith('.json')).length
  const summary = []
  if (papers > 0) summary.push(`papers/ (${papers} PDF)`)
  if (texts > 0) summary.push(`text/ (${texts})`)
  if (notes > 0) summary.push(`notes/ (${notes})`)
  return [...summary, ...names.sort()].slice(0, 40)
}

function readdirSafe(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function statOrNull(file) {
  try {
    return fs.statSync(file)
  } catch {
    return null
  }
}

function readJson(file, fallback) {
  try {
    const info = fs.statSync(file)
    if (!info.isFile() || info.size > MAX_PARSE_BYTES) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function str(value) {
  return typeof value === 'string' ? value : ''
}

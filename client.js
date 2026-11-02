/**
 * dsh-idea-review — Client half.
 *
 * Registers two contributions for the Host's `idea_review` runs:
 *   - `sidebar.panellist` icon (id `idea-review`, order 20) that opens the page
 *   - `main` page (key `idea-review`) listing runs and showing one run's detail
 *
 * Data comes from the Host HTTP routes declared in DESIGN.md:
 *   GET /idea-review/api/runs        -> { runs: RunSummary[] }
 *   GET /idea-review/api/runs/<key>  -> { run: RunSummary }
 *   GET /idea-review/report/<key>    -> self-contained report HTML
 * Every RunSummary also carries the optional `final` meta-review block.
 *
 * Constraints (DESIGN.md "硬性约束"): only `react` may be required, every visible
 * string lives in the zh/en dictionaries below, and all styling uses theme tokens.
 * Styles ship as a `<style>` React element rendered inside the page, so unmounting
 * removes them and nothing is appended to the document outside the component tree.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-idea-review',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement

    const NS = 'idea-review'
    const API_RUNS = '/idea-review/api/runs'
    const REPORT_BASE = '/idea-review/report/'
    const COPY_FEEDBACK_MS = 1600

    /** Simplified Chinese copy. Key set is the source of truth. */
    const ZH = {
      'panel': '想法评审',
      'title': '想法评审',
      'hint.title': '怎么开始',
      'hint.body': '跟 agent 说：「用 idea-review 看看这个 idea：……」',
      'refresh': '刷新',
      'list.count': '共 {count} 条',
      'loading.list': '正在加载运行…',
      'loading.detail': '正在加载详情…',
      'error.title': '加载失败',
      'error.list': '无法获取运行列表，请确认 Host 插件已启用。',
      'error.detail': '无法获取这次运行的详情。',
      'error.refresh': '刷新失败，显示的是上一次的数据。',
      'retry': '重试',
      'empty.title': '还没有运行记录',
      'empty.body': '让 agent 用 idea-review 跑一次，结果会出现在这里。',
      'row.noIdea': '（未命名想法）',
      'report.yes': '有报告',
      'report.no': '无报告',
      'lang.zh': '中文',
      'lang.en': '英文',
      'quality.summary': '质量：高 {high} · 中 {medium} · 低 {low}',
      'detail.title': '运行详情',
      'detail.counts': '计数',
      'detail.quality': '质量分布',
      'detail.info': '信息',
      'detail.lang': '语言',
      'detail.created': '创建时间',
      'detail.updated': '更新时间',
      'detail.lastAction': '最近动作',
      'detail.dir': '运行目录',
      'final.title': '最终评审',
      'final.byline': '由 {byline} 综合',
      'final.generatedAt': '生成于 {time}',
      'final.sameFamily': '与 proposal 写作出自同一家模型厂商，独立性有限。',
      'final.failed': '最终评审失败',
      'final.failedNote': '最终评审没有完成：{error}',
      'final.empty': '（终审没有给出结论）',
      'action.openReport': '打开报告',
      'action.copyDir': '复制运行目录',
      'action.copied': '已复制',
      'action.close': '收起详情',
      'count.candidates': '候选',
      'count.fulltexts': '精读',
      'count.notes': '笔记',
      'count.gaps': '空白',
      'count.seeds': '种子',
      'count.proposals': '提案',
      'count.peerReviews': '评审',
      'quality.high': '高',
      'quality.medium': '中',
      'quality.low': '低',
      'none': '暂无',
      'date.locale': 'zh-CN',
    }

    /** English copy, key-identical to ZH. */
    const EN = {
      'panel': 'Idea Review',
      'title': 'Idea Review',
      'hint.title': 'How to start',
      'hint.body': 'Tell the agent: "Use idea-review to review this idea: …"',
      'refresh': 'Refresh',
      'list.count': '{count} total',
      'loading.list': 'Loading runs…',
      'loading.detail': 'Loading details…',
      'error.title': 'Could not load',
      'error.list': 'The run list could not be fetched. Check that the Host plugin is enabled.',
      'error.detail': 'This run could not be loaded.',
      'error.refresh': 'Refresh failed; showing the previous data.',
      'retry': 'Retry',
      'empty.title': 'No runs yet',
      'empty.body': 'Ask the agent to run idea-review; results will show up here.',
      'row.noIdea': '(Untitled idea)',
      'report.yes': 'Report',
      'report.no': 'No report',
      'lang.zh': 'Chinese',
      'lang.en': 'English',
      'quality.summary': 'Quality: high {high} · medium {medium} · low {low}',
      'detail.title': 'Run details',
      'detail.counts': 'Counts',
      'detail.quality': 'Quality',
      'detail.info': 'Details',
      'detail.lang': 'Language',
      'detail.created': 'Created',
      'detail.updated': 'Updated',
      'detail.lastAction': 'Last action',
      'detail.dir': 'Run directory',
      'final.title': 'Final review',
      'final.byline': 'Written by {byline}',
      'final.generatedAt': 'Generated {time}',
      'final.sameFamily': 'Shares the proposal writer’s vendor, so its independence is limited.',
      'final.failed': 'Final review failed',
      'final.failedNote': 'The final review did not complete: {error}',
      'final.empty': '(The final review returned no verdict.)',
      'action.openReport': 'Open report',
      'action.copyDir': 'Copy run directory',
      'action.copied': 'Copied',
      'action.close': 'Close details',
      'count.candidates': 'Candidates',
      'count.fulltexts': 'Full texts',
      'count.notes': 'Notes',
      'count.gaps': 'Gaps',
      'count.seeds': 'Seeds',
      'count.proposals': 'Proposals',
      'count.peerReviews': 'Peer reviews',
      'quality.high': 'High',
      'quality.medium': 'Medium',
      'quality.low': 'Low',
      'none': 'None',
      'date.locale': 'en',
    }

    const PAGE_CSS = `
.irx_page{width:100%;min-width:0;height:100%;min-height:0;display:flex;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:1.6}
.irx_listPane{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}
.irx_scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.irx_content{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.irx_heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px;padding-top:28px}
[data-platform=darwin] .irx_heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.irx_headingTitle{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;min-width:0}
.irx_headingTitle h1{margin:0;min-width:0;max-width:100%;font-size:20px;font-weight:500;line-height:28px}
.irx_runCount{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;white-space:nowrap}
.irx_hint{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;margin:0 0 18px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px}
.irx_hintLabel{flex:none;color:var(--dsw-alias-label-primary);font-weight:500}
.irx_hintText{min-width:0;overflow-wrap:anywhere}
.irx_notice{margin:0 0 12px;color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;overflow-wrap:anywhere}
.irx_list{list-style:none;display:flex;flex-direction:column;gap:2px;margin:0;padding:0}
.irx_rowItem{margin:0;padding:0;min-width:0}
.irx_row{display:flex;flex-direction:column;gap:2px;width:100%;padding:8px 10px;text-align:left;white-space:normal;color:inherit;font:inherit;background:transparent;border:0;border-radius:var(--dsw-radius-md);cursor:pointer;transition:background-color .12s}
.irx_row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.irx_rowActive,.irx_rowActive:hover{background:var(--dsw-alias-interactive-bg-hover)}
.irx_row:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.irx_rowTop{display:flex;align-items:center;gap:10px;min-width:0}
.irx_rowTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;line-height:22px}
.irx_rowMetaRow{display:flex;align-items:center;gap:12px;min-width:0}
.irx_rowMeta{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px}
.irx_pill{flex:none;display:inline-flex;align-items:center;gap:5px;height:19px;padding:0 7px;border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap}
.irx_dot{flex:none;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-caption)}
.irx_dotOn{background:var(--dsw-alias-state-success-primary)}
.irx_dotBusiness{background:var(--dsw-alias-state-business-primary)}
.irx_dotWarn{background:var(--dsw-alias-state-warn-primary)}
.irx_dotFail{background:var(--dsw-alias-state-error-primary)}
.irx_pillFinal{border-color:transparent;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-primary)}
.irx_pillWarn{border-color:transparent;background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-primary)}
.irx_pillFail{border-color:transparent;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.irx_qualityBar{display:flex;align-items:stretch;width:100%;height:8px;border-radius:4px;overflow:hidden;background:var(--dsw-alias-bg-skeleton)}
.irx_qualityBar>span{display:block;flex-basis:0;min-width:0}
.irx_qInline{flex:none;display:inline-flex;align-items:center;gap:10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;white-space:nowrap}
.irx_qItem{display:inline-flex;align-items:center;gap:4px}
.irx_dotHigh{background:var(--dsw-alias-state-success-primary)}
.irx_dotMedium{background:var(--dsw-alias-state-warn-primary)}
.irx_dotLow{background:var(--dsw-alias-state-error-primary)}
.irx_segHigh{background:var(--dsw-alias-state-success-primary)}
.irx_segMedium{background:var(--dsw-alias-state-warn-primary)}
.irx_segLow{background:var(--dsw-alias-state-error-primary)}
.irx_detail{display:flex;flex-direction:column;flex:0 0 46%;min-width:320px;max-width:560px;min-height:0;background:var(--dsw-alias-bg-base);border-left:.5px solid var(--dsw-alias-border-l4)}
.irx_detailHeader{display:flex;align-items:center;justify-content:space-between;gap:16px;height:44px;min-height:44px;padding:0 12px 0 24px;border-bottom:.5px solid var(--dsw-alias-border-l3)}
.irx_detailTitle{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);font-weight:500;line-height:20px}
.irx_detailScroll{flex:1;min-height:0;overflow:auto;padding:20px 24px 32px;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.irx_idea{margin:0 0 16px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px);line-height:1.6}
.irx_actions{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}
.irx_button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border:.5px solid transparent;border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;white-space:nowrap;cursor:pointer;transition:background-color .12s,color .12s,border-color .12s}
.irx_button:disabled{cursor:default}
.irx_button:focus-visible,.irx_iconButton:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.irx_primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}
.irx_primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.irx_primary:disabled{background:var(--dsw-alias-button-primary-dimmed);color:var(--dsw-alias-label-tertiary)}
.irx_ghost{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}
.irx_ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.irx_ghost:disabled{color:var(--dsw-alias-label-caption);border-color:var(--dsw-alias-border-l4)}
.irx_iconButton{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:14px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.irx_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.irx_card{margin:0 0 14px;padding:14px 16px;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l4));border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1))}
.irx_cardTitle{margin:0 0 10px;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);font-weight:400;line-height:20px}
.irx_cardTitleInline{margin:0}
.irx_finalHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px}
.irx_finalTime{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap}
.irx_finalBy{margin:0 0 8px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;overflow-wrap:anywhere}
.irx_finalVerdict{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px);line-height:1.6}
.irx_finalError{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px}
.irx_caveat{display:flex;align-items:flex-start;gap:6px;margin:10px 0 0;padding:6px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;overflow-wrap:anywhere}
.irx_caveat .irx_dot{margin-top:7px}
.irx_countGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:12px 16px}
.irx_countValue{font-size:16px;font-weight:500;line-height:24px;font-variant-numeric:tabular-nums}
.irx_countLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.irx_qualityLegend{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:12px}
.irx_legendItem{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px}
.irx_legendDot{flex:none;width:6px;height:6px;border-radius:50%}
.irx_legendValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.irx_infoRow{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:.5px solid var(--dsw-alias-border-l3);font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px}
.irx_infoRow:last-child{padding-bottom:0;border-bottom:0}
.irx_infoRowBlock{flex-direction:column;align-items:stretch;gap:2px}
.irx_infoLabel{flex:none;color:var(--dsw-alias-label-tertiary)}
.irx_infoValue{min-width:0;overflow-wrap:anywhere;text-align:right;color:var(--dsw-alias-label-primary)}
.irx_infoRowBlock .irx_infoValue{text-align:left;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;word-break:break-all}
.irx_state{display:flex;flex-direction:column;align-items:center;padding:44px 20px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size,14px);line-height:1.6}
.irx_stateGlyph{margin-bottom:12px;color:var(--dsw-alias-label-caption)}
.irx_stateTitle{margin:0 0 6px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size,14px);font-weight:500;line-height:1.6}
.irx_stateBody{max-width:420px;margin:0;overflow-wrap:anywhere}
.irx_stateAction{margin-top:16px}
.irx_skeletonList{display:flex;flex-direction:column;gap:2px}
.irx_skeletonRow{height:60px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-skeleton)}
.irx_skeletonBlock{height:12px;border-radius:6px;background:var(--dsw-alias-bg-skeleton)}
.irx_detailSkeleton{display:flex;flex-direction:column;gap:12px;padding-top:4px}
.irx_srOnly{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@keyframes irx_spin{to{transform:rotate(360deg)}}
.irx_spin{animation:irx_spin .9s linear infinite}
@media (prefers-reduced-motion:reduce){.irx_spin{animation:none}}
@media (max-width:820px){
.irx_pageHasDetail .irx_listPane{display:none}
.irx_detail{flex:1 1 auto;min-width:0;max-width:none;border-left:0}
}
@media (max-width:560px){
.irx_content{padding-right:16px;padding-left:16px}
.irx_detailScroll{padding:16px 16px 24px}
}
`

    /** Count fields in display order; the second entry is the dictionary key. */
    const COUNT_FIELDS = [
      ['candidates', 'count.candidates'],
      ['fulltexts', 'count.fulltexts'],
      ['notes', 'count.notes'],
      ['gaps', 'count.gaps'],
      ['seeds', 'count.seeds'],
      ['proposals', 'count.proposals'],
      ['peerReviews', 'count.peerReviews'],
    ]

    function toCount(value) {
      return typeof value === 'number' && isFinite(value) && value > 0 ? Math.floor(value) : 0
    }

    function toText(value) {
      return typeof value === 'string' ? value : ''
    }

    /** Normalize the optional final meta review; absent or malformed means "none". */
    function normalizeFinal(raw) {
      const source = raw && typeof raw === 'object' ? raw : {}
      return {
        present: source.present === true,
        reviewer: toText(source.reviewer),
        family: toText(source.family),
        sameFamilyAsWriter: source.sameFamilyAsWriter === true,
        generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : null,
        verdict: toText(source.verdict),
        error: toText(source.error),
      }
    }

    /** Normalize one Host summary; missing or malformed fields fall back to zero. */
    function normalizeRun(raw) {
      const source = raw && typeof raw === 'object' ? raw : {}
      const counts = source.counts && typeof source.counts === 'object' ? source.counts : {}
      const quality = source.quality && typeof source.quality === 'object' ? source.quality : {}
      const normalizedCounts = {}
      for (const [field] of COUNT_FIELDS) normalizedCounts[field] = toCount(counts[field])
      return {
        key: toText(source.key),
        dir: toText(source.dir),
        idea: toText(source.idea),
        lang: source.lang === 'en' ? 'en' : 'zh',
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : null,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
        lastAction: toText(source.lastAction) || null,
        counts: normalizedCounts,
        quality: {
          high: toCount(quality.high),
          medium: toCount(quality.medium),
          low: toCount(quality.low),
        },
        final: normalizeFinal(source.final),
        hasReport: source.hasReport === true,
        reportMtime: typeof source.reportMtime === 'string' ? source.reportMtime : null,
      }
    }

    function formatDate(value, localeTag) {
      if (typeof value !== 'string' || value === '') return ''
      const date = new Date(value)
      if (isNaN(date.getTime())) return ''
      try {
        return new Intl.DateTimeFormat(localeTag, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(date)
      } catch (error) {
        return value
      }
    }

    async function fetchJson(url) {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (response.status === 404) return { missing: true }
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const data = await response.json()
      return { data }
    }

    /** Load the run index; a 404 means "no runs yet", not an error. */
    async function fetchRuns() {
      const result = await fetchJson(API_RUNS)
      if (result.missing) return []
      const rows = result.data && Array.isArray(result.data.runs) ? result.data.runs : []
      return rows.map(normalizeRun).filter((run) => run.key !== '')
    }

    /** Load one run's summary; an unknown key (404) is an error for the detail pane. */
    async function fetchRun(key) {
      const result = await fetchJson(API_RUNS + '/' + encodeURIComponent(key))
      if (result.missing) throw new Error('HTTP 404')
      const run = result.data && result.data.run ? normalizeRun(result.data.run) : null
      if (run === null || run.key === '') throw new Error('malformed run payload')
      return run
    }

    /** Sidebar glyph: a document under a magnifier, drawn in currentColor. */
    function PanelIcon(props) {
      const requested = props && typeof props.size === 'number' ? props.size : 18
      const size = requested > 0 ? requested : 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 20 20',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h('path', {
          d: 'M6.1 2.6h4.2l3.2 3.2v3a2.6 2.6 0 0 1-2.6 2.6H6.1a2.6 2.6 0 0 1-2.6-2.6V5.2a2.6 2.6 0 0 1 2.6-2.6Z',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M10.3 2.6v2.1a1.1 1.1 0 0 0 1.1 1.1h2.1',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M5.4 7.5h4M5.4 9.8h2.6',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
        }),
        h('circle', {
          cx: '14.2',
          cy: '14.2',
          r: '2.9',
          stroke: 'currentColor',
          strokeWidth: '1.4',
        }),
        h('path', {
          d: 'm16.2 16.2 1.5 1.5',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
        })
      )
    }

    function IconRefresh(props) {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 14 14',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          className: props && props.className ? props.className : undefined,
        },
        h('path', {
          d: 'M12.25 7a5.25 5.25 0 1 1-5.25-5.25c1.47 0 2.88.58 3.93 1.6L12.25 4.67',
          stroke: 'currentColor',
          strokeWidth: '1.3',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M12.25 1.75v2.92h-2.92',
          stroke: 'currentColor',
          strokeWidth: '1.3',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        })
      )
    }

    function IconClose() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 14 14',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', {
          d: 'M3.8 3.8l6.4 6.4M10.2 3.8l-6.4 6.4',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
        })
      )
    }

    function IconExternal() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 14 14',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', {
          d: 'M8.6 2h3.4v3.4M5.8 8.2 12 2',
          stroke: 'currentColor',
          strokeWidth: '1.3',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M10.2 7.6v3.1a1.3 1.3 0 0 1-1.3 1.3H3.3A1.3 1.3 0 0 1 2 10.7V5.1a1.3 1.3 0 0 1 1.3-1.3h3.1',
          stroke: 'currentColor',
          strokeWidth: '1.3',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        })
      )
    }

    function IconCopy() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 14 14',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('rect', {
          x: '2.4',
          y: '2.4',
          width: '6',
          height: '6',
          rx: '1.4',
          stroke: 'currentColor',
          strokeWidth: '1.3',
        }),
        h('path', {
          d: 'M5.6 11.6h4A1.4 1.4 0 0 0 11 10.2V6.2',
          stroke: 'currentColor',
          strokeWidth: '1.3',
          strokeLinecap: 'round',
        })
      )
    }

    function IconCheck() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 14 14',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', {
          d: 'm2.8 7.4 2.9 2.9 5.5-6.1',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        })
      )
    }

    function IconWarning() {
      return h(
        'svg',
        {
          width: 22,
          height: 22,
          viewBox: '0 0 22 22',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('circle', {
          cx: '11',
          cy: '11',
          r: '8.2',
          stroke: 'currentColor',
          strokeWidth: '1.4',
        }),
        h('path', {
          d: 'M11 6.4v5.2',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
        }),
        h('circle', {
          cx: '11',
          cy: '15.1',
          r: '0.9',
          fill: 'currentColor',
        })
      )
    }

    /** Three-segment quality bar for the detail pane; `label` is its accessible name. */
    function qualityBar(quality, label) {
      const segments = []
      if (quality.high > 0) segments.push(h('span', { key: 'high', className: 'irx_segHigh', style: { flexGrow: quality.high } }))
      if (quality.medium > 0) segments.push(h('span', { key: 'medium', className: 'irx_segMedium', style: { flexGrow: quality.medium } }))
      if (quality.low > 0) segments.push(h('span', { key: 'low', className: 'irx_segLow', style: { flexGrow: quality.low } }))
      return h('span', { className: 'irx_qualityBar', role: 'img', 'aria-label': label, title: label }, segments)
    }

    /** Compact inline quality reading for one list row: "高 2 · 中 1 · 低 0". */
    function qualityInline(quality, label, tr) {
      const items = [
        ['high', 'quality.high', 'irx_dotHigh', quality.high],
        ['medium', 'quality.medium', 'irx_dotMedium', quality.medium],
        ['low', 'quality.low', 'irx_dotLow', quality.low],
      ]
      return h(
        'span',
        { className: 'irx_qInline', 'aria-label': label },
        items.map(([key, labelKey, dotClass, value]) =>
          h(
            'span',
            { key, className: 'irx_qItem' },
            h('span', { className: 'irx_dot ' + dotClass, 'aria-hidden': 'true' }),
            tr(labelKey) + ' ' + value
          )
        )
      )
    }

    /** Compact list chip for the final meta review: present, same-family warning, or failure. */
    function finalChip(final, tr) {
      if (final.present) {
        const warn = final.sameFamilyAsWriter
        return h(
          'span',
          {
            className: warn ? 'irx_pill irx_pillWarn' : 'irx_pill irx_pillFinal',
            title: warn ? tr('final.sameFamily') : undefined,
          },
          h('span', { className: warn ? 'irx_dot irx_dotWarn' : 'irx_dot irx_dotBusiness', 'aria-hidden': 'true' }),
          tr('final.title')
        )
      }
      if (final.error !== '') {
        return h(
          'span',
          { className: 'irx_pill irx_pillFail', title: final.error },
          h('span', { className: 'irx_dot irx_dotFail', 'aria-hidden': 'true' }),
          tr('final.failed')
        )
      }
      return null
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'idea-review:dictionaries')
        const t = ctx.locale.bind(NS)

        /**
         * The Host page for one profile's runs: index list on the left, the
         * selected run on the right (single column below 820px).
         */
        function PanelPage(props) {
          const tr = props && typeof props.t === 'function' ? props.t : t
          const [list, setList] = React.useState({ status: 'loading', runs: [] })
          const [refreshing, setRefreshing] = React.useState(false)
          const [refreshError, setRefreshError] = React.useState(false)
          const [selectedKey, setSelectedKey] = React.useState(null)
          const [detail, setDetail] = React.useState({ status: 'idle', key: null, run: null })
          const [detailNonce, setDetailNonce] = React.useState(0)
          const [copiedKey, setCopiedKey] = React.useState('')
          const alive = React.useRef(true)
          const listRef = React.useRef(list)
          listRef.current = list
          const cache = React.useRef(null)
          if (cache.current === null) cache.current = new Map()

          React.useEffect(() => {
            alive.current = true
            return () => {
              alive.current = false
            }
          }, [])

          const loadRuns = React.useCallback(async (initial) => {
            if (initial) setList({ status: 'loading', runs: [] })
            setRefreshing(true)
            setRefreshError(false)
            try {
              const runs = await fetchRuns()
              if (!alive.current) return
              setList({ status: 'ready', runs })
              setSelectedKey((previous) => (previous !== null && runs.some((run) => run.key === previous) ? previous : null))
            } catch (error) {
              if (!alive.current) return
              const current = listRef.current
              if (current.status === 'ready' && current.runs.length > 0) setRefreshError(true)
              else setList({ status: 'error', runs: [] })
            } finally {
              if (alive.current) setRefreshing(false)
            }
          }, [])

          React.useEffect(() => {
            loadRuns(true)
          }, [loadRuns])

          // Detail fetch, with a session cache so reselecting a run is instant.
          React.useEffect(() => {
            if (selectedKey === null) return undefined
            const cached = cache.current.get(selectedKey)
            if (cached !== undefined) {
              setDetail({ status: 'ready', key: selectedKey, run: cached })
              return undefined
            }
            let cancelled = false
            setDetail({ status: 'loading', key: selectedKey, run: null })
            fetchRun(selectedKey).then(
              (run) => {
                if (cancelled) return
                cache.current.set(selectedKey, run)
                setDetail({ status: 'ready', key: selectedKey, run })
              },
              () => {
                if (cancelled) return
                setDetail({ status: 'error', key: selectedKey, run: null })
              }
            )
            return () => {
              cancelled = true
            }
          }, [selectedKey, detailNonce])

          React.useEffect(() => {
            if (copiedKey === '') return undefined
            const timer = setTimeout(() => setCopiedKey(''), COPY_FEEDBACK_MS)
            return () => clearTimeout(timer)
          }, [copiedKey])

          const refresh = () => {
            cache.current.clear()
            setDetailNonce((value) => value + 1)
            loadRuns(listRef.current.status !== 'ready')
          }

          const closeDetail = () => setSelectedKey(null)

          const openReport = (run) => {
            if (!run.hasReport) return
            window.open(REPORT_BASE + encodeURIComponent(run.key), '_blank', 'noopener,noreferrer')
          }

          const copyDir = (run) => {
            if (run.dir === '') return
            try {
              const clipboard = navigator && navigator.clipboard
              if (!clipboard || typeof clipboard.writeText !== 'function') return
              const result = clipboard.writeText(run.dir)
              if (result && typeof result.then === 'function') {
                result.then(
                  () => {
                    if (alive.current) setCopiedKey(run.key)
                  },
                  () => {}
                )
              }
            } catch (error) {
              /* clipboard is best-effort: stay silent when blocked */
            }
          }

          const onKeyDown = (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented || selectedKey === null) return
            event.preventDefault()
            event.stopPropagation()
            setSelectedKey(null)
          }

          const dateLocale = tr('date.locale')
          const none = tr('none')
          const languageLabel = (lang) => (lang === 'en' ? tr('lang.en') : tr('lang.zh'))
          const qualityLabel = (quality) =>
            tr('quality.summary', { high: quality.high, medium: quality.medium, low: quality.low })
          const runCount = list.status === 'ready' ? list.runs.length : 0

          const renderSkeletonList = () =>
            h(
              'div',
              { className: 'irx_skeletonList', role: 'status' },
              h('span', { className: 'irx_srOnly' }, tr('loading.list')),
              h('div', { className: 'irx_skeletonRow', 'aria-hidden': 'true' }),
              h('div', { className: 'irx_skeletonRow', 'aria-hidden': 'true' }),
              h('div', { className: 'irx_skeletonRow', 'aria-hidden': 'true' })
            )

          const renderState = (glyph, title, body, action) =>
            h(
              'div',
              { className: 'irx_state' },
              h('div', { className: 'irx_stateGlyph', 'aria-hidden': 'true' }, glyph),
              h('p', { className: 'irx_stateTitle' }, title),
              h('p', { className: 'irx_stateBody' }, body),
              action === null ? null : h('div', { className: 'irx_stateAction' }, action)
            )

          const retryButton = (onClick, label) =>
            h('button', { type: 'button', className: 'irx_button irx_ghost', onClick }, label)

          const renderRow = (run) => {
            const active = run.key === selectedKey
            const created = formatDate(run.createdAt, dateLocale) || none
            const meta = [
              created,
              languageLabel(run.lang),
              tr('count.candidates') + ' ' + run.counts.candidates,
              tr('count.fulltexts') + ' ' + run.counts.fulltexts,
              tr('count.gaps') + ' ' + run.counts.gaps,
              tr('count.proposals') + ' ' + run.counts.proposals,
            ].join('  ·  ')
            return h(
              'li',
              { key: run.key, className: 'irx_rowItem' },
              h(
                'button',
                {
                  type: 'button',
                  className: active ? 'irx_row irx_rowActive' : 'irx_row',
                  'aria-current': active ? 'true' : undefined,
                  onClick: () => setSelectedKey(run.key),
                },
                h(
                  'span',
                  { className: 'irx_rowTop' },
                  h('span', { className: 'irx_rowTitle' }, run.idea.trim() === '' ? tr('row.noIdea') : run.idea),
                  finalChip(run.final, tr),
                  h(
                    'span',
                    { className: 'irx_pill' },
                    h('span', { className: run.hasReport ? 'irx_dot irx_dotOn' : 'irx_dot', 'aria-hidden': 'true' }),
                    run.hasReport ? tr('report.yes') : tr('report.no')
                  )
                ),
                h(
                  'span',
                  { className: 'irx_rowMetaRow' },
                  h('span', { className: 'irx_rowMeta' }, meta),
                  qualityInline(run.quality, qualityLabel(run.quality), tr)
                )
              )
            )
          }

          let listBody
          if (list.status === 'loading') {
            listBody = renderSkeletonList()
          } else if (list.status === 'error') {
            listBody = renderState(h(IconWarning, null), tr('error.title'), tr('error.list'), retryButton(refresh, tr('retry')))
          } else if (list.runs.length === 0) {
            listBody = renderState(h(PanelIcon, { size: 26 }), tr('empty.title'), tr('empty.body'), null)
          } else {
            listBody = h('ul', { className: 'irx_list' }, list.runs.map(renderRow))
          }

          const renderFinalCard = (run) => {
            const final = run.final
            if (!final.present && final.error === '') return null
            const bylineParts = [final.reviewer, final.family].filter((part) => part !== '')
            const byline = bylineParts.length > 0 ? tr('final.byline', { byline: bylineParts.join(' / ') }) : ''
            const generated = final.present ? formatDate(final.generatedAt, dateLocale) : ''
            const head = h(
              'div',
              { className: 'irx_finalHead' },
              h('h3', { className: 'irx_cardTitle irx_cardTitleInline' }, tr('final.title')),
              generated === '' ? null : h('span', { className: 'irx_finalTime' }, tr('final.generatedAt', { time: generated }))
            )
            const body = final.present
              ? h('p', { className: 'irx_finalVerdict' }, final.verdict !== '' ? final.verdict : tr('final.empty'))
              : h('p', { className: 'irx_finalError' }, tr('final.failedNote', { error: final.error }))
            const caveat =
              final.present && final.sameFamilyAsWriter
                ? h(
                    'p',
                    { className: 'irx_caveat' },
                    h('span', { className: 'irx_dot irx_dotWarn', 'aria-hidden': 'true' }),
                    tr('final.sameFamily')
                  )
                : null
            return h(
              'section',
              { className: 'irx_card', 'aria-label': tr('final.title') },
              head,
              byline === '' ? null : h('p', { className: 'irx_finalBy' }, byline),
              body,
              caveat
            )
          }

          const renderDetailBody = (run) => {
            const idea = run.idea.trim() === '' ? tr('row.noIdea') : run.idea
            const created = formatDate(run.createdAt, dateLocale) || none
            const updated = formatDate(run.updatedAt, dateLocale) || none
            const copied = copiedKey === run.key
            const actions = h(
              'div',
              { className: 'irx_actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'irx_button irx_primary',
                  onClick: () => openReport(run),
                  disabled: !run.hasReport,
                },
                h(IconExternal, null),
                tr('action.openReport')
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'irx_button irx_ghost',
                  onClick: () => copyDir(run),
                  disabled: run.dir === '',
                },
                copied ? h(IconCheck, null) : h(IconCopy, null),
                copied ? tr('action.copied') : tr('action.copyDir')
              )
            )
            const counts = h(
              'section',
              { className: 'irx_card' },
              h('h3', { className: 'irx_cardTitle' }, tr('detail.counts')),
              h(
                'div',
                { className: 'irx_countGrid' },
                COUNT_FIELDS.map(([field, labelKey]) =>
                  h(
                    'div',
                    { key: field },
                    h('div', { className: 'irx_countValue' }, String(run.counts[field])),
                    h('div', { className: 'irx_countLabel' }, tr(labelKey))
                  )
                )
              )
            )
            const quality = h(
              'section',
              { className: 'irx_card' },
              h('h3', { className: 'irx_cardTitle' }, tr('detail.quality')),
              qualityBar(run.quality, qualityLabel(run.quality)),
              h(
                'div',
                { className: 'irx_qualityLegend' },
                [
                  ['high', 'quality.high', 'irx_segHigh'],
                  ['medium', 'quality.medium', 'irx_segMedium'],
                  ['low', 'quality.low', 'irx_segLow'],
                ].map(([field, labelKey, colorClass]) =>
                  h(
                    'span',
                    { key: field, className: 'irx_legendItem' },
                    h('span', { className: 'irx_legendDot ' + colorClass, 'aria-hidden': 'true' }),
                    tr(labelKey),
                    h('span', { className: 'irx_legendValue' }, String(run.quality[field]))
                  )
                )
              )
            )
            const infoRow = (key, label, value, block) =>
              h(
                'div',
                { key, className: block ? 'irx_infoRow irx_infoRowBlock' : 'irx_infoRow' },
                h('span', { className: 'irx_infoLabel' }, label),
                h('span', { className: 'irx_infoValue' }, value)
              )
            const info = h(
              'section',
              { className: 'irx_card' },
              h('h3', { className: 'irx_cardTitle' }, tr('detail.info')),
              infoRow('lang', tr('detail.lang'), languageLabel(run.lang), false),
              infoRow('created', tr('detail.created'), created, false),
              infoRow('updated', tr('detail.updated'), updated, false),
              infoRow('lastAction', tr('detail.lastAction'), run.lastAction === null ? none : run.lastAction, false),
              infoRow('dir', tr('detail.dir'), run.dir === '' ? none : run.dir, true)
            )
            return h(
              'div',
              null,
              h('p', { key: 'idea', className: 'irx_idea' }, idea),
              renderFinalCard(run),
              actions,
              counts,
              quality,
              info
            )
          }

          let detailBody
          if (selectedKey === null) {
            detailBody = null
          } else if (detail.status === 'error' && detail.key === selectedKey) {
            detailBody = renderState(h(IconWarning, null), tr('error.title'), tr('error.detail'), retryButton(refresh, tr('retry')))
          } else if (detail.status === 'ready' && detail.run !== null && detail.run.key === selectedKey) {
            detailBody = renderDetailBody(detail.run)
          } else {
            detailBody = h(
              'div',
              { className: 'irx_detailSkeleton', role: 'status' },
              h('span', { className: 'irx_srOnly' }, tr('loading.detail')),
              h('div', { className: 'irx_skeletonBlock', style: { height: '16px', width: '94%' }, 'aria-hidden': 'true' }),
              h('div', { className: 'irx_skeletonBlock', style: { height: '16px', width: '72%' }, 'aria-hidden': 'true' }),
              h('div', { className: 'irx_skeletonBlock', style: { height: '32px', width: '180px', marginTop: '6px' }, 'aria-hidden': 'true' }),
              h('div', { className: 'irx_skeletonBlock', style: { height: '96px', width: '100%', marginTop: '10px' }, 'aria-hidden': 'true' }),
              h('div', { className: 'irx_skeletonBlock', style: { height: '64px', width: '100%' }, 'aria-hidden': 'true' })
            )
          }

          return h(
            'section',
            {
              className: selectedKey === null ? 'irx_page' : 'irx_page irx_pageHasDetail',
              'aria-label': tr('title'),
              'data-testid': 'idea-review-page',
              onKeyDown,
            },
            h('style', { key: 'irx-style' }, PAGE_CSS),
            h(
              'div',
              { className: 'irx_listPane' },
              h(
                'div',
                { className: 'irx_scroll' },
                h(
                  'div',
                  { className: 'irx_content' },
                  h(
                    'div',
                    { className: 'irx_heading' },
                    h(
                      'div',
                      { className: 'irx_headingTitle' },
                      h('h1', null, tr('title')),
                      list.status === 'ready'
                        ? h('span', { className: 'irx_runCount' }, tr('list.count', { count: runCount }))
                        : null
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'irx_button irx_ghost',
                        onClick: refresh,
                        disabled: refreshing,
                        'aria-busy': refreshing ? 'true' : 'false',
                      },
                      h(IconRefresh, { className: refreshing ? 'irx_spin' : undefined }),
                      tr('refresh')
                    )
                  ),
                  h(
                    'div',
                    { className: 'irx_hint' },
                    h('span', { className: 'irx_hintLabel' }, tr('hint.title')),
                    h('span', { className: 'irx_hintText' }, tr('hint.body'))
                  ),
                  refreshError ? h('p', { className: 'irx_notice', role: 'status' }, tr('error.refresh')) : null,
                  listBody
                )
              )
            ),
            selectedKey === null
              ? null
              : h(
                  'aside',
                  { className: 'irx_detail', 'aria-label': tr('detail.title') },
                  h(
                    'div',
                    { className: 'irx_detailHeader' },
                    h('h2', { className: 'irx_detailTitle' }, tr('detail.title')),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'irx_iconButton',
                        onClick: closeDetail,
                        'aria-label': tr('action.close'),
                        title: tr('action.close'),
                      },
                      h(IconClose, null)
                    )
                  ),
                  h('div', { className: 'irx_detailScroll' }, detailBody)
                )
          )
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: NS,
              order: 20,
              locale: NS,
              label: () => t('panel'),
            },
            PanelIcon
          )
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: NS,
              locale: NS,
            },
            PanelPage
          )
        )
      },
    }
  },
})

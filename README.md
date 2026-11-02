# Idea Review for DeepSeek Harness

![ci](https://github.com/saideao/dsh-idea-review/actions/workflows/ci.yml/badge.svg)

把 idea-review 移植成 DSH 插件：给一个还很粗糙的研究 idea 做一次文献调研和多模型评审，
最后出一份可以自己看的 HTML 报告。

装上以后，在 DSH 里跟 agent 说一句话就行：

> 用 idea-review 看看这个 idea：让大模型代替真人填社会调查问卷，看能不能复现真实人群的回答分布

## 它给 DSH 加了三样东西

| 贡献 | 说明 |
| --- | --- |
| **技能 `idea-review`** | 完整的工作流程说明（拆检索词、初筛、精读评质量、找空白、写 proposal、元评审、汇总、出报告），agent 识别到相关请求就按它执行 |
| **工具 `idea_review`** | 把固定的、容易做错的步骤交给脚本：建运行目录、检索、下载全文、查进度、调别家模型做元评审、渲染报告 |
| **Web 面板** | 侧边栏"想法评审"图标：列出历次运行、看读了几篇/找到几个空白/几份评审，一键打开 HTML 报告 |

分工和原项目一致：**要动脑子的部分由 agent 自己做**（用它正在用的模型，不额外花 API 钱），
检索、下载、格式检查、"证据不够就停"、调别家模型这些固定动作由插件里的脚本完成。

> 所以它是"多模型"但不是"每个环节都能换模型"：写 proposal 的是 DSH 当前会话的模型，
> 挑毛病的是**别家公司的模型**（本机 `claude` / `codex` / `gemini` / `codebuddy` 命令行，
> 或 OpenAI 兼容接口）。跨厂商评审这条核心设计保留。

## 安装

需要 DSH Desktop（含 `plugin_manager`）。克隆到任意位置后，用本地目录安装：

```bash
git clone https://github.com/saideao/dsh-idea-review.git
```

然后在 DSH 里（需要 profile 写权限，会弹一次审批）：

```
plugin_manager(action: "install_bundle", target: "/绝对路径/dsh-idea-review")
```

装完重启 DSH Desktop，让 Client 半和 Host 半都重新加载。卸载：

```
plugin_manager(action: "remove_bundle", target: "@local/dsh-idea-review")
```

运行目录和索引不会跟着删，需要的话自己清理 `~/.dsh/idea-review`。

## 环境要求

- **Python 3.10+**（`python3` 在 PATH 里）。脚本只用标准库；抽 PDF 文字优先用 `pypdf`，
  没装就用 `pdftotext`（poppler）。也可以用 `uv`：把插件配置的 `python` 改成 `uv run`，
  `ir.py` 自带的 PEP 723 声明会自动装 `pypdf`。
- 能联网（Semantic Scholar / arXiv / OpenAlex）。
- 元评审可选：本机有 `codex`、`gemini`、`claude`、`codebuddy` 里任意一个就能换别家模型独立评审；
  一个都没有时用子代理代评，报告里会标明是同一家的模型。

## 配置

插件行的 `config`（可选，写在 profile 的 `cordis.patch.yml` 里）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `python` | `"python3"` | 运行脚本的解释器；可以写 `"uv run"` 或绝对路径 |
| `stateDir` | `$DSH_HOME/idea-review` | 运行索引（面板数据）放哪里 |
| `stepTimeoutSec` | `1500` | 单次脚本调用的超时；元评审慢，可以调大 |

```yaml
- id: idea-review
  name: '@local/dsh-idea-review'
  config:
    python: 'uv run'
    stepTimeoutSec: 2400
```

插件不导出 `Config` schema（bundle 装在 profile 里，解析不到 dsh 安装目录下的 `schemastery`），
所以 `config` 不做校验：字段写错会退回默认值。

## 运行目录长什么样

默认建在会话当前目录下：`idea-review-runs/<日期>-<几个英文词>/`，里面有
`meta.json`、`01_plan.json`、`02_candidates.json`、`03_screen.json`、`04_fulltext.json`、
`notes/`、`papers/`、`text/`、`05_reviews.json` … `10_chair.json`、`report.html`。
格式和原项目的命令行版完全一样，两个版本可以互相接着跑。

## 面板

侧边栏底部的"想法评审"图标打开主面板：

- 列出所有运行：idea 原文、日期、语言、候选/精读/空白/proposal/元评审数量、质量分布；
- 选中一个可以看到明细、直接打开 HTML 报告、复制运行目录路径；
- 还没有运行时给出"怎么开始"的提示。

面板只服务索引里登记的运行目录（按 key 查表），不会把任意路径当文件读。

## 仓库结构

```
index.js              Host 半：注册技能、idea_review 工具、三个 HTTP 路由
lib/runs.js           运行索引与摘要（面板数据源）
lib/py.js             子进程执行（超时、输出截断、ENOENT 提示）
client.js             Client 半：sidebar.panellist 图标 + main 面板
skill/SKILL.md        DSH 版技能正文
skill/scripts/        与原项目逐字节一致的 ir.py / report.py
skill/references/     每一步的具体要求、JSON 格式
skill/assets/         报告样式、JSON Schema、元评审模板
test/                 Host 半（node）与 skill 半（python）的自测
```

Host 半只 import `node:` 内置模块，Client 半只 `require('react')` —— 这是刻意的：
profile 里安装的 bundle 解析不到 dsh 安装目录下的包，所以不用 `defineTool`、不用
`schemastery`、不 require Harness 的 Client 组件库。

## 自测

```bash
node test/host.test.mjs    # 假 ctx + 真 python + 真 HTTP handler，init→next→report 全链路
python3 test/smoke.py      # 脚本/参考资料与原项目逐字节一致，zh/en 各跑一遍 init→next→report
```

两个测试都在临时目录里跑、跑完删掉，不污染插件目录和 DSH 状态。CI 里跑的也是这两条。

## 已知限制

- **面板的三个 HTTP 路由不做鉴权**：DSH 的 SPA 入口会检查 token，插件注册的命名路由在它之前命中，
  所以 `/idea-review/api/runs` 和 `/idea-review/report/<key>` 在本机可直接访问。它们只读
  `stateDir` 索引里登记的运行目录（报告里有 idea 原文和论文信息）。默认只绑 `127.0.0.1`，
  不影响本机使用；如果把 DSH Web 绑到 `0.0.0.0` 或做了端口转发，请自己加一层网络访问限制。
- 面板数据来自工具写下的运行索引，所以**只在通过 `idea_review` 工具跑过之后才会出现**；
  用原项目命令行版或手工建出来的运行目录不会自动出现在面板里。
- 工具没暴露的脚本开关（`--candidates`、`--ideas`、`--min-fulltexts`、`--year-from`、
  `--per-query`、`--site`）只能用默认值；要改就直接改运行目录里的 `meta.json`。
- 元评审要等全部评审跑完才返回，一次可能几分钟；超过 `stepTimeoutSec` 会被终止，
  这时把 `timeoutSec` 调小、分批评，或改用 `dump` 交给子代理。
- 走 API 评审时，`IDEA_REVIEW_API_BASE` / `IDEA_REVIEW_API_KEY` / `IDEA_REVIEW_API_MODEL`
  要在**启动 DSH 之前**设好（插件进程继承 DSH 的环境变量，agent 里 export 传不进去）。

## 许可

MIT，见 [LICENSE](LICENSE)。`skill/scripts`、`skill/references`、`skill/assets` 来自上游
idea-review 项目，版权归原作者。

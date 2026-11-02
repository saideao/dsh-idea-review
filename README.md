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

### 前置条件

| 需要 | 说明 |
| --- | --- |
| **DSH Desktop** | 要有 `plugin_manager` 工具（Desktop 版自带；只有纯 CLI 的会话装不了这个插件） |
| **Python 3.10+** | `python3 --version` 能跑。脚本只用标准库，不需要 `pip install` 任何东西 |
| 能联网 | Semantic Scholar / arXiv / OpenAlex |
| 可选：别家模型 CLI | `claude` / `codex` / `gemini` / `codebuddy` 任意一个，用于跨厂商元评审；一个都没有也能跑，改成子代理代评 |
| 可选：PDF 文字抽取 | `pypdf`（`pip install pypdf`）或 `pdftotext`（`brew install poppler`）；都没有时全文抽不出文字，会停在"读全文"这一步 |

### 1. 克隆到固定目录

```bash
mkdir -p ~/dsh-plugins
git clone https://github.com/saideao/dsh-idea-review.git ~/dsh-plugins/dsh-idea-review
```

⚠️ 这是**链接安装**：DSH 只记住这个目录的路径。装完别移动、别删掉它，否则插件失效（重新走一遍安装就恢复了）。

### 2. 确认 Python 位置

```bash
python3 --version      # 需要 3.10 或更高
command -v python3     # 记下路径；不在默认位置时，装完在「配置」里指定
```

### 3. 让 DSH 装上它

在 DSH Desktop 里开任意一个会话，跟 agent 说：

> 帮我安装 `/Users/你/dsh-plugins/dsh-idea-review` 这个插件

agent 会调用：

```
plugin_manager(action: "install_bundle", target: "/Users/你/dsh-plugins/dsh-idea-review")
```

这一步要写当前 profile（`~/.dsh/profiles/<profile>`），所以**会弹一次审批，点同意**。

装成功的判断（别只看日志）：

- 返回里 `application` 是 `"applied"`、`warnings` 是 `[]`
- agent 的工具列表里出现 `idea_review`
- 技能列表里出现 `idea-review`

装进的是**当前 profile**：所有会话可见，重启后保留。想装到别的 profile，先切 profile 再重复第 3 步。

### 4. 重启 DSH Desktop

Host 半（技能、工具、HTTP 路由）和 Client 半（侧边栏图标、面板）都要重新加载。第一次装完如果侧边栏还没图标，顺手刷新一下窗口（`Cmd+R`）。

### 5. 验证装好了

1. 侧边栏底部多一个**「想法评审」**图标（在齿轮上面、日程图标旁边）
2. **Settings → Plugins** 里能看到「想法评审」，图标是放大镜压着一份文档
3. 跟 agent 说「用 idea-review 看看这个 idea：……」，它会先调 `idea_review` 的 `action: "init"`
4. 打开面板，如果是空的、显示"怎么开始"的提示，说明前后端都通了

不花钱的最小验证：让 agent 跑一次 `idea_review` 的 `action: "reviewers"`（不建目录、不调模型），能列出本机的评审 CLI 就说明工具链路正常。

### 升级

```bash
cd ~/dsh-plugins/dsh-idea-review && git pull
```

然后**重启 DSH Desktop** —— 替换已安装的包必须重启才会加载新的 JavaScript。已有的运行目录和索引不受影响。

### 卸载

```
plugin_manager(action: "remove_bundle", target: "@local/dsh-idea-review")
```

技能、工具、三个 HTTP 路由和面板会一起移除。运行数据不会自动删：

```bash
rm -rf ~/.dsh/idea-review                 # 面板索引
rm -rf ~/dsh-plugins/dsh-idea-review      # 插件本体（可选）
```

### 装完出问题

| 现象 | 怎么办 |
| --- | --- |
| `plugin_manager` 返回 `failed` | 看返回里的错误。最常见：`target` 不是**绝对路径**，或那个目录里没有 `package.json` |
| 工具报找不到可执行文件 | 没装 Python 或不在 PATH。先 `python3 --version`，然后在「配置」里把 `python` 指到绝对路径 |
| `search` / `fetch` 报网络错 | 检索要联网。先终端验证：`curl 'https://api.semanticscholar.org/graph/v1/paper/search?query=test'` |
| `fetch` 下来的全文是空的 | 缺 PDF 文字抽取：`pip install pypdf`，或 `brew install poppler`（提供 `pdftotext`） |
| 侧边栏没有图标 / 面板空白 | 重启 DSH Desktop 并刷新窗口；仍没有就看 Settings → Plugins 里这一行是否启用 |
| 面板一直是空的 | 面板只显示通过 `idea_review` 工具跑过的运行；命令行版或手工建的目录不会出现 |
| `reviewers` 说有模型，`review` 却失败 | 对应 CLI 没登录。先手动跑一次 `codex` / `claude` / `gemini` 完成登录 |
| 本机一个别家模型都没有 | 用 `action: "review"` + `dump: true` 把评审材料导出到 `review_prompts/`，再开子代理代评 |
| 想换成 `uv` 跑脚本 | 配置里把 `python` 改成 `uv run`，`ir.py` 的 PEP 723 声明会自动装 `pypdf` |


## 配置

插件行的 `config` 是可选的。改法有两种：让 agent 帮你改，或者自己编辑当前 profile 的 patch 层
`~/.dsh/profiles/<profile>/cordis.patch.yml`：

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

改完**重启 DSH Desktop** 才生效。

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

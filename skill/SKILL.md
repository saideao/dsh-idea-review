# idea-review：查文献、找空白、写 proposal、换模型挑毛病

分工：要动脑子的步骤你自己做（拆检索词、初筛、精读评质量、找空白、写 proposal、汇总评审意见）；固定的步骤交给 `idea_review` 工具（它替你跑这个 skill 里的 python 脚本，检索、下载全文、检查文件格式和进度、调用别家模型做元评审、出 HTML 报告）。

这样分是因为：检索接口有限流和去重的细节，PDF 要校验、按页标号；调别家命令行工具的参数错一个就会读到用户的配置或者改走 API 计费；"证据不够就停"这条规矩要每次都执行，不能看心情。这些写死在脚本里，你把精力放在读论文和写东西上。

下文 `RUN` 指这次的运行目录，`references/...` 是相对这个 skill 目录的路径。

## 在 DSH 里怎么调用

只有一个工具 `idea_review`，`action` 决定做什么（不要自己用 shell 跑 python 脚本，工具已经配好了 python 环境）：

| action | 作用 | 参数 |
|---|---|---|
| `init` | 建运行目录、记下 idea 和数量 | `idea`、`lang`、`writer`、`writerModel`、`refs`（`run` 可省，省了自动生成） |
| `next` | 检查进度和文件格式，告诉你下一步 | `run`，`force` |
| `search` | 按检索式检索、合并去重、取候选 | `run`，`queries`、`papersDir`、`again` |
| `fetch` | 按初筛结果下载全文、抽文字 | `run` |
| `reviewers` | 看本机能用哪些别家的评审模型 | `writer` |
| `review` | 请别家模型做元评审 | `run`，`reviewers`、`timeoutSec`、`dump` |
| `report` | 渲染 HTML 报告 | `run` |

- `writer` 默认 `other`。你是 DeepSeek 的模型，填 `other`，`writerModel` 填你的模型名；确定自己是 Claude / GPT / Gemini / 混元时才填 `anthropic` / `openai` / `google` / `tencent`。元评审要换别家的模型，这一项决定排除谁。
- 工具的返回是 JSON：`runDir` 是本次运行目录（**`init` 生成，之后每一步都把它原样传成 `run`**），`output` 是脚本的 stdout（**`next` 的"下一步"就在这里，每步做完都要读它**），`message` 是失败原因（成功时为空），还有 `ok`、`exitCode`；`report` 成功时还多一个 `reportUrl`。`ok` 为 false 时先按 `message` 修（比如某个 JSON 格式不对），别把失败当成功往下走。
- 脚本的提示是命令行口吻（比如"运行 ir.py search RUN"、"加 --force"、"`python3 scripts/report.py RUN`"），一律按上面的参数表换成 `idea_review` 调用。
- 环境：不用 uv、不用管 pypdf，插件调用脚本时已处理；PDF 抽文字优先用 pypdf，缺了会退回 `pdftotext`。`search` / `fetch` / `review` 要联网。
- `init` 不用传 `run`：工具会在会话工作目录下自动建 `idea-review-runs/<日期>-<几个英文词>/` 并返回 `runDir`。想让运行目录放在别处，也可以给 `run` 一个绝对路径（相对路径按会话工作目录解析）。
- 侧边栏的 idea-review 面板会显示历史运行（idea、日期、语言、计数、有没有报告）。报告出好后可以让用户点面板里的"打开报告"，或把 `report` 返回的报告路径给用户用浏览器打开。

## 开始前

先和用户对齐这几件事，能用默认的就别问：

- **idea**：一两句话就够。只有一个词、看不出要解决什么问题的，请用户补一句。
- **语言**：跟用户说话的语言走，`lang: "zh"` 或 `lang: "en"`。笔记、proposal、报告都用这个语言写。
- **数量**：默认候选 40 篇、精读 8 篇、proposal 3 份（原始 idea 1 份，加 2 个新方向）。用户想快一点可以调小 `refs`（精读篇数），想读得全一点调大。
- **评审**：调用 `idea_review` 的 `reviewers` 动作，看本机有哪些别家的模型能用，告诉用户你打算调用哪几个。这会用掉对应工具的订阅额度或 API 费用，用户点头再调。

## 流程

每做完一步就调用一次 `idea_review` 的 `next`。它检查你写的文件格式对不对，告诉你下一步做什么、要写几个。中途断了或者换了会话，也从 `next` 接着来，已经做完的不用重做。

**0. 建目录**

```
idea_review { "action": "init", "idea": "用户的 idea 原文", "lang": "zh", "writer": "other", "writerModel": "你的模型名" }
```

`init` 返回的 `runDir` 就是下文说的 `RUN`，后面每一步都把它原样传成 `run`。`idea` 第一次必须给；对同一个 `RUN` 再调一次 `init` 是幂等的（只改你明确给的数量），中途补参数是安全的。

**1. 拆检索词**：写 `RUN/01_plan.json`。要求见 references/steps.md 第 1 节。

**2. 检索**：

```
idea_review { "action": "search", "run": "<RUN>" }
```

用户手上有 PDF 的，加 `"papersDir": "<目录绝对路径>"`（相对路径按会话工作目录解析），这些论文编号 L01、L02…，不占精读名额。要直接给英文检索式就用 `"queries": ["...", "..."]`；要换检索式重新检索，加 `"again": true`（会覆盖已有候选和之后的记录）。

**3. 初筛**：读 `RUN/screen_todo.md`，每篇给 high / medium / low 和一句理由，写进 `RUN/03_screen.json`。这一步只判断值不值得读全文，不判断有没有人做过。见第 3 节。

**4. 下载全文**：

```
idea_review { "action": "fetch", "run": "<RUN>" }
```

它按初筛结果从高到低下载，下载失败的往下顺延，没有链接的会按标题去 arXiv 找预印本。如果它说"又取了 N 篇候选"，说明能下载的不够，回到第 3 步初筛这些新候选（追加进 `03_screen.json`），再运行 fetch。

**5. 精读**：`next` 会列出要读的论文和全文文件（`RUN/text/P03.txt`，已经用 `[p.N]` 标了页）。每篇写一个 `RUN/notes/P03.json`，要求见第 5 节。

这一步最占篇幅，一篇全文几万字。能开子代理（DSH 的 subagent）就一篇交给一个子代理，并行读：给它 idea 原文、论文编号、全文路径、references/steps.md 第 5 节和 references/formats.md 里 notes 那一节，让它把 JSON 直接写到 `RUN/notes/<编号>.json`。不能开子代理就一篇一篇来，读完一篇立刻写文件，再读下一篇。全文长就分段读，方法和实验部分不能跳。

**证据门槛**：读完调用 `next`。读到的全文少于 3 篇，或者全是 low，它会说停。停了就别往下找空白、写 proposal：两三篇弱论文撑不起十个空白，硬写只会生成看起来像样的空话。这时直接出报告（第 11 步），告诉用户报告顶部写的补救办法：手动下载没拿到全文的论文，按编号放进 `RUN/papers/`（比如 `P07.pdf`）后让你接着跑；或者换检索式开一次新的运行。只有用户明确说"就用现有的跑完"，才这样强制往下跑：

```
idea_review { "action": "next", "run": "<RUN>", "force": true }
```

**6. 版图和空白**：写 `RUN/06_landscape.json`。空白个数不超过 `next` 给的上限（按读到的篇数定，3 到 8 个）。见第 6 节。

**7. 新方向**：写 `RUN/07_seeds.json`，个数按 `next` 说的（不会超过空白个数）。见第 7 节。

**8. proposal**：写 `RUN/08_proposals.json`。I1 是用户的原始 idea，I2 起依次对应 seeds 里的新方向。见第 8 节。

**9. 元评审**：先看能调谁：

```
idea_review { "action": "reviewers", "writer": "other" }
```

`next` 也会给出能用的评审。然后：

```
idea_review { "action": "review", "run": "<RUN>", "reviewers": ["codex", "gemini"] }
```

`reviewers` 不传就默认用本机所有能用的别家模型；也可以列 `claude` / `codex` / `gemini` / `codebuddy` / `api`，或者写成 `"codebuddy:模型名"` 指定模型。`timeoutSec` 是单次调用最多等多少秒，默认 900。每份可能要几分钟，一次调用会等到全部跑完，跑完再 `next`；调用超过工具的单步时限会被终止，真跑不完就把 `timeoutSec` 调小、分几次评，或者改用 `dump` 交子代理。`codebuddy` 是腾讯 CodeBuddy 的命令行，默认用混元 hy3；它也能调别家的模型（`"codebuddy:模型名"`），算哪家按模型名定。评审在空的临时目录里、新会话里独立完成，只看得到 proposal 和论文材料。

本机一个别家的模型都没有时，见第 9 节的"没有别家模型时"：用 `"dump": true` 只把评审材料写到 `RUN/review_prompts/`，再开子代理代评。走 API 的话，环境变量（`IDEA_REVIEW_API_BASE` / `IDEA_REVIEW_API_KEY` / `IDEA_REVIEW_API_MODEL`）要在启动 DSH 之前设好，否则工具进程读不到。

**10. 汇总**：每份 proposal 有两份及以上成功的评审时，写 `RUN/10_chair.json`。只有一份评审的跳过。见第 10 节。

**11. 出报告**：

```
idea_review { "action": "report", "run": "<RUN>" }
```

返回的 `reportUrl` 是面板里的报告页面，`output` 里有本机报告文件路径。把 `reportUrl` 给用户（或者让他点侧边栏 idea-review 面板里的"打开报告"），也可以把文件路径给他用浏览器打开。回复里简短说清：读了几篇全文、质量怎么分布、找到几个空白、几家评审都提到的问题是什么。不要替用户下"值得做"或"不值得做"的结论，拍板的是用户。

DSH 版没有"发布成网页应用"这一步（脚本里的 `--site` 没有暴露成工具参数）：报告是本机自包含的 HTML，不要往外发布。

## 每一步都要守的规矩

- **不编造**：论文、页码、数字、结论都要来自全文或检索结果。拿不准就写拿不准。
- **判断依据正文**：摘要常常说得比正文大。引用全文时写页码，格式 `[p.6]`。
- **分清来源**：哪些是论文写的，哪些是你推断的，要写明。
- **只引用候选里的编号**（P07、L02 这种）。需要别的文献，写进 `needs_checking`，不要凭记忆补论文。
- **不夸、不打分、不替用户拍板**。报告是帮用户发现盲点的。

## 运行目录里的文件

| 文件 | 谁写 | 内容 |
|---|---|---|
| `meta.json` | init | idea、语言、数量、你是哪家的模型 |
| `01_plan.json` | 你 | 复述、领域、核心概念、检索式 |
| `02_search_results.json`、`02_candidates.json` | search | 全部检索结果、候选（带编号） |
| `screen_todo.md` | search / fetch / next | 还没初筛的候选，给你读 |
| `03_screen.json` | 你 | 初筛结果 |
| `04_fulltext.json`、`papers/`、`text/` | fetch | 全文下载记录、PDF、抽出的文字 |
| `notes/P03.json` | 你（或子代理） | 一篇一个精读笔记 |
| `05_reviews.json` | next | 合并后的精读笔记 |
| `06_landscape.json` | 你 | 版图和空白 |
| `07_seeds.json` | 你 | 新方向 |
| `08_proposals.json` | 你 | proposal |
| `09_meta_reviews.json`、`usage.json` | review | 元评审、评审用量 |
| `review_prompts/I1.md` | review（`dump`） | 给子代理代评的评审材料 |
| `10_chair.json` | 你 | 评审意见汇总 |
| `report.html` | report | 报告（自包含 HTML） |

## 参考文件

- `references/steps.md`：每一步的具体要求，做到哪一步读哪一节。
- `references/formats.md`：你要写的每个 JSON 文件的格式和例子，写文件前看对应一节。
- `assets/schemas.zh.json`：完整的 JSON Schema，`next` 按它检查格式。

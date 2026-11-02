#!/usr/bin/env python3
"""dsh-idea-review skill 冒烟测试：离线跑通 python 侧，只用标准库。

从包目录运行：

    cd dsh-idea-review && python3 test/smoke.py

检查内容：
  1. skill 资产齐全；没改过的资产和源仓库逐字节一致；改过的脚本 / schema / references
     存在、非空、并且仍然暴露预期接口（ir.py --help 有 chair，schemas 有 FinalReview）。
  2. SKILL.md / steps.md / formats.md 已经写明最终评审（chair）这一步。
  3. `ir.py --help`、`report.py --help`、`ir.py reviewers` 正常退出。
  4. 中文运行 init -> next -> report，报告是自包含 HTML，包含 idea 原文。
  5. 英文运行同样跑一遍，报告是英文。
  6. 最终评审回归：建一个 schema-valid 的假运行，验证 init --final-reviewer 落进 meta.json、
     next 会要求最终评审、chair --dump 写出含材料和 schema 的 final_review_prompt.md、
     合法的 11_final_review.json 让 next 走到报告、坏掉的 11_final_review.json 被 next 拒绝。
  7. 失败路径（没写 01_plan.json 就 search）干净退出，不是崩溃。
  8. 所有产物都在临时目录里并且被清掉；包目录和只读源仓库前后一字节未变
     （__pycache__ 这种别人跑脚本也会生成的字节码缓存不算包内容）。
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True  # 让下面的 import ir 不往 skill/scripts 写 __pycache__

PKG = Path(__file__).resolve().parent.parent
SKILL = PKG / "skill"
SCRIPTS = SKILL / "scripts"
REFS = SKILL / "references"
ASSETS = SKILL / "assets"
SRC = Path(os.environ.get("IDEA_REVIEW_SRC", "/Users/sidelau/Desktop/idea-review"))
PY = sys.executable or "python3"

sys.path.insert(0, str(SCRIPTS))
import ir  # noqa: E402  只用来校验测试 fixture（ir.py 本身只用标准库，导入无副作用）

SKIP_DIRS = {".git", ".venv", "__pycache__", ".pytest_cache", "node_modules",
             ".mypy_cache", ".ruff_cache"}
SKIP_NAMES = {".DS_Store"}

EXPECTED = [
    "skill/SKILL.md",
    "skill/scripts/ir.py",
    "skill/scripts/report.py",
    "skill/references/steps.md",
    "skill/references/formats.md",
    "skill/assets/meta_review.en.md",
    "skill/assets/meta_review.zh.md",
    "skill/assets/final_review.en.md",
    "skill/assets/final_review.zh.md",
    "skill/assets/report.css",
    "skill/assets/report.js",
    "skill/assets/schemas.en.json",
    "skill/assets/schemas.zh.json",
]
# 这些文件没有按插件需要改过，必须和源仓库逐字节一致。
UNCHANGED = [
    "assets/report.css",
    "assets/report.js",
    "assets/meta_review.en.md",
    "assets/meta_review.zh.md",
]
# 这些文件是有意分叉的（最终评审、报告、schema、参考文献），只检查接口，不检查字节。
DIVERGED = [
    "scripts/ir.py", "scripts/report.py",
    "references/steps.md", "references/formats.md",
    "assets/schemas.en.json", "assets/schemas.zh.json",
    "assets/final_review.en.md", "assets/final_review.zh.md",
    "SKILL.md",
]
SUBNOUNS = ["init", "next", "search", "fetch", "reviewers", "review", "chair"]
ACTIONS = ["init", "next", "search", "fetch", "reviewers", "review", "chair", "report"]

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail if not ok else ""))


def tail(proc: subprocess.CompletedProcess, limit: int = 240) -> str:
    text = ((proc.stdout or "") + (proc.stderr or "")).strip()
    return text[-limit:].replace("\n", " ⏎ ")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot(root: Path) -> dict[str, tuple[int, int, str]]:
    """相对路径 -> (size, mtime_ns, sha256)。用来证明测试没有写文件。"""
    snap: dict[str, tuple[int, int, str]] = {}
    if not root.is_dir():
        return snap
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            if name in SKIP_NAMES:
                continue
            path = Path(dirpath) / name
            try:
                stat = path.stat()
                snap[str(path.relative_to(root))] = (stat.st_size, stat.st_mtime_ns, sha256(path))
            except OSError as exc:
                snap[str(path.relative_to(root))] = (-1, -1, f"unreadable:{exc.__class__.__name__}")
    return snap


def diff_snapshot(before: dict, after: dict, limit: int = 5) -> list[str]:
    changes = [f"+{path}" for path in sorted(after.keys() - before.keys())]
    changes += [f"-{path}" for path in sorted(before.keys() - after.keys())]
    changes += [f"~{path}" for path in sorted(before.keys() & after.keys()) if before[path] != after[path]]
    return changes[:limit]


def run_py(script: Path, args: list[str], timeout: int = 180) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return subprocess.run(
        [PY, "-B", str(script), *args],
        cwd=str(PKG), env=env, text=True, capture_output=True, timeout=timeout,
    )


def write_json(root: Path, name: str, value) -> None:
    path = root / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# 静态资产 / 文档
# ---------------------------------------------------------------------------

def check_assets() -> None:
    missing = [name for name in EXPECTED if not (PKG / name).is_file()]
    check("skill assets present (13 files)", not missing, "missing: " + ", ".join(missing))

    empty = [name for name in DIVERGED if (SKILL / name).is_file() and (SKILL / name).stat().st_size == 0]
    check("diverged skill files exist and are non-empty", not empty, "empty: " + ", ".join(empty))

    if SRC.is_dir():
        bad = [name for name in UNCHANGED
               if sha256(ASSETS / Path(name).name) != sha256(SRC / "skill" / "idea-review" / name)]
        check("untouched assets byte-identical to source repo (css/js/meta_review)", not bad,
              "different: " + ", ".join(bad))
    else:
        check("untouched assets byte-identical to source repo (css/js/meta_review)", True,
              "source repo absent, skipped")


def check_interface() -> None:
    ir_path = SCRIPTS / "ir.py"
    check("ir.py exposes the chair subcommand in source",
          ir_path.is_file() and "cmd_chair" in ir_path.read_text(encoding="utf-8"))

    proc = run_py(ir_path, ["--help"])
    check("ir.py --help exits 0", proc.returncode == 0, tail(proc))
    missing = [word for word in SUBNOUNS if word not in (proc.stdout or "")]
    check("ir.py --help lists every subcommand including chair", not missing,
          "missing: " + ", ".join(missing))

    proc = run_py(SCRIPTS / "report.py", ["--help"])
    check("report.py --help exits 0", proc.returncode == 0, tail(proc))

    proc = run_py(ir_path, ["reviewers", "--writer", "other"])
    check("ir.py reviewers exits 0 (offline, no reviewer CLIs required)", proc.returncode == 0, tail(proc))

    for lang in ("zh", "en"):
        path = ASSETS / f"schemas.{lang}.json"
        ok, detail = False, "missing file"
        if path.is_file():
            try:
                schema = load_json(path)
                fr = schema["FinalReview"]
                standing = fr["$defs"]["IdeaStanding"]
                consensus = fr["$defs"]["FinalConsensusIssue"]
                required = {"verdict", "per_idea", "consensus", "disagreements", "top_risks",
                            "cheapest_experiments", "must_verify", "next_steps", "uncertainties"}
                ok = (required <= set(fr["required"])
                      and set(standing["properties"]["status"]["enum"]) == {"clear", "contested", "needs_evidence", "blocked"}
                      and set(consensus["properties"]["severity"]["enum"]) == {"fatal", "serious", "minor"})
                detail = "FinalReview fields/enums differ"
            except (ValueError, KeyError) as exc:
                detail = f"cannot read FinalReview: {exc}"
        check(f"schemas.{lang}.json carries the FinalReview schema", ok, detail)


def check_docs() -> None:
    for lang in ("zh", "en"):
        path = ASSETS / f"final_review.{lang}.md"
        text = path.read_text(encoding="utf-8") if path.is_file() else ""
        check(f"final_review.{lang}.md has system/user split and language placeholder",
              bool(text) and "---USER---" in text and "$language" in text)
    zh_prompt = (ASSETS / "final_review.zh.md").read_text(encoding="utf-8")
    en_prompt = (ASSETS / "final_review.en.md").read_text(encoding="utf-8").lower()
    check("final_review prompts describe the no-score / no-verdict rule",
          "不评分" in zh_prompt and "no scores" in en_prompt and "no worth-doing verdict" in en_prompt)

    steps = (REFS / "steps.md").read_text(encoding="utf-8")
    formats = (REFS / "formats.md").read_text(encoding="utf-8")
    check("steps.md documents the final review section",
          "## 11. 最终评审" in steps and "11_final_review.json" in steps
          and "final_review_prompt.md" in steps)
    check("formats.md documents 11_final_review.json",
          "## 11. 11_final_review.json" in formats and "FinalReview" in formats
          and "same_family_as_writer" in formats and "needs_evidence" in formats)


def check_skill_md() -> None:
    path = SKILL / "SKILL.md"
    check("SKILL.md exists", path.is_file())
    if not path.is_file():
        return
    text = path.read_text(encoding="utf-8")

    check("SKILL.md has no YAML frontmatter", not text.startswith("---"))
    check("SKILL.md has no shell/uv commands left",
          "uv run" not in text and "SKILL_DIR/scripts" not in text and "scripts/ir.py" not in text)
    missing = [a for a in ACTIONS if f'"action": "{a}"' not in text]
    check("SKILL.md documents all 8 idea_review actions", not missing, "missing: " + ", ".join(missing))
    check("SKILL.md documents the final review step (chair, finalReviewer, 11_final_review.json)",
          "finalReviewer" in text and "11_final_review.json" in text
          and "**11. 最终评审**" in text and "**12. 出报告**" in text)
    check("SKILL.md keeps the house rules section",
          "每一步都要守的规矩" in text and "不编造" in text and "不替用户拍板" in text)
    check("SKILL.md mentions the DSH run-history panel", "idea-review 面板" in text)


# ---------------------------------------------------------------------------
# init -> next -> report（中英文各一遍）
# ---------------------------------------------------------------------------

def pipeline(tmp: Path, tag: str, lang: str, idea: str) -> Path:
    run_dir = tmp / f"run-{tag}"

    proc = run_py(SCRIPTS / "ir.py", [
        "init", str(run_dir), "--idea", idea, "--lang", lang,
        "--writer", "other", "--writer-model", "smoke-test",
    ])
    check(f"{tag}: init exits 0", proc.returncode == 0, tail(proc))
    check(f"{tag}: init creates meta.json", (run_dir / "meta.json").is_file(), tail(proc))
    meta_ok = False
    if (run_dir / "meta.json").is_file():
        meta = load_json(run_dir / "meta.json")
        meta_ok = (meta.get("lang") == lang and meta.get("idea") == idea
                   and meta.get("writer", {}).get("family") == "other"
                   and meta.get("writer", {}).get("model") == "smoke-test")
    check(f"{tag}: meta.json records lang/idea/writer", meta_ok)

    proc = run_py(SCRIPTS / "ir.py", ["init", str(run_dir)])
    check(f"{tag}: second init is idempotent (exit 0)", proc.returncode == 0, tail(proc))

    proc = run_py(SCRIPTS / "ir.py", ["search", str(run_dir)])
    combined = (proc.stdout or "") + (proc.stderr or "")
    check(f"{tag}: search without 01_plan.json fails cleanly",
          proc.returncode == 1 and "01_plan.json" in combined, tail(proc))

    proc = run_py(SCRIPTS / "ir.py", ["next", str(run_dir)])
    check(f"{tag}: next exits 0", proc.returncode == 0, tail(proc))
    check(f"{tag}: next points at 01_plan.json", "01_plan.json" in (proc.stdout or ""), tail(proc))

    proc = run_py(SCRIPTS / "report.py", [str(run_dir)])
    check(f"{tag}: report exits 0", proc.returncode == 0, tail(proc))
    report_path = run_dir / "report.html"
    check(f"{tag}: report.html is written next to the run", report_path.is_file(), tail(proc))
    if not report_path.is_file():
        return run_dir

    html = report_path.read_text(encoding="utf-8")
    lowered = html.lower()
    check(f"{tag}: report is a self-contained HTML document",
          lowered.lstrip().startswith("<!doctype html>") and "<style" in lowered
          and "<link" not in lowered and "<script src" not in lowered.replace(" ", ""),
          "not a single-file html")
    check(f"{tag}: report embeds the idea text", idea in html)
    expected_lang = 'lang="zh-CN"' if lang == "zh" else 'lang="en"'
    check(f"{tag}: report language is {lang}", expected_lang in html)
    check(f"{tag}: report leaks no package paths",
          str(PKG) not in html and str(SKILL) not in html)
    return run_dir


# ---------------------------------------------------------------------------
# 最终评审回归：造一个 schema-valid 的运行，把 chair 流程整个跑一遍
# ---------------------------------------------------------------------------

PAPER = {
    "paper_id": "P03", "title": "LLM simulated survey responses", "year": 2025,
    "venue": "arXiv", "peer_reviewed": False, "citation_count": 12,
    "abstract": "We simulate survey respondents with LLMs.", "url": "https://example.org/p3",
    "authors": ["A. Author"], "local_path": False,
}
SCREEN = {"paper_id": "P03", "relevance": "high", "reason": "直接相关"}
NOTE = {
    "what_it_actually_does": "用三个模型模拟 2000 份问卷回答，和真实分布对比。",
    "problem": "能不能用 LLM 代替真人填问卷。",
    "method": "按人口统计条件采样生成回答。",
    "setup": "两个公开问卷数据集，三个模型。",
    "key_results": ["在态度类问题上分布接近真实（p.5）", "在事实类问题上偏差大（p.7）"],
    "abstract_vs_body": {"overclaims": [], "scope_gaps": ["只在英语问卷上测过（p.9）"]},
    "quality": {"paper_type": "empirical", "evidence_strength": "medium", "rigor": ["有基线（p.4）"],
                "reproducibility": "medium", "red_flags": [], "tier": "medium", "tier_reason": "样本偏小。"},
    "relevance_to_idea": "就是这个方向最接近的工作。",
    "limitations": ["只测了英语"], "open_questions": ["中文问卷没测（p.9）"],
}
LANDSCAPE = {
    "summary": "这个方向目前只在英语问卷上做过小规模验证。",
    "clusters": [{"name": "LLM 模拟受访者", "paper_ids": ["P03"], "summary": "条件采样生成回答。"}],
    "gaps": [{
        "kind": "missing_setting", "title": "中文问卷没试过", "description": "现有工作只覆盖英语问卷。",
        "evidence": [{"paper_id": "P03", "note": "只在英语问卷上测过（p.9）"}], "source": "authors_admit",
        "why_it_matters": "跨语言是主要风险。", "closest_read": [], "check_queries": ["llm survey simulation chinese"],
    }],
}
PROPOSAL = {
    "title": "跨语言问卷代答", "one_liner": "让模型先在中文问卷上复现真实分布。",
    "problem": "中文问卷能不能用 LLM 代替。",
    "why_existing_fail": "现有工作只覆盖英语（P03）。",
    "closest_work": [{"paper_id": "P03", "overlap": "同一类任务", "difference": "语言不同"}],
    "method": "条件采样 + 真实分布对比。",
    "minimal_experiment": {"setup": "取两个中文公开问卷", "data": "CFPS 子集", "baselines": ["随机抽样"],
                           "metrics": ["分布距离"], "duration": "两周"},
    "falsification": "分布距离不比随机好，就说明不成立。",
    "risks": ["数据授权"], "needs_checking": [], "questions_for_author": ["为什么是中文？"],
}
META_REVIEW = {
    "overlap": [{"paper_id": "P03", "title": "LLM simulated survey responses",
                 "what_it_actually_does": "英语问卷模拟（p.5）", "overlap": "同一任务",
                 "difference": "语言不同", "read_full_text": True}],
    "no_overlap_note": "",
    "abstract_body_mismatches": [],
    "causes_of_death": [{"reason": "中文问卷缺少可比基线", "basis": "P03 只给了英语基线（p.8）", "source": "paper"}],
    "feasibility": {"bottleneck": "中文问卷数据授权", "workaround": "用公开的 CFPS 子集"},
    "cheapest_falsification": {"experiment": "拿一个中文问卷跑 500 份", "compare_against": "随机抽样",
                               "metric": "分布距离", "kill_if": "和随机一样", "continue_if": "明显更好", "est_days": "3"},
    "questions_for_author": ["中文为什么更难？", "无监督怎么评估？", "算力够吗？"],
}
CHAIR = {
    "summary": {"summary": "两位评审都担心数据授权。",
                "consensus": [{"issue": "数据授权", "raised_by": ["codex", "claude"]}],
                "disagreements": [{"topic": "指标选择", "positions": ["codex：用 FID", "claude：用人口统计偏差"]}],
                "must_verify": ["P03 是否给了中文结果"]},
    "proposal_id": "I1",
}
FINAL_REVIEW = {
    "verdict": "这份 proposal 的跨语言问题是真问题，但数据授权会先卡住。",
    "per_idea": [{"proposal_id": "I1", "status": "needs_evidence", "summary": "方向成立但缺中文基线。",
                  "main_risks": ["数据授权", "指标不统一"], "supporting_papers": ["P03"]}],
    "consensus": [{"issue": "数据授权", "raised_by": ["codex", "claude"], "severity": "serious"}],
    "disagreements": [{"topic": "指标", "positions": ["codex：FID", "claude：人口统计偏差"],
                       "how_to_settle": "两个都算，看结论是否相反"}],
    "top_risks": ["拿不到中文问卷", "基线不可比", "跨语言差异不可控"],
    "cheapest_experiments": [{"experiment": "跑 500 份中文问卷", "for_idea": "I1",
                              "kill_if": "分布距离和随机一样", "est_days": "3"}],
    "must_verify": ["P03 有没有中文结果（p.9）"],
    "next_steps": ["先确认数据授权", "再决定指标"],
    "uncertainties": ["不清楚 CFPS 的授权条款"],
}


def check_chair(tmp: Path) -> None:
    run_dir = tmp / "run-chair"
    finalist = "codex:gpt-5.5-codex"

    proc = run_py(SCRIPTS / "ir.py", [
        "init", str(run_dir), "--idea", "让大模型代替真人填中文问卷",
        "--writer", "other", "--lang", "zh", "--refs", "1",
        "--final-reviewer", finalist,
    ])
    check("chair: init --final-reviewer exits 0", proc.returncode == 0, tail(proc))
    meta = load_json(run_dir / "meta.json") if (run_dir / "meta.json").is_file() else {}
    check("chair: init --final-reviewer is recorded in meta.json",
          (meta.get("final_review") or {}).get("reviewer") == finalist,
          str(meta.get("final_review")))

    for what, value, schema in (
        ("notes/P03.json (PaperReview)", NOTE, "PaperReview"),
        ("06_landscape.json (Landscape)", LANDSCAPE, "Landscape"),
        ("08_proposals.json entry (Proposal)", PROPOSAL, "Proposal"),
        ("09_meta_reviews.json entry (MetaReview)", META_REVIEW, "MetaReview"),
        ("10_chair.json summary (ChairSummary)", CHAIR["summary"], "ChairSummary"),
    ):
        errs = ir.check(value, schema)
        check(f"chair fixture: {what} is schema-valid", not errs, " :: ".join(errs))

    write_json(run_dir, "01_plan", {
        "restated_idea": "让模型代替真人填中文问卷，看能否复现分布。",
        "field": "计算社会科学",
        "core_concepts": ["LLM 模拟受访者", "问卷", "分布对齐"],
        "search_queries": ["llm survey simulation", "synthetic respondents"],
    })
    write_json(run_dir, "02_candidates", [PAPER])
    write_json(run_dir, "03_screen", [SCREEN])
    write_json(run_dir, "04_fulltext", {"P03": {"status": "ok", "text_path": "text/P03.txt", "pages": 9, "chars": 40000}})
    (run_dir / "text").mkdir(exist_ok=True)
    (run_dir / "text" / "P03.txt").write_text("全文……", encoding="utf-8")
    write_json(run_dir, "notes/P03", NOTE)
    write_json(run_dir, "05_reviews", [{"paper_id": "P03", "review": NOTE, "error": "", "truncated": False}])
    write_json(run_dir, "06_landscape", LANDSCAPE)
    write_json(run_dir, "07_seeds", {"seeds": []})
    write_json(run_dir, "08_proposals", [{"proposal_id": "I1", "proposal": PROPOSAL}])
    write_json(run_dir, "09_meta_reviews", [
        {"proposal_id": "I1", "reviewer": "codex", "model": "gpt-5.5", "family": "openai",
         "review": META_REVIEW, "error": ""},
        {"proposal_id": "I1", "reviewer": "claude", "model": "opus", "family": "anthropic",
         "review": META_REVIEW, "error": ""},
    ])
    write_json(run_dir, "10_chair", [CHAIR])

    proc = run_py(SCRIPTS / "ir.py", ["next", str(run_dir)])
    check("chair: next asks for the final review",
          proc.returncode == 0 and "最终评审" in (proc.stdout or "")
          and "第 11 节" in (proc.stdout or ""), tail(proc))

    proc = run_py(SCRIPTS / "ir.py", ["chair", str(run_dir), "--dump"])
    check("chair: chair --dump exits 0 (offline)", proc.returncode == 0, tail(proc))
    prompt_path = run_dir / "final_review_prompt.md"
    check("chair: chair --dump writes final_review_prompt.md", prompt_path.is_file(), tail(proc))
    if prompt_path.is_file():
        prompt = prompt_path.read_text(encoding="utf-8")
        needles = ["用户的原始 idea", "跨语言问卷代答", "codex", "数据授权", "P03", "FinalReview"]
        missing = [needle for needle in needles if needle not in prompt]
        check("chair: prompt carries the idea, proposal, reviewer, materials and FinalReview schema",
              not missing, "missing: " + ", ".join(missing))

    errs = ir.check(FINAL_REVIEW, "FinalReview")
    check("chair fixture: final review is schema-valid", not errs, " :: ".join(errs))
    write_json(run_dir, "11_final_review", {
        "reviewer": "self", "family": "other", "same_family_as_writer": True,
        "generated_at": "2026-11-02T17:00:00",
        "inputs": {"proposals": 1, "meta_reviews": 2, "chairs": 1},
        "review": FINAL_REVIEW, "error": "",
    })

    proc = run_py(SCRIPTS / "ir.py", ["next", str(run_dir)])
    check("chair: a valid 11_final_review.json makes next move on to the report",
          proc.returncode == 0 and "report.py" in (proc.stdout or ""), tail(proc))

    write_json(run_dir, "11_final_review", {"reviewer": "x", "review": {"verdict": 1}})
    proc = run_py(SCRIPTS / "ir.py", ["next", str(run_dir)])
    combined = (proc.stdout or "") + (proc.stderr or "")
    check("chair: next rejects a malformed 11_final_review.json",
          "格式有问题" in combined and "FinalReview" in combined, tail(proc))


# ---------------------------------------------------------------------------

def main() -> int:
    pkg_before = snapshot(PKG)
    src_before = snapshot(SRC) if SRC.is_dir() else None
    tmp = Path(tempfile.mkdtemp(prefix="dsh-idea-review-smoke-"))
    try:
        check_assets()
        check_interface()
        check_docs()
        check_skill_md()
        zh_run = pipeline(tmp, "zh", "zh", "用 LLM 自动做文献综述，减少人工筛选")
        en_run = pipeline(tmp, "en", "en", "Automated literature review with LLMs to cut manual screening")
        check_chair(tmp)
        check("runs are created under the temp dir",
              all(tmp in path.parents for path in (zh_run, en_run, tmp / "run-chair")))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    check("temp dir is removed after the test", not tmp.exists())

    pkg_changes = diff_snapshot(pkg_before, snapshot(PKG))
    check("package directory is untouched by the test (ignoring __pycache__)",
          not pkg_changes, "; ".join(pkg_changes))
    if src_before is None:
        check("read-only source repo is untouched by the test", True, "source repo absent, skipped")
    else:
        src_changes = diff_snapshot(src_before, snapshot(SRC))
        check("read-only source repo is untouched by the test", not src_changes, "; ".join(src_changes))

    failed = 0
    for name, ok, detail in results:
        if ok:
            print(f"PASS  {name}")
        else:
            failed += 1
            print(f"FAIL  {name}" + (f"  [{detail}]" if detail else ""))
    if failed:
        print(f"\n{failed}/{len(results)} checks FAILED")
        return 1
    print(f"\nAll {len(results)} checks PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())

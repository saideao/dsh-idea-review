#!/usr/bin/env python3
"""dsh-idea-review skill 冒烟测试：离线跑通 python 侧，只用标准库。

从包目录运行：

    cd dsh-idea-review && python3 test/smoke.py

检查内容：
  1. skill 资产齐全，脚本 / references / assets 和源仓库逐字节一致。
  2. SKILL.md 已改成 DSH 的 `idea_review` 工具写法（没有 frontmatter、没有 `uv run`）。
  3. `ir.py --help`、`report.py --help`、`ir.py reviewers` 正常退出。
  4. 中文运行 init -> next -> report，报告是自包含 HTML，包含 idea 原文。
  5. 英文运行同样跑一遍，报告是英文。
  6. 失败路径（没写 01_plan.json 就 search）干净退出，不是崩溃。
  7. 所有产物都在临时目录里并且被清掉；包目录和只读源仓库前后一字节未变。
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

PKG = Path(__file__).resolve().parent.parent
SKILL = PKG / "skill"
SCRIPTS = SKILL / "scripts"
REFS = SKILL / "references"
ASSETS = SKILL / "assets"
SRC = Path(os.environ.get("IDEA_REVIEW_SRC", "/Users/sidelau/Desktop/idea-review"))
PY = sys.executable or "python3"

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
    "skill/assets/report.css",
    "skill/assets/report.js",
    "skill/assets/schemas.en.json",
    "skill/assets/schemas.zh.json",
]
# 这些文件必须和源仓库逐字节一致（SKILL.md 是改写过的，不在内）。
VERBATIM = [
    "scripts/ir.py", "scripts/report.py",
    "references/steps.md", "references/formats.md",
    "assets/meta_review.en.md", "assets/meta_review.zh.md",
    "assets/report.css", "assets/report.js",
    "assets/schemas.en.json", "assets/schemas.zh.json",
]

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
            except OSError as exc:  # 读不了也算一个稳定的标记
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


def check_assets() -> None:
    missing = [name for name in EXPECTED if not (PKG / name).is_file()]
    check("skill assets present (11 files)", not missing, "missing: " + ", ".join(missing))

    if SRC.is_dir():
        bad = [name for name in VERBATIM if sha256(SKILL / name) != sha256(SRC / "skill" / "idea-review" / name)]
        check("scripts/references/assets byte-identical to source repo", not bad,
              "different: " + ", ".join(bad))
    else:
        check("scripts/references/assets byte-identical to source repo", True,
              "source repo absent, skipped")


def check_skill_md() -> None:
    path = SKILL / "SKILL.md"
    check("SKILL.md exists", path.is_file())
    if not path.is_file():
        return
    text = path.read_text(encoding="utf-8")

    check("SKILL.md has no YAML frontmatter", not text.startswith("---"))
    check("SKILL.md has no shell/uv commands left",
          "uv run" not in text and "SKILL_DIR/scripts" not in text and "scripts/ir.py" not in text)
    actions = ["init", "next", "search", "fetch", "reviewers", "review", "report"]
    missing = [a for a in actions if f'"action": "{a}"' not in text]
    check("SKILL.md documents all 7 idea_review actions", not missing, "missing: " + ", ".join(missing))
    check("SKILL.md keeps the house rules section",
          "每一步都要守的规矩" in text and "不编造" in text and "不替用户拍板" in text)
    check("SKILL.md mentions the DSH run-history panel", "idea-review 面板" in text)


def check_help() -> None:
    proc = run_py(SCRIPTS / "ir.py", ["--help"])
    check("ir.py --help exits 0", proc.returncode == 0, tail(proc))
    check("ir.py --help lists every subcommand",
          all(word in (proc.stdout or "") for word in
              ("init", "next", "search", "fetch", "reviewers", "review")),
          tail(proc))

    proc = run_py(SCRIPTS / "report.py", ["--help"])
    check("report.py --help exits 0", proc.returncode == 0, tail(proc))

    proc = run_py(SCRIPTS / "ir.py", ["reviewers", "--writer", "other"])
    check("ir.py reviewers exits 0 (offline, no reviewer CLIs required)", proc.returncode == 0, tail(proc))


def pipeline(tmp: Path, tag: str, lang: str, idea: str) -> Path:
    run_dir = tmp / f"run-{tag}"

    # 0. init
    proc = run_py(SCRIPTS / "ir.py", [
        "init", str(run_dir), "--idea", idea, "--lang", lang,
        "--writer", "other", "--writer-model", "smoke-test",
    ])
    check(f"{tag}: init exits 0", proc.returncode == 0, tail(proc))
    check(f"{tag}: init creates meta.json", (run_dir / "meta.json").is_file(), tail(proc))
    meta_ok = False
    if (run_dir / "meta.json").is_file():
        meta = json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))
        meta_ok = (meta.get("lang") == lang and meta.get("idea") == idea
                   and meta.get("writer", {}).get("family") == "other"
                   and meta.get("writer", {}).get("model") == "smoke-test")
    check(f"{tag}: meta.json records lang/idea/writer", meta_ok)

    # init 幂等：再跑一次不带 idea 也成功
    proc = run_py(SCRIPTS / "ir.py", ["init", str(run_dir)])
    check(f"{tag}: second init is idempotent (exit 0)", proc.returncode == 0, tail(proc))

    # 失败路径：没写 01_plan.json 就 search，应该干净退出并提示
    proc = run_py(SCRIPTS / "ir.py", ["search", str(run_dir)])
    combined = (proc.stdout or "") + (proc.stderr or "")
    check(f"{tag}: search without 01_plan.json fails cleanly",
          proc.returncode == 1 and "01_plan.json" in combined, tail(proc))

    # 1. next
    proc = run_py(SCRIPTS / "ir.py", ["next", str(run_dir)])
    check(f"{tag}: next exits 0", proc.returncode == 0, tail(proc))
    check(f"{tag}: next points at 01_plan.json", "01_plan.json" in (proc.stdout or ""), tail(proc))

    # 2. report
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


def main() -> int:
    pkg_before = snapshot(PKG)
    src_before = snapshot(SRC) if SRC.is_dir() else None
    tmp = Path(tempfile.mkdtemp(prefix="dsh-idea-review-smoke-"))
    try:
        check_assets()
        check_skill_md()
        check_help()
        zh_run = pipeline(tmp, "zh", "zh", "用 LLM 自动做文献综述，减少人工筛选")
        en_run = pipeline(tmp, "en", "en", "Automated literature review with LLMs to cut manual screening")
        check("runs are created under the temp dir",
              all(tmp in path.parents for path in (zh_run, en_run)))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    check("temp dir is removed after the test", not tmp.exists())

    pkg_changes = diff_snapshot(pkg_before, snapshot(PKG))
    check("package directory is untouched by the test", not pkg_changes, "; ".join(pkg_changes))
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

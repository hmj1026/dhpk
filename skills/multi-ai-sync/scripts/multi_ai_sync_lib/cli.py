"""multi-ai-sync CLI 整合。"""

import argparse
import json
import os

from .apply_sync_v2 import (
    apply_plan,
    load_plan,
    render_apply_markdown,
    render_manual_draft_markdown,
    render_self_test_markdown,
    run_self_tests,
    update_tasks_from_apply_report,
)
from .constants import TARGETS_DEFAULT
from .mapping import build_plan, generate_tasks, render_plan_markdown
from .utils import read_text, safe_exists, write_or_print
from .validation import render_validation_markdown, run_validation


def cmd_plan(args):
    repo_root = os.path.abspath(args.root)
    plan = build_plan(repo_root, args.targets)

    if args.format == "json":
        payload = json.dumps(plan, indent=2, sort_keys=True)
    else:
        payload = render_plan_markdown(plan)

    write_or_print(payload, args.output)


def cmd_tasks(args):
    if not safe_exists(args.plan):
        print("找不到 plan file: %s" % args.plan)
        return 1
    plan = json.loads(read_text(args.plan))
    tasks_md = generate_tasks(plan, args.change_name)
    write_or_print(tasks_md, args.output)
    return 0


def cmd_validate(args):
    repo_root = os.path.abspath(args.root)
    report = run_validation(repo_root)
    if args.format == "json":
        payload = json.dumps(report, indent=2, sort_keys=True)
    else:
        payload = render_validation_markdown(report)
    write_or_print(payload, args.output)
    if report["gate"] == "FAIL":
        return 2
    return 0


def cmd_apply(args):
    if not safe_exists(args.plan):
        print("找不到 plan file: %s" % args.plan)
        return 1
    repo_root = os.path.abspath(args.root)
    plan = load_plan(args.plan)
    report = apply_plan(
        plan,
        repo_root,
        dry_run=args.dry_run,
        codex_skill_fallback_roots=args.codex_skills_fallback_roots,
        sync_run_id=args.sync_run_id,
    )
    if args.update_tasks and not args.dry_run:
        tasks_path_abs = os.path.abspath(os.path.join(repo_root, args.update_tasks))
        report["tasks_update"] = update_tasks_from_apply_report(tasks_path_abs, report)
    if args.manual_draft_output and not args.dry_run:
        draft_path_abs = os.path.abspath(os.path.join(repo_root, args.manual_draft_output))
        draft_md = render_manual_draft_markdown(report)
        draft_dir = os.path.dirname(draft_path_abs)
        if draft_dir and not os.path.isdir(draft_dir):
            os.makedirs(draft_dir)
        with open(draft_path_abs, "w") as fh:
            fh.write(draft_md)
        report["manual_draft"] = {
            "output_path": draft_path_abs,
            "generated": True,
        }
    if args.format == "json":
        payload = json.dumps(report, indent=2, sort_keys=True)
    else:
        payload = render_apply_markdown(report)
    write_or_print(payload, args.output)
    if report["summary"]["failed"] > 0:
        return 2
    return 0


def cmd_self_test(args):
    report = run_self_tests()
    if args.format == "json":
        payload = json.dumps(report, indent=2, sort_keys=True)
    else:
        payload = render_self_test_markdown(report)
    write_or_print(payload, args.output)
    if report.get("failed", 0) > 0:
        return 2
    return 0


def build_parser():
    parser = argparse.ArgumentParser(description="Claude-first 多平台 sync helper")
    parser.add_argument("--root", default=".", help="Repository root 路徑")

    sub = parser.add_subparsers(dest="command")

    p_plan = sub.add_parser("plan", help="產生 sync plan")
    p_plan.add_argument("--targets", nargs="+", default=TARGETS_DEFAULT, choices=["codex", "gemini", "antigravity"], help="Target 平台")
    p_plan.add_argument("--format", choices=["markdown", "json"], default="markdown")
    p_plan.add_argument("--output", default="", help="把結果寫入檔案")
    p_plan.set_defaults(func=cmd_plan)

    p_tasks = sub.add_parser("openspec-tasks", help="由 plan json 產生 OpenSpec tasks")
    p_tasks.add_argument("--plan", required=True, help="`plan --format json` 產出的 plan json 路徑")
    p_tasks.add_argument("--change-name", required=True, help="OpenSpec change name")
    p_tasks.add_argument("--output", default="", help="把 tasks markdown 寫入檔案")
    p_tasks.set_defaults(func=cmd_tasks)

    p_validate = sub.add_parser("validate", help="執行 post-sync validation gate")
    p_validate.add_argument("--format", choices=["markdown", "json"], default="markdown")
    p_validate.add_argument("--output", default="", help="把 validation 輸出寫入檔案")
    p_validate.set_defaults(func=cmd_validate)

    p_apply = sub.add_parser("apply", help="把 plan 內 adapted 項目套用到 target 平台")
    p_apply.add_argument("--plan", required=True, help="`plan --format json` 產出的 plan json 路徑")
    p_apply.add_argument("--dry-run", action="store_true", help="只輸出報告，不寫入檔案")
    p_apply.add_argument("--sync-run-id", default="", help="本次同步 run id（不給則自動產生）")
    p_apply.add_argument(
        "--codex-skills-fallback-roots",
        nargs="+",
        default=["artifacts/codex-skills-fallback", ".agent/skills", ".agents/skills", "~/.codex/skills"],
        help="當 .codex/skills 不可寫時，依序嘗試 fallback roots（.agent/skills 為 canonical，.agents/skills 為 legacy alias）",
    )
    p_apply.add_argument("--update-tasks", default="", help="依 apply 結果回寫 tasks checkbox")
    p_apply.add_argument("--manual-draft-output", default="", help="把 manual 項目轉成 reviewer-ready 草稿檔")
    p_apply.add_argument("--format", choices=["markdown", "json"], default="markdown")
    p_apply.add_argument("--output", default="", help="把 apply 報告寫入檔案")
    p_apply.set_defaults(func=cmd_apply)

    p_self_test = sub.add_parser("self-test", help="執行 converter/self-check 測試")
    p_self_test.add_argument("--format", choices=["markdown", "json"], default="markdown")
    p_self_test.add_argument("--output", default="", help="把 self-test 報告寫入檔案")
    p_self_test.set_defaults(func=cmd_self_test)

    return parser


def main(argv):
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        parser.print_help()
        return 1
    return args.func(args)

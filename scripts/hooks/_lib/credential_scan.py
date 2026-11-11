"""Bounded metadata-only traversal for recursive credential absence proofs."""

import math
import os
from pathlib import Path
import stat
import time

MAX_ENTRIES = 20000
MAX_SECONDS = 0.300
TEST_BUDGET_FLOOR = 0.300
TEST_BUDGET_CEILING = 10.0


def budget_seconds(env=os.environ, default=None):
    """Time budget for one bounded scan or git listing.

    Production is always `default` (MAX_SECONDS, 300 ms). A test harness running the
    hook as a subprocess may raise it with DHPK_CREDENTIAL_TEST_MAX_SECONDS, but only
    together with DHPK_TEST_MODE=1; the value is clamped to [0.300, 10.0] so it can
    never shorten the budget, and anything unparsable or non-finite is ignored.
    """
    base = MAX_SECONDS if default is None else default
    if env.get('DHPK_TEST_MODE') != '1':
        return base
    try:
        value = float(env.get('DHPK_CREDENTIAL_TEST_MAX_SECONDS', ''))
    except ValueError:
        return base
    if not math.isfinite(value):
        return base
    return min(max(value, TEST_BUDGET_FLOOR), TEST_BUDGET_CEILING)


def scan_roots(roots, matching_patterns, unresolved, follow, clock=time.monotonic, scandir=os.scandir):
    deadline = clock() + budget_seconds()
    count = 0
    hits = set()
    paths = []

    def check_time():
        if clock() > deadline:
            raise TimeoutError()

    def record(path, matches):
        if matches:
            hits.update(matches)
            if path not in paths and len(paths) < 3:
                paths.append(path)

    def examine(logical, physical, root=False):
        nonlocal count
        check_time()
        info = os.lstat(physical)
        check_time()
        link = stat.S_ISLNK(info.st_mode)
        # 根路徑可能穿過父層連結，必須同時保留邏輯路徑與嚴格解析後的實體路徑。
        target = str(Path(physical).resolve(strict=True)) if root or link else physical
        check_time()
        target_info = os.stat(target) if link else info
        check_time()
        logical_matches = matching_patterns(logical)
        physical_matches = matching_patterns(target)
        # 部分排除無法保證連結別名被排除；目標受保護時仍須拒絕。
        selected = (logical_matches | physical_matches) if root or link else ((logical_matches | physical_matches) & unresolved)
        record(logical, selected)
        if selected:
            return
        if stat.S_ISDIR(target_info.st_mode):
            if link and not root:
                if follow:
                    raise ValueError('followed directory symlink')
                return
            # root 執行者仍可讀 chmod 000；同時檢查 mode 與實際權限。
            if not target_info.st_mode & 0o444 or not target_info.st_mode & 0o111 or not os.access(target, os.R_OK | os.X_OK):
                raise PermissionError()
            check_time()
            with scandir(target) as entries:
                check_time()
                for entry in entries:
                    check_time()
                    count += 1
                    if count > MAX_ENTRIES:
                        raise OverflowError()
                    examine(os.path.join(logical, entry.name), os.path.join(target, entry.name))
                    check_time()
        check_time()

    try:
        for root in roots:
            check_time()
            # 先消去 .. 會改變連結後的實體目標；保留原始路徑供作業系統解析。
            physical = root if os.path.isabs(root) else os.path.join(os.getcwd(), root)
            examine(os.path.abspath(physical), physical, True)
        check_time()
    except TimeoutError:
        return 'time limit', hits, paths
    except OverflowError:
        return 'entry limit', hits, paths
    except (OSError, ValueError, RuntimeError, RecursionError):
        return 'unreadable or unsafe path', hits, paths
    return None, hits, paths

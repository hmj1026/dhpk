"""General utility helpers."""

import datetime
import glob
import json
import os
import re


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def relpath(path, root):
    return os.path.relpath(path, root).replace("\\", "/")


def read_text(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def safe_exists(path):
    return os.path.exists(path)


def uniq(items):
    seen = set()
    output = []
    for item in items:
        if item not in seen:
            output.append(item)
            seen.add(item)
    return output


def parse_frontmatter_keys(path):
    if not safe_exists(path):
        return []
    txt = read_text(path)
    if not txt.startswith("---"):
        return []
    parts = txt.split("---", 2)
    if len(parts) < 3:
        return []
    frontmatter = parts[1]
    keys = []
    for line in frontmatter.splitlines():
        match = re.match(r"^([A-Za-z0-9_-]+):", line.strip())
        if match:
            keys.append(match.group(1))
    return keys


def parse_json_ok(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            json.load(fh)
        return True
    except Exception:
        return False


def parse_toml_like_ok(path, required_tokens):
    if not safe_exists(path):
        return False
    txt = read_text(path)
    for token in required_tokens:
        if token not in txt:
            return False
    return True


def has_any_files(path):
    return bool([p for p in glob.glob(os.path.join(path, "**/*"), recursive=True) if os.path.isfile(p)])


def write_or_print(content, out_path):
    if out_path:
        out_dir = os.path.dirname(out_path)
        if out_dir and not os.path.isdir(out_dir):
            os.makedirs(out_dir)
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(content)
        print("已寫入 %s" % out_path)
    else:
        print(content)

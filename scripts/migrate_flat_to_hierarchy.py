#!/usr/bin/env python3
"""
将 MindNote 旧版扁平 md 结构迁移为分层目录结构。

旧结构示例:
  demo.mn/
    map.mn
    md/
      Root.md
      Child.md
      Node A.md

新结构示例:
  demo.mn/
    map.mn
    md/
      Root.md
      Root/
        Child.md
        Node A.md

用法:
  python scripts/migrate_flat_to_hierarchy.py /path/to/demo.mn
  python scripts/migrate_flat_to_hierarchy.py /path/to/demo.mn --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ILLEGAL_CHARS = re.compile(r'[\\/:*?"<>|]')


@dataclass
class MoveOp:
    old_rel: str
    new_rel: str
    old_abs: Path
    temp_abs: Path
    new_abs: Path


def sanitize_filename(name: str) -> str:
    return ILLEGAL_CHARS.sub('_', name).strip()


def normalize_rel(path: str) -> str:
    return path.replace('\\', '/').strip('/')


def basename(path: str) -> str:
    return normalize_rel(path).split('/')[-1]


def strip_md(path: str) -> str:
    return path[:-3] if path.endswith('.md') else path


def plan_new_paths(node: dict[str, Any], parent_rel: str | None) -> None:
    current = normalize_rel(node.get('filepath') or '')
    if not current:
        current = f"{sanitize_filename(node.get('topic', 'Untitled'))}.md"

    if parent_rel:
        target = normalize_rel(f"{strip_md(parent_rel)}/{basename(current)}")
    else:
        target = current

    node['_old_filepath'] = current
    node['_new_filepath'] = target

    for child in node.get('children') or []:
        plan_new_paths(child, target)


def collect_moves(node: dict[str, Any], md_dir: Path, moves: list[MoveOp], index_counter: list[int]) -> None:
    old_rel = node['_old_filepath']
    new_rel = node['_new_filepath']

    if old_rel != new_rel:
        idx = index_counter[0]
        index_counter[0] += 1
        old_abs = md_dir / old_rel
        temp_abs = md_dir / f"{old_rel}.mn_migrate_tmp_{idx}"
        new_abs = md_dir / new_rel
        moves.append(MoveOp(old_rel, new_rel, old_abs, temp_abs, new_abs))

    for child in node.get('children') or []:
        collect_moves(child, md_dir, moves, index_counter)


def ensure_no_conflicts(moves: list[MoveOp]) -> None:
    old_set = {m.old_abs.resolve() for m in moves}
    new_set: set[Path] = set()

    for move in moves:
        target = move.new_abs.resolve()

        if target in new_set:
            raise RuntimeError(f"目标路径重复: {move.new_abs}")
        new_set.add(target)

        if move.new_abs.exists() and target not in old_set:
            raise RuntimeError(f"目标路径已存在，迁移中止: {move.new_abs}")


def execute_moves(moves: list[MoveOp], dry_run: bool) -> None:
    # phase 1: old -> temp
    for m in moves:
        if not m.old_abs.exists():
            print(f"[WARN] 源文件不存在，跳过: {m.old_abs}")
            continue

        print(f"[MOVE-1] {m.old_abs} -> {m.temp_abs}")
        if not dry_run:
            m.temp_abs.parent.mkdir(parents=True, exist_ok=True)
            m.old_abs.rename(m.temp_abs)

    # phase 2: temp -> new
    for m in moves:
        if not m.temp_abs.exists() and not dry_run:
            continue

        print(f"[MOVE-2] {m.temp_abs} -> {m.new_abs}")
        if not dry_run:
            m.new_abs.parent.mkdir(parents=True, exist_ok=True)
            m.temp_abs.rename(m.new_abs)


def cleanup_meta(node: dict[str, Any]) -> None:
    node.pop('_old_filepath', None)
    node['filepath'] = node.pop('_new_filepath', node.get('filepath', ''))
    for child in node.get('children') or []:
        cleanup_meta(child)


def main() -> int:
    parser = argparse.ArgumentParser(description='迁移 MindNote 扁平 md 结构到分层目录结构')
    parser.add_argument('bundle', help='MindNote bundle 路径（*.mn 目录）')
    parser.add_argument('--dry-run', action='store_true', help='仅打印变更，不写入')
    args = parser.parse_args()

    bundle = Path(args.bundle).expanduser().resolve()
    md_dir = bundle / 'md'
    map_file = bundle / 'map.mn'

    if not bundle.exists() or not bundle.is_dir():
        raise RuntimeError(f"bundle 不存在或不是目录: {bundle}")
    if not md_dir.exists() or not md_dir.is_dir():
        raise RuntimeError(f"md 目录不存在: {md_dir}")
    if not map_file.exists() or not map_file.is_file():
        raise RuntimeError(f"map.mn 不存在: {map_file}")

    data = json.loads(map_file.read_text(encoding='utf-8'))
    root = data.get('nodeData')
    if not isinstance(root, dict):
        raise RuntimeError('map.mn 格式错误: 缺少 nodeData')

    plan_new_paths(root, None)
    moves: list[MoveOp] = []
    collect_moves(root, md_dir, moves, [0])

    print(f"计划迁移文件数: {len(moves)}")
    if not moves:
        cleanup_meta(root)
        print('无需迁移。')
        return 0

    ensure_no_conflicts(moves)
    execute_moves(moves, args.dry_run)

    cleanup_meta(root)
    if not args.dry_run:
        map_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f"已更新: {map_file}")
    else:
        print('[DRY-RUN] 未写入 map.mn')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())

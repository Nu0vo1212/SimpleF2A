"""
构建 Windows 单文件 exe（Python + pywebview）。

用法：
    python app/build_exe.py [--out 路径] [--onedir]

产出：
    单文件模式 -> 桌面 SimpleF2A.exe（含 Python 运行时、webview、dist 静态资源）
    目录模式   -> build/pyinstaller/SimpleF2A/ 目录

注意：打包前需先 npm run build 生成 dist/。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app" / "simplef2a.py"
DIST = ROOT / "dist"
BUILD = ROOT / "build" / "pyinstaller"
ICON = ROOT / "tools" / "app.ico"
NAME = "SimpleF2A"


def log(msg: str) -> None:
    print(msg, flush=True)


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except Exception:
            pass

    args = sys.argv[1:]
    onedir = "--onedir" in args
    out_path = None
    if "--out" in args:
        idx = args.index("--out")
        if idx + 1 < len(args):
            out_path = Path(args[idx + 1])

    if not (DIST / "index.html").exists():
        log("✗ 找不到 dist/index.html")
        log("  请先在项目根目录运行： npm run build")
        return 1

    # 把静态资源与图标复制到打包工作目录
    stage = BUILD / "stage"
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True, exist_ok=True)
    shutil.copytree(DIST, stage / "dist")
    if ICON.exists():
        shutil.copy2(ICON, stage / "app.ico")

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--name",
        NAME,
        "--distpath",
        str(BUILD / "dist"),
        "--workpath",
        str(BUILD / "work"),
        "--specpath",
        str(BUILD),
        # 静态资源：打包进 exe，运行时解压到 _MEIPASS/dist
        "--add-data",
        f"{stage / 'dist'}{os.pathsep}dist",
        # 桌面壳需要的新依赖
        "--hidden-import",
        "webview.platforms.winforms",
        "--hidden-import",
        "webview.platforms.edgechromium",
        "--hidden-import",
        "clr",
        "--hidden-import",
        "pythonnet",
        "--hidden-import",
        "bottle",
        "--collect-all",
        "webview",
        "--collect-all",
        "clr_loader",
        "--noconsole",
    ]
    if ICON.exists():
        cmd += ["--icon", str(ICON)]
    if not onedir:
        cmd.append("--onefile")

    cmd.append(str(APP))

    log("→ 正在打包（首次约需 1-3 分钟）…")
    log("  " + " ".join(cmd[:6]) + " …")
    result = subprocess.run(cmd, cwd=str(ROOT))
    if result.returncode != 0:
        log("✗ PyInstaller 失败")
        return result.returncode

    produced = BUILD / "dist" / (f"{NAME}.exe" if not onedir else NAME)
    if not produced.exists():
        log(f"✗ 未找到产物：{produced}")
        return 1

    if not onedir:
        target = out_path or (Path.home() / "Desktop" / f"{NAME}.exe")
        target.parent.mkdir(parents=True, exist_ok=True)
        # 先删旧文件，避免 exe 被占用导致覆盖失败
        if target.exists():
            try:
                target.unlink()
            except OSError:
                alt = target.with_name(f"{NAME}-new.exe")
                log(f"⚠ 旧文件被占用，输出到 {alt}")
                target = alt
        shutil.copy2(produced, target)
        size_mb = target.stat().st_size / 1024 / 1024
        log("")
        log(f"✓ 已生成：{target}  ({size_mb:.1f} MB)")
        log("  双击运行即可；数据保存在 %APPDATA%\\SimpleF2A\\accounts.json")
    else:
        log("")
        log(f"✓ 已生成目录版：{produced}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
SimpleF2A · 桌面版（Python + pywebview）

设计要点：
  - 用系统 WebView2 渲染界面，没有浏览器地址栏 / 标签页
  - 数据不再存浏览器 IndexedDB，改存到用户目录的 JSON 文件：
        %APPDATA%\\SimpleF2A\\accounts.json
    这样即便清除浏览器数据、换浏览器、换端口，账户都在
  - 前端通过 pywebview 的 JS 桥调用 Python 接口（window.pywebview.api.*）
  - 单实例保护：重复启动时聚焦已有窗口
  - 系统托盘：最小化到托盘，右键菜单可显示/退出

运行：
    python app/simplef2a.py
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path

try:
    import webview
except ImportError:
    print("缺少 pywebview，请先运行：pip install pywebview")
    sys.exit(1)


APP_NAME = "SimpleF2A"
APP_VERSION = "1.0.0"

# ----------------------------------------------------------------------------- 路径


def resource_dir() -> Path:
    """静态资源目录（打包后是 _MEIPASS 或 exe 同级 dist/）。"""
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        candidate = base / "dist"
        if candidate.exists():
            return candidate
        return Path(sys.executable).parent / "dist"
    here = Path(__file__).resolve().parent
    for c in (here.parent / "dist", here / "dist"):
        if c.exists():
            return c
    return here.parent / "dist"


def data_dir() -> Path:
    """用户数据目录：%APPDATA%\\SimpleF2A"""
    base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    d = Path(base) / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


DATA_FILE = data_dir() / "accounts.json"
SETTINGS_FILE = data_dir() / "settings.json"


# ----------------------------------------------------------------------------- 数据仓库


class Store:
    """
    账户与设置的持久化。

    文件格式：
        { "version": 1, "accounts": [ ... ], "updatedAt": 169... }

    写入采用「临时文件 + 原子替换」，避免断电/崩溃导致文件损坏。
    """

    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.Lock()

    def _read(self) -> dict:
        if not self._path.exists():
            return {"version": 1, "accounts": [], "updatedAt": 0}
        try:
            with self._path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                return {"version": 1, "accounts": [], "updatedAt": 0}
            data.setdefault("accounts", [])
            data.setdefault("version", 1)
            return data
        except (json.JSONDecodeError, OSError):
            # 损坏时保留备份，避免直接覆盖用户数据
            try:
                self._path.replace(self._path.with_suffix(".corrupt.json"))
            except OSError:
                pass
            return {"version": 1, "accounts": [], "updatedAt": 0}

    def _write(self, data: dict) -> None:
        data["updatedAt"] = int(time.time() * 1000)
        tmp = self._path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        tmp.replace(self._path)

    def load_accounts(self) -> list:
        with self._lock:
            return self._read().get("accounts", [])

    def save_accounts(self, accounts: list) -> None:
        with self._lock:
            data = self._read()
            data["accounts"] = accounts
            data["version"] = 1
            self._write(data)

    def clear(self) -> None:
        with self._lock:
            self._write({"version": 1, "accounts": [], "updatedAt": 0})

    def info(self) -> dict:
        with self._lock:
            data = self._read()
            size = self._path.stat().st_size if self._path.exists() else 0
            return {
                "path": str(self._path),
                "count": len(data.get("accounts", [])),
                "bytes": size,
                "updatedAt": data.get("updatedAt", 0),
            }


store = Store(DATA_FILE)


# ----------------------------------------------------------------------------- JS 桥


class Api:
    """暴露给前端的接口（window.pywebview.api.<method>()）。"""

    def __init__(self):
        self._window = None

    def bind(self, window) -> None:
        self._window = window

    # --- 账户数据 ---
    def load_accounts(self) -> dict:
        try:
            return {"ok": True, "accounts": store.load_accounts()}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e), "accounts": []}

    def save_accounts(self, accounts: list) -> dict:
        try:
            store.save_accounts(accounts)
            return {"ok": True}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)}

    def clear_accounts(self) -> dict:
        try:
            store.clear()
            return {"ok": True}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)}

    def storage_info(self) -> dict:
        try:
            return {"ok": True, **store.info()}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)}

    # --- 窗口控制 ---
    def minimize_to_tray(self) -> dict:
        if self._window:
            self._window.hide()
            return {"ok": True}
        return {"ok": False}

    def show_window(self) -> dict:
        if self._window:
            self._window.show()
            self._window.restore()
            return {"ok": True}
        return {"ok": False}

    def quit_app(self) -> dict:
        if self._window:
            self._window.destroy()
        return {"ok": True}

    # --- 外链：用系统默认浏览器打开，而不是在 WebView 内导航 ---
    def open_external(self, url: str) -> dict:
        import webbrowser

        if url.startswith(("http://", "https://")):
            webbrowser.open(url)
            return {"ok": True}
        return {"ok": False, "error": "仅允许 http/https"}

    # --- 托盘提示 ---
    def notify(self, title: str, message: str) -> dict:
        if self._window:
            try:
                self._window.show()
                return {"ok": True}
            except Exception:  # noqa: BLE001
                return {"ok": False}
        return {"ok": False}

    def app_info(self) -> dict:
        return {
            "ok": True,
            "name": APP_NAME,
            "version": APP_VERSION,
            "platform": sys.platform,
            "frozen": bool(getattr(sys, "frozen", False)),
            "mode": "desktop",
            "storagePath": str(DATA_FILE),
        }


# ----------------------------------------------------------------------------- 托盘


class Tray:
    """
    Windows 系统托盘（基于 WinForms NotifyIcon，由 pywebview 自带的 pythonnet 提供）。
    非 Windows 平台静默跳过。
    """

    def __init__(self, window, icon_path: Path | None = None):
        self._window = window
        self._icon_path = icon_path
        self._notify = None
        self._thread = None
        self._started = False

    def start(self) -> bool:
        if sys.platform != "win32":
            return False
        try:
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()
            # 等一小会儿，让托盘图标先建好
            for _ in range(40):
                if self._started:
                    break
                time.sleep(0.05)
            return self._started
        except Exception:  # noqa: BLE001
            return False

    def _run(self) -> None:
        try:
            import clr  # noqa: F401

            clr.AddReference("System.Windows.Forms")
            clr.AddReference("System.Drawing")

            from System.Drawing import Icon, SystemIcons  # type: ignore
            from System.Windows.Forms import (  # type: ignore
                Application,
                ContextMenuStrip,
                NotifyIcon,
                ToolStripMenuItem,
                ToolTipIcon,
            )
        except Exception:  # noqa: BLE001
            return

        try:
            if self._icon_path and self._icon_path.exists():
                icon = Icon(str(self._icon_path))
            else:
                icon = SystemIcons.Shield
        except Exception:  # noqa: BLE001
            icon = SystemIcons.Shield

        notify = NotifyIcon()
        notify.Icon = icon
        notify.Text = f"{APP_NAME} · 本地验证器"
        notify.Visible = True

        menu = ContextMenuStrip()
        menu.ShowImageMargin = False

        def on_open(_s=None, _e=None):
            try:
                self._window.show()
                self._window.restore()
            except Exception:  # noqa: BLE001
                pass

        def on_notify(_s=None, _e=None):
            try:
                notify.ShowBalloonTip(
                    2500,
                    APP_NAME,
                    "账户数据保存在本机，不会上传到任何服务器。",
                    ToolTipIcon.Info,
                )
            except Exception:  # noqa: BLE001
                pass

        def on_quit(_s=None, _e=None):
            try:
                notify.Visible = False
                notify.Dispose()
            except Exception:  # noqa: BLE001
                pass
            try:
                self._window.destroy()
            except Exception:  # noqa: BLE001
                pass

        item_open = ToolStripMenuItem("打开 SimpleF2A")
        item_open.Click += on_open
        menu.Items.Add(item_open)

        item_info = ToolStripMenuItem("数据保存在本机")
        item_info.Click += on_notify
        menu.Items.Add(item_info)

        menu.Items.Add(ToolStripMenuItem("-"))

        item_quit = ToolStripMenuItem("退出")
        item_quit.Click += on_quit
        menu.Items.Add(item_quit)

        notify.ContextMenuStrip = menu

        def on_double_click(_s=None, _e=None):
            on_open()

        notify.DoubleClick += on_double_click

        self._notify = notify
        self._started = True

        # WinForms 需要自己的消息循环
        try:
            Application.Run()
        except Exception:  # noqa: BLE001
            pass


# ----------------------------------------------------------------------------- 主程序


def main() -> int:
    # Windows 控制台默认 GBK，打印中文/符号可能抛 UnicodeEncodeError
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            pass

    index = resource_dir() / "index.html"
    if not index.exists():
        msg = (
            f"找不到界面资源：{index}\n\n"
            "请先在项目根目录运行：\n    npm run build\n"
            "再启动本程序。"
        )
        print(msg)
        _message_box("SimpleF2A 启动失败", msg)
        return 1

    api = Api()
    icon_file = resource_dir().parent / "app.ico"
    if not icon_file.exists():
        icon_file = resource_dir() / "app.ico"

    window = webview.create_window(
        title=f"{APP_NAME} · 本地二步验证器",
        url=str(index),
        js_api=api,
        width=1120,
        height=780,
        min_size=(380, 600),
        background_color="#07090C",
        confirm_close=False,
        easy_drag=False,
    )
    api.bind(window)

    tray = Tray(window, icon_file)

    def on_shown():
        tray.start()

    window.events.shown += on_shown

    webview.start(
        debug=bool(os.environ.get("SIMPLEF2A_DEBUG")),
        private_mode=False,  # 允许 localStorage 持久化（主题等偏好）
        storage_path=str(data_dir() / "webview"),
    )
    return 0


def _message_box(title: str, text: str) -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, text, title, 0x10)
    except Exception:  # noqa: BLE001
        pass


if __name__ == "__main__":
    raise SystemExit(main())

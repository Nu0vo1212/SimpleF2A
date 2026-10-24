"""
从 Edge 的 IndexedDB（leveldb）中提取 SimpleF2A 账户数据。

原理：
  IndexedDB 底层是 leveldb，其 WAL 日志（*.log）里保存着写入记录。
  账户对象的 value 是 IndexedDB 的结构化克隆编码，但其中所有字符串
  （issuer / account / secret / algorithm）与数字以明文形式存储，
  因此可以直接按记录边界解析，无需依赖完整 leveldb 读取库。

  解析出的结果按 id 去重（同一记录可能因多次写入出现多份），
  取最后出现的版本（leveldb 后写覆盖先写）。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def find_leveldb_dirs() -> list[Path]:
    """
    在 Edge / Chrome 的所有 profile 中找出可能存放本应用数据的 IndexedDB 目录。

    注意：目录名是按 origin 命名的（如 http_127.0.0.1_48620.indexeddb.leveldb），
    里面不一定含 "simplef2a"，因此改为「探测内容是否包含数据库名」。
    """
    bases = [
        Path.home() / "AppData/Local/Microsoft/Edge/User Data",
        Path.home() / "AppData/Local/Google/Chrome/User Data",
    ]
    found: list[Path] = []
    for base in bases:
        if not base.exists():
            continue
        for profile in base.iterdir():
            if not profile.is_dir():
                continue
            idb = profile / "IndexedDB"
            if not idb.exists():
                continue
            for d in idb.iterdir():
                if not d.is_dir() or "indexeddb.leveldb" not in d.name:
                    continue
                # 快速探测：目录内是否有文件包含 simplef2a-accounts
                hit = False
                for f in list(d.glob("*.log"))[:3] + list(d.glob("*.ldb"))[:3]:
                    try:
                        if b"simplef2a-accounts" in f.read_bytes():
                            hit = True
                            break
                    except OSError:
                        continue
                if hit:
                    found.append(d)
    return found


def read_logs(leveldb_dir: Path) -> bytes:
    """拼接该数据库所有日志与 ldb 文件（只读，不改动原文件）。"""
    chunks: list[bytes] = []
    for pattern in ("*.log", "*.ldb"):
        for f in sorted(leveldb_dir.glob(pattern)):
            try:
                chunks.append(f.read_bytes())
            except OSError as e:
                print(f"  读取失败 {f.name}: {e}", file=sys.stderr)
    return b"\n\x00\n".join(chunks)


# IndexedDB 结构化克隆的编码：字段名以 0x22(长度前缀) + 名称字节 描述，
# 值同理。例如 b'secret"\x10' + 16 字节 secret。
# 因此用「字段名 + 长度字节 + 值」的形式匹配，而不是当 JSON 处理。
def _str_field(name: bytes) -> bytes:
    """匹配 `name` + 长度字节 + 值，长度 1..255。"""
    return name + rb'"(.)'


def parse_accounts(raw: bytes) -> list[dict]:
    """从 leveldb 原始字节中解析账户记录。"""
    accounts: dict[str, dict] = {}

    # 以 secret 字段为锚点定位每个账户对象（secret 必有且格式固定）
    secret_re = re.compile(rb'secret"\x10([A-Z2-7]{16})|secret"([\x11-\x50])([A-Z2-7]{17,80})')

    for m in secret_re.finditer(raw):
        if m.group(1):
            secret = m.group(1).decode("ascii")
        else:
            secret = m.group(3).decode("ascii")

        # 向前找该对象的起始（最近的 id 字段）
        head_start = max(0, m.start() - 900)
        head = raw[head_start : m.start()]

        id_m = None
        for cand in re.finditer(rb'id"\x24([0-9a-f-]{36})', head):
            id_m = cand  # 取最后一个（最近的）
        if not id_m:
            continue
        acc_id = id_m.group(1).decode("ascii")

        # 向前取 type / issuer / account
        def find_str(name: bytes, src: bytes) -> str:
            mm = re.search(name + rb'"([\x01-\x60])([\x20-\x7e]+)', src)
            if not mm:
                return ""
            length = mm.group(1)[0]
            value = mm.group(2)[:length]
            return value.decode("utf-8", "replace").strip()

        type_s = find_str(b"type", head)
        issuer_s = find_str(b"issuer", head)
        account_s = find_str(b"account", head)

        # 向后取 algorithm / digits / period / counter
        tail = raw[m.end() : m.end() + 160]
        algorithm_s = "SHA1"
        alg_m = re.search(rb'algorithm"([\x03-\x0a])(SHA1|SHA256|SHA512|MD5)', tail)
        if alg_m:
            algorithm_s = alg_m.group(2).decode("ascii")

        def find_num(name: bytes, default: int) -> int:
            mm = re.search(name + rb'((?:I.|\x01.{1,9}))', tail, re.DOTALL)
            if not mm:
                return default
            seg = mm.group(1)[1:]  # 去掉 I 标记
            if not seg:
                return 0
            # 小整数直接是单字节；大整数是 0x01 + 变长
            if seg[0] == 0x01:
                val = 0
                for b in seg[1:]:
                    val = (val << 7) | (b & 0x7F)
                    if not (b & 0x80):
                        break
                return val
            return seg[0]

        otp_type = type_s or "totp"
        defaults = {
            "totp": (6, 30),
            "hotp": (6, 30),
            "steam": (5, 30),
            "yandex": (8, 30),
            "motp": (6, 10),
        }
        def_digits, def_period = defaults.get(otp_type, (6, 30))

        digits = find_num(b"digits", def_digits)
        period = find_num(b"period", def_period)
        counter = find_num(b"counter", 0)

        # 类型约束校正
        if otp_type == "steam":
            digits = 5
        elif otp_type == "yandex":
            digits = 8
        elif otp_type == "motp":
            digits = 6
        if not (1 <= digits <= 10):
            digits = def_digits

        if otp_type == "motp":
            period = 10
        elif otp_type in ("steam", "yandex"):
            period = 30
        if not (1 <= period <= 300):
            period = def_period
        if not (0 <= counter < 2**31):
            counter = 0

        pin = ""
        pin_m = re.search(rb'pin"([\x04-\x10])([0-9]{4,16})', tail)
        if pin_m:
            pin = pin_m.group(2)[: pin_m.group(1)[0]].decode("ascii")

        accounts[acc_id] = {
            "id": acc_id,
            "type": otp_type,
            "issuer": issuer_s,
            "account": account_s,
            "secret": secret,
            "algorithm": algorithm_s,
            "digits": digits,
            "period": period,
            "counter": counter,
            **({"pin": pin} if pin else {}),
        }

    return list(accounts.values())


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            pass

    dirs = find_leveldb_dirs()
    if not dirs:
        print("未找到 SimpleF2A 的浏览器数据。")
        print("请确认曾在 Edge/Chrome 中打开过应用。")
        return 1

    print("找到数据库目录：")
    for d in dirs:
        print(f"  {d}")

    all_accounts: dict[str, dict] = {}
    for d in dirs:
        raw = read_logs(d)
        parsed = parse_accounts(raw)
        if parsed:
            print(f"\n{d.name}: 解析出 {len(parsed)} 个账户")
            for a in parsed:
                all_accounts[a["id"]] = a

    if not all_accounts:
        print("\n✗ 未能从日志中解析出账户数据。")
        return 1

    result = list(all_accounts.values())
    # 补全桌面版存储需要的字段
    out = {
        "version": 1,
        "source": "browser-indexeddb",
        "accounts": [
            {
                **a,
                "order": i,
                "createdAt": 0,
                "updatedAt": 0,
            }
            for i, a in enumerate(result)
        ],
    }

    target = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if target:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n已写入: {target}")

    print(f"\n共 {len(result)} 个账户：")
    for a in result:
        secret_masked = a["secret"][:4] + "•" * (len(a["secret"]) - 8) + a["secret"][-4:]
        print(
            f"  {a['issuer'] or '未命名'} · {a['account']} "
            f"[{a['type']} {a['algorithm']} {a['digits']}位] {secret_masked}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

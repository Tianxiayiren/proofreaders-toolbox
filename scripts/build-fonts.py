# 霞鹜文楷字体子集化：按站点实际用字裁剪，生成 woff2
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(r"C:\Users\user\Desktop\Module_demo\编校工具箱")
FONT_DIR = Path(os.environ["LOCALAPPDATA"]) / "Microsoft" / "Windows" / "Fonts"
OUT_DIR = ROOT / "public" / "fonts"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------- 1. 收集字符集 ----------
chars = set()

# 1a) 页面里出现的所有字符（含界面文字、标准条文、示例）
for f in ["index.html", "rules.html", "cyt266.html", "cyt121.html"]:
    text = (ROOT / "public" / f).read_text(encoding="utf-8")
    chars.update(text)
print(f"页面文本字符数: {len(chars)}")

# 1b) 全表 8105 字 + 繁体/异体字（查询结果里会显示）
hanzi_chars = set()
data = json.loads((ROOT / "data" / "dataset.json").read_text(encoding="utf-8"))
for e in data["entries"]:
    hanzi_chars.add(e["char"])
    for k in ("traditional", "variant"):
        if e.get(k):
            hanzi_chars.update(e[k]["chars"])
chars.update(hanzi_chars)
print(f"加入字表与繁异体后: {len(chars)}（其中字表用字 {len(hanzi_chars)}）")

# 1c) 常用 ASCII / 标点兜底（界面输入、码位显示等）
chars.update("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
             " .,:;!?()[]{}<>|-—_=+*&^%$#@~`'\"“”‘’、。，：；！？（）【】《》〈〉「」『』…·×÷→←↑↓")
chars = {c for c in chars if isinstance(c, str) and len(c) == 1 and ord(c) >= 32}
print(f"最终字符集: {len(chars)} 个字符")

# ---------- 2. 子集化 ----------
def subset(src_name, out_name, kind="text"):
    """kind: text=正文字形（含全部字表用字）；hanzi=仅字表与繁异体（供按需加载）"""
    src = FONT_DIR / src_name
    if not src.exists():
        print(f"  ✖ 缺少源字体 {src_name}")
        return None
    text = "".join(sorted(chars if kind == "text" else hanzi_chars))
    tmp_ttf = OUT_DIR / (out_name + ".ttf")
    args = [
        sys.executable, "-m", "fontTools.subset", str(src),
        f"--text={text}",
        "--layout-features=*",          # 保留全部 OpenType 特性
        "--name-IDs=*",                 # 保留字体名
        "--glyph-names",
        "--ignore-missing-glyphs",
        f"--output-file={tmp_ttf}",
    ]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print("  ✖ 子集化失败:", (r.stderr or r.stdout)[-400:])
        return None
    mid = tmp_ttf.stat().st_size

    woff2 = OUT_DIR / (out_name + ".woff2")
    r2 = subprocess.run([sys.executable, "-m", "fontTools.ttLib.woff2", "compress",
                         "-o", str(woff2), str(tmp_ttf)], capture_output=True, text=True)
    if r2.returncode != 0:
        print("  ✖ woff2 压缩失败:", (r2.stderr or r2.stdout)[-300:])
        return None
    final = woff2.stat().st_size
    tmp_ttf.unlink()
    print(f"  {out_name:26s} 字数 {len(text):6d}  woff2 {final/1024:7.0f} KB")
    return final


print("\n子集化：")
total = 0
for src, out, kind in [
    ("LXGWWenKai-Regular.ttf", "lxgw-wenkai-400", "text"),   # 正文常规
    ("LXGWWenKai-Medium.ttf",  "lxgw-wenkai-500", "text"),   # 正文中粗（标题/加粗）
]:
    n = subset(src, out, kind)
    if n:
        total += n
print(f"\n合计 {total/1024:.0f} KB")
print("输出目录:", OUT_DIR)
for f in sorted(OUT_DIR.iterdir()):
    print(f"  {f.name:26s} {f.stat().st_size/1024:8.0f} KB")

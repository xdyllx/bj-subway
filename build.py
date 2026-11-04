#!/usr/bin/env python3
"""抓取北京地铁官网数据，生成 docs/data.json。"""
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
UA = {"User-Agent": "Mozilla/5.0"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def parse_time(s):
    """'5:09' -> 分钟数(自0点)；无效返回 None。"""
    if not s or s == "——":
        return None
    m = re.match(r"^(\d{1,2}):(\d{2})$", s.strip())
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if h >= 24:
        h -= 24  # 末班车常有 24:xx 表示次日0点前
    return h * 60 + mi


def main():
    timeinfos = get("https://www.bjsubway.com/api/guanwang/v2/getTimeinfos")
    headways = json.loads((ROOT / "headways.json").read_text(encoding="utf-8"))["lines"]

    lines = {}
    for ln in timeinfos["data"]:
        code = ln["lineCode"]
        stations = []
        for st in ln["flTimes"]:
            # up = 终点方向(upDestName)，down = 起点方向(downStartName)。
            # 官方语义：up 列是「往 upDestName 方向」在本站的首/末班通过时间。
            s = {
                "code": st["stationCode"],
                "name": st["stationName"],
                "dest": st["upDestName"],       # A方向终点（开往）
                "destB": st["downDestName"],    # B方向终点（开往）
                "first": parse_time(st["upFirstTime"]),
                "last": parse_time(st["upLastTime"]),
                "firstB": parse_time(st["downFirstTime"]),
                "lastB": parse_time(st["downLastTime"]),
            }
            if s["first"] is not None:
                stations.append(s)
        if not stations:
            continue
        hw = headways.get(code, {"weekday": {"peak": 5, "daytime": 8}})
        lines[code] = {
            "name": ln["lineName"],
            "color": "#" + ln["lineRgbColor"],
            "headways": hw,
            # 方向标签：A = 开往 upDestName，B = 开往 downDestName
            "dirA": stations[0]["dest"],
            "dirB": stations[0]["destB"],
            "stations": stations,
        }

    out = {"generated": __import__("time").strftime("%Y-%m-%d %H:%M"), "lines": lines}
    dest = ROOT / "docs" / "data.json"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK: {len(lines)} lines -> {dest} ({dest.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

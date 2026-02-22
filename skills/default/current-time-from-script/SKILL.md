---
name: current-time-from-script
description: Return the current local time by executing a Python script under scripts/.
---

# Current Time Skill (Script Demo)

## Goal

ユーザーに現在時刻を返す。

## Steps

1. `scripts/current_time.py` を実行する。
2. スクリプトの標準出力をそのまま時刻として扱う。
3. `現在時刻は <出力値> です。` の形式で返答する。

## Rules

- 毎回必ずスクリプトを実行し、キャッシュ値を使わない。
- 時刻は実行環境のローカルタイムゾーンを使用する。
- スクリプト実行に失敗した場合は、失敗理由を短く伝える。

---
name: ai-review
description: AI Review Comments のレビューコメントを読み取り、修正を適用し、対応状況を書き戻す。ユーザーが「レビューコメントを反映して」「ai-review のコメントを見て直して」と言ったとき、またはワークスペースに .ai-review/comments.json が存在してその反映を求められたときに使う。
---

# ai-review — レビューコメントの取得と反映

ワークスペースの `.ai-review/comments.json` に、VS Code 拡張
**AI Review Comments** で付けられたレビューコメントが入っています。
このスキルでは CLI を通じてコメントを読み取り、修正を適用し、結果を書き戻します。
拡張のパネルが開いていれば、書き戻しは**即座にパネルへ反映**されます。

## CLI の呼び出し方

リポジトリを clone 済みの場合:

```bash
node <repo>/cli/ai-review.mjs <command>
```

npx で直接（インストール不要）:

```bash
npx -y github:ykitaza/ai-review-comments <command>
```

## 手順

1. **やることリストを取得する** — `pending` が最適（未対応コメントのみ、
   全ファイル横断、JSON）:

   ```bash
   ai-review pending          # 全ワークスペースの未対応コメント
   ai-review pending <file>   # 特定ファイルのみ
   ```

   各コメントには位置情報が付いています:
   - `line` / `range` — ソースの行（1始まり）
   - `selector` — HTML要素のCSSセレクタ
   - `mdLine` / `srcLine` — プレビューコメントの元ソース行
   - `path` — JSON/YAML のデータパス（例 `services.web.ports`）
   - `snippet` — コメント時点の該当箇所の内容
   - **`stale`** — `true` ならコメント後にファイルが変わっており、**行番号を
     鵜呑みにしてはいけない**。`snippet` と指摘の意図から現在の該当箇所を
     探して適用すること。

2. **修正を適用する** — 位置情報と `body`（指摘）に従って対象ファイルを編集する。
   `stale: true` のコメントは必ず現状のファイルを読んで位置を再特定する。

3. **対応済みにする** — 対応したら `--note` で**何をしたかを添えて** resolve する
   （パネルに ✓ と対応メモが表示され、以後のプロンプトから除外される）:

   ```bash
   ai-review resolve <file> <id> --note "ボタン文言を「30秒で無料登録」に変更"
   ```

4. **質問・提案を返す（任意）** — 指摘が曖昧なときは、元コメントに紐付けて
   質問できる（パネルに AI バッジ + ↪ 返信マーカー付きで表示される）:

   ```bash
   ai-review add <file> --line 42 --body "Aの意味とBの意味どちらですか？" --author ai --reply-to 3
   ```

## 注意

- コメントの `id` はファイルごとに独立。resolve/remove には `pending`/`json` で確認した id を使う。
- 人間のコメントを勝手に `remove` しない。対応したら `resolve --note` を使う。
- ストアの場所は CWD から `.ai-review/` または `.git/` を上方向に探索して決まる。

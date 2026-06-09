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

1. **コメントを確認する**

   ```bash
   ai-review list             # 全ファイルのコメント一覧
   ai-review json <file>      # 機械可読なJSON（こちらを推奨）
   ai-review prompt <file>    # 整形済みプロンプト（位置情報＋指摘）
   ```

   各コメントには位置情報が付いています:
   - `line` / `range` — ソースの行（1始まり）
   - `selector` — HTML要素のCSSセレクタ
   - `mdLine` / `srcLine` — プレビューコメントの元ソース行
   - `path` — JSON/YAML のデータパス（例 `services.web.ports`）
   - `snippet` — コメント時点の該当箇所の内容

2. **修正を適用する** — 位置情報と `body`（指摘）に従って対象ファイルを編集する。
   `snippet` はコメント時点の内容なので、ファイルが変わっていたら現状を確認して
   意図に合う箇所へ適用する。

3. **対応済みにする** — 対応したコメントは resolve でマークする
   （パネルでは ✓ 取り消し線になり、以後のプロンプトから除外される）:

   ```bash
   ai-review resolve <file> <id>
   ```

4. **AIからコメントを返す（任意）** — 質問や提案がある場合は、自分のコメントを
   追加できる（パネルに AI バッジ付きで表示される）:

   ```bash
   ai-review add <file> --line 42 --body "この関数は分割を推奨します" --author ai
   ```

## 注意

- コメントの `id` はファイルごとに独立。resolve/remove には `json` で確認した id を使う。
- 人間のコメントを勝手に `remove` しない。対応したら `resolve` を使う。
- ストアの場所は CWD から `.ai-review/` または `.git/` を上方向に探索して決まる。

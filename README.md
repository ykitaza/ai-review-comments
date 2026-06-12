# AI Review Comments

任意のファイルをサイドパネルでレビューし、**レンダリング結果または生の行に
コメントを付けて、AI 向けの修正プロンプトをコピー**できる VS Code 拡張です。
コピーした内容は Claude Code / Copilot / ChatGPT などにそのまま貼り付けられます。

![コメント→コピー→AIに貼り付け](media/flow.gif)

## 2つの使い方: VS Code拡張 / ブラウザ（npx）

同じレビューUIを **VS Code の中**でも **ブラウザ**でも使えます。コメントはどちらも
ワークスペースの `.ai-review/comments.json` に保存され、共有されます。

### VS Code で開く

エクスプローラーで**ファイルを右クリック**（エディタのタブ／エディタ上でも可）し、
**「AI Review: Open Review Panel」** を選びます。コマンドパレット
（`⌘/Ctrl+Shift+P` → *AI Review: Open Review Panel*）からも実行できます。

![エディタの横に開いたレビューパネル](media/vscode-overview.png)

### ブラウザで開く（VS Code不要・ビルド不要）

エンジニア以外のメンバーとレビューする場合や、依存を増やしたくない場合は
`npx` 一発でブラウザが開きます:

```bash
npx -y github:ykitaza/ai-review-comments open ./docs/design.md
# ファイルパスだけでもOK:
npx -y github:ykitaza/ai-review-comments ./docs/design.md
```

ローカルサーバが立ち上がりブラウザが開きます（`--port N` / `--no-open` /
`--keep-alive` オプションあり。タブを閉じるとサーバも終了します）。
コメントは VS Code 版と同じストアに入るので、**ブラウザでコメント → AI が CLI で
読んで対応 → ブラウザに即時反映**のループがそのまま動きます。

## コンセプト

AI に HTML ページや Markdown ドキュメントを生成させたとき——レビューは
**レンダリング結果（見た目）** を見て行いたいのに、修正させるには AI が
**ソース** を編集する必要があります。このギャップを埋めます。

1. **AI が生成したファイルをプレビューで開く**（HTML はそのまま、Markdown は
   `mermaid` / `plantuml` 図を含めてレンダリング）。
2. **見ているものに直接コメント** — 要素や行をクリックして指摘を書く。
3. **コピー** — コメントが、対象を正確に指す（CSS セレクタ／ソース行／
   JSON・YAML のデータパス）プロンプトに整形され、貼り付け可能な形になります。

```mermaid
flowchart LR
  A[AIが生成したファイル] --> B[レビューパネルで開く]
  B --> C{プレビュー or ソース}
  C -->|要素・行をクリック| D[コメント + 位置情報]
  D --> E[AI向けプロンプトに整形]
  E --> F[クリップボードへコピー]
  F --> A
```

## 使い方

レンダリング結果にコメント → **Copy** → クリップボードには構造化された
プロンプト（ファイルパス・CSSセレクタ・ソース行・該当HTML・指摘）が入り →
AI に貼り付ければ、どこを直すか正確に伝わります（上のアニメーション参照）。

プレビューとソースはいつでも切替可能。どちらで付けたコメントも同期し、
同じ行を指します。

![プレビューとソースの切替](media/toggle.gif)

1. ファイルを右クリック → **AI Review: Open Review Panel**（エディタの横に開く）
2. **👁 Preview / `<>` Source** を切り替え（プレビューは HTML/Markdown のみ）
3. コメントを付ける:
   - **プレビュー**: 要素をクリック、または **✎ Text** で文章をドラッグ選択
   - **ソース**: 行をクリック、または範囲をドラッグ → その場の入力欄に記入
     （⌘/Ctrl+Enter で確定）
4. **📋 Copy AI prompt** を押して AI に貼り付け

## 機能

- **2 つのビューを自由に切替**（Obsidian 風）: レンダリング ⇄ 生ソース
- **コメントがソースに紐付く** — レンダリングされた見出しへのコメントは元の
  Markdown 行を、HTML 要素へのコメントはソース行と安定した CSS セレクタを記録
- **JSON/YAML のデータパス** — 行コメントが構造パス（例 `services.web.ports`）を取得
- **`mermaid` / `plantuml` 図** を Markdown プレビューで描画
- **プロンプトテンプレート** — 修正 / 質問 / レビュー / プレーン、または
  `{{file}}` `{{count}}` `{{comments}}` で自作
- **ファイル単位で永続化** — コメントはワークスペースの
  `.ai-review/comments.json` に保存（AIエージェントやCLIから読み書き可能）
- **AI連携** — CLI でコメントを取得・追加・対応済み化でき、開いているパネルに
  即時反映（下記「AIエージェント連携」参照）
- **リサイズ / 折りたたみ**対応・レスポンシブ

### 対応フォーマット

| ファイル | プレビュー | ソース |
|------|-----------|--------|
| `.html` `.htm` | ライブレンダリング・要素/テキストコメント | 生 HTML + 行番号 |
| `.md` `.markdown` | レンダリング（`mermaid` / `plantuml` 含む）・要素/テキストコメント | 生 Markdown + 行番号 |
| `.json` `.yaml` `.xml` `.svg` `.txt` `.csv`・各種ソース | —（ソースのみ） | 行 + JSON/YAML データパス |

> Markdown プレビューは `mermaid` を CDN から読み込みます（要ネット接続）。
> `plantuml` / `puml` ブロックと、Markdown画像として参照されたローカル
> `.puml` / `.plantuml` ファイルは、ローカルの `plantuml` コマンドがある場合だけ
> SVG化します。

## AIエージェント連携

コメントはワークスペースの **`.ai-review/comments.json`** に保存されるので、
クリップボード経由だけでなく、**AIエージェントが直接コメントを取りに行けます**。
付属の CLI でコメントの取得・追加・対応済み化ができ、変更は開いている
パネルに**即時反映**されます。

```bash
# AIのやることリスト: 未対応コメントのみJSONで（stale=位置ズレ検知つき）
npx -y github:ykitaza/ai-review-comments pending

# コメントを見る
npx -y github:ykitaza/ai-review-comments list
npx -y github:ykitaza/ai-review-comments prompt docs/design.md   # プロンプト形式

# AI がコメントを返す（AIバッジ＋↪返信マーカー付きでパネルに表示）
npx -y github:ykitaza/ai-review-comments add docs/design.md \
  --line 42 --body "Aの意味とBの意味どちらですか？" --author ai --reply-to 3

# 対応したコメントを ✓ に。--note の対応メモはパネルに表示される
npx -y github:ykitaza/ai-review-comments resolve docs/design.md 1 \
  --note "ボタン文言を「30秒で無料登録」に変更"
```

想定ループ: **人間がパネルでコメント → AI が `pending` で読んで修正
（`stale` で位置ズレも検知）→ `resolve --note` で対応内容を残す／曖昧なら
`add --reply-to` で質問 → パネルに即反映**。

Claude Code 用のスキル定義を [`skills/ai-review/`](skills/ai-review/SKILL.md) に
同梱しています。エージェントにこのスキルを与えると、上記のループを自走できます。

> `.ai-review/` を Git にコミットすればコメントをチームで共有できます。
> 共有したくない場合は `.gitignore` に追加してください。

## インストール

### パッケージ済み VSIX から（現在）

```bash
git clone https://github.com/ykitaza/ai-review-comments.git
cd ai-review-comments
npm install
npm run package          # → ai-review-comments-<version>.vsix
code --install-extension ai-review-comments-*.vsix
```

または VS Code で **拡張機能パネル → ··· → VSIX からインストール…**

### Marketplace から

_未公開です。_ 公開後は **「AI Review Comments」** で検索、または
`code --install-extension ykitaza.ai-review-comments`。

## 設定

| 設定 | 既定 | 説明 |
|------|------|------|
| `aiReviewComments.defaultTemplate` | `fix` | 既定のプロンプトテンプレート（`fix` / `question` / `review` / `plain`） |

## 開発

```bash
npm install
npm run watch        # 変更を監視して dist/ を再ビルド
npm run typecheck    # tsc --noEmit
npm run package      # .vsix を作成
```

VS Code で **F5** を押すと拡張機能の開発ホストが起動します。設計は
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照。

## ライセンス

[MIT](LICENSE)

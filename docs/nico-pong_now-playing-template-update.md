# nico-pong 追加修正指示：再生中コメントテンプレートのデフォルト値変更とバージョン更新

## 目的

Chrome 拡張 **nico-pong** において、リクエストタブ内の動画自動再生は動作するようになった。

しかし、動画再生時に投稿される生主コメントのデフォルトテンプレートで、作者名が正しく表示されない問題がある。

現在のデフォルトテンプレートは以下になっている。

```text
♪ 再生中: {title} / 作者: {author} / {url}
```

このうち `{author}` が正しく展開されず、生主コメント上で作者名が表示されない。

一方、以下のように `{displayAuthorName}` と `{ownerName}` を使うと作者名が表示される。

```text
♪ 再生中: {title} / 作者: {displayAuthorName} ：{ownerName}
```

そのため、再生中コメントテンプレートのデフォルト値を、URL 表示も含めて以下に変更する。

```text
♪ 再生中: {title} / 作者: {displayAuthorName} ：{ownerName} / URL ： {url}
```

---

## 修正内容

### 1. 再生中コメントテンプレートのデフォルト値を変更する

現在、再生開始時に使用されるデフォルトテンプレートが以下になっている箇所を探す。

```text
♪ 再生中: {title} / 作者: {author} / {url}
```

これを以下に変更する。

```text
♪ 再生中: {title} / 作者: {displayAuthorName} ：{ownerName} / URL ： {url}
```

---

## 変更対象候補

以下のようなファイル・箇所を確認すること。

- `src/` 配下の設定初期値
- `defaultSettings`
- `initialSettings`
- `commentTemplate`
- `nowPlayingTemplate`
- `playMessageTemplate`
- `storage` 初期化処理
- Options / SidePanel の設定初期値
- テンプレート入力欄の `placeholder` / `defaultValue`
- Chrome storage に初期値を書き込んでいる処理
- 利用可能プレースホルダの説明テキスト

プロジェクト内で以下の文字列を全文検索すること。

```text
{author}
```

または

```text
♪ 再生中:
```

該当箇所が複数ある場合は、再生中コメントテンプレートのデフォルト値に関係する箇所をすべて修正する。

---

## 注意点

### 既存ユーザー設定の扱い

すでにユーザーが手動でテンプレートを変更している場合は、その設定を勝手に上書きしないこと。

ただし、保存済みテンプレートが旧デフォルト値と完全一致する場合は、新デフォルト値へ移行してよい。

旧デフォルト値：

```text
♪ 再生中: {title} / 作者: {author} / {url}
```

新デフォルト値：

```text
♪ 再生中: {title} / 作者: {displayAuthorName} ：{ownerName} / URL ： {url}
```

望ましい移行ロジックは以下。

```ts
const OLD_NOW_PLAYING_TEMPLATE =
  "♪ 再生中: {title} / 作者: {author} / {url}";

const NEW_NOW_PLAYING_TEMPLATE =
  "♪ 再生中: {title} / 作者: {displayAuthorName} ：{ownerName} / URL ： {url}";

if (
  settings.nowPlayingTemplate === undefined ||
  settings.nowPlayingTemplate === OLD_NOW_PLAYING_TEMPLATE
) {
  settings.nowPlayingTemplate = NEW_NOW_PLAYING_TEMPLATE;
}
```

設定キー名は既存実装に合わせること。

---

## 2. テンプレート展開処理の確認

テンプレート展開処理で、以下のプレースホルダが利用可能であることを確認する。

```text
{title}
{displayAuthorName}
{ownerName}
{url}
```

すでに `{displayAuthorName}`、`{ownerName}`、`{url}` が展開可能であれば、展開処理自体は変更しなくてよい。

ただし、設定画面やヘルプ文に利用可能プレースホルダ一覧がある場合は、そこも更新すること。

### `{author}` について

`{author}` は現状では期待通りに展開されないため、デフォルトテンプレートでは使用しない。

ただし、既存ユーザーがカスタムテンプレート内で `{author}` を手動使用している可能性があるため、テンプレート展開機能から削除する必要はない。

---

## 3. バージョンを上げる

今回の修正は Chrome 拡張 nico-pong の動作修正なので、バージョン番号を上げる。

`manifest.json` の `version` を現在値から 1 パッチ上げること。

例：

```json
{
  "version": "0.1.1"
}
```

すでに `0.1.1` 以上の場合は、現在のバージョンからパッチバージョンを +1 する。

例：

- `0.1.0` → `0.1.1`
- `0.1.1` → `0.1.2`
- `0.2.0` → `0.2.1`

`package.json` にも `version` がある場合は、`manifest.json` と同じバージョンに揃えること。

---

## 4. 動作確認

修正後、以下を確認する。

### 確認1：デフォルトテンプレート

設定を初期状態にしたとき、再生中コメントテンプレートのデフォルト値が以下になっていること。

```text
♪ 再生中: {title} / 作者: {displayAuthorName} ：{ownerName} / URL ： {url}
```

### 確認2：リクエストタブ自動再生

リクエストタブに動画を登録し、自動再生されること。

### 確認3：生主コメント投稿

動画再生時、生主コメントとして以下のような形式で投稿されること。

```text
♪ 再生中: 動画タイトル / 作者: 表示作者名 ：投稿者名 / URL ： https://www.nicovideo.jp/watch/smxxxxxxx
```

### 確認4：作者名表示

`{displayAuthorName}` と `{ownerName}` のどちらか、または両方に値が入っている動画で、作者名が空欄にならないこと。

### 確認5：URL表示

`{url}` が動画 URL に正しく展開されること。

### 確認6：既存設定の保護

ユーザーが独自にテンプレートを編集している場合、その値が勝手に新デフォルト値で上書きされないこと。

ただし、保存済みテンプレートが旧デフォルト値と完全一致する場合は、新デフォルト値に移行してよい。

---

## 完了条件

- 再生中コメントテンプレートのデフォルト値が新しい形式になっている
- `{author}` 依存がデフォルトテンプレートから除去されている
- `{displayAuthorName}` と `{ownerName}` を使った作者名がコメントに投稿される
- `/ URL ： {url}` がデフォルトテンプレートに含まれている
- `{url}` が動画 URL として正しく展開される
- `manifest.json` のバージョンが上がっている
- `package.json` がある場合はそちらのバージョンも一致している
- 既存ユーザーのカスタムテンプレートを破壊しない

---

## 補足

この修正は新機能追加というより、再生中コメントの表示不具合修正である。

そのため、バージョン更新は基本的に **パッチバージョン上げ** とする。

例：

```text
0.1.0 → 0.1.1
```

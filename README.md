# DodgeBlobs

モバイル対応の避けゲー「DodgeBlobs」。GitHub Pagesにデプロイ可能です。

## ローカル開発

```bash
npm i
npm run dev
```

## GitHub Pages へのデプロイ

1. `vite.config.ts` の `base` は `/tamayokebattle/` に設定済み
2. `main` ブランチに push すると、Actions が自動で build → Pages にデプロイ
3. リポジトリの Settings → Pages の Source を「GitHub Actions」に設定

公開URL例: `https://satoshi5884.github.io/tamayokebattle/`

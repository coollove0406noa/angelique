# angelique - Project TODO

## Phase 2: DB Schema & Global Design
- [x] DBスキーマ設計（clients, sessions, messages, carryover, settings テーブル）
- [x] Drizzle migration 実行
- [x] グローバルCSS（くすみ系カラーパレット・フォント）
- [x] 共通レイアウトコンポーネント（ヘッダー・ロゴ）

## Phase 3: Server-side
- [x] tRPC routers: clients, sessions, messages, settings, carryover
- [x] Socket.io サーバー統合（server/_core/index.ts に登録）
- [x] SendGrid メール送信ヘルパー
- [x] ワンタイムトークン生成・検証ロジック

## Phase 4: 管理者認証・予約管理
- [x] 管理者パスワード認証（Cookie + bcrypt）
- [x] 予約管理画面（顧客登録・一覧・編集・削除）
- [x] 登録時メール自動送信（SendGrid）
- [x] 繰越分の確認・追加機能

## Phase 5: 管理者セッション・チャット・タイマー
- [x] セッション一覧画面（ステータス・開始ボタン）
- [x] カウントダウンタイマー（残り5分アラート音＋画面フラッシュ）
- [x] リアルタイムチャット（Socket.io）
- [x] 「時間を延長する」ボタン（STORESのURLをお客様に自動送信）
- [x] 「次回に繰り越す」ボタン（残り時間を分単位で保存）
- [x] 管理者「再開」ボタン（タイマー再スタート）

## Phase 6: お客様チャット画面
- [x] ワンタイムトークンURLでセッション参加
- [x] リアルタイムチャット（Socket.io）
- [x] 残り時間表示
- [x] 時間切れ時の延長案内自動表示
- [x] 延長ボタン（STORESのURLへ遷移）
- [x] 「延長しました、お待ちください」ボタン

## Phase 7: 設定画面・メール
- [x] 設定画面（STORES URL 10分・20分・30分をDB管理）
- [x] SendGrid APIキー環境変数設定（webdev_request_secrets）
- [x] メールテンプレート（セッション参加URL・日時・注意事項）

## Phase 8: テスト・チェックポイント
- [x] Vitestテスト（14テスト全通過: admin.check, admin.login, clients, sessions, settings, carryover）
- [x] チェックポイント保存

## Phase 9: ドキュメント
- [x] 使い方マニュアル（日本語）
- [x] テーブル設計書

## 納品
- [x] GitHubリポジトリ作成（https://github.com/coollove0406noa/angelique）
- [x] 最終チェックポイント保存（version: 49d4520c）

## バグ修正: SendGridメール送信
- [x] 環境変数がサーバーに正しく渡されているか確認
- [x] 顧客登録時のメール送信コードパスを確認・ログ追加
- [x] SendGrid APIへの実際のHTTPリクエストを確認
- [x] メール送信の単体テストを実行して結果を確認

## バグ修正・改善
- [x] アラート音修正：残り5分・1分でチャイム1回のみ、ループ・連続再生を削除
- [x] チャット折りたたみ廃止：全メッセージを最初から全文表示
- [x] 延長URLをクリック可能なリンク/ボタンに変更（お客様画面）

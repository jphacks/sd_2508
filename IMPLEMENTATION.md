# 見守りカード - LoRa通信を用いた見守りシステム

[![IMAGE ALT TEXT HERE](https://jphacks.com/wp-content/uploads/2025/05/JPHACKS2025_ogp.jpg)](https://www.youtube.com/watch?v=lA9EluZugD8)

## 製品概要

LoRa通信とBLE、GPSを組み合わせた包括的な見守りシステムのWebアプリケーションです。スマホを持たない幼児や高齢者にカードトラッカーを持たせ、保護者がWebアプリで位置を追跡できます。

### 背景（製品開発のきっかけ、課題等）

- 近年、通園バスへの幼児置き去り事件が多発
- 高齢者の徘徊による行方不明事件の増加
- スマホを持たせられない年齢層の見守りニーズ
- 既存のGPS端末は屋内での精度が低い

### 製品説明（具体的な製品の説明）

LoRaカードトラッカーとBLEビーコン、GPSを組み合わせた3つのモードを持つ見守りシステムです：

1. **室内位置追跡モード**: BLEビーコン3台で部屋内の位置を高精度に把握
2. **バス置き去り検知モード**: BLEビーコン1台で移動物内の置き去りを検知
3. **屋外GPS追跡モード**: GPSで親子間の距離を監視

### 特長

#### 1. マルチモード対応
シーンに応じて3つのモードを切り替え可能。室内・車内・屋外それぞれに最適化された見守りを実現。

#### 2. 高精度な室内位置推定
Fingerprinting法により、BLE3台で部屋内の位置を数十cm単位で推定。キャリブレーション機能で任意の部屋に対応。

#### 3. 直感的なUI/UX
pomunity.comを参考にした使いやすいインターフェース。非技術者でも簡単に設定・利用可能。

## 技術スタック

- **フロントエンド**: React + TypeScript + Vite
- **地図表示**: Leaflet / React-Leaflet
- **ルーティング**: React Router
- **バックエンド**: Firebase (Firestore, Realtime Database, Authentication)

## 使用デバイス

- **BLE Beacon**: MM-BLEBC4（×3台）
- **LoRa カードトラッカー**: SenseCAP T1000-A LoRa WAN（×3台）
- **LoRa WAN ゲートウェイ**: SenseCAP M2

## セットアップ

### 必要条件
- Node.js 18以上
- npm または yarn

### インストール

```bash
cd front
npm install
```

### 開発サーバーの起動

```bash
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。

### ビルド

```bash
npm run build
```

## 機能詳細

### 機能1: 室内位置追跡（完全実装）
- BLEビーコン3台を使用したFingerprinting法による室内位置推定
- リアルタイムの位置表示と部屋退出時の警告
- 詳細なキャリブレーション機能（7ポイント測定）
- 家具配置によるマップのカスタマイズ

### 機能2: バス置き去り検知（モック実装）
- BLEビーコン1台による検知範囲の監視
- 単独検知3分継続で警告を発報
- 地図上での検知範囲の可視化

### 機能3: 屋外GPS追跡（モック実装）
- 親トラッカーと子トラッカーの距離監視
- カスタマイズ可能な警告距離（デフォルト30m）
- リアルタイムGPS位置の地図表示
- デモ位置: 宮城県仙台市青葉区荒巻青葉6−3付近（東北大学）

## プロジェクト構造

```
front/
├── src/
│   ├── pages/              # ページコンポーネント
│   │   ├── Dashboard.tsx   # ダッシュボード
│   │   ├── Mode1Indoor.tsx # 機能1: 室内位置追跡
│   │   ├── Mode2Bus.tsx    # 機能2: バス置き去り検知
│   │   ├── Mode3GPS.tsx    # 機能3: GPS追跡
│   │   ├── Management.tsx  # 管理画面
│   │   └── Calibration.tsx # キャリブレーション
│   ├── types/              # TypeScript型定義
│   ├── utils/              # ユーティリティ関数
│   ├── App.tsx            # メインアプリケーション
│   ├── firebase.ts        # Firebase設定
│   ├── main.tsx           # エントリーポイント
│   └── styles.css         # グローバルスタイル
```

## TODO（未実装機能）

### 機能1（室内位置追跡）
- [ ] 三辺測量アルゴリズムの完全実装
- [ ] カルマンフィルタによる位置スムージング
- [ ] 追加キャリブレーションポイント機能
- [ ] 部屋サイズの手動入力対応

### 機能2（バス置き去り検知）
- [ ] 実際のビーコン・トラッカーデータとの連携
- [ ] 検知履歴の記録と表示

### 機能3（GPS追跡）
- [ ] 実際のGPSデータとの連携
- [ ] 移動履歴の記録と表示
- [ ] ジオフェンス機能

### 共通
- [ ] プッシュ通知機能
- [ ] データ分析ダッシュボード
- [ ] ユーザー認証とマルチユーザー対応

## 注力したこと（こだわり等）

* Fingerprinting法による高精度な室内位置推定アルゴリズムの実装
* 非技術者でも使えるシンプルで直感的なキャリブレーションUI
* pomunity.comを参考にした洗練されたデザイン
* TypeScriptによる型安全な実装

## 開発技術

### 活用した技術
#### API・データ
* Firebase Firestore
* Firebase Realtime Database
* OpenStreetMap (Leaflet)

#### フレームワーク・ライブラリ・モジュール
* React 18
* TypeScript
* Vite
* React Router
* Leaflet / React-Leaflet

#### デバイス
* SenseCAP T1000-A LoRa WAN トラッカー
* MM-BLEBC4 BLEビーコン
* SenseCAP M2 LoRaWANゲートウェイ

### 独自技術
#### ハッカソンで開発した独自機能・技術
* Fingerprinting法による室内位置推定システム
* マルチモード対応の見守りシステムアーキテクチャ
* ユーザーフレンドリーなキャリブレーションワークフロー

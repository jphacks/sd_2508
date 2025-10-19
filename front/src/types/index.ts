// デバイス（トラッカー）関連の型定義
export interface Device {
  deviceId: string; // トラッカーにつけた名前（識別用）
  devEUI: string; // LoRaWAN デバイスEUI（必須）
  lorawan?: {
    joinEUI?: string;
    appEUI?: string;
  };
  model: string;
  firmware?: string;
  ownerUid: string;
  status: 'active' | 'inactive';
  tags?: string[];
  userName?: string; // トラッカー所持者のユーザー名
}

// ビーコン関連の型定義
export interface Beacon {
  beaconId: string;
  mac: string;
  uuid?: string;
  major?: number;
  minor?: number;
  type: 'ibeacon' | 'eddystone' | 'raw';
  rssiAt1m?: number;
  place?: { x: number; y: number };
  anchor_loc?: { lat: number; lon: number };
  tags?: string[];
  name?: string;
}

// GPS測位データ
export interface GPSFix {
  ts: string;
  loc: { lat: number; lon: number; alt?: number };
  hdop?: number;
  acc_m?: number;
  speed_mps?: number;
}

// BLEスキャンデータ
export interface BLEScan {
  ts: string;
  scan_ms?: number;
  channel?: number;
  beacons: Array<{
    mac: string;
    rssi: number;
    txPower?: number;
  }>;
  scanner?: {
    kind: string;
    appVer?: string;
  };
  loc_hint?: { lat: number; lon: number };
}

// 位置融合データ
export interface FusedPosition {
  ts: { _seconds: number };
  loc?: { lat: number; lon: number; floor?: number };
  xy?: { x: number; y: number }; // 0-1の正規化座標
  cov_xy?: number[][];
  uncertainty_ellipse?: {
    semi_major: number;
    semi_minor: number;
    theta_deg: number;
  };
  method?: string;
  confidence?: number;
  inputs?: {
    gps_ref?: string;
    scan_ref?: string;
    beacons_used?: string[];
  };
}

// 部屋のプロファイル（機能1用）
export interface RoomProfile {
  roomId: string;
  name: string;
  beacons: string[]; // beaconIdの配列
  calibrationPoints: CalibrationPoint[];
  outline?: { width: number; height: number }; // メートル単位（未指定の場合は正規化座標）
  furniture?: FurnitureItem[];
  beaconPositions?: Array<{
    id: string;
    name: string;
    position: { x: number; y: number }; // 0-1の正規化座標
  }>;
  createdAt: string;
  updatedAt: string;
}

// キャリブレーションポイント
export interface CalibrationPoint {
  id: string;
  position: { x: number; y: number }; // 部屋内の実座標（メートル）
  label: string; // "左上隅", "中央", "ドア内側" など
  measurements: Array<{
    deviceId: string;
    timestamp: string;
    rssiValues: { [beaconMac: string]: number };
  }>;
}

// 家具アイテム
export type FurnitureType = 'desk' | 'tv' | 'piano' | 'chair';

export interface FurnitureItem {
  id: string;
  type: FurnitureType; // string から FurnitureType に変更
  position: { x: number; y: number };
  width: number;
  height: number;
}

// アプリケーションモード
export type AppMode = 'mode1' | 'mode2' | 'mode3';

// 機能1の設定
export interface Mode1Config {
  roomId: string;
  alertOnExit: boolean;
  calibrated: boolean;
}

// 機能2の設定
export interface Mode2Config {
  beaconId: string;
  alertThresholdMinutes: number; // デフォルト3分
  calibrated: boolean;
}

// 機能3の設定
export interface Mode3Config {
  parentTrackerIds: string[]; // 親トラッカーのdeviceId配列
  maxDistanceMeters: number; // デフォルト30m
  calibrated: boolean;
}

// アプリケーション設定
export interface AppConfig {
  currentMode: AppMode;
  mode1?: Mode1Config;
  mode2?: Mode2Config;
  mode3?: Mode3Config;
  userId: string;
}

// アラート情報
export interface Alert {
  id: string;
  type: 'exit_room' | 'bus_left_behind' | 'separated';
  message: string;
  deviceId?: string;
  deviceName?: string;
  timestamp: string;
  dismissed: boolean;
}

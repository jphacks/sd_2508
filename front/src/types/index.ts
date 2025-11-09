// 統合型定義ファイル（重複を削除し、統合）

// === 基本型定義 ===
export type Mode = 'indoor' | 'bus' | 'gps';
export type AppMode = "mode1" | "mode2" | "mode3";
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

// === デバイス関連（統合版） ===
export interface Device {
  // 必須フィールド（最小限）
  id: string;
  devEUI: string;
  
  // オプショナルフィールド（大部分を任意に）
  deviceId: string;
  name?: string;
  userName?: string;
  model?: string;
  firmware?: string;
  ownerUid?: string;
  status?: "active" | "inactive";
  tags?: string[];
  
  // LoRaWAN関連（任意）
  lorawan?: {
    joinEUI?: string;
    appEUI?: string;
  };
  
  // リアルタイムデータ（任意）
  bleData?: BLEData[];
  position?: GPSPosition | null;
  lastUpdate?: Date;
  statusData?: DeviceStatusData | null;
  
  // その他（任意）
  mac?: string;
  [key: string]: any; // 拡張性のため
}

// DeviceStatusをDeviceStatusDataにリネーム（重複回避）
export interface DeviceStatusData {
  inside?: boolean;           // 室内状態 (true: 室内, false: 室外)
  shock?: boolean;            // 転倒状態 (true: 転倒, false: 正常)
  temperature_c?: number;     // 温度 (摂氏)
  inBus?: boolean;            // バス内状態 (true: バス内, false: バス外)
  busStatusUpdatedAt?: string; // バス状態の最終更新時刻
  [key: string]: any;         // その他のstatusフィールドに対応
}

// BLEData型を統合（BeaconDataと統合）
export interface BLEData {
  beaconId?: string;
  mac: string;
  rssi: number;
  timestamp: string;
  distance?: number;
  txPower?: number;
}

// BeaconData型をBLEDataのエイリアスに
export type BeaconData = BLEData;

export interface GPSPosition {
  lat: number;
  lng?: number;
  lon: number;
  timestamp?: string;
  accuracy?: number;
  altitude?: number;
  speed?: number;
}

// === ビーコン関連 ===
export interface Beacon {
  beaconId?: string;
  id: string;
  name?: string;
  mac: string;
  uuid?: string;
  major?: number;
  minor?: number;
  type?: "ibeacon" | "eddystone" | "raw";
  rssiAt1m?: number;
  place?: { x: number; y: number };
  anchor_loc?: { lat: number; lon: number };
  tags?: string[];
}

export interface BeaconDevice {
  id: string;
  name: string;
  mac: string;
  rssi?: number;
  lastSeen?: string;
  battery?: number;
  isActive?: boolean;
}

// === アラート関連 ===
export type AlertType = 'shock' | 'exit_room' | 'bus_alone' | 'gps_distance';
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Alert {
  id: string;
  type: AlertType;
  message: string;
  deviceId: string;
  deviceName?: string;
  timestamp: string;
  dismissed: boolean;
  severity?: AlertSeverity;
  mode: Mode;
  additionalData?: Record<string, any>;
}

// === モード関連 ===
export interface ModeConfig {
  title: string;
  description: string;
  color: string;
  icon: string;
}

// === GPS関連 ===
export interface GPSFix {
  ts: string;
  loc: { lat: number; lon: number; alt?: number };
  hdop?: number;
  acc_m?: number;
  speed_mps?: number;
}

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

export interface FusedPosition {
  ts: { _seconds: number };
  loc?: { lat: number; lon: number; floor?: number };
  xy?: { x: number; y: number };
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

// === 室内マップ関連 ===
export interface RoomProfile {
  roomId: string;
  name: string;
  beacons: string[];
  doorBeaconId?: string | null;
  calibrationPoints: CalibrationPoint[];
  outline?: { width: number; height: number };
  furniture?: FurnitureItem[];
  exitMargin?: number;
  beaconPositions?: Array<{
    id: string;
    name: string;
    position: { x: number; y: number };
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface CalibrationPoint {
  id: string;
  label: string;
  position: { x: number; y: number };
  mac?: string;
  beaconId?: string;
  measurements: Array<{
    timestamp: string;
    rssiValues: { [mac: string]: number };
  }>;
}

export type FurnitureType = "desk" | "tv" | "piano" | "chair";

export interface FurnitureItem {
  id: string;
  type: FurnitureType;
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface BeaconPosition {
  id: string;
  name: string;
  x: number; // マップ上のX座標 (0-100%)
  y: number; // マップ上のY座標 (0-100%)
  mac: string;
  range?: number; // 検知範囲（メートル）
}

export interface RoomLayout {
  id: string;
  name: string;
  width: number; // 実際の幅（メートル）
  height: number; // 実際の高さ（メートル）
  beacons: BeaconPosition[];
  obstacles?: Array<{ // 障害物（壁、家具など）
    x: number;
    y: number;
    width: number;
    height: number;
    type: 'wall' | 'furniture' | 'door';
    label?: string;
  }>;
  zones?: Array<{ // エリア定義
    id: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
  }>;
}

// === 設定関連 ===
export interface Mode1Config {
  roomId: string;
  alertOnExit: boolean;
  calibrated: boolean;
}

export interface Mode2Config {
  beaconId: string;
  alertThresholdMinutes: number;
  calibrated: boolean;
}

export interface Mode3Config {
  parentTrackerIds: string[];
  maxDistanceMeters: number;
  calibrated: boolean;
}

// 温度閾値設定
export interface TemperatureThresholdSettings {
  highTempThreshold: number; // 高温警告の閾値（デフォルト28度）
  lowTempThreshold?: number; // 低温警告の閾値（オプション）
  rssiSumThreshold?: number; // 🔥 RSSI合計の退室判定閾値（デフォルト-200）
}

// バス内デバイス数警告閾値設定
export interface BusSettings {
  rssiThreshold: number; // バス内判定閾値（dBm、デフォルト-75）
  busDeviceAlertThreshold: number; // バス内デバイス数警告閾値（デフォルト1）
}

export interface AppConfig {
  currentMode: AppMode;
  mode1?: Mode1Config;
  mode2?: Mode2Config;
  mode3?: Mode3Config;
  userId: string;
}

export interface TrackerGroup {
  id: string;
  name: string;
  parentDeviceId: string;
  childDeviceIds: string[];
  settings: {
    maxDistance: number;
    alertEnabled: boolean;
    trackingInterval: number;
  };
  createdAt: string;
  updatedAt: string;
}

// === API関連 ===
export interface APIResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  timestamp: string;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Mode2Bus用の設定ハンドラー型を追加
export interface Mode2BusSettings {
  selectedBeacon: string;
  rssiThreshold: number;
  alertThreshold: number;
  alertEnabled: boolean;
  alertSound: boolean;
  connectionTimeout: number;
  showAllDevices: boolean;
}

export interface Mode2BusSettingsHandlers {
  onSelectedBeaconChange?: (beaconId: string) => void;
  onRssiThresholdChange?: (threshold: number) => void;
  onAlertThresholdChange?: (threshold: number) => void;
  onAlertEnabledChange?: (enabled: boolean) => void;
  onAlertSoundChange?: (enabled: boolean) => void;
  onConnectionTimeoutChange?: (timeout: number) => void;
  onShowAllDevicesChange?: (show: boolean) => void;
}

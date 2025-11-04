// 統合型定義ファイル（すべての型を1つのファイルに）

// === 基本型定義 ===
export type Mode = 'indoor' | 'bus' | 'gps';
export type AppMode = "mode1" | "mode2" | "mode3";
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

// === デバイス関連 ===
export interface Device {
  // 既存のフィールド
  deviceId: string;
  devEUI: string;
  lorawan?: {
    joinEUI?: string;
    appEUI?: string;
  };
  model: string;
  firmware?: string;
  ownerUid: string;
  status: "active" | "inactive";
  tags?: string[];
  userName?: string;
  
  // 統合画面用の追加フィールド
  id?: string;
  name?: string;
  bleData?: BeaconData[];
  position?: GPSPosition;
  lastUpdate?: Date;
}

export interface BeaconData {
  beaconId: string;
  mac: string;
  rssi: number;
  timestamp: string;
  distance?: number;
}

export interface GPSPosition {
  lat: number;
  lng?: number;
  lon: number;
  timestamp?: string;
  accuracy?: number;
  altitude?: number;
  speed?: number;
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

// === 既存の型定義（変更なし） ===
export interface Beacon {
  beaconId: string;
  mac: string;
  uuid?: string;
  major?: number;
  minor?: number;
  type: "ibeacon" | "eddystone" | "raw";
  rssiAt1m?: number;
  place?: { x: number; y: number };
  anchor_loc?: { lat: number; lon: number };
  tags?: string[];
  name?: string;
}

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

export interface RoomProfile {
  roomId: string;
  name: string;
  beacons: string[];
  doorBeaconId?: string | null;
  calibrationPoints: CalibrationPoint[];
  outline?: { width: number; height: number };
  furniture?: FurnitureItem[];
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
  position: { x: number; y: number };
  label: string;
  measurements: Array<{
    deviceId: string;
    timestamp: string;
    rssiValues: { [beaconMac: string]: number };
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

export interface AppConfig {
  currentMode: AppMode;
  mode1?: Mode1Config;
  mode2?: Mode2Config;
  mode3?: Mode3Config;
  userId: string;
}

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

// 🔥 追加: 室内マップ関連の型定義
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

// 🔥 追加: ビーコンデバイス型定義
export interface BeaconDevice {
  id: string;
  name: string;
  mac: string;
  rssi?: number;
  lastSeen?: string;
  battery?: number;
  isActive: boolean;
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

export interface DeviceStatus {
  deviceId: string;
  isOnline: boolean;
  lastSeen: string;
  batteryLevel?: number;
  signalStrength?: number;
  location?: {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: string;
  };
  firmware?: string;
  uptime: number;
  dataRate?: string;
  frequency?: number;
}
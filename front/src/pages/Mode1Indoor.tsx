import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { ref, onValue, update } from "firebase/database";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { useLocation } from "react-router-dom";
import { rtdb, db } from "../firebase";
import { Device, BLEScan, RoomProfile, Alert, Beacon, CalibrationPoint } from "../types";
import { estimatePositionHybrid } from "../utils/positioning";

// ビーコン受信ログの型定義
interface BeaconLog {
  id: string;
  timestamp: string;
  deviceId: string;
  deviceName: string;
  missingBeacons: Array<{
    beaconId: string;
    beaconName: string;
    mac: string;
  }>;
  receivedBeacons: Array<{
    beaconId: string;
    beaconName: string;
    mac: string;
    rssi: number;
  }>;
}

type BeaconSignal = {
  beaconId: string;
  mac: string;
  rssi: number;
};

const FURNITURE_TYPES = {
  desk: { label: "机", width: 2, height: 1, color: "#8B4513" },
  tv: { label: "テレビ", width: 3, height: 0.5, color: "#2C3E50" },
  piano: { label: "ピアノ", width: 2, height: 1.5, color: "#1A1A1A" },
  chair: { label: "椅子", width: 0.8, height: 0.8, color: "#CD853F" },
  door: { label: "ドア", width: 1, height: 0.2, color: "#D2691E" },
} as const;

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30分

// RTDB監視を削除し、外部データのみに依存
export default function Mode1Indoor({ devices: externalDevices }: { devices?: Device[] } = {}) {
  const location = useLocation();
  const [devices, setDevices] = useState<Device[]>(externalDevices || []);
  const [beacons, setBeacons] = useState<(Beacon & { firestoreId: string })[]>([]);
  const beaconsRef = useRef<(Beacon & { firestoreId: string })[]>([]);
  const [roomProfile, setRoomProfile] = useState<RoomProfile | null>(null);
  
  // 🔥 不足している状態管理を追加
  const [availableRooms, setAvailableRooms] = useState<RoomProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const [devicePositions, setDevicePositions] = useState<
    Map<string, { x: number; y: number }>
  >(new Map());
  const [deviceTimestamps, setDeviceTimestamps] = useState<Map<string, string>>(
    new Map()
  );
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [beaconLogs, setBeaconLogs] = useState<BeaconLog[]>([]);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const presenceStatusRef = useRef<Map<string, boolean>>(new Map());
  const rtdbUnsubscribesRef = useRef<(() => void)[]>([]);
  const [showRssiOverlay, setShowRssiOverlay] = useState(false);
  const [deviceBeaconSignals, setDeviceBeaconSignals] = useState<
    Map<string, BeaconSignal[]>
  >(new Map());
  const [infoIconPositions, setInfoIconPositions] = useState<
    Map<string, { x: number; y: number; radius: number }>
  >(new Map());
  const [tooltip, setTooltip] = useState<{
    deviceId: string;
    left: number;
    top: number;
    signals: BeaconSignal[];
  } | null>(null);

  // 🔥 相対時刻を定期的に更新するための状態フラグ
  const [updateTicker, setUpdateTicker] = useState(0);

  const normalizeTimestampToIso = useCallback((value: unknown): string | null => {
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      const millis = value > 1e12 ? value : value * 1000;
      const parsed = new Date(millis);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    return null;
  }, []);

  // 🔥 デフォルトルーム選択のuseEffectを追加
  useEffect(() => {
    if (availableRooms.length > 0 && !roomProfile) {
      // 最初の部屋をデフォルトで選択
      setRoomProfile(availableRooms[0]);
    }
  }, [availableRooms, roomProfile]);
  
  useEffect(() => {
    beaconsRef.current = beacons;
  }, [beacons]);

  const cleanupRtdbListeners = useCallback(() => {
    if (rtdbUnsubscribesRef.current.length === 0) {
      return;
    }

    rtdbUnsubscribesRef.current.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        console.error("RTDB listener cleanup failed:", error);
      }
    });
    rtdbUnsubscribesRef.current = [];
  }, []);

  const getBeaconInfo = useCallback((mac: string) => {
    const normalized = mac.toUpperCase().replace(/:/g, "");
    const beacon = beaconsRef.current.find((b) => {
      if (!b.mac) return false;
      return b.mac.toUpperCase().replace(/:/g, "") === normalized;
    });
    if (!beacon) {
      return null;
    }
    return {
      beaconId: beacon.beaconId ?? undefined,
      name: beacon.name ?? undefined,
    };
  }, []);

  const selectBeaconLabel = (
    info:
      | Partial<{
          beaconId: string | null;
          name: string | null;
        }>
      | undefined,
    fallback: string
  ) => {
    const values = [info?.name, info?.beaconId, fallback]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(
        (value, index, array) =>
          value.length > 0 && array.indexOf(value) === index
      );
    return values.length > 0 ? values.join(" → ") : fallback;
  };

  useEffect(() => {
    loadData();
    return () => {
      cleanupRtdbListeners();
    };
  }, [cleanupRtdbListeners]);

  // 🔥 相対時刻を定期的に更新するための useEffect
  useEffect(() => {
    const interval = setInterval(() => {
      setUpdateTicker(prev => prev + 1);
    }, 1000); // 1秒ごとに更新

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setShowRssiOverlay(params.has("rssi"));
  }, [location.search]);

  // 🔥 loadData関数からRTDB監視を完全削除
  const [isInitialized, setIsInitialized] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      
      const [beaconsSnapshot, roomsSnapshot, configSnapshot] = await Promise.all([
        getDocs(collection(db, 'beacons')),
        getDocs(collection(db, 'rooms')),
        getDocs(collection(db, 'appConfig')) // 🔥 追加: ユーザー設定を取得
      ]);

      const beaconsData = beaconsSnapshot.docs.map(doc => ({
        firestoreId: doc.id,
        ...doc.data()
      })) as (Beacon & { firestoreId: string })[];
      
      setBeacons(beaconsData);
      beaconsRef.current = beaconsData;
      
      const roomProfiles = roomsSnapshot.docs.map(doc => ({
        roomId: doc.id,
        ...doc.data()
      })) as RoomProfile[];
      
      setAvailableRooms(roomProfiles);
      
      // 🔥 アクティブルーム検索
      const userId = 'demo-user'; // TODO: 実際のユーザーIDを使用
      const userConfig = configSnapshot.docs.find(doc => doc.data().userId === userId);
      const activeRoomId = userConfig?.data()?.mode1?.roomId;
      
      let selectedRoom: RoomProfile | null = null;
      
      if (activeRoomId) {
        // 使用中に設定されたルームを検索
        selectedRoom = roomProfiles.find(room => room.roomId === activeRoomId) || null;
      }
      
      if (!selectedRoom && roomProfiles.length > 0) {
        // フォールバック: 最初のルームを使用
        selectedRoom = roomProfiles[0];
        console.warn('⚠️ フォールバック: 最初のルーム使用:', selectedRoom.name);
      }
      
      if (selectedRoom) {
        setRoomProfile(selectedRoom);
      }
      
      // 🔧 roomProfile が設定されたことを確実に把握するため、コールバック関数を使用
      setIsInitialized(true);
      setLoading(false);
      
    } catch (error) {
      console.error('❌ Mode1 データ読み込みエラー:', error);
      setError('データの読み込みに失敗しました');
      setLoading(false);
    }
  };

  const performPositionEstimation = useCallback((device: Device, scan: BLEScan) => {
    try {
      if (!roomProfile?.calibrationPoints) {
        console.warn(`⚠️ Mode1 CalibrationPointsが未設定: ${device.name}`);
        return;
      }

      // ビーコン位置情報を構築
      const beaconPositions = roomProfile.beacons
        .map((beaconId) => {
          const beacon = beaconsRef.current.find(b => b.firestoreId === beaconId);
          if (beacon && beacon.place) {
            return {
              x: beacon.place.x,
              y: beacon.place.y,
              mac: beacon.mac,
              beaconId: beaconId,
            };
          }
          return null;
        })
        .filter((b) => b !== null) as Array<{
          x: number;
          y: number;
          mac: string;
          beaconId: string;
        }>;

      // MACアドレスベースのRSSIマップ作成
      const rssiMap: { [mac: string]: number } = {};
      
      scan.beacons.forEach((beacon) => {
        if (beacon.mac && beacon.rssi) {
          const normalizedMac = beacon.mac.toUpperCase().replace(/:/g, "");
          const isInvalidSignal = normalizedMac === "FFFFFFFFFFFF" || beacon.rssi === -1;
          
          if (!isInvalidSignal) {
            rssiMap[normalizedMac] = beacon.rssi;
          }
        }
      });

      if (Object.keys(rssiMap).length === 0) {
        console.warn(`⚠️ ${device.name}: 有効なRSSI値がありません`);
        return;
      }

      // 位置推定実行
      const position = estimatePositionHybrid(
        rssiMap,
        roomProfile.calibrationPoints,
        beaconPositions.length >= 3 ? beaconPositions : undefined
      );

      if (position) {
        // 座標変換
        const outlineWidth = roomProfile.outline?.width ?? 1;
        const outlineHeight = roomProfile.outline?.height ?? 1;
        const actualPosition = {
          x: position.x * outlineWidth,
          y: position.y * outlineHeight
        };

        // 🔧 位置情報を即座に更新
        setDevicePositions(prev => {
          const newMap = new Map(prev);
          newMap.set(device.devEUI, actualPosition);
          return newMap;
        });

        checkRoomExit(device, actualPosition, roomProfile);

        // 🔧 描画を強制実行
        setTimeout(() => {
          if (roomProfile && canvasRef.current) {
            drawRoom();
          }
        }, 100);
      } else {
        console.warn(`⚠️ ${device.name}: 位置推定失敗`);
      }
    } catch (error) {
      console.error(`❌ Mode1 位置推定エラー: ${device.name}`, error);
    }
  }, [roomProfile]);

  // 🔥 Mode1専用のデータ処理関数
  const processDeviceDataForMode1 = useCallback((device: Device) => {
    // 🔥 必要な条件をチェック
    if (!roomProfile) {
      console.warn(`⚠️ Mode1 roomProfile未設定: ${device.name}`);
      return;
    }
    
    if (beaconsRef.current.length === 0) {
      console.warn(`⚠️ Mode1 beacons未設定: ${device.name}`);
      return;
    }

    // BLEデータがある場合の位置推定
    let latestBleTimestampIso: string | null = null;

    if (device.bleData && device.bleData.length > 0) {
      // 🔥 BLEScanデータの構築（詳細ログ付き）
      const latestScan: BLEScan = {
        ts: device.lastUpdate?.toISOString() || new Date().toISOString(),
        beacons: device.bleData.map(ble => {
          return {
            mac: ble.mac,
            rssi: ble.rssi,
            txPower: undefined
          };
        })
      };

      // 🔥 位置推定処理を実行
      try {
        performPositionEstimation(device, latestScan);
      } catch (error) {
        console.error(`❌ Mode1 位置推定エラー: ${device.name}`, error);
      }

      // ビーコンシグナル更新
      const signals: BeaconSignal[] = device.bleData.map(ble => {
        const beaconInfo = getBeaconInfo(ble.mac);

        const bleTimestampIso = normalizeTimestampToIso((ble as any).timestamp);
        if (bleTimestampIso) {
          if (!latestBleTimestampIso || new Date(bleTimestampIso).getTime() > new Date(latestBleTimestampIso).getTime()) {
            latestBleTimestampIso = bleTimestampIso;
          }
        }

        return {
          beaconId: beaconInfo?.beaconId || ble.beaconId || ble.mac,
          mac: ble.mac,
          rssi: ble.rssi
        };
      });
      
      setDeviceBeaconSignals(prev => new Map(prev.set(device.devEUI, signals)));
    } else {
      console.warn(`⚠️ Mode1 BLEデータなし: ${device.name}`);
    }

    // 最終更新時刻の更新
    if (!latestBleTimestampIso && device.lastUpdate) {
      latestBleTimestampIso = device.lastUpdate.toISOString();
    }

    if (latestBleTimestampIso) {
      setDeviceTimestamps(prev => new Map(prev.set(device.devEUI, latestBleTimestampIso!)));
    }
  }, [roomProfile, normalizeTimestampToIso]);

  // 🔥 roomProfile が設定された後に、外部デバイスを強制的に再処理する
  useEffect(() => {
    if (!roomProfile || !externalDevices || externalDevices.length === 0) {
      return;
    }

    // console.log('🔄 roomProfile が設定されたため、外部デバイスを再処理します', {
    //   roomName: roomProfile.name,
    //   deviceCount: externalDevices.length,
    //   hasCalibrationPoints: !!roomProfile.calibrationPoints
    // });

    // 全外部デバイスを処理
    externalDevices.forEach((device) => {
      processDeviceDataForMode1(device);
    });
  }, [roomProfile, externalDevices, processDeviceDataForMode1]);

  // 🔥 外部データ処理を初期化完了後に実行
  useEffect(() => {
    if (!externalDevices || !isInitialized || !roomProfile) {
      return;
    }

    // 🔧 デバイスごとのBLEデータ変更を詳細チェック
    externalDevices.forEach((externalDevice, index) => {
      const currentDevice = devices.find(d => d.devEUI === externalDevice.devEUI);
      
      // BLEデータの変更チェック
      const hasBleChange = !currentDevice || 
        JSON.stringify(currentDevice.bleData) !== JSON.stringify(externalDevice.bleData);
      
      // 最終更新時刻の変更チェック  
      const hasTimeChange = !currentDevice ||
        currentDevice.lastUpdate?.getTime() !== externalDevice.lastUpdate?.getTime();

      if (hasBleChange || hasTimeChange) {
        // 即座にデバイスデータを処理
        processDeviceDataForMode1(externalDevice);
      }
    });

    // デバイス配列を更新
    setDevices(externalDevices);
  }, [externalDevices, isInitialized, roomProfile, devices, processDeviceDataForMode1]);

  // 🔥 CalibrationPoint変換のヘルパー関数
  const convertBeaconsToCalibrationPoints = useCallback((
    beaconIds: string[], 
    beacons: (Beacon & { firestoreId: string })[]
  ): CalibrationPoint[] => {
    return beaconIds
      .map((beaconId) => {
        const beacon = beacons.find(b => b.firestoreId === beaconId);
        if (beacon && beacon.place) {
          const calibrationPoint: CalibrationPoint = {
            id: beaconId,
            label: beacon.name || beacon.beaconId || beaconId,
            position: {
              x: beacon.place.x,
              y: beacon.place.y
            },
            measurements: [] // 空の配列で初期化
          };
          return calibrationPoint;
        }
        
        console.warn(`⚠️ ビーコンが見つからない: ${beaconId}`);
        return null;
      })
      .filter((point): point is CalibrationPoint => point !== null);
  }, []);


  const checkRoomExit = (
    device: Device,
    position: { x: number; y: number },
    room: RoomProfile,
    forceOutside: boolean = false
  ): boolean => {
    const margin = -0.5;
    const outlineWidth = room.outline?.width ?? 1;
    const outlineHeight = room.outline?.height ?? 1;
    const isInside = forceOutside ? false : (
      position.x >= -margin &&
      position.x <= outlineWidth + margin &&
      position.y >= -margin &&
      position.y <= outlineHeight + margin
    );

    const normalizedDeviceId = device.devEUI?.toLowerCase();
    if (normalizedDeviceId) {
      const previous = presenceStatusRef.current.get(normalizedDeviceId);
      if (previous !== isInside) {
        presenceStatusRef.current.set(normalizedDeviceId, isInside);
        const statusRef = ref(rtdb, `devices/${normalizedDeviceId}/status`);
        
        // 日本時間（JST、+09:00）のタイムスタンプを作成
        const now = new Date();
        const jstOffset = 9 * 60; // 日本時間のオフセット（分）
        const jstTime = new Date(now.getTime() + jstOffset * 60 * 1000);
        const year = jstTime.getUTCFullYear();
        const month = String(jstTime.getUTCMonth() + 1).padStart(2, '0');
        const day = String(jstTime.getUTCDate()).padStart(2, '0');
        const hours = String(jstTime.getUTCHours()).padStart(2, '0');
        const minutes = String(jstTime.getUTCMinutes()).padStart(2, '0');
        const seconds = String(jstTime.getUTCSeconds()).padStart(2, '0');
        const timestamp = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+09:00`;
        
        update(statusRef, {
          inside: isInside,
          updatedAtInside: timestamp
        }).catch((error) => {
          console.error(`Presence update failed for ${device.devEUI}:`, error);
          if (typeof previous === "boolean") {
            presenceStatusRef.current.set(normalizedDeviceId, previous);
          } else {
            presenceStatusRef.current.delete(normalizedDeviceId);
          }
        });
      }
    }

    return isInside;
  };

  const dismissAlert = (alertId: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  // 🔥 formatTimestamp を useCallback に変更し、updateTicker を依存配列に追加
  const formatTimestamp = useCallback((timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffSecs = Math.floor((diffMs % 60000) / 1000);

      if (diffMins === 0) {
        return `${diffSecs}秒前`;
      } else if (diffMins < 60) {
        return `${diffMins}分前`;
      } else {
        const hours = Math.floor(diffMins / 60);
        if (hours < 24) {
          return `${hours}時間前`;
        } else {
          return date.toLocaleString("ja-JP", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
        }
      }
    } catch {
      return "不明";
    }
  }, [updateTicker]);

  useEffect(() => {
    if (roomProfile && canvasRef.current) {
      // 🔧 短い遅延で確実に描画
      const timer = setTimeout(() => {
        drawRoom();
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [roomProfile, devicePositions, devices, showRssiOverlay]);

  useEffect(() => {
    if (roomProfile && devices.length > 0 && devicePositions.size > 0) {
      const timer = setTimeout(() => {
        drawRoom();
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [devices]);


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = (event.clientX - rect.left) * scaleX;
      const canvasY = (event.clientY - rect.top) * scaleY;

      let hoveredDeviceId: string | null = null;
      infoIconPositions.forEach((icon, deviceId) => {
        const dx = canvasX - icon.x;
        const dy = canvasY - icon.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= icon.radius) {
          hoveredDeviceId = deviceId;
        }
      });

      if (hoveredDeviceId) {
        const icon = infoIconPositions.get(hoveredDeviceId);
        if (!icon) return;

        const containerRect =
          canvas.parentElement?.getBoundingClientRect() ?? rect;
        const scaleCssX = rect.width / canvas.width;
        const scaleCssY = rect.height / canvas.height;
        const left =
          icon.x * scaleCssX + (rect.left - containerRect.left) + 12;
        const top =
          icon.y * scaleCssY + (rect.top - containerRect.top) - 12;
        const signals = deviceBeaconSignals.get(hoveredDeviceId) || [];

        setTooltip((prev) => {
          if (
            prev &&
            prev.deviceId === hoveredDeviceId &&
            Math.abs(prev.left - left) < 0.5 &&
            Math.abs(prev.top - top) < 0.5
          ) {
            return prev;
          }
          return {
            deviceId: hoveredDeviceId!,
            left,
            top,
            signals,
          };
        });
      } else {
        setTooltip((prev) => (prev ? null : prev));
      }
    };

    const handleMouseLeave = () => {
      setTooltip(null);
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [infoIconPositions, deviceBeaconSignals]);

  useEffect(() => {
    if (!tooltip) return;
    const signals = deviceBeaconSignals.get(tooltip.deviceId) || [];
    setTooltip((prev) => {
      if (!prev) return prev;
      const sameLength = prev.signals.length === signals.length;
      const sameContent =
        sameLength &&
        prev.signals.every(
          (signal, index) =>
            signal.beaconId === signals[index]?.beaconId &&
            signal.mac === signals[index]?.mac &&
            signal.rssi === signals[index]?.rssi
        );
      if (sameContent) {
        return prev;
      }
      return { ...prev, signals };
    });
  }, [deviceBeaconSignals, tooltip]);

  useEffect(() => {
    if (tooltip && !infoIconPositions.has(tooltip.deviceId)) {
      setTooltip(null);
    }
  }, [infoIconPositions, tooltip]);

  const tooltipDevice = useMemo(() => {
    if (!tooltip) return null;
    return devices.find((device) => device.devEUI === tooltip.deviceId) || null;
  }, [tooltip, devices]);

  const drawRoom = () => {
    const canvas = canvasRef.current;
    if (!canvas || !roomProfile) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const roomWidth = roomProfile.outline?.width ?? 1;
    const roomHeight = roomProfile.outline?.height ?? 1;
    const exitSpaceDepth = 1.0; // 奥行き1m
    const exitSpaceWidth = 1.0; // 横幅1m

    // 退室スペースを含めた描画範囲を計算
    const exitSpaceMargin = exitSpaceDepth;
    const padding = 40;
    
    // ドアの位置から退室スペースの方向を計算
    const doorOutside = roomProfile.calibrationPoints?.find(p => p.id === "door_outside");
    const doorInside = roomProfile.calibrationPoints?.find(p => p.id === "door_inside");
    let totalWidth = roomWidth;
    let totalHeight = roomHeight;
    let offsetX = 0;
    let offsetY = 0;
    let doorInsideActual: { x: number; y: number } | null = null;
    let doorOutsideActual: { x: number; y: number } | null = null;
    let doorNormal: { x: number; y: number } | null = null;
    
    if (doorOutside && doorInside) {
      doorInsideActual = {
        x: doorInside.position.x * roomWidth,
        y: doorInside.position.y * roomHeight
      };
      doorOutsideActual = {
        x: doorOutside.position.x * roomWidth,
        y: doorOutside.position.y * roomHeight
      };

      // ドアの向きベクトル（実寸）
      const doorVectorX = doorOutsideActual.x - doorInsideActual.x;
      const doorVectorY = doorOutsideActual.y - doorInsideActual.y;
      const doorVectorLength = Math.hypot(doorVectorX, doorVectorY) || 1;
      doorNormal = {
        x: doorVectorX / doorVectorLength,
        y: doorVectorY / doorVectorLength
      };
      
      // 退室スペースの最大範囲を計算（実寸）
      const maxExitX = doorOutsideActual.x + doorNormal.x * exitSpaceMargin;
      const maxExitY = doorOutsideActual.y + doorNormal.y * exitSpaceMargin;
      const minExitX = doorOutsideActual.x - doorNormal.x * exitSpaceMargin;
      const minExitY = doorOutsideActual.y - doorNormal.y * exitSpaceMargin;
      
      // 全体の描画範囲を計算（実寸）
      const minX = Math.min(0, doorInsideActual.x, doorOutsideActual.x, minExitX, maxExitX);
      const minY = Math.min(0, doorInsideActual.y, doorOutsideActual.y, minExitY, maxExitY);
      const maxX = Math.max(roomWidth, doorInsideActual.x, doorOutsideActual.x, minExitX, maxExitX);
      const maxY = Math.max(roomHeight, doorInsideActual.y, doorOutsideActual.y, minExitY, maxExitY);
      
      totalWidth = maxX - minX;
      totalHeight = maxY - minY;
      offsetX = -minX;
      offsetY = -minY;
    }
    
    const width = canvas.width - padding * 2;
    const height = canvas.height - padding * 2;

    const scaleX = width / totalWidth;
    const scaleY = height / totalHeight;
    const scale = Math.min(scaleX, scaleY);
    
    // 実際に使用される描画領域の高さを計算
    // クリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 背景
    ctx.fillStyle = "#f5f7fa";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 退室スペースの背景を描画（薄い赤色）
    if (doorInsideActual && doorOutsideActual && doorNormal) {
      ctx.fillStyle = "rgba(255, 107, 53, 0.1)";
      
      // ドアの中心位置を計算（ドアの描画と同じ位置）
      const doorCenterX = (doorInsideActual.x + doorOutsideActual.x) / 2;
      const doorCenterY = (doorInsideActual.y + doorOutsideActual.y) / 2;
      const doorThickness = 0.05;

      const exitX = (doorCenterX + offsetX) * scale + padding;
      const exitY = (doorCenterY + offsetY) * scale + padding;
      
      ctx.save();
      ctx.translate(exitX, exitY);
      const angle = Math.atan2(doorNormal.y, doorNormal.x);
      ctx.rotate(angle);
      
      ctx.fillRect(
        doorThickness * scale / 2,
        -exitSpaceWidth * scale / 2,
        exitSpaceDepth * scale,
        exitSpaceWidth * scale
      );
      ctx.restore();
      
      // 「退室スペース」ラベル
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#ff6b35";
      ctx.textAlign = "center";
      const labelDistance = (exitSpaceDepth / 2 + doorThickness / 2) * scale;
      ctx.fillText(
        "退室スペース",
        exitX + doorNormal.x * labelDistance,
        exitY + doorNormal.y * labelDistance
      );
    }

    // 部屋の輪郭
    ctx.strokeStyle = "#2c3e50";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      padding + offsetX * scale,
      padding + offsetY * scale,
      roomWidth * scale,
      roomHeight * scale
    );

    // グリッド線（最背面）
    ctx.strokeStyle = "#e1e8ed";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    for (let i = 1; i < roomWidth; i++) {
      const x = padding + (i + offsetX) * scale;
      ctx.beginPath();
      ctx.moveTo(x, padding + offsetY * scale);
      ctx.lineTo(x, padding + (roomHeight + offsetY) * scale);
      ctx.stroke();
    }
    for (let i = 1; i < roomHeight; i++) {
      const y = padding + (i + offsetY) * scale;
      ctx.beginPath();
      ctx.moveTo(padding + offsetX * scale, y);
      ctx.lineTo(padding + (roomWidth + offsetX) * scale, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 家具を描画（中間層）
    if (roomProfile.furniture && roomProfile.furniture.length > 0) {
      roomProfile.furniture.forEach(furniture => {
        // ドアはキャリブレーション点から描画するため、家具の旧データはスキップ
        if (furniture.type === 'door' as any) {
          return;
        }
        const furnitureType = FURNITURE_TYPES[furniture.type as keyof typeof FURNITURE_TYPES];
        const furnitureColor = furnitureType?.color || '#95a5a6';
        
        ctx.fillStyle = furnitureColor;
        // 正規化座標（0-1）× ルームサイズ = 実際のメートル位置
        const furnitureX = furniture.position.x * roomWidth;
        const furnitureY = furniture.position.y * roomHeight;
        const furnitureW = furniture.width * roomWidth;
        const furnitureH = furniture.height * roomHeight;

        const x = padding + (furnitureX + offsetX) * scale;
        const y = padding + (furnitureY + offsetY) * scale;
        const w = furnitureW * scale;
        const h = furnitureH * scale;

        ctx.fillRect(x, y, w, h);

        // 家具の境界線
        ctx.strokeStyle = "#2c3e50";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        // ラベル
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.strokeStyle = "#2c3e50";
        ctx.lineWidth = 2;

        ctx.strokeText(
          furnitureType?.label || furniture.type,
          x + w / 2,
          y + h / 2 + 4
        );
        ctx.fillText(
          furnitureType?.label || furniture.type,
          x + w / 2,
          y + h / 2 + 4
        );
      });
    }

    // ドアを描画（キャリブレーションポイントから取得）
    if (roomProfile.calibrationPoints) {
      const doorInside = roomProfile.calibrationPoints.find(
        (p) => p.id === "door_inside"
      );
      const doorOutside = roomProfile.calibrationPoints.find(
        (p) => p.id === "door_outside"
      );

      if (doorInside && doorOutside) {
        const doorInsideActual = {
          x: doorInside.position.x * roomWidth,
          y: doorInside.position.y * roomHeight
        };
        const doorOutsideActual = {
          x: doorOutside.position.x * roomWidth,
          y: doorOutside.position.y * roomHeight
        };

        // ドアの中心位置を計算
        const doorCenterX =
          (doorInsideActual.x + doorOutsideActual.x) / 2;
        const doorCenterY =
          (doorInsideActual.y + doorOutsideActual.y) / 2;

        // ドアの向きを計算（内側→外側のベクトル）
        const x = padding + (doorCenterX + offsetX) * scale;
        const y = padding + (doorCenterY + offsetY) * scale;

        // ドアアイコンとラベル
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#8B4513";
        ctx.fillText("🚪", x, y);

        // ラベル「ドア」
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#8B4513";
        ctx.lineWidth = 3;
        ctx.strokeText("ドア", x, y + 20);
        ctx.fillText("ドア", x, y + 20);
      }
    }

    if (
      showRssiOverlay &&
      roomProfile.calibrationPoints &&
      roomProfile.calibrationPoints.length > 0
    ) {
      const previousTextAlign = ctx.textAlign;
      const previousTextBaseline = ctx.textBaseline;
      const previousFont = ctx.font;

      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "9px sans-serif";

      roomProfile.calibrationPoints.forEach((point) => {
        if (!point.measurements || point.measurements.length === 0) {
          return;
        }

        const stats = new Map<
          string,
          {
            sum: number;
            count: number;
          }
        >();

        point.measurements.forEach((measurement) => {
          if (!measurement.rssiValues) {
            return;
          }

          Object.entries(measurement.rssiValues).forEach(([mac, rssi]) => {
            if (typeof rssi !== "number" || Number.isNaN(rssi)) {
              return;
            }

            const normalizedMac = mac.toUpperCase().replace(/:/g, "");
            const current = stats.get(normalizedMac) || { sum: 0, count: 0 };
            current.sum += rssi;
            current.count += 1;
            stats.set(normalizedMac, current);
          });
        });

        if (stats.size === 0) {
          return;
        }

        const entries = Array.from(stats.entries())
          .map(([mac, { sum, count }]) => {
            const average = sum / Math.max(count, 1);
            const beaconInfo = getBeaconInfo(mac);
            // MACアドレスを除外してビーコン名またはbeaconIdのみを使用
            let displayName = "";
            if (beaconInfo?.name) {
              displayName = beaconInfo.name;
            } else if (beaconInfo?.beaconId) {
              displayName = beaconInfo.beaconId;
            } else {
              displayName = "ビーコン";
            }
            return {
              mac,
              name: displayName,
              average: Math.round(average),
              count,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, "ja"));

        const lines = [
          `${point.label}`,
          ...entries.map(
            (entry) =>
              `${entry.name}: ${entry.average}dBm${
                entry.count > 1 ? ` (${entry.count})` : ""
              }`
          ),
        ];

        const lineHeight = 11;
        const textWidths = lines.map((line) => ctx.measureText(line).width);
        const boxWidth = Math.max(...textWidths, 0) + 12;
        const boxHeight = lines.length * lineHeight + 8;

        const normalizedX = point.position.x;
        const normalizedY = point.position.y;

        const pointX =
          padding + (normalizedX * roomWidth + offsetX) * scale;
        const pointY =
          padding + (normalizedY * roomHeight + offsetY) * scale;

        // マーカー
        ctx.beginPath();
        ctx.arc(pointX, pointY, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#1abc9c";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();

        let boxX = pointX + 12;
        if (boxX + boxWidth > canvas.width - padding) {
          boxX = pointX - boxWidth - 12;
        }
        boxX = Math.max(boxX, padding);

        let boxY = pointY - boxHeight / 2;
        if (boxY < padding) {
          boxY = padding;
        }
        if (boxY + boxHeight > canvas.height - padding) {
          boxY = canvas.height - padding - boxHeight;
        }

        ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        ctx.strokeStyle = "#1abc9c";
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

        ctx.fillStyle = "#34495e";
        lines.forEach((line, index) => {
          ctx.fillText(line, boxX + 6, boxY + 4 + lineHeight * index);
        });
      });

      ctx.textAlign = previousTextAlign;
      ctx.textBaseline = previousTextBaseline;
      ctx.font = previousFont;
    }

    const iconPositions = new Map<string, { x: number; y: number; radius: number }>();

    // デバイスの位置を描画（最前面）
    if (devicePositions.size > 0) {
      devicePositions.forEach((position, deviceId) => {
        const device = devices.find((d) => d.devEUI === deviceId);

        // 位置座標を変換：position.x/yは既に実際のメートル位置
        const displayX = position.x;
        const displayY = position.y;

        const x = padding + (displayX + offsetX) * scale;
        const y = padding + (displayY + offsetY) * scale;

        // デバイスの影
        ctx.beginPath();
        ctx.arc(x + 2, y + 2, 14, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
        ctx.fill();

        // デバイスの円（メイン）
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fillStyle = "#4A90E2";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.stroke();

        // 内側の小さな円
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        // 名前（背景付き）
        const deviceName = device?.userName || device?.deviceId || deviceId;
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";

        const textMetrics = ctx.measureText(deviceName);
        const textWidth = textMetrics.width + 8;
        const textHeight = 16;

        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fillRect(
          x - textWidth / 2,
          y - 35 - textHeight / 2,
          textWidth,
          textHeight
        );

        ctx.fillStyle = "#2c3e50";
        ctx.fillText(deviceName, x, y - 30);

        const labelAlign = ctx.textAlign;
        const labelBaseline = ctx.textBaseline;

        const infoRadius = 8;
        const infoOffset = textWidth / 2 + infoRadius + 6;
        const infoX = x + infoOffset;
        const infoY = y - 30;

        ctx.beginPath();
        ctx.arc(infoX, infoY, infoRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#34495e";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.fillText("i", infoX, infoY);

        ctx.textAlign = labelAlign;
        ctx.textBaseline = labelBaseline;

        iconPositions.set(deviceId, { x: infoX, y: infoY, radius: infoRadius + 4 });
      });
    }

    setInfoIconPositions(iconPositions);

  };

  useEffect(() => {
    if (roomProfile) {
      // 少し遅延させて確実に描画
      const timer = setTimeout(() => {
        drawRoom();
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [roomProfile, devicePositions, devices, showRssiOverlay]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      <div>
        {/* 機能見出しは不要のため削除 */}
        {/* ヘッダー上の部屋表示はキャンバス右上へ移動しました */}
      </div>

      {/* その他のアラート表示（shock以外） */}
      {alerts.filter(a => a.type !== 'shock').length > 0 && (
        <div className="alert-stack">
          {alerts.filter(a => a.type !== 'shock').map((alert) => {
            // アラートタイプに応じて背景色とアイコンを変更
            const alertStyle = {
              backgroundColor: "#ff6b35", // 退室: オレンジ
              border: "3px solid #cc5529",
              animation: "none",
            };
            const alertIcon = "🚪 部屋退室";
            
            return (
              <div
                key={alert.id}
                className="alert alert-danger"
                style={alertStyle}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <strong style={{ fontSize: "18px" }}>{alertIcon}</strong>
                    <p style={{ marginTop: "8px", fontSize: "16px" }}>
                      {alert.message}
                    </p>
                  </div>
                  <button
                    onClick={() => dismissAlert(alert.id)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "white",
                      fontSize: "24px",
                      cursor: "pointer",
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ビーコンログパネル */}
      {showLogPanel && (
        <div
          className="card"
          style={{
            marginBottom: "24px",
            maxHeight: "400px",
            overflow: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <h3 style={{ margin: 0 }}>ビーコン受信ログ</h3>
            <button
              onClick={() => setBeaconLogs([])}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #95a5a6",
                backgroundColor: "white",
                color: "#95a5a6",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              ログをクリア
            </button>
          </div>
          {beaconLogs.length === 0 ? (
            <p style={{ color: "#95a5a6", textAlign: "center", padding: "20px" }}>
              ログはありません
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {beaconLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    padding: "12px",
                    border: "1px solid #e1e8ed",
                    borderRadius: "8px",
                    backgroundColor: "#f8f9fa",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "8px",
                    }}
                  >
                    <strong style={{ color: "#2c3e50" }}>
                      {log.deviceName}
                    </strong>
                    <span style={{ fontSize: "12px", color: "#95a5a6" }}>
                      {formatTimestamp(log.timestamp)}
                    </span>
                  </div>
                  {log.missingBeacons.length > 0 && (
                    <div
                      style={{
                        backgroundColor: "#fff3cd",
                        border: "1px solid #ffc107",
                        borderRadius: "6px",
                        padding: "8px",
                        marginBottom: "8px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: "600",
                          color: "#856404",
                          marginBottom: "4px",
                        }}
                      >
                        ⚠️ 受信できなかったビーコン:
                      </div>
                      <div style={{ fontSize: "12px", color: "#856404" }}>
                        {log.missingBeacons
                          .map((b) => `${b.beaconName} (${b.mac})`)
                          .join(", ")}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: "24px",
          flexDirection: window.innerWidth <= 768 ? "column" : "row",
        }}
      >
        {/* 左側: ユーザー名と設定 */}
        <div
          style={{
            width: window.innerWidth <= 768 ? "100%" : "300px",
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          <div className="card">
            <h3 style={{ marginBottom: "12px" }}>ユーザー名</h3>
            {devices.map((device) => {
              const position = devicePositions.get(device.devEUI);
              const timestamp = deviceTimestamps.get(device.devEUI);
              const lastUpdateMs = timestamp ? Date.parse(timestamp) : NaN;
              const isStale =
                Number.isFinite(lastUpdateMs) &&
                Date.now() - lastUpdateMs >= STALE_THRESHOLD_MS;
              const statusColor = isStale
                ? "#f39c12"
                : position
                ? "#50C878"
                : "#95a5a6";
              return (
                <div
                  key={device.devEUI}
                  style={{
                    padding: "12px",
                    borderBottom: "1px solid #e1e8ed",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "baseline",
                      }}
                    >
                      <strong>{device.userName || device.deviceId}</strong>
                      <span style={{ fontSize: "12px", color: "#95a5a6" }}>
                        ({device.deviceId})
                      </span>
                    </div>

                    {timestamp && (
                      <p
                        style={{
                          fontSize: "12px",
                          marginTop: "2px",
                          color: "#95a5a6",
                        }}
                      >
                        更新: {formatTimestamp(timestamp)}
                      </p>
                    )}
                  </div>
                  <div
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      backgroundColor: statusColor,
                      marginTop: "4px",
                    }}
                  />
                </div>
              );
            })}

            {/* ビーコンログ表示ボタン: ユーザーパネルの下部に移動 */}
            <div style={{ padding: '12px', borderTop: '1px solid #e1e8ed', display: 'flex', justifyContent: 'flex-start' }}>
              <button
                onClick={() => setShowLogPanel(!showLogPanel)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '2px solid #4A90E2',
                  backgroundColor: showLogPanel ? '#4A90E2' : 'white',
                  color: showLogPanel ? 'white' : '#4A90E2',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                ビーコンログ
                {beaconLogs.length > 0 && (
                  <span
                    style={{
                      backgroundColor: '#ff6b35',
                      color: 'white',
                      borderRadius: '10px',
                      padding: '2px 6px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      marginLeft: '8px'
                    }}
                  >
                    {beaconLogs.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 右側: 部屋表示パネル */}
        <div className="card" style={{ flex: 1, minWidth: 0 }}>
          <div className="canvas-container" style={{ maxWidth: "100%", position: 'relative' }}>
            <div className="canvas-wrapper">
              <canvas
                ref={canvasRef}
                width={800}
                height={600}
                style={{
                  border: "1px solid #e1e8ed",
                  borderRadius: "8px",
                  boxSizing: "border-box",
                  display: "block",
                }}
              />
            </div>
            {/* キャンバス右上に部屋名を表示 */}
            <div style={{
              position: 'absolute',
              top: 12,
              right: 12,
              zIndex: 20,
              backgroundColor: 'white',
              padding: '8px 12px',
              borderRadius: '10px',
              boxShadow: '0 6px 18px rgba(0,0,0,0.06)',
              fontSize: '16px',
              fontWeight: 700,
              color: '#2c3e50'
            }}>
              部屋: {roomProfile?.name || '未設定'}
            </div>
            {tooltip && (
              <div
                style={{
                  position: "absolute",
                  left: tooltip.left,
                  top: tooltip.top,
                  transform: "translate(-50%, -100%)",
                  backgroundColor: "rgba(44, 62, 80, 0.92)",
                  color: "#ffffff",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  boxShadow: "0 8px 16px rgba(0, 0, 0, 0.15)",
                  pointerEvents: "none",
                  maxWidth: "250px",
                  backdropFilter: "blur(4px)",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: tooltip.signals.length > 0 ? "6px" : "0" }}>
                  {tooltipDevice?.deviceId ||
                    tooltip.deviceId}
                </div>
                {tooltip.signals.length > 0 ? (
                  <ul
                    style={{
                      padding: 0,
                      margin: 0,
                      listStyle: "none",
                      lineHeight: 1.6,
                    }}
                  >
                    {tooltip.signals.map((signal) => (
                      <li
                        key={`${signal.mac}-${signal.beaconId}-${signal.rssi}`}
                      >
                        <span style={{ fontWeight: 500 }}>
                          {signal.beaconId}
                        </span>
                        <span
                          style={{
                            marginLeft: "6px",
                            color: "rgba(255, 255, 255, 0.75)",
                            fontFamily: "monospace",
                          }}
                        >
                          {signal.mac}
                        </span>
                        <span style={{ marginLeft: "8px", color: "#ecf0f1" }}>
                          {signal.rssi} dBm
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span style={{ color: "rgba(255, 255, 255, 0.7)" }}>
                    ビーコンを受信していません
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

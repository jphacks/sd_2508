
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ModeSelector from '../components/unified/ModeSelector';
import ErrorBoundary from '../components/common/ErrorBoundary';
import ShockAlertModal from '../components/ShockAlertModal';
import { Alert, Device, Mode, ModeConfig, RoomLayout, BeaconDevice, GPSPosition, TemperatureThresholdSettings } from '../types';
import { collection, onSnapshot, doc as firestoreDoc, updateDoc, setDoc, getDocs, getDoc, deleteField } from 'firebase/firestore';
import { ref, onValue, update, get } from 'firebase/database';
import { db, rtdb } from '../firebase';
import { calculateGPSDistance } from '../utils/positioning';

// 各モードのダッシュボードコンポーネント
import Mode1Indoor from './Mode1Indoor';
import Mode2Bus from './Mode2Bus';
import Mode3GPS from './Mode3GPS';

// 🎨 ステータス表示用の色定義
const STATUS_COLORS = {
  // 正常時（緑）
  success: {
    color: '#2d7d45',
    bgColor: '#c8e6c9'
  },
  // 警告時（赤）
  alert: {
    color: '#d32f2f',
    bgColor: '#ffcdd2'
  },
  // 不明・タイムアウト（黄）
  warning: {
    color: '#856404',
    bgColor: '#fff3cd'
  },
  // グレー（未受信）
  inactive: {
    color: '#6c757d',
    bgColor: '#e9ecef'
  },
  // エラーテキスト（赤）
  errorText: '#e57373',
  // 高温時の背景
  highTempBg: '#ffebee'
} as const;

type ShockAlertEntry = {
  id: string;
  deviceId: string;
  message: string;
  timestamp: number;
};

const createJstTimestamp = () => {
  const now = new Date();
  const jstOffsetMinutes = 9 * 60;
  const jstTime = new Date(now.getTime() + jstOffsetMinutes * 60 * 1000);
  const year = jstTime.getUTCFullYear();
  const month = String(jstTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jstTime.getUTCDate()).padStart(2, '0');
  const hours = String(jstTime.getUTCHours()).padStart(2, '0');
  const minutes = String(jstTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(jstTime.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+09:00`;
};

export default function Dashboard() {
  // === 基本状態管理 ===
  const [parentTrackers, setParentTrackers] = useState<string[]>([]);
  const [currentMode, setCurrentMode] = useState<Mode>('indoor');
  const [devices, setDevices] = useState<Device[]>([]);
  const [beacons, setBeacons] = useState<BeaconDevice[]>([]);
  const [selectedBeacon, setSelectedBeacon] = useState<string>('');
  const [selectedParentId, setSelectedParentId] = useState<string>('');
  const [maxDistance] = useState<number>(50);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 温度閾値設定
  const [temperatureThreshold, setTemperatureThreshold] = useState<number>(28);

  // バス監視設定を追加（範囲ベース）
  const [busRange, setBusRange] = useState(5); // メートル単位
  const [rssiThreshold, setRssiThreshold] = useState(-75);
  const [alertThreshold, setAlertThreshold] = useState(3);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [connectionTimeout, setConnectionTimeout] = useState(10);
  const [showAllDevices, setShowAllDevices] = useState(false);
  const [busDeviceAlertThreshold, setBusDeviceAlertThreshold] = useState(1); // バス内デバイス数の警告閾値
  const [shockAlerts, setShockAlerts] = useState<ShockAlertEntry[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shockAlertsRef = useRef<ShockAlertEntry[]>([]);

  const [gpsMaxDistance, setGpsMaxDistance] = useState(30);
  const [baseLocation, setBaseLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [baseLocationDistance, setBaseLocationDistance] = useState(50);

  // リアルタイム更新用のstate（1秒ごとに経過時間を更新）
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // 1秒ごとに現在時刻を更新
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    shockAlertsRef.current = shockAlerts;
  }, [shockAlerts]);

  useEffect(() => {
    if (devices.length === 0 && shockAlertsRef.current.length === 0) {
      return;
    }

    const prevAlerts = shockAlertsRef.current;
    const prevMap = new Map(prevAlerts.map(alert => [alert.deviceId, alert]));
    const nextAlerts: ShockAlertEntry[] = [];
    let hasNewAlert = false;

    devices.forEach(device => {
      const normalizedDevEUI = device.devEUI?.toLowerCase();
      const hasShock = device.statusData?.shock === true;
      
      if (!normalizedDevEUI || !hasShock) {
        return;
      }

      const existingAlert = prevMap.get(normalizedDevEUI);
      if (existingAlert) {
        nextAlerts.push(existingAlert);
        return;
      }

      const newAlert: ShockAlertEntry = {
        id: `${normalizedDevEUI}-${Date.now()}`,
        deviceId: normalizedDevEUI,
        message: `${device.userName || device.deviceId || device.name || normalizedDevEUI} が衝撃を検知しました！`,
        timestamp: Date.now()
      };

      nextAlerts.push(newAlert);
      hasNewAlert = true;
    });

    setShockAlerts(nextAlerts);

    if (hasNewAlert && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((error) => {
        console.warn('⚠️ ショックアラート音の再生に失敗:', error);
      });
    }
  }, [devices]);

  const handleShockAlertClose = useCallback(async (deviceId: string) => {
    try {
      await update(ref(rtdb, `devices/${deviceId}/status`), { shock: false });
    } catch (error) {
      console.error(`❌ Shock値の更新に失敗: ${error}`);
    }
  }, []);

  const normalizeTimestampToIso = useCallback((value: unknown): string | null => {
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const millis = value > 1e12 ? value : value * 1000; // 秒かミリ秒かを推定
      const parsed = new Date(millis);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    return null;
  }, []);

  const extractBeaconTimestampIso = useCallback((beacon: any): string | null => {
    if (!beacon) {
      return null;
    }

    const candidates: Array<unknown> = [
      beacon.timestamp,
      beacon.ts,
      beacon.time,
      beacon.timeStamp,
      beacon.scanTime,
      beacon.scan_time,
      beacon.receivedAt,
      beacon.received_at,
      beacon.lastSeen,
      beacon.last_seen,
      beacon.updatedAt,
      beacon.updated_at,
      beacon.createdAt,
      beacon.created_at,
      beacon.utc_iso,
      beacon.utc,
      beacon.iso,
      beacon.isoTime,
      beacon.iso_time
    ];

    for (const candidate of candidates) {
      const iso = normalizeTimestampToIso(candidate);
      if (iso) {
        return iso;
      }
    }

    return null;
  }, [normalizeTimestampToIso]);

  // Firestoreから基準位置を読み込む
  useEffect(() => {
    const loadBaseLocation = async () => {
      try {
        const { getDoc, doc } = await import('firebase/firestore');
        const baseLocationDoc = await getDoc(doc(db, 'settings', 'base_location'));
        if (baseLocationDoc.exists()) {
          const data = baseLocationDoc.data();
          if (data && typeof data.lat === 'number' && typeof data.lon === 'number') {
            setBaseLocation({ lat: data.lat, lon: data.lon });
          }
        }
      } catch (error) {
        console.error('基準位置の読み込みエラー:', error);
      }
    };

    loadBaseLocation();
  }, []);

  // 🔧 RSSI から距離を推定する関数
  const estimateDistance = useCallback((rssi: number, rssiAt1m: number = -59): number => {
    if (rssi === 0) return -1;
    
    // 理想的なログ距離パス損失モデル
    const n = 2.0; // バス内環境での損失指数
    
    if (rssi > rssiAt1m) return 0.5; // 1m未満は0.5mとする
    
    const ratio = rssiAt1m / rssi;
    if (ratio < 1.0) return 0.5;
    
    return Math.pow(ratio, (1 / n));
  }, []);

  

  // 🔧 距離からRSSIを逆算する関数
  const distanceToRssi = useCallback((distance: number, rssiAt1m: number = -59): number => {
    if (distance <= 0) return rssiAt1m;
    
    const n = 2.0; // 環境定数
    const rssi = rssiAt1m - (10 * n * Math.log10(distance));
    
    return Math.round(rssi);
  }, []);

  // 🔧 動的に計算されたRSSI閾値
  const calculatedRssiThreshold = useMemo(() => {
    return rssiThreshold;
  }, [rssiThreshold]);

  // 🔧 Firebase更新用のヘルパー関数を追加
  const updateBusStatusInFirebase = useCallback(async (deviceId: string, devEUI: string, isInBus: boolean) => {
    try {
      const statusRef = ref(rtdb, `devices/${devEUI.toLowerCase()}/status`);

      await update(statusRef, {
        inBus: isInBus,
        busStatusUpdatedAt: createJstTimestamp()
      });

    } catch (error) {
      console.error(`❌ ${deviceId}: バス状態更新エラー:`, error);
    }
  }, []);

  // 🔧 全デバイスのバス状態を更新する関数
  const updateBusStatusForAllDevices = useCallback(async (overrideBusRange?: number, overrideSelectedBeacon?: string) => {
    const effectiveBusRange = overrideBusRange ?? busRange;
    const effectiveSelectedBeacon = overrideSelectedBeacon ?? selectedBeacon;
    const effectiveRssiThreshold = overrideBusRange !== undefined
      ? distanceToRssi(overrideBusRange)
      : rssiThreshold;
    
    if (!effectiveSelectedBeacon || devices.length === 0) {
      console.warn('⚠️ バス状態更新スキップ: ビーコン未選択またはデバイスなし');
      return;
    }

    const currentTime = new Date();
    let busDeviceCount = 0;
    
    const updatePromises = devices.map(async (device) => {
      if (!device.devEUI) {
        console.warn(`⚠️ ${device.name}: devEUIが設定されていません`);
        return;
      }

      let isInBus = false;

      // BLEデータから判定
      if (device.bleData && Array.isArray(device.bleData)) {
        const latestBleData = device.bleData.find(ble => 
          ble && ble.beaconId === effectiveSelectedBeacon && typeof ble.rssi === 'number'
        );

        if (latestBleData) {
          try {
            const bleTimestamp = new Date(latestBleData.timestamp);
            if (!isNaN(bleTimestamp.getTime())) {
              const timeSinceLastBle = currentTime.getTime() - bleTimestamp.getTime();
              const isRecentlyReceived = timeSinceLastBle < 30 * 60 * 1000; // 30分以内
              
              // 🔧 引数で受け取った値を使用してリアルタイム判定
              const isWithinBusRange = latestBleData.rssi >= effectiveRssiThreshold;
              
              isInBus = isRecentlyReceived && isWithinBusRange;
              
              if (isInBus) {
                busDeviceCount++;
              }
            }
          } catch (error) {
            console.error(`❌ ${device.name}: BLEデータ処理エラー:`, error);
          }
        }
      }

      await updateBusStatusInFirebase(device.id, device.devEUI, isInBus);
    });

    try {
      await Promise.all(updatePromises);
    } catch (error) {
      console.error('❌ バス状態一括更新エラー:', error);
    }
  }, [devices, busRange, selectedBeacon, distanceToRssi, estimateDistance, updateBusStatusInFirebase, rssiThreshold]);

  // 🔧 設定変更時に即座にバス状態を更新する関数を追加
  const lastUpdateRef = useRef<number>(0);
  const updateThrottleMs = 500; // 5秒間のスロットル
  const triggerBusStatusUpdate = useCallback(async (overrideBusRange?: number, overrideSelectedBeacon?: string) => {
    const now = Date.now();
    
    if (now - lastUpdateRef.current < updateThrottleMs) {
      return;
    }
    
    lastUpdateRef.current = now;
    await updateBusStatusForAllDevices(overrideBusRange, overrideSelectedBeacon);
  }, [updateBusStatusForAllDevices]);

  const triggerBusStatusUpdateRef = useRef(triggerBusStatusUpdate);
  useEffect(() => {
    triggerBusStatusUpdateRef.current = triggerBusStatusUpdate;
  }, [triggerBusStatusUpdate]);

  // === 設定変更のハンドラー関数 ===
  const handleSelectedBeaconChange = useCallback(async (beaconId: string) => {
    setSelectedBeacon(beaconId);
  }, [setSelectedBeacon]);

  const handleBusRangeChange = useCallback(async (range: number) => {
    setBusRange(range);
    const newThreshold = distanceToRssi(range);
    setRssiThreshold(newThreshold);

    if (triggerBusStatusUpdateRef.current) {
      await triggerBusStatusUpdateRef.current(range);
    }
  }, [distanceToRssi]);


  const handleAlertThresholdChange = useCallback(async (threshold: number) => {
    setAlertThreshold(threshold);
  }, []);


  const handleAlertEnabledChange = useCallback((enabled: boolean) => {
    setAlertEnabled(enabled);
  }, []);

  const handleConnectionTimeoutChange = useCallback((timeout: number) => {
    setConnectionTimeout(timeout);
  }, []);

  const handleShowAllDevicesChange = useCallback((show: boolean) => {
    setShowAllDevices(show);
  }, []);

  // 🔧 RSSI閾値の直接変更ハンドラー
  const handleRssiThresholdChange = useCallback(async (threshold: number) => {
    setRssiThreshold(threshold);
    
    // RSSI値から距離を逆算して範囲を更新
    const estimatedRange = estimateDistance(threshold);
    const newRange = Math.max(1, Math.min(20, estimatedRange));
    
    setBusRange(newRange);

    if (triggerBusStatusUpdateRef.current) {
      await triggerBusStatusUpdateRef.current(newRange);
    }
  }, [estimateDistance]);



  // === モード設定 ===
  const modeConfigs: Record<Mode, ModeConfig> = {
    indoor: {
      title: '部屋退出検知',
      description: 'BLEビーコンを使用した室内位置推定',
      color: '#4A90E2',
      icon: ''
    },
    bus: {
      title: 'バス置き去り検知',
      description: 'バス内での置き去り防止システム',
      color: '#FF9800',
      icon: ''
    },
    gps: {
      title: 'GPS検知',
      description: '屋外での位置追跡',
      color: '#4CAF50',
      icon: ''
    }
  };

  const handleModeChange = useCallback((mode: Mode) => {
    setCurrentMode(mode);
  }, [currentMode]);

  // === Firebase データ取得 ===
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];

    const loadInitialData = async () => {
      try {
        //  温度閾値を読み込み
        const tempThresholdDoc = await getDoc(firestoreDoc(db, 'settings', 'temperature-thresholds'));
        if (tempThresholdDoc.exists()) {
          const tempSettings = tempThresholdDoc.data() as TemperatureThresholdSettings;
          setTemperatureThreshold(tempSettings.highTempThreshold || 28);
        }
        
        // ビーコンデータを読み込み
        const beaconsSnapshot = await getDocs(collection(db, 'beacons'));
        const beaconsData = beaconsSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            beaconId: data.beaconId || doc.id,
            name: data.name || data.beaconId || doc.id,
            mac: data.mac || '',
            uuid: data.uuid,
            major: data.major,
            minor: data.minor,
            type: data.type || 'ibeacon',
            rssiAt1m: (typeof data.rssiAt1m === 'number') ? data.rssiAt1m : -59,
            place: data.place,
            anchor_loc: data.anchor_loc,
            tags: data.tags,
            isActive: data.isActive !== false,
            lastSeen: data.lastSeen || new Date().toISOString()
          };
        });
        
        setBeacons(beaconsData);
        
        if (beaconsData.length > 0 && !selectedBeacon) {
          setSelectedBeacon(beaconsData[0].id);
        }
        
        // デバイスデータを読み込み
        const devicesSnapshot = await getDocs(collection(db, 'devices'));
        const devicesData = devicesSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            devEUI: data.devEUI || doc.id,
            deviceId: data.deviceId || doc.id,
            name: data.userName || data.deviceId || doc.id,
            userName: data.userName,
            model: data.model,
            status: data.status || 'active',
            lastUpdate: data.lastUpdate?.toDate?.() || new Date(),
            bleData: data.bleData || [],
            position: data.position || null,
            statusData: null
          } as Device;
        });
        
        setDevices(devicesData);
        
        // RTDB監視を設定
        devicesData.forEach(device => {
          const normalizedDevEUI = device.devEUI?.toLowerCase();
          if (!normalizedDevEUI) return;

          // Status監視
          const statusRef = ref(rtdb, `devices/${normalizedDevEUI}/status`);
          const unsubStatus = onValue(statusRef, (snapshot) => {
          if (snapshot.exists()) {
            const status = snapshot.val();
            // updatedAtから時刻を取得（形式: 2025-11-08T11:33:09+09:00）
            const lastUpdate = status.updatedAt ? new Date(status.updatedAt) : new Date();
            setDevices(prev => prev.map(d => 
              d.devEUI === device.devEUI ? { ...d, statusData: status, lastUpdate } : d
            ));
            }
          });

          // GNSS監視
          const gnssRef = ref(rtdb, `devices/${normalizedDevEUI}/gnss`);
          const unsubGnss = onValue(gnssRef, (snapshot) => {
            if (snapshot.exists()) {
              const gnss = snapshot.val();
              if (gnss && typeof gnss.lat === 'number' && typeof gnss.lon === 'number') {
                setDevices(prev => prev.map(d => 
                  d.devEUI === device.devEUI ? {
                    ...d,
                    position: { lat: gnss.lat, lon: gnss.lon, timestamp: gnss.utc_iso }
                    // lastUpdateは更新しない（statusのupdatedAtのみを使用）
                  } : d
                ));
              }
            }
          });

          // Beacons監視
          const beaconsRef = ref(rtdb, `devices/${normalizedDevEUI}/beacons`);
          const unsubBeacons = onValue(beaconsRef, (snapshot) => {
            if (snapshot.exists()) {
              const beacons = snapshot.val();
              if (beacons && Array.isArray(beacons)) {
                const bleData = beacons
                  .filter((beacon: any) => beacon.mac && beacon.rssi && beacon.rssi !== -1)
                  .slice(-5)
                  .map((beacon: any) => {
                    const normalizedMac = beacon.mac.toUpperCase().replace(/:/g, "");
                    const selectedBeaconData = beaconsData.find(b => 
                      b.mac && b.mac.toUpperCase().replace(/:/g, "") === normalizedMac
                    );

                    const timestampIso = extractBeaconTimestampIso(beacon) || new Date().toISOString();
                    
                    return {
                      beaconId: selectedBeaconData?.id || selectedBeacon,
                      rssi: beacon.rssi,
                      timestamp: timestampIso,
                      mac: normalizedMac
                    };
                  });

                const latestBleTimestampIso = bleData.reduce<string | null>((latest, ble) => {
                  if (!ble.timestamp) {
                    return latest;
                  }
                  if (!latest) {
                    return ble.timestamp;
                  }
                  return new Date(ble.timestamp).getTime() > new Date(latest).getTime()
                    ? ble.timestamp
                    : latest;
                }, null);

                let shouldTriggerUpdate = false;

                // 🔧 前回のBLEデータと比較して、実際に変化があった場合のみ更新
                setDevices(prev => {
                  let hasDeviceChanged = false;
                  const updatedDevices = prev.map(d => {
                    if (d.devEUI === device.devEUI) {
                      const prevBleData = d.bleData || [];
                      const hasRealChange = bleData.some(newBle => {
                        const prevBle = prevBleData.find(pb => pb.beaconId === newBle.beaconId);
                        return !prevBle || prevBle.rssi !== newBle.rssi;
                      });
                      
                      if (hasRealChange) {
                        hasDeviceChanged = true;
                        // lastUpdateは更新しない（statusのupdatedAtのみを使用）
                        return { ...d, bleData };
                      }
                      return d;
                    }
                    return d;
                  });

                  if (hasDeviceChanged) {
                    shouldTriggerUpdate = true;
                    return updatedDevices;
                  }

                  return prev;
                });

                if (shouldTriggerUpdate && triggerBusStatusUpdateRef.current) {
                  triggerBusStatusUpdateRef.current();
                }
              }
            }
          });

          unsubscribes.push(unsubStatus, unsubGnss, unsubBeacons);
        });
        
        setLoading(false);
        
      } catch (error) {
        console.error('💥 初期化エラー:', error);
        setError('データの読み込みに失敗しました');
        setLoading(false);
      }
    };

    loadInitialData();

    return () => {
      unsubscribes.forEach(unsubscribe => unsubscribe());
    };
  }, []);

  // 定期的なバス状態更新は廃止し、BLE計測の変化のみで更新する

  // 状態計算関数
  const getIndoorStatus = (device: Device) => {
    if (!device.statusData) {
      return { status: '不明', ...STATUS_COLORS.warning };
    }
    
    const isInside = device.statusData.inside === true;
    if (isInside) {
      return { status: '室内', ...STATUS_COLORS.success };
    } else {
      return { status: '室外', ...STATUS_COLORS.alert };
    }
  };

  const getTemperatureDisplay = (device: Device) => {
    if (!device.statusData || typeof device.statusData.temperature_c !== 'number') {
      return { display: '不明', temperature: null, isHighTemp: false };
    }
    const temp = device.statusData.temperature_c;
    const isHighTemp = temp > temperatureThreshold;
    return { 
      display: `${temp.toFixed(1)}°C`, 
      temperature: temp,
      isHighTemp: isHighTemp
    };
  };

  const getMotionStatus = (device: Device) => {
    if (!device.statusData) {
      return { status: '不明', ...STATUS_COLORS.warning };
    }
    
    const hasShock = device.statusData.shock === true;
    if (hasShock) {
      return { status: '転倒', ...STATUS_COLORS.alert };
    } else {
      return { status: '正常', ...STATUS_COLORS.success };
    }
  };

  const getBusStatus = (device: Device, busDeviceCount: number) => {

    // 警告条件: バス内デバイス数が閾値以下の場合
    const shouldAlert = busDeviceCount <= busDeviceAlertThreshold;

    // 1. Mode2Busと同じローカルBLE判定を最優先で実行
    if (!selectedBeacon) {
      return { status: 'ビーコン未選択', ...STATUS_COLORS.warning };
    }

    const latestBleData = device.bleData?.find(ble =>
      ble && ble.beaconId === selectedBeacon && typeof ble.rssi === 'number'
    );

    if (latestBleData) {
      try {
        const bleTimestamp = new Date(latestBleData.timestamp);
        if (!isNaN(bleTimestamp.getTime())) {
          const timeSinceLastBle = Date.now() - bleTimestamp.getTime();
          const isRecentlyReceived = timeSinceLastBle < 30 * 60 * 1000; // 30分以内
          const isWithinBusRange = latestBleData.rssi >= calculatedRssiThreshold;
          const estimatedDistance = estimateDistance(latestBleData.rssi);

          if (isRecentlyReceived) {
            if (isWithinBusRange) {
              return {
                status: 'バス内',
                color: shouldAlert ? STATUS_COLORS.alert.color : STATUS_COLORS.success.color,
                bgColor: shouldAlert ? STATUS_COLORS.alert.bgColor : STATUS_COLORS.success.bgColor
              };
            }

            return {
              status: 'バス外',
              ...STATUS_COLORS.success
            };
          }

          return { status: 'なし', ...STATUS_COLORS.inactive };
        }
      } catch (error) {
        console.error('バス状態のBLE判定エラー:', error);
        return { status: 'エラー', color: STATUS_COLORS.errorText, bgColor: STATUS_COLORS.alert.bgColor };
      }
    }

    // 2. BLEデータが無い場合は、RTDBのステータスをフォールバックとして利用
    if (device.statusData && typeof device.statusData.inBus === 'boolean') {
      const isInBus = device.statusData.inBus;
      const lastUpdated = device.statusData.busStatusUpdatedAt;

      if (lastUpdated) {
        try {
          const updateTime = new Date(lastUpdated);
          const timeSinceUpdate = Date.now() - updateTime.getTime();

          if (timeSinceUpdate < 5 * 60 * 1000) {
            if (isInBus) {
              return { 
                status: 'バス内', 
                color: shouldAlert ? STATUS_COLORS.alert.color : STATUS_COLORS.success.color, 
                bgColor: shouldAlert ? STATUS_COLORS.alert.bgColor : STATUS_COLORS.success.bgColor
              };
            }
            return { status: 'バス外', ...STATUS_COLORS.success };
          }
        } catch (error) {
          console.error('バス状態の時刻確認エラー:', error);
        }
      }
    }

    // 3. それでも判定できない場合は未受信扱い
    return { status: 'BLE未受信', ...STATUS_COLORS.inactive };
  };

    // GPS状態判定関数を追加
  const getGPSStatus = (device: Device) => {
    if (!device.position) {
      return { 
        status: 'GPS未取得', 
        ...STATUS_COLORS.inactive
      };
    }

    try {
      const { lat, lon, timestamp } = device.position;
      
      // GPS座標の有効性チェック
      if (typeof lat !== 'number' || typeof lon !== 'number' || 
          lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return { 
          status: 'GPS未取得', 
          ...STATUS_COLORS.inactive
        };
      }

      // タイムスタンプの確認
      let updateTime: Date | null = null;
      if (timestamp) {
        updateTime = new Date(timestamp);
        if (isNaN(updateTime.getTime())) {
          updateTime = null;
        }
      }

      // 基準位置が設定されている場合、距離を計算
      let distanceFromBase: number | null = null;
      let isOutOfRange = false;
      
      if (baseLocation) {
        distanceFromBase = calculateGPSDistance(
          baseLocation.lat,
          baseLocation.lon,
          lat,
          lon
        );
        isOutOfRange = distanceFromBase > baseLocationDistance;
      }


      if (updateTime) {
        return {
          status: isOutOfRange ? '範囲外' : '範囲内',
          color: isOutOfRange ? STATUS_COLORS.alert.color : STATUS_COLORS.success.color,
          bgColor: isOutOfRange ? STATUS_COLORS.alert.bgColor : STATUS_COLORS.success.bgColor,
          coordinates: { lat, lon },
          lastUpdate: updateTime,
          distance: distanceFromBase
        };
      } else {
        return {
          status: isOutOfRange ? '範囲外' : '範囲内(更新時刻不明)',
          color: isOutOfRange ? STATUS_COLORS.alert.color : STATUS_COLORS.success.color,
          bgColor: isOutOfRange ? STATUS_COLORS.alert.bgColor : STATUS_COLORS.success.bgColor,
          coordinates: { lat, lon },
          lastUpdate: null,
          distance: distanceFromBase
        };
      }
    } catch (error) {
      console.error('GPS状態判定エラー:', error);
      return { 
        status: 'GPS未取得', 
        ...STATUS_COLORS.inactive,
        distance: null
      };
    }
  };

  // 子トラッカーが離れすぎているか（親リストは上の state を参照）
  const isChildTooFar = useCallback((trackerId: string, useDevices: Device[] = devices): boolean => {
    const child = useDevices.find(d => d.id === trackerId);
    
    if (!child?.position || parentTrackers.includes(trackerId)) {
      return false;
    }

    const parentsWithGPS = useDevices.filter(d => 
      parentTrackers.includes(d.id) && d.position
    );
    
    if (parentsWithGPS.length === 0) {
      return false;
    }

    let minDistance = Infinity;
    
    parentsWithGPS.forEach(parent => {
      if (!parent.position) return;
      
      const R = 6371e3;
      const φ1 = (child.position!.lat * Math.PI) / 180;
      const φ2 = (parent.position!.lat * Math.PI) / 180;
      const Δφ = ((parent.position!.lat - child.position!.lat) * Math.PI) / 180;
      const Δλ = ((parent.position!.lon - child.position!.lon) * Math.PI) / 180;

      const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      
      if (distance < minDistance) {
        minDistance = distance;
      }
    });

    // const maxDistanceForAlert = 30; // Mode3 の maxDistance に合わせたい場合は state 化して共有してください
    return minDistance > gpsMaxDistance && minDistance !== Infinity;
  }, [devices, parentTrackers, gpsMaxDistance]);

  const getGPSDistanceStatus = (device: Device) => {
    if (!device.position) {
      return {
        status: '-',
        color: '#6c757d',
        bgColor: '#e9ecef',
        distance: null
      };
    }

    if (parentTrackers.length > 0) {
      // 親トラッカーの場合
      if (parentTrackers.includes(device.id)) {
        return {
          status: '保護者',
          color: '#2d7d45',
          bgColor: '#c8e6c9',
          distance: null
        };
      }

      // 親トラッカーがいる場合は親からの距離を計算
      const parentsWithGPS = devices.filter(d => 
        parentTrackers.includes(d.id) && d.position
      );
      
      if (parentsWithGPS.length === 0) {
        return {
          status: '親GPS未取得',
          color: '#6c757d',
          bgColor: '#e9ecef',
          distance: null
        };
      }

      // 最も近い親までの距離を計算
      let minDistance = Infinity;
      
      parentsWithGPS.forEach(parent => {
        if (!parent.position) return;
        
        const distance = calculateGPSDistance(
          parent.position.lat,
          parent.position.lon,
          device.position!.lat,
          device.position!.lon
        );
        
        if (distance < minDistance) {
          minDistance = distance;
        }
      });

      const isTooFar = minDistance > gpsMaxDistance;
      
      return {
        status: isTooFar ? 'はぐれ' : '正常',
        color: isTooFar ? '#d32f2f' : '#2d7d45',
        bgColor: isTooFar ? '#ffcdd2' : '#c8e6c9',
        distance: minDistance !== Infinity ? minDistance : null
      };
    }

    // 親トラッカー未設定の場合は基準位置からの距離を計算
    if (baseLocation) {
      const distance = calculateGPSDistance(
        baseLocation.lat,
        baseLocation.lon,
        device.position.lat,
        device.position.lon
      );

      const isTooFar = distance > baseLocationDistance;

      return {
        status: isTooFar ? '範囲外' : '範囲内',
        color: isTooFar ? '#d32f2f' : '#2d7d45',
        bgColor: isTooFar ? '#ffcdd2' : '#c8e6c9',
        distance: distance
      };
    }

    // 親トラッカーも基準位置も未設定の場合
    return {
      status: '基準未設定',
      color: '#6c757d',
      bgColor: '#e9ecef',
      distance: null
    };
  };

  // 親トラッカー変更ハンドラー
  const handleParentTrackersChange = useCallback((ids: string[]) => {
    setParentTrackers(ids);
  }, []);

  // 基準位置変更ハンドラー
  const handleBaseLocationChange = useCallback((location: { lat: number; lon: number } | null) => {
    setBaseLocation(location);
  }, []);

  // 基準位置距離変更ハンドラー
  const handleBaseLocationDistanceChange = useCallback((distance: number) => {
    setBaseLocationDistance(distance);
  }, []);


  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔄</div>
        <h2>読み込み中...</h2>
        <p>データを取得しています。しばらくお待ちください。</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
        <h2>エラーが発生しました</h2>
        <p style={{ color: STATUS_COLORS.errorText }}>{error}</p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '12px 24px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '16px',
            marginTop: '16px'
          }}
        >
          再読み込み
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <ShockAlertModal
        alerts={shockAlerts}
        onClose={handleShockAlertClose}
      />
      <div style={{ 
        padding: '24px', 
        backgroundColor: '#f8f9fa',
        minHeight: '100vh'
      }}>
        <div style={{ 
          maxWidth: '1400px', 
          margin: '0 auto'
        }}>
          {/* デバイス状態表示テーブルを復元 */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
          }}>
            <h2 style={{
              fontSize: '20px',
              fontWeight: 'bold',
              marginBottom: '20px',
              color: '#333'
            }}>
              登録ユーザーの状態一覧
            </h2>

            {devices.length > 0 ? (
              <div style={{
                overflowX: 'auto',
                borderRadius: '8px',
                border: '1px solid #e9ecef'
              }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '17px',
                  minWidth: '1000px'
                }}>
                  <thead>
                    <tr style={{
                      backgroundColor: '#f8f9fa',
                      borderBottom: '2px solid #dee2e6'
                    }}>
                      <th style={{
                        padding: '12px 16px',
                        textAlign: 'left',
                        fontWeight: 'bold',
                        color: '#495057',
                        borderRight: '1px solid #dee2e6'
                      }}>
                        デバイス名
                      </th>
                      <th style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: '#495057',
                        borderRight: '1px solid #dee2e6',
                        minWidth: '100px'
                      }}>
                        室内検知
                      </th>
                      <th style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: '#495057',
                        borderRight: '1px solid #dee2e6',
                        minWidth: '100px'
                      }}>
                        転倒検知
                      </th>
                      <th style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: '#495057',
                        borderRight: '1px solid #dee2e6',
                        minWidth: '120px'
                      }}>
                        バス内検知
                      </th>
                      <th style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: '#495057',
                        borderRight: '1px solid #dee2e6',
                        minWidth: '100px'
                      }}>
                        気温
                      </th>
                      {parentTrackers.length <= 0 && (
                      <th style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: '#495057',
                        minWidth: '150px'
                      }}>
                        GPS情報
                      </th>
                      )}
                      {parentTrackers.length > 0 && (
                        <th style={{
                          padding: '12px 16px',
                          textAlign: 'center',
                          fontWeight: 'bold',
                          color: '#495057',
                          minWidth: '120px'
                        }}>
                          はぐれ検知
                        </th>
                        )}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // バス内デバイス数を一度だけ計算
                      const busDeviceCount = devices.filter(d => {
                        if (!selectedBeacon) return false;
                        
                        const latestBle = d.bleData?.find(ble =>
                          ble && ble.beaconId === selectedBeacon && typeof ble.rssi === 'number'
                        );

                        if (latestBle) {
                          try {
                            const bleTimestamp = new Date(latestBle.timestamp);
                            if (!isNaN(bleTimestamp.getTime())) {
                              const timeSinceLastBle = Date.now() - bleTimestamp.getTime();
                              const isRecentlyReceived = timeSinceLastBle < 30 * 60 * 1000;
                              const isWithinBusRange = latestBle.rssi >= calculatedRssiThreshold;
                              return isRecentlyReceived && isWithinBusRange;
                            }
                          } catch (error) {
                            return false;
                          }
                        }
                        return false;
                      }).length;

                      return devices.map((device, index) => {
                        const indoorStatus = getIndoorStatus(device);
                        const temperatureDisplay = getTemperatureDisplay(device);
                        const motionStatus = getMotionStatus(device);
                        const busStatus = getBusStatus(device, busDeviceCount);
                        const gpsStatus = getGPSStatus(device);
                        const latestBleData = device.bleData?.find(ble => ble && ble.beaconId === selectedBeacon);
                      
                      // 経過時間を計算
                      const getTimeAgo = (date: Date | null) => {
                        if (!date) return '';
                        const diffMs = currentTime.getTime() - new Date(date).getTime();
                        const diffSeconds = Math.floor(diffMs / 1000);
                        const diffMinutes = Math.floor(diffMs / (1000 * 60));
                        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                        
                        if (diffDays > 0) return `${diffDays}日前`;
                        if (diffHours > 0) return `${diffHours}時間前`;
                        if (diffMinutes > 0) return `${diffMinutes}分前`;
                        return `${diffSeconds}秒前`;
                      };

                      return (
                        <tr 
                          key={device.id}
                          style={{
                            backgroundColor: index % 2 === 0 ? '#ffffff' : '#f8f9fa',
                            borderBottom: '1px solid #dee2e6'
                          }}
                        >
                          {/* デバイス名 */}
                          <td style={{
                            padding: '12px 16px',
                            borderRight: '1px solid #dee2e6'
                          }}>
                            <div style={{ marginBottom: '4px' }}>
                              <span style={{ fontWeight: 'bold' }}>{device.name}</span>
                              <span style={{
                                fontSize: '15px',
                                color: '#999',
                                fontFamily: 'monospace',
                                marginLeft: '8px'
                              }}>
                                {device.deviceId}
                              </span>
                            </div>
                            <div style={{
                              fontSize: '14px',
                              color: '#999'
                            }}>
                              {device.lastUpdate ? (
                                <>
                                  {new Date(device.lastUpdate).toLocaleString('ja-JP')}
                                  <span style={{ marginLeft: '4px' }}>
                                    ({getTimeAgo(device.lastUpdate)})
                                  </span>
                                </>
                              ) : '更新情報なし'}
                            </div>
                            
                          </td>

                          {/* 室内検知 */}
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            borderRight: '1px solid #dee2e6'
                          }}>
                            <span style={{
                              padding: '4px 12px',
                              borderRadius: '20px',
                              fontSize: '20px',
                              fontWeight: 'bold',
                              backgroundColor: indoorStatus.bgColor,
                              color: indoorStatus.color,
                              border: `1px solid ${indoorStatus.color}40`
                            }}>
                              {indoorStatus.status}
                            </span>
                          </td>

                          {/* 転倒検知 */}
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            borderRight: '1px solid #dee2e6'
                          }}>
                            <span style={{
                              padding: '4px 12px',
                              borderRadius: '20px',
                              fontSize: '20px',
                              fontWeight: 'bold',
                              backgroundColor: motionStatus.bgColor,
                              color: motionStatus.color,
                              border: `1px solid ${motionStatus.color}40`
                            }}>
                              {motionStatus.status}
                            </span>
                          </td>

                          {/* バス内検知 */}
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            borderRight: '1px solid #dee2e6'
                          }}>
                            <span style={{
                              padding: '4px 12px',
                              borderRadius: '20px',
                              fontSize: '20px',
                              fontWeight: 'bold',
                              backgroundColor: busStatus.bgColor,
                              color: busStatus.color,
                              border: `1px solid ${busStatus.color}40`
                            }}>
                              {busStatus.status}
                            </span>
                          </td>

                          {/* 温度 */}
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            borderRight: '1px solid #dee2e6',
                            backgroundColor: temperatureDisplay.isHighTemp ? STATUS_COLORS.highTempBg : 'transparent'
                          }}>
                            <div style={{
                              fontSize: '22px',
                              fontWeight: 'bold',
                              color: temperatureDisplay.isHighTemp ? '#c62828' : '#333'
                            }}>
                              {temperatureDisplay.display}
                            </div>
                          </td>

                          {/* GPS */}
                          {parentTrackers.length <= 0 && (
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            borderRight: '1px solid #dee2e6'
                          }}>
                            <div>
                              <span style={{
                              padding: '6px 16px',
                              borderRadius: '20px',
                              fontSize: '20px',
                              fontWeight: 'bold',
                              backgroundColor: gpsStatus.bgColor,
                              color: gpsStatus.color,
                              border: `1px solid ${gpsStatus.color}40`,
                              display: 'inline-block'
                              }}>
                                {gpsStatus.status}
                                {/* 距離情報を表示 */}
                                {'distance' in gpsStatus && gpsStatus.distance !== null && baseLocation && (
                                  <div style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
                                    {/* 基準位置から: {gpsStatus.distance.toFixed(1)}m */}
                                  </div>
                                )}
                                {/* 最終更新時刻を表示 */}
                                {'lastUpdate' in gpsStatus && gpsStatus.lastUpdate && (
                                  <div style={{ fontSize: '10px', color: '#666', marginTop: '1px' }}>
                                    最終更新：{getTimeAgo(gpsStatus.lastUpdate)}
                                  </div>
                                )}
                              </span>
                             
                            </div>
                          </td>
                          )}

                          {parentTrackers.length > 0 && (
                            <td style={{
                              padding: '12px 16px',
                              textAlign: 'center'
                            }}>
                              {(() => {
                                const distanceStatus = getGPSDistanceStatus(device);
                                return (
                                  <div>
                                    <span style={{
                                      padding: '6px 16px',
                                      borderRadius: '20px',
                                      fontSize: '20px',
                                      fontWeight: 'bold',
                                      backgroundColor: distanceStatus.bgColor,
                                      color: distanceStatus.color,
                                      border: `1px solid ${distanceStatus.color}40`,
                                      display: 'inline-block'
                                    }}>
                                      {distanceStatus.status}
                                    {distanceStatus.distance !== null && (
                                      <div style={{ fontSize: '10px', color: '#666', marginTop: '1px' }}>
                                        {distanceStatus.distance.toFixed(1)}m
                                      </div>
                                    )}
                                    </span>
                                  </div>
                                );
                              })()}
                              </td>
                              )}
                       </tr>
                      );
                    })})()}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{
                textAlign: 'center',
                padding: '40px',
                color: '#666'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📱</div>
                <h3>登録されているデバイスがありません</h3>
                <p>Firestoreにデバイスを登録してください。</p>
              </div>
            )}
          </div>

          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '32px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
            border: '1px solid #e1e8ed'
          }}>
            <ModeSelector
              currentMode={currentMode}
              onModeChange={handleModeChange}
              modeConfigs={modeConfigs}
            />

            <div style={{
              marginTop: '32px'
            }}>
              {currentMode === 'indoor' && (
                <div>
                  <Mode1Indoor devices={devices} />
                </div>
              )}

              {currentMode === 'bus' && (
                <div>
                  <Mode2Bus 
                    devices={devices} 
                    beacons={beacons}
                    selectedBeacon={selectedBeacon}
                    onSelectedBeaconChange={handleSelectedBeaconChange}
                    rssiThreshold={rssiThreshold}
                    onRssiThresholdChange={handleRssiThresholdChange}
                    alertEnabled={alertEnabled}
                    onAlertEnabledChange={handleAlertEnabledChange}
                    connectionTimeout={connectionTimeout}
                    onConnectionTimeoutChange={handleConnectionTimeoutChange}
                    showAllDevices={showAllDevices}
                    onShowAllDevicesChange={handleShowAllDevicesChange}
                    busRange={busRange}
                    onBusRangeChange={handleBusRangeChange}
                    busDeviceAlertThreshold={busDeviceAlertThreshold}
                    onBusDeviceAlertThresholdChange={setBusDeviceAlertThreshold}
                  />
                </div>
              )}

              {currentMode === 'gps' && (
                <Mode3GPS 
                  devices={devices}
                  parentTrackers={parentTrackers}
                  onParentTrackersChange={handleParentTrackersChange}
                  baseLocation={baseLocation}
                  onBaseLocationChange={handleBaseLocationChange}
                  baseLocationDistance={baseLocationDistance}
                  onBaseLocationDistanceChange={handleBaseLocationDistanceChange}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      <audio
        ref={audioRef}
        src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGmi78OScTgwOUKXh8bllHAU2jdXxxn0pBSl+zPLaizsKFFux6OyrWBgLTKXh8bxpIgU1gtDy04k3CBtmue7mnlENDlCn4fG2Yx0FNo3V8cV9KwUqfsvy2os6CxJbrefrqVYZCkyk4PG8aScGOILN8tiIOAgZZ7jt5Z9PDw5Rrerlsl0dBTiO1/HGfSwHKn3L8tuKOwsTWbHn66hWGQpNpOHxvGknBjiCzfLYiDgIGWe47eWfTw8OUq3q5bJdHQU4jtfxxn0sByp9y/LbizsLE1mw5+uoVhkKTKTh8bxpJwY4gs3y2Ig4CBlnuO3ln08PDlKs6eWyXRwGOI7X8cZ9LAcqfcvy24s7CxNZsOfrqFYZCkyk4fG8aScGOILN8tiIOAgZZ7jt5Z9PDw5Sq+rlsl0cBjiO1/HGfSwHKn3L8tuKOwsTWbDn66hWGQpMo+HxvGknBjiCzfLYiDgIGWe47eWfTw8OUqvq5bJdHQU4jtfxxn0sByp9y/LbijsLE1mw5+uoVRkKTKPh8bxpJwY4gs3y2Ig4CBlnuO3ln08PDlKr6uWyXRwGOI7X8cZ9KwcqfMvy24o6CxNZr+frqFYZCkyi4PG8aScGOILN8tiIOQgZZ7jt5Z9PDw5Sq+rlsl0cBjiO1/HGfCsHKnzL8tuKOgsTWa/n66hWGQpMouDxvGknBjiCzfLYiDkIGWe47eWfTw8OUqvq5bJdHAY4jtfxxnwrByp8y/LbijsLE1mw5+uoVhkKTKLg8bxpJwY4gs3y2Ig5CBlnuO3ln08PDlKr6uWyXRwGOI7X8cZ8KwcqfMvy24o6CxNZsOfrqFYZCkyi4PG8aScGOILN8tiIOQgZZ7jt5Z9PDw5Sq+rlsl0cBjiO1/HGfCsHKnzL8tuKOgsTWbDn66hWGQpMouDxvGknBjiCzfLYiDgIGWe47eWfTw8OU="
      />
    </ErrorBoundary>
  );
}

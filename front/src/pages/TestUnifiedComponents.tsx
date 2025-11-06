
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ModeSelector from '../components/unified/ModeSelector';
import ErrorBoundary from '../components/common/ErrorBoundary';
import { Alert, Device, Mode, ModeConfig, RoomLayout, BeaconDevice, GPSPosition } from '../types';
import { 
  collection, 
  getDocs,
  getDoc,
  where 
} from 'firebase/firestore';
import { ref, onValue, update, get } from 'firebase/database';
import { db, rtdb } from '../firebase';

// 各モードのダッシュボードコンポーネント
import Mode1Indoor from './Mode1Indoor';
import Mode2Bus from './Mode2Bus';
import Mode3GPS from './Mode3GPS';

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
  const [currentMode, setCurrentMode] = useState<Mode>('indoor');
  const [devices, setDevices] = useState<Device[]>([]);
  const [beacons, setBeacons] = useState<BeaconDevice[]>([]);
  const [selectedBeacon, setSelectedBeacon] = useState<string>('');
  const [selectedParentId, setSelectedParentId] = useState<string>('');
  const [maxDistance] = useState<number>(50);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 🔧 バス監視設定を追加（範囲ベース）
  const [busRange, setBusRange] = useState(5); // メートル単位
  const [rssiThreshold, setRssiThreshold] = useState(-75);
  const [alertThreshold, setAlertThreshold] = useState(3);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [connectionTimeout, setConnectionTimeout] = useState(10);
  const [showAllDevices, setShowAllDevices] = useState(false);

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

      console.log(`✅ ${deviceId}: バス状態更新完了 (${isInBus ? 'バス内' : 'バス外'})`);
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
      console.log('⚠️ バス状態更新スキップ: ビーコン未選択またはデバイスなし');
      return;
    }

    console.log('🔄 全デバイスのバス状態更新開始...');
    console.log(`🎯 判定基準: RSSI ${effectiveRssiThreshold}dBm以上をバス内と判定 (${effectiveBusRange}m相当)`);
    
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
              const isRecentlyReceived = timeSinceLastBle < 5 * 60 * 1000; // 5分以内
              
              // 🔧 引数で受け取った値を使用してリアルタイム判定
              const isWithinBusRange = latestBleData.rssi >= effectiveRssiThreshold;
              
              isInBus = isRecentlyReceived && isWithinBusRange;
              
              // 🔧 詳細ログを追加
              const estimatedDistance = estimateDistance(latestBleData.rssi);
              console.log(`📊 ${device.name}: RSSI=${latestBleData.rssi}dBm, 距離=${estimatedDistance.toFixed(1)}m, 閾値=${effectiveRssiThreshold}dBm, 判定=${isInBus ? 'バス内' : 'バス外'}`);
              
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
      console.log(`🚌 バス状態更新完了: ${devices.length}台処理, バス内: ${busDeviceCount}台`);
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
      console.log('⏱️ バス状態更新スロットル中 - スキップ');
      return;
    }
    
    lastUpdateRef.current = now;
    console.log('🔄 設定変更によるバス状態更新トリガー', { overrideBusRange, overrideSelectedBeacon });
    await updateBusStatusForAllDevices(overrideBusRange, overrideSelectedBeacon);
  }, [updateBusStatusForAllDevices]);

  const triggerBusStatusUpdateRef = useRef(triggerBusStatusUpdate);
  useEffect(() => {
    triggerBusStatusUpdateRef.current = triggerBusStatusUpdate;
  }, [triggerBusStatusUpdate]);

  // === 設定変更のハンドラー関数 ===
  const handleSelectedBeaconChange = useCallback(async (beaconId: string) => {
    console.log('🎯 ビーコン変更:', beaconId);
    setSelectedBeacon(beaconId);
  }, [setSelectedBeacon]);

  const handleBusRangeChange = useCallback(async (range: number) => {
    setBusRange(range);
    const newThreshold = distanceToRssi(range);
    setRssiThreshold(newThreshold);
    console.log('📐 バス有効範囲変更:', range, 'm', '→ RSSI:', newThreshold, 'dBm');

    if (triggerBusStatusUpdateRef.current) {
      await triggerBusStatusUpdateRef.current(range);
    }
  }, [distanceToRssi]);


  const handleAlertThresholdChange = useCallback(async (threshold: number) => {
    setAlertThreshold(threshold);
    console.log('⏰ 警告時間変更:', threshold);
  }, []);


  const handleAlertEnabledChange = useCallback((enabled: boolean) => {
    setAlertEnabled(enabled);
    console.log('🚨 警告有効/無効:', enabled);
  }, []);

  const handleConnectionTimeoutChange = useCallback((timeout: number) => {
    setConnectionTimeout(timeout);
    console.log('⏱️ 接続タイムアウト変更:', timeout);
  }, []);

  const handleShowAllDevicesChange = useCallback((show: boolean) => {
    setShowAllDevices(show);
    console.log('👁️ 全デバイス表示:', show);
  }, []);

  // 🔧 RSSI閾値の直接変更ハンドラー
  const handleRssiThresholdChange = useCallback(async (threshold: number) => {
    console.log('📶 RSSI閾値変更開始:', threshold, 'dBm');
    setRssiThreshold(threshold);
    
    // RSSI値から距離を逆算して範囲を更新
    const estimatedRange = estimateDistance(threshold);
    const newRange = Math.max(1, Math.min(20, estimatedRange));
    console.log('📶 RSSI閾値変更:', threshold, 'dBm', '→ 推定範囲:', estimatedRange.toFixed(1), 'm', '→ 実際設定:', newRange, 'm');
    
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
      description: '屋外での高精度位置追跡',
      color: '#4CAF50',
      icon: ''
    }
  };

  const handleModeChange = useCallback((mode: Mode) => {
    console.log('モード変更:', currentMode, '→', mode);
    setCurrentMode(mode);
  }, [currentMode]);

  // === Firebase データ取得 ===
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];

    const loadInitialData = async () => {
      try {
        console.log('📱 データ読み込み開始...');
        
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
            setDevices(prev => prev.map(d => 
              d.devEUI === device.devEUI ? { ...d, statusData: status, lastUpdate: new Date() } : d
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
                    position: { lat: gnss.lat, lon: gnss.lon, timestamp: gnss.utc_iso },
                    lastUpdate: new Date()
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
                    
                    return {
                      beaconId: selectedBeaconData?.id || selectedBeacon,
                      rssi: beacon.rssi,
                      timestamp: new Date().toISOString(),
                      mac: normalizedMac
                    };
                  });

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
                        console.log(`📶 ${device.name}: BLE実データ変更検出`);
                        hasDeviceChanged = true;
                        return { ...d, bleData, lastUpdate: new Date() };
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
      return { status: '不明', color: '#856404', bgColor: '#fff3cd' };
    }
    
    const isInside = device.statusData.inside === true;
    if (isInside) {
      return { status: '室内', color: '#155724', bgColor: '#d4edda' };
    } else {
      return { status: '室外', color: '#721c24', bgColor: '#f8d7da' };
    }
  };

  const getTemperatureDisplay = (device: Device) => {
    if (!device.statusData || typeof device.statusData.temperature_c !== 'number') {
      return '不明';
    }
    return `${device.statusData.temperature_c.toFixed(1)}°C`;
  };

  const getMotionStatus = (device: Device) => {
    if (!device.statusData) {
      return { status: '不明', color: '#856404', bgColor: '#fff3cd' };
    }
    
    const hasShock = device.statusData.shock === true;
    if (hasShock) {
      return { status: '転倒', color: '#721c24', bgColor: '#f8d7da' };
    } else {
      return { status: '正常', color: '#155724', bgColor: '#d4edda' };
    }
  };

  const getBusStatus = (device: Device) => {
    console.log(`🔍 ${device.name} バス状態判定開始:`, {
      hasStatusData: !!device.statusData,
      inBus: device.statusData?.inBus,
      lastUpdated: device.statusData?.busStatusUpdatedAt,
      selectedBeacon,
      hasBleData: !!device.bleData?.length
    });

    // 1. Mode2Busと同じローカルBLE判定を最優先で実行
    if (!selectedBeacon) {
      return { status: 'ビーコン未選択', color: '#856404', bgColor: '#fff3cd' };
    }

    const latestBleData = device.bleData?.find(ble =>
      ble && ble.beaconId === selectedBeacon && typeof ble.rssi === 'number'
    );

    if (latestBleData) {
      try {
        const bleTimestamp = new Date(latestBleData.timestamp);
        if (!isNaN(bleTimestamp.getTime())) {
          const timeSinceLastBle = Date.now() - bleTimestamp.getTime();
          const isRecentlyReceived = timeSinceLastBle < 5 * 60 * 1000; // 5分以内
          const isWithinBusRange = latestBleData.rssi >= calculatedRssiThreshold;
          const estimatedDistance = estimateDistance(latestBleData.rssi);

          console.log(`📊 ${device.name} ローカル判定:`, {
            rssi: latestBleData.rssi,
            threshold: calculatedRssiThreshold,
            distance: estimatedDistance.toFixed(1),
            isWithinRange: isWithinBusRange,
            isRecent: isRecentlyReceived
          });

          if (isRecentlyReceived) {
            if (isWithinBusRange) {
              return {
                status: 'バス内',
                color: '#155724',
                bgColor: '#d4edda'
              };
            }

            return {
              status: 'バス外',
              color: '#721c24',
              bgColor: '#f8d7da'
            };
          }

          return { status: '受信タイムアウト', color: '#856404', bgColor: '#fff3cd' };
        }
      } catch (error) {
        console.error('バス状態のBLE判定エラー:', error);
        return { status: 'エラー', color: '#dc3545', bgColor: '#f8d7da' };
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

          console.log(`📊 ${device.name} RTDB判定:`, {
            inBus: isInBus,
            timeSinceUpdate: Math.floor(timeSinceUpdate / 1000),
            isRecent: timeSinceUpdate < 5 * 60 * 1000
          });

          if (timeSinceUpdate < 5 * 60 * 1000) {
            if (isInBus) {
              return { status: 'バス内', color: '#155724', bgColor: '#d4edda' };
            }
            return { status: 'バス外', color: '#721c24', bgColor: '#f8d7da' };
          }
        } catch (error) {
          console.error('バス状態の時刻確認エラー:', error);
        }
      }
    }

    // 3. それでも判定できない場合は未受信扱い
    return { status: 'BLE未受信', color: '#6c757d', bgColor: '#e9ecef' };
  };

    // 🔧 GPS状態判定関数を追加
  const getGPSStatus = (device: Device) => {
    if (!device.position) {
      return { 
        status: 'GPS未取得', 
        color: '#6c757d', 
        bgColor: '#e9ecef'
      };
    }

    try {
      const { lat, lon, timestamp } = device.position;
      
      // GPS座標の有効性チェック
      if (typeof lat !== 'number' || typeof lon !== 'number' || 
          lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return { 
          status: 'GPS未取得', 
          color: '#6c757d', 
          bgColor: '#e9ecef'
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

      // 🔧 2種類のパラメータのみ
      if (timestamp) {
        return {
          status: 'GPS取得済み',
          color: '#155724',
          bgColor: '#d4edda'
        };
      } else {
        return {
          status: 'GPS未取得',
          color: '#6c757d',
          bgColor: '#e9ecef'
        };
      }
    } catch (error) {
      console.error('GPS状態判定エラー:', error);
      return { 
        status: 'GPS未取得', 
        color: '#6c757d', 
        bgColor: '#e9ecef'
      };
    }
  };

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
        <p style={{ color: '#dc3545' }}>{error}</p>
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
                  fontSize: '14px',
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
                        温度
                      </th>
                      {/* <th style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: '#495057',
                        borderRight: '1px solid #dee2e6',
                        minWidth: '120px'
                      }}>
                        最新BLE
                      </th> */}
                      <th style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: '#495057',
                        minWidth: '150px'
                      }}>
                        GPS情報
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device, index) => {
                      const indoorStatus = getIndoorStatus(device);
                      const temperatureDisplay = getTemperatureDisplay(device);
                      const motionStatus = getMotionStatus(device);
                      const busStatus = getBusStatus(device);
                      const gpsStatus = getGPSStatus(device);
                      const latestBleData = device.bleData?.find(ble => ble && ble.beaconId === selectedBeacon);
                      
                      // 経過時間を計算
                      const getTimeAgo = (date: Date | null) => {
                        if (!date) return '';
                        const now = new Date();
                        const diffMs = now.getTime() - new Date(date).getTime();
                        const diffMinutes = Math.floor(diffMs / (1000 * 60));
                        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                        
                        if (diffDays > 0) return `${diffDays}日前`;
                        if (diffHours > 0) return `${diffHours}時間前`;
                        if (diffMinutes > 0) return `${diffMinutes}分前`;
                        return '1分以内';
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
                                fontSize: '12px',
                                color: '#666',
                                fontFamily: 'monospace',
                                marginLeft: '8px'
                              }}>
                                ({device.deviceId})
                              </span>
                            </div>
                            <div style={{
                              fontSize: '11px',
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
                              fontSize: '12px',
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
                              fontSize: '12px',
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
                              fontSize: '12px',
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
                            borderRight: '1px solid #dee2e6'
                          }}>
                            <div style={{
                              fontSize: '16px',
                              fontWeight: 'bold',
                              color: '#333'
                            }}>
                              {temperatureDisplay}
                            </div>
                          </td>

                          {/* GPS */}
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            borderRight: '1px solid #dee2e6'
                          }}>
                            <div>
                              <span style={{
                              padding: '6px 16px',
                              borderRadius: '20px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                              backgroundColor: gpsStatus.bgColor,
                              color: gpsStatus.color,
                              border: `1px solid ${gpsStatus.color}40`,
                              display: 'inline-block'
                              }}>
                                {gpsStatus.status}
                              </span>
                              
                              {/* {gpsStatus.coordinates && (
                                <>
                                  <div style={{ fontSize: '11px', color: '#333', fontFamily: 'monospace' }}>
                                    {gpsStatus.coordinates.lat}
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#333', fontFamily: 'monospace' }}>
                                    {gpsStatus.coordinates.lon}
                                  </div>
                                </>
                              )}
                              
                              {gpsStatus.lastUpdate && (
                                <div style={{ fontSize: '10px', color: 'black' }}>
                                  {gpsStatus.lastUpdate.toLocaleTimeString('ja-JP')}
                                </div>
                              )} */}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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
                    alertThreshold={alertThreshold}
                    onAlertThresholdChange={handleAlertThresholdChange}
                    alertEnabled={alertEnabled}
                    onAlertEnabledChange={handleAlertEnabledChange}
                    connectionTimeout={connectionTimeout}
                    onConnectionTimeoutChange={handleConnectionTimeoutChange}
                    showAllDevices={showAllDevices}
                    onShowAllDevicesChange={handleShowAllDevicesChange}
                    busRange={busRange}
                    onBusRangeChange={handleBusRangeChange}
                  />
                </div>
              )}

              {currentMode === 'gps' && (
                <div>
                  <Mode3GPS devices={devices} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

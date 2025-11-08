// Mode2Bus.tsx の最適化版
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { ref, update, onValue } from 'firebase/database';
import { db, rtdb } from '../firebase';
import { Device, Beacon } from '../types';

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

interface Mode2Props {
  devices?: Device[];
  beacons?: Beacon[];
  selectedBeacon?: string;
  onSelectedBeaconChange?: (beaconId: string) => void;
  rssiThreshold?: number;
  onRssiThresholdChange?: (threshold: number) => void;
  alertEnabled?: boolean;
  onAlertEnabledChange?: (enabled: boolean) => void;
  connectionTimeout?: number;
  onConnectionTimeoutChange?: (timeout: number) => void;
  showAllDevices?: boolean;
  onShowAllDevicesChange?: (show: boolean) => void;
  busRange?: number;
  onBusRangeChange?: (range: number) => void;
  busDeviceAlertThreshold?: number;
  onBusDeviceAlertThresholdChange?: (threshold: number) => void;
}

interface DeviceWithConnection extends Device {
  connectionStatus: 'excellent' | 'good' | 'weak' | 'poor' | 'offline';
  lastConnectionTime: Date | null;
  rssiValue: number | null;
  timeSinceLastConnection: number | null;
}

export default function Mode2Bus({ 
  devices: externalDevices, 
  beacons: externalBeacons,
  selectedBeacon: externalSelectedBeacon,
  onSelectedBeaconChange,
  rssiThreshold: externalRssiThreshold,
  onRssiThresholdChange,
  alertEnabled: externalAlertEnabled,
  onAlertEnabledChange,
  connectionTimeout: externalConnectionTimeout,
  onConnectionTimeoutChange,
  showAllDevices: externalShowAllDevices,
  onShowAllDevicesChange,
  busRange: externalBusRange,
  onBusRangeChange,
  busDeviceAlertThreshold: externalBusDeviceAlertThreshold,
  onBusDeviceAlertThresholdChange
}: Mode2Props = {}) {
  // === 基本状態管理 ===
  const [devices, setDevices] = useState<Device[]>(externalDevices || []);
  const [beacons, setBeacons] = useState<Beacon[]>(externalBeacons || []);
  
  // 内部制御用の状態
  const [internalSelectedBeacon, setInternalSelectedBeacon] = useState<string>('');
  const [internalAlertEnabled, setInternalAlertEnabled] = useState(true);
  const [internalRssiThreshold, setInternalRssiThreshold] = useState(-75);
  const [internalConnectionTimeout, setInternalConnectionTimeout] = useState(10);
  const [internalShowAllDevices, setInternalShowAllDevices] = useState(false);
  const [internalBusRange, setInternalBusRange] = useState(5);
  const [internalBusDeviceAlertThreshold, setInternalBusDeviceAlertThreshold] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  // 参照値
  const rtdbUnsubscribersRef = useRef<(() => void)[]>([]);
  const lastAlertCheckRef = useRef(0);
  const lastUpdateRef = useRef(0); // Firebase更新用のスロットル追加
  const alertCheckThrottleMs = 1000; // 10秒
  const updateThrottleMs = 500;

  // 外部制御か内部制御かを判定
  const isExternalDataMode = Boolean(externalDevices && externalBeacons);
  const isExternallyControlled = Boolean(
    externalSelectedBeacon !== undefined ||
    externalRssiThreshold !== undefined ||
    onSelectedBeaconChange ||
    onRssiThresholdChange
  );

  // 距離推定関数
const estimateDistance = useCallback((rssi: number, rssiAt1m: number = -59): number => {
    if (rssi === 0) return -1;
    const n = 2.0;
    if (rssi > rssiAt1m) return 0.5;
    const ratio = rssiAt1m / rssi;
    if (ratio < 1.0) return 0.5;
    return Math.pow(ratio, (1 / n));
  }, []);

  const formatTimeAgo = useCallback((timestamp: string | number | Date) => {
    const time = new Date(timestamp);
    if (isNaN(time.getTime())) return 'N/A';

    const diffMs = Date.now() - time.getTime();
    if (diffMs < 60 * 1000) return '1分未満前';

    const minutes = Math.floor(diffMs / (60 * 1000));
    if (minutes < 60) return `${minutes}分前`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}時間前`;

    const days = Math.floor(hours / 24);
    return `${days}日前`;
  }, []);

  // 実際に使用する値を決定
  const selectedBeacon = isExternallyControlled ? externalSelectedBeacon || '' : internalSelectedBeacon;
  const rssiThreshold = isExternallyControlled ? externalRssiThreshold || -75 : internalRssiThreshold;
  const alertEnabled = true;  // 🔧 常に有効に固定
  const connectionTimeout = isExternallyControlled ? externalConnectionTimeout || 10 : internalConnectionTimeout;
  const showAllDevices = isExternallyControlled ? externalShowAllDevices || false : internalShowAllDevices;
  const busRange = isExternallyControlled ? externalBusRange || 5 : internalBusRange;
  const busDeviceAlertThreshold = isExternallyControlled ? externalBusDeviceAlertThreshold || 1 : internalBusDeviceAlertThreshold;

  // === ユーティリティ関数 ===
  const updateBusStatusInFirebase = useCallback(async (deviceId: string, devEUI: string, isInBus: boolean) => {
    try {
      const statusRef = ref(rtdb, `devices/${devEUI.toLowerCase()}/status`);

      await update(statusRef, {
        inBus: isInBus,
        busStatusUpdatedAt: createJstTimestamp()
      });
    } catch (error) {
      console.error(`バス状態更新エラー (${deviceId}):`, error);
    }
  }, []);

  
  // === スロットル化された置き去り検知 ===
  const checkForAloneDevicesThrottled = useCallback(async (overrideRssiThreshold?: number, overrideSelectedBeacon?: string) => {
    const now = Date.now();
    
    if (now - lastUpdateRef.current < updateThrottleMs) {
      return;
    }

    if (now - lastAlertCheckRef.current < alertCheckThrottleMs) {
      return;
    }
    
    lastAlertCheckRef.current = now;
    lastUpdateRef.current = now;

    const effectiveRssiThreshold = overrideRssiThreshold ?? rssiThreshold;
    const effectiveSelectedBeacon = overrideSelectedBeacon ?? selectedBeacon;

    if (!effectiveSelectedBeacon || !alertEnabled) {
      console.warn('⚠️ ビーコン未選択または警告無効のため処理をスキップ');
      return;
    }

    try {
      const currentTime = new Date();

      const devicesInBus = devices.filter(device => {
        if (!device.bleData || !Array.isArray(device.bleData)) return false;
        
        const latestBleData = device.bleData.find(ble => 
          ble && ble.beaconId === effectiveSelectedBeacon && typeof ble.rssi === 'number'
        );
        if (!latestBleData) return false;

        try {
          const bleTimestamp = new Date(latestBleData.timestamp);
          if (isNaN(bleTimestamp.getTime())) return false;
          
          const timeSinceLastBle = currentTime.getTime() - bleTimestamp.getTime();
          const isRecentlyReceived = timeSinceLastBle < 30 * 60 * 1000;
          // 🔧 引数で受け取った値を使用
          const isWithinBusRange = latestBleData.rssi >= effectiveRssiThreshold;
          
          const isInBus = isRecentlyReceived && isWithinBusRange;
          return isInBus;
        } catch (error) {
          console.error(`❌ ${device.name}: BLEデータ処理エラー:`, error);
          return false;
        }
      });

      // Firebase更新（効果的な値を使用）
      const updatePromises = devices.map(async (device) => {
        const isInBus = devicesInBus.some(busDevice => busDevice.id === device.id);
        if (device.devEUI) {
          await updateBusStatusInFirebase(device.id, device.devEUI, isInBus);
        }
      });

      await Promise.all(updatePromises);
    } catch (error) {
      console.error('❌ バス内判定処理エラー:', error);
    }
  }, [rssiThreshold, selectedBeacon, alertEnabled, devices, estimateDistance, updateBusStatusInFirebase]);

  // === 設定変更ハンドラー ===
  const handleSelectedBeaconChange = useCallback((value: string) => {
    if (onSelectedBeaconChange) {
      onSelectedBeaconChange(value);
    } else {
      setInternalSelectedBeacon(value);
    }
  }, [onSelectedBeaconChange]);

  const handleRssiThresholdChange = useCallback(async (value: number) => {
    if (onRssiThresholdChange) {
      onRssiThresholdChange(value);
    } else {
      setInternalRssiThreshold(value);
    }
    
    // 🔧 新しい値を直接渡して即座更新
    if (selectedBeacon && devices.length > 0) {
      const now = Date.now();
      if (now - lastUpdateRef.current >= 1000) { // 1秒に短縮
        setTimeout(async () => {
          if (selectedBeacon && devices.length > 0) {
            await checkForAloneDevicesThrottled(value, undefined);
          }
        }, 200); // 遅延を短縮
      }
    }
  }, [onRssiThresholdChange, selectedBeacon, devices.length, checkForAloneDevicesThrottled]);

  const distanceToRssi = useCallback((distance: number, rssiAt1m: number = -59): number => {
    if (distance <= 0) return rssiAt1m;
    
    const n = 2.0; // 環境定数
    const rssi = rssiAt1m - (10 * n * Math.log10(distance));
    
    return Math.round(rssi);
  }, []);

  const handleBusRangeChange = useCallback(async (value: number) => {
    if (onBusRangeChange) {
      onBusRangeChange(value);
    } else {
      setInternalBusRange(value);
    }
    
    // 🔧 バス範囲変更時も同様に処理
    if (selectedBeacon && devices.length > 0) {         
      const now = Date.now();
      if (now - lastUpdateRef.current >= 1000) {
        setTimeout(async () => {
          if (selectedBeacon && devices.length > 0) {
            // バス範囲からRSSI閾値を計算して渡す
            const calculatedRssi = distanceToRssi(value);
            await checkForAloneDevicesThrottled(calculatedRssi, undefined);
          }
        }, 200);
      }
    }
  }, [onBusRangeChange, selectedBeacon, devices.length, checkForAloneDevicesThrottled, distanceToRssi]);

  const handleAlertEnabledChange = useCallback((value: boolean) => {
    if (onAlertEnabledChange) {
      onAlertEnabledChange(value);
    } else {
      setInternalAlertEnabled(value);
    }
  }, [onAlertEnabledChange]);

  const handleConnectionTimeoutChange = useCallback((value: number) => {
    if (onConnectionTimeoutChange) {
      onConnectionTimeoutChange(value);
    } else {
      setInternalConnectionTimeout(value);
    }
  }, [onConnectionTimeoutChange]);

  const handleShowAllDevicesChange = useCallback((value: boolean) => {
    if (onShowAllDevicesChange) {
      onShowAllDevicesChange(value);
    } else {
      setInternalShowAllDevices(value);
    }
  }, [onShowAllDevicesChange]);

  const handleBusDeviceAlertThresholdChange = useCallback((value: number) => {
    if (onBusDeviceAlertThresholdChange) {
      onBusDeviceAlertThresholdChange(value);
    } else {
      setInternalBusDeviceAlertThreshold(value);
    }
  }, [onBusDeviceAlertThresholdChange]);

  // === 独立モード用のデータ読み込み ===
  const loadInitialData = useCallback(async () => {
    try {
      setIsLoading(true);
      
      const [beaconsSnapshot, devicesSnapshot] = await Promise.all([
        getDocs(collection(db, 'beacons')),
        getDocs(collection(db, 'devices'))
      ]);

      const beaconsData = beaconsSnapshot.docs.map(doc => {
        const raw = doc.data() as any;
        return {
          beaconId: raw.beaconId || doc.id,
          id: doc.id,
          name: raw.name || raw.beaconId || doc.id,
          mac: raw.mac || '',
          uuid: raw.uuid,
          major: raw.major,
          minor: raw.minor,
          type: raw.type || 'ibeacon',
          rssiAt1m: (typeof raw.rssiAt1m === 'number') ? raw.rssiAt1m : -59,
          place: raw.place,
          anchor_loc: raw.anchor_loc,
          tags: raw.tags
        } as Beacon;
      });
      
      const devicesData = devicesSnapshot.docs.map(doc => {
        const raw = doc.data() as any;
        return {
          id: doc.id,
          deviceId: raw.deviceId || doc.id,
          name: raw.userName || raw.deviceId || doc.id,
          userName: raw.userName,
          devEUI: raw.devEUI,
          mac: raw.mac,
          model: raw.model,
          status: raw.status,
          bleData: Array.isArray(raw.bleData) ? raw.bleData : [],
          statusData: null
        };
      });

      setBeacons(beaconsData);
      setDevices(devicesData);
      
      if (beaconsData.length > 0 && !selectedBeacon) {
        handleSelectedBeaconChange(beaconsData[0].id);
      }
      
    } catch (error) {
      console.error('初期データ読み込みエラー:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedBeacon, handleSelectedBeaconChange]);

  // === リアルタイム監視 ===
  const setupRealtimeMonitoring = useCallback(() => {
    if (!selectedBeacon || isExternalDataMode) {
      console.warn('⚠️ 外部データモードまたはビーコン未選択のため、RTDB監視をスキップ');
      return;
    }

    rtdbUnsubscribersRef.current.forEach(unsubscribe => unsubscribe());
    rtdbUnsubscribersRef.current = [];

    const unsubscribers = devices.map(device => {
      const normalizedDeviceId = device.devEUI?.toLowerCase();
      if (!normalizedDeviceId) {
        console.warn(`⚠️ ${device.name}: devEUIが設定されていません`);
        return null;
      }

      // 🔧 beaconsデータのみを監視し、statusデータは除外
      const beaconsRef = ref(rtdb, `devices/${normalizedDeviceId}/beacons`);
      return onValue(beaconsRef, (snapshot) => {
        const beacons = snapshot.val();
        if (beacons && Array.isArray(beacons)) {
          const bleData = beacons
            .filter((beacon: any) => beacon.mac && beacon.rssi && beacon.rssi !== -1)
            .map((beacon: any) => {
              const normalizedMac = beacon.mac.toUpperCase().replace(/:/g, "");
              const selectedBeaconData = beacons.find(b => 
                b.mac && b.mac.toUpperCase().replace(/:/g, "") === normalizedMac
              );
              
              return {
                beaconId: selectedBeaconData?.id || selectedBeacon,
                rssi: beacon.rssi,
                timestamp: new Date().toISOString(), // 現在時刻を使用
                mac: normalizedMac
              };
            });

          // 🔧 前回のBLEデータと比較して、実際に変化があった場合のみ更新
          let shouldTriggerUpdate = false;
          
          setDevices(prevDevices => {
            const updatedDevices = prevDevices.map(d => {
              if (d.id === device.id) {
                const prevBleData = d.bleData || [];
                const hasRealChange = bleData.some(newBle => {
                  const prevBle = prevBleData.find(pb => pb.beaconId === newBle.beaconId);
                  return !prevBle || Math.abs(prevBle.rssi - newBle.rssi) >= 3; // 3dBm以上の変化のみ
                });
                
                if (hasRealChange) {
                  shouldTriggerUpdate = true;
                  return { ...d, bleData };
                }
                return d;
              }
              return d;
            });
            
            return updatedDevices;
          });

          // ✅ BLE受信時にinBus判定を実行
          if (shouldTriggerUpdate) {
            setTimeout(() => {
              checkForAloneDevicesThrottled();
            }, 200);
          }
        }
      }, (error) => {
        console.error(`❌ ${device.name}の監視エラー:`, error);
      });
    }).filter(Boolean);

    rtdbUnsubscribersRef.current = unsubscribers as (() => void)[];
    
    return () => {
      rtdbUnsubscribersRef.current.forEach(unsubscribe => unsubscribe());
      rtdbUnsubscribersRef.current = [];
    };
  }, [selectedBeacon, devices, beacons, isExternalDataMode]);

  // === メモ化された計算 ===
  const deviceStatusList = useMemo(() => {
    const now = new Date();
    const timeoutMs = connectionTimeout * 60 * 1000;

    return devices.map(device => {
      let connectionStatus: DeviceWithConnection['connectionStatus'] = 'offline';
      let latestBleData = null;
      let lastConnectionTime = null;
      let rssiValue = null;

      if (selectedBeacon && device.bleData && Array.isArray(device.bleData)) {
        latestBleData = device.bleData.find(ble => 
          ble && ble.beaconId === selectedBeacon && typeof ble.rssi === 'number'
        );

        if (latestBleData) {
          try {
            const bleTimestamp = new Date(latestBleData.timestamp);
            if (!isNaN(bleTimestamp.getTime())) {
              lastConnectionTime = bleTimestamp;
              const timeSinceLastBle = now.getTime() - bleTimestamp.getTime();
              rssiValue = latestBleData.rssi;

              if (timeSinceLastBle < timeoutMs) {
                if (rssiValue >= -60) connectionStatus = 'excellent';
                else if (rssiValue >= -70) connectionStatus = 'good';
                else if (rssiValue >= -80) connectionStatus = 'weak';
                else connectionStatus = 'poor';
              }
            }
          } catch (error) {
            // エラーハンドリング
          }
        }
      }

      return {
        ...device,
        connectionStatus,
        lastConnectionTime,
        rssiValue,
        timeSinceLastConnection: lastConnectionTime ? now.getTime() - lastConnectionTime.getTime() : null
      } as DeviceWithConnection;
    });
  }, [devices, selectedBeacon, connectionTimeout]);

  const activeDevices = useMemo(() => {
    if (!selectedBeacon) return [];

    const now = new Date();
    
    return devices.filter(device => {
      if (!device.bleData || !Array.isArray(device.bleData)) return false;
      
      const latestBleData = device.bleData.find(ble => 
        ble && ble.beaconId === selectedBeacon && typeof ble.rssi === 'number'
      );
      if (!latestBleData) return false;

      try {
        const bleTimestamp = new Date(latestBleData.timestamp);
        if (isNaN(bleTimestamp.getTime())) return false;
        
        const timeSinceLastBle = now.getTime() - bleTimestamp.getTime();
        const isRecentlyReceived = timeSinceLastBle < 30 * 60 * 1000;
        const isWithinBusRange = latestBleData.rssi >= rssiThreshold;
        
        return isRecentlyReceived && isWithinBusRange;
      } catch (error) {
        return false;
      }
    });
  }, [devices, selectedBeacon, rssiThreshold]);

  // 🔧 全デバイスを表示（バス外はグレーアウト）
  const displayDevices = useMemo(() => {
    return deviceStatusList;
  }, [deviceStatusList]);

  // === エフェクト ===
  useEffect(() => {
    if (isExternalDataMode && externalDevices && externalBeacons) {
      setDevices(externalDevices);
      setBeacons(externalBeacons);
      setIsLoading(false);
      
      if (externalBeacons.length > 0 && !selectedBeacon) {
        handleSelectedBeaconChange(externalBeacons[0].id);
      }
      
    } else {
      loadInitialData();
    }
  }, [externalDevices, externalBeacons, isExternalDataMode, loadInitialData, selectedBeacon, handleSelectedBeaconChange]);

  useEffect(() => {
    if (isExternalDataMode && externalDevices && Array.isArray(externalDevices)) {
      const timer = setTimeout(() => {
        setDevices(externalDevices);
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [externalDevices, isExternalDataMode]);

  useEffect(() => {
    if (isExternalDataMode && externalBeacons && Array.isArray(externalBeacons)) {
      setBeacons(externalBeacons);
    }
  }, [externalBeacons, isExternalDataMode]);

  useEffect(() => {
    if (selectedBeacon && devices.length > 0 && beacons.length > 0 && !isExternalDataMode) {
      const cleanup = setupRealtimeMonitoring();
      return cleanup;
    }
  }, [selectedBeacon, devices.length, beacons.length, isExternalDataMode, setupRealtimeMonitoring]);

  useEffect(() => {
    return () => {
      rtdbUnsubscribersRef.current.forEach(unsubscribe => unsubscribe());
    };
  }, []);

  // === レンダリング ===
  if (isLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h2>読み込み中...</h2>
      </div>
    );
  }

  return (
    <div style={{ 
      maxWidth: '1400px', margin: '0 auto'}}>
      {/* 機能見出しは不要のため削除 */}

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '2fr 1fr',
        gap: '24px',
        marginBottom: '24px'
      }}>
        {/* バス内デバイス一覧 */}
        <div style={{ 
          backgroundColor: 'white', 
          borderRadius: '12px', 
          padding: '24px', 
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)' 
        }}>
          <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            全デバイス ({displayDevices.length}台)
            <span style={{ 
              fontSize: '14px', 
              fontWeight: 'normal', 
              color: '#4CAF50',
              marginLeft: '8px'
            }}>
              バス内: {activeDevices.length}台
            </span>
          </h3>
          
          {displayDevices.length > 0 ? (
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '12px' 
            }}>
              {displayDevices.map(device => {
                const latestBleData = device.bleData?.find(ble => ble.beaconId === selectedBeacon);
                const distance = latestBleData ? estimateDistance(latestBleData.rssi) : -1;
                const rssiPercentage = latestBleData ? Math.max(0, Math.min(100, ((latestBleData.rssi + 90) / 60) * 100)) : 0;
                
                // バス内判定（RSSI閾値以上かつ最近の信号）
                const isInBus = activeDevices.some(activeDevice => activeDevice.id === device.id);

                const containerStyle = {
                  padding: '16px',
                  backgroundColor: isInBus ? '#F8F9FA' : '#E8E8E8',
                  borderRadius: '8px',
                  border: isInBus ? '2px solid #E8F5E8' : '2px solid #D0D0D0',
                  opacity: isInBus ? 1 : 0.6, // バス外をグレーアウト
                  transition: 'all 0.3s ease'
                };

                const statusIndicatorColor = isInBus ? '#4CAF50' : '#9E9E9E';
                
                return (
                  <div
                    key={device.id}
                    style={containerStyle}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 'bold' }}>
                          {device.name}
                          <span style={{ 
                            marginLeft: '8px', 
                            fontSize: '12px', 
                            padding: '2px 6px', 
                            borderRadius: '4px',
                            backgroundColor: isInBus ? '#E8F5E8' : '#F5F5F5',
                            color: isInBus ? '#2E7D32' : '#757575'
                          }}>
                            {isInBus ? 'バス内' : 'バス外'}
                          </span>
                        </h4>
                      </div>
                      <div style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        backgroundColor: statusIndicatorColor
                      }} />
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
                      <div>
                        {/* <strong>信号強度</strong> */}
                        <div style={{ marginTop: '4px' }}>
                          <div style={{
                            fontSize: '16px',
                            fontWeight: 'bold',
                            color: latestBleData && latestBleData.rssi > -100 ? '#4CAF50' : '#FF9800'
                          }}>
                            {latestBleData?.rssi || 'N/A'} dBm
                          </div>
                          <div style={{
                            width: '100%',
                            height: '4px',
                            backgroundColor: '#E0E0E0',
                            borderRadius: '2px',
                            marginTop: '4px'
                          }}>
                            <div style={{
                              width: `${rssiPercentage}%`,
                              height: '100%',
                              backgroundColor: latestBleData && latestBleData.rssi > -100 ? '#4CAF50' : '#FF9800',
                              borderRadius: '2px'
                            }} />
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div style={{ marginTop: '12px', fontSize: '12px', color: '#666' }}>
                      最終受信: {latestBleData ? formatTimeAgo(latestBleData.timestamp) : 'N/A'}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
              <h4 style={{ margin: '0 0 8px 0' }}>
                デバイスがありません
              </h4>
              <p style={{ margin: 0, fontSize: '14px' }}>
                ビーコンからの信号を受信しているデバイスがありません
              </p>
            </div>
          )}
        </div>

        {/* 設定パネル */}
        <div style={{ 
          backgroundColor: 'white', 
          borderRadius: '12px', 
          padding: '24px', 
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)' 
        }}>
          <h3 style={{ marginBottom: '16px' }}>設定</h3>
          
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            marginBottom: '24px'
          }}>
          
          {/* ビーコン選択 */}
          <div>
            <label style={{ 
              display: 'block', 
              marginBottom: '8px', 
              fontWeight: '600', 
              color: '#333' 
            }}>
              バスビーコンを選択
            </label>
            <select
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid #ddd',
                fontSize: '14px'
              }}
              value={selectedBeacon}
              onChange={(e) => handleSelectedBeaconChange(e.target.value)}
            >
              <option value="">選択してください</option>
              {beacons.map(beacon => (
                <option key={beacon.id} value={beacon.id}>
                  {beacon.beaconId || beacon.name}
                </option>
              ))}
            </select>
          </div>

          {/* RSSI閾値設定 */}
          <div>
            <label style={{ 
              display: 'block', 
              marginBottom: '8px', 
              fontWeight: '600', 
              color: '#333' 
            }}>
              バス内判定閾値: {rssiThreshold}dBm
            </label>
            <input
              type="range"
              style={{
                width: '100%',
                marginBottom: '8px'
              }}
              value={rssiThreshold}
              onChange={(e) => handleRssiThresholdChange(Number(e.target.value))}
              min={-150}
              max={-30}
              step={5}
            />
          </div>

          {/* バス内デバイス数警告閾値設定 */}
          <div>
            <label style={{ 
              display: 'block', 
              marginBottom: '8px', 
              fontWeight: '600', 
              color: '#333' 
            }}>
              バス内置き去りデバイス警告数: {busDeviceAlertThreshold}台
            </label>
            <input
              type="range"
              style={{
                width: '100%',
                marginBottom: '8px'
              }}
              value={busDeviceAlertThreshold}
              onChange={(e) => handleBusDeviceAlertThresholdChange(Number(e.target.value))}
              min={0}
              max={10}
              step={1}
            />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

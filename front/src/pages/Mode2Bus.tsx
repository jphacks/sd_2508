import { useState, useEffect } from 'react';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import { db, rtdb } from '../firebase';

// 型定義
interface Device {
  id: string;
  deviceId?: string;
  name: string;
  userName?: string;
  devEUI?: string;
  mac?: string;
  model?: string;
  status?: string;
  bleData?: {
    beaconId: string;
    rssi: number;
    timestamp: string;
  }[];
}

interface Beacon {
  id: string;          // Firestoreドキュメント ID
  beaconId?: string;   // ビーコンの識別子
  name: string;        // 表示名
  mac: string;         // MACアドレス
  rssiAt1m?: number;   // 1mでのRSSI値
  type?: string;       // ビーコンタイプ
}

interface DeviceWithConnection extends Device {
  connectionStatus: 'excellent' | 'good' | 'weak' | 'poor' | 'offline';
  lastConnectionTime: Date | null;
  rssiValue: number | null;
  timeSinceLastConnection: number | null;
}

export default function Mode2Bus() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [beacons, setBeacons] = useState<Beacon[]>([]);
  const [selectedBeacon, setSelectedBeacon] = useState<string>('');
  const [alert, setAlert] = useState<string | null>(null);
  const [alertThreshold, setAlertThreshold] = useState(3); // 分
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [alertSound, setAlertSound] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  
  // RSSI閾値設定
  const [rssiThreshold, setRssiThreshold] = useState(-75); // バス内判定のRSSI閾値（dBm）

  // 実際のデータ読み込み
  useEffect(() => {
    loadInitialData();
    
    // リアルタイム監視の開始
    const unsubscribeDevices = setupRealtimeMonitoring();
    
    return () => {
      if (unsubscribeDevices) unsubscribeDevices();
    };
  }, []);

  // 距離推定関数
  const estimateDistance = (rssi: number, rssiAt1m: number = -59) => {
    if (rssi === 0 || rssi >= 0) return -1;
    
    const ratio = (rssiAt1m - rssi) / 20;
    const distance = Math.pow(10, ratio);
    return distance;
  };

  // 初期データ読み込み
  const loadInitialData = async () => {
    try {
      setIsLoading(true);
      
      // ビーコン読み込み
      const beaconsSnapshot = await getDocs(collection(db, 'beacons'));
      const beaconsData = beaconsSnapshot.docs.map(doc => {
        const raw = doc.data() as any;
        const resolvedBeaconId = typeof raw.beaconId === 'string' && raw.beaconId.length > 0 ? raw.beaconId : doc.id;
        return {
          id: doc.id,
          beaconId: resolvedBeaconId,
          name: raw.name || resolvedBeaconId,
          mac: raw.mac || '',
          rssiAt1m: (typeof raw.rssiAt1m === 'number') ? raw.rssiAt1m : -59,
          type: raw.type || 'ibeacon'
        };
      });
      setBeacons(beaconsData);
      
      // 最初のビーコンを自動選択
      if (beaconsData.length > 0 && !selectedBeacon) {
        setSelectedBeacon(beaconsData[0].id);
      }
      
      // デバイス読み込み
      const devicesSnapshot = await getDocs(collection(db, 'devices'));
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
          bleData: Array.isArray(raw.bleData) ? raw.bleData : []
        };
      });
      setDevices(devicesData);
      
      console.log('✅ 初期データ読み込み完了:', {
        beacons: beaconsData.length,
        devices: devicesData.length
      });
      
    } catch (error) {
      console.error('❌ 初期データ読み込みエラー:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // リアルタイム監視の設定
  const setupRealtimeMonitoring = () => {
    if (!selectedBeacon) {
      console.log('⚠️ ビーコンが選択されていないため、監視を開始できません');
      return;
    }

    console.log(`🔄 ビーコン ${selectedBeacon} のリアルタイム監視を開始`);
    
    try {
      // Mode1と同じようにRealtimeDatabaseから取得
      const unsubscribers = devices.map(device => {
        const normalizedDeviceId = device.devEUI?.toLowerCase();
        if (!normalizedDeviceId) {
          console.warn(`⚠️ ${device.name}: devEUIが設定されていません`);
          return null;
        }

        console.log(`📡 ${device.name}(${normalizedDeviceId})の監視開始`);

        const trackerRef = ref(rtdb, `devices/${normalizedDeviceId}`);
        return onValue(trackerRef, (snapshot) => {
          const data = snapshot.val();
          if (data && data.beacons) {
            console.log(`📊 ${device.name}のRTDB更新:`, {
              timestamp: data.beaconsUpdatedAt,
              beaconsCount: data.beacons.length,
              selectedBeacon
            });

            // Mode1と同じ形式でビーコンデータを処理
            const bleData = data.beacons
              .filter((beacon: any) => beacon.mac && beacon.rssi && beacon.rssi !== -1)
              .map((beacon: any) => {
                // MACアドレスを正規化
                const normalizedMac = beacon.mac.toUpperCase().replace(/:/g, "");
                
                // 選択されたビーコンかチェック
                const selectedBeaconData = beacons.find(b => 
                  b.mac && b.mac.toUpperCase().replace(/:/g, "") === normalizedMac
                );
                
                return {
                  beaconId: selectedBeaconData?.id || selectedBeacon,
                  rssi: beacon.rssi,
                  timestamp: data.beaconsUpdatedAt || new Date().toISOString(),
                  mac: normalizedMac
                };
              });
            
            // デバイス状態を更新
            updateDeviceBleData(device.id, bleData);
          } else {
            console.log(`📭 ${device.name}: ビーコンデータなし`);
            // データがない場合は空配列に設定
            updateDeviceBleData(device.id, []);
          }
        }, (error) => {
          console.error(`❌ ${device.name}の監視エラー:`, error);
        });
      }).filter(Boolean);

      console.log(`✅ ${unsubscribers.length}台のデバイス監視を開始`);

      return () => {
        console.log('🔄 リアルタイム監視を停止');
        unsubscribers.forEach(unsub => unsub && unsub());
      };
    } catch (error) {
      console.error('❌ リアルタイム監視の設定に失敗:', error);
      return undefined;
    }
  };

  // デバイスのBLEデータを更新する関数
  const updateDeviceBleData = (deviceId: string, bleData: any[]) => {
    setDevices(prevDevices => 
      prevDevices.map(device => 
        device.id === deviceId 
          ? { ...device, bleData }
          : device
      )
    );
  };

  // 置き去り検知ロジック
  const checkForAloneDevices = (currentDevices: Device[]) => {
    if (!selectedBeacon) return;

    try {
      const now = new Date();
      const thresholdMs = alertThreshold * 60 * 1000;

      // 選択されたビーコンを受信し、RSSI閾値を満たすデバイスを特定
      const devicesInBus = currentDevices.filter(device => {
        if (!device.bleData || !Array.isArray(device.bleData)) return false;
        
        const latestBleData = device.bleData.find(ble => 
          ble && 
          ble.beaconId === selectedBeacon && 
          typeof ble.rssi === 'number' && 
          ble.timestamp
        );
        
        if (!latestBleData) return false;

        try {
          const bleTimestamp = new Date(latestBleData.timestamp);
          if (isNaN(bleTimestamp.getTime())) return false;
          
          const timeSinceLastBle = now.getTime() - bleTimestamp.getTime();
          
          // 5分以内の受信 かつ RSSI閾値以上
          const isRecentlyReceived = timeSinceLastBle < 5 * 60 * 1000;
          const isWithinBusRange = latestBleData.rssi >= rssiThreshold;
          
          return isRecentlyReceived && isWithinBusRange;
        } catch (error) {
          console.error(`❌ デバイス ${device.name} の BLE データ処理エラー:`, error);
          return false;
        }
      });

      console.log(`🚌 バス内デバイス数: ${devicesInBus.length} (RSSI閾値: ${rssiThreshold}dBm以上)`);

      // 1台のみの状態が閾値時間続いているかチェック
      if (devicesInBus.length === 1) {
        const aloneDevice = devicesInBus[0];
        const latestBleData = aloneDevice.bleData?.find(ble => ble.beaconId === selectedBeacon);
        
        if (latestBleData) {
          try {
            const aloneStartTime = new Date(latestBleData.timestamp);
            const aloneTime = now.getTime() - aloneStartTime.getTime();
            const distance = estimateDistance(latestBleData.rssi);
            
            if (aloneTime >= thresholdMs) {
              const alertMessage = `🚨 ${aloneDevice.name} がバスに置き去りにされている可能性があります！

📍 推定距離: ${distance.toFixed(1)}m
📶 信号強度: ${latestBleData.rssi}dBm
⏰ 単独検知時間: ${Math.floor(aloneTime / 60000)}分
🚌 判定基準: RSSI ${rssiThreshold}dBm以上をバス内と判定`;
              
              setAlert(alertMessage);
              
              // 警告音の再生
              if (alertSound) {
                playAlertSound();
              }
              
              console.log('🚨 置き去り警告発生:', alertMessage);
            }
          } catch (error) {
            console.error('❌ 警告処理エラー:', error);
          }
        }
      } else if (devicesInBus.length === 0) {
        const receivingDevicesCount = currentDevices.filter(d => 
          d.bleData?.some(ble => ble && ble.beaconId === selectedBeacon)
        ).length;
        
        setAlert(`📶 現在バス内にいるデバイスはありません。

🔍 判定基準: RSSI ${rssiThreshold}dBm以上
📡 受信中デバイス: ${receivingDevicesCount}台
💡 RSSI閾値が厳しすぎる可能性があります。`);
      } else {
        // 複数台がバス内にいる場合は警告をクリア
        setAlert(null);
      }
    } catch (error) {
      console.error('❌ 置き去り検知処理エラー:', error);
    }
  };

  // 通信状況監視用の状態を追加
  const [connectionTimeout, setConnectionTimeout] = useState(10); // 分
  const [showAllDevices, setShowAllDevices] = useState(false); // 全デバイス表示切り替え

  // 通信状況を取得する関数
  const getDeviceConnectionStatus = () => {
    const now = new Date();
    const timeoutMs = connectionTimeout * 60 * 1000;

    return devices.map(device => {
      let connectionStatus = 'offline'; // offline, online, weak
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
                // RSSI値による接続品質判定
                if (rssiValue >= -60) {
                  connectionStatus = 'excellent';
                } else if (rssiValue >= -70) {
                  connectionStatus = 'good';
                } else if (rssiValue >= -80) {
                  connectionStatus = 'weak';
                } else {
                  connectionStatus = 'poor';
                }
              }
            }
          } catch (error) {
            console.error(`❌ デバイス ${device.name} の接続状況確認エラー:`, error);
          }
        }
      }

      return {
        ...device,
        connectionStatus,
        lastConnectionTime,
        rssiValue,
        timeSinceLastConnection: lastConnectionTime ? now.getTime() - lastConnectionTime.getTime() : null
      };
    });
  };

  // 接続状況による色とアイコンを取得
  const getConnectionDisplay = (status: string, rssi?: number) => {
    switch (status) {
      case 'excellent':
        return { color: '#4CAF50', icon: '📶', text: '優秀', bgColor: '#E8F5E8' };
      case 'good':
        return { color: '#8BC34A', icon: '📶', text: '良好', bgColor: '#F1F8E9' };
      case 'weak':
        return { color: '#FF9800', icon: '📶', text: '弱い', bgColor: '#FFF8E1' };
      case 'poor':
        return { color: '#F44336', icon: '📵', text: '貧弱', bgColor: '#FFEBEE' };
      case 'offline':
      default:
        return { color: '#9E9E9E', icon: '📵', text: 'オフライン', bgColor: '#F5F5F5' };
    }
  };

  // 信号強度バーの幅を計算
  const getRssiBarWidth = (rssi: number) => {
    if (rssi >= -30) return 100;
    if (rssi <= -90) return 0;
    return ((rssi + 90) / 60) * 100;
  };

  // 警告音の再生
  const playAlertSound = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) {
        console.warn('⚠️ このブラウザは Web Audio API をサポートしていません');
        return;
      }
      
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.5);
      
      console.log('🔊 警告音を再生しました');
    } catch (error) {
      console.error('❌ 警告音の再生に失敗:', error);
    }
  };

  // 選択されたビーコンの変更時にリアルタイム監視を再設定
  useEffect(() => {
    if (selectedBeacon && devices.length > 0) {
      const unsubscribe = setupRealtimeMonitoring();
      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
  }, [selectedBeacon, devices, beacons]);

  // 現在アクティブなデバイス（ビーコンを受信中）を取得
  const getActiveDevices = () => {
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
        
        // 条件1: 5分以内の受信
        const isRecentlyReceived = timeSinceLastBle < 5 * 60 * 1000;
        
        // 条件2: RSSI値がバス内の距離範囲内
        const isWithinBusRange = latestBleData.rssi >= rssiThreshold;
        
        return isRecentlyReceived && isWithinBusRange;
      } catch (error) {
        console.error(`❌ デバイス ${device.name} の処理エラー:`, error);
        return false;
      }
    });
  };

  if (isLoading) {
    return (
      <div className="container">
        <div className="card">
          <h2>🔄 データを読み込み中...</h2>
          <p>ビーコンとデバイスの情報を取得しています。</p>
        </div>
      </div>
    );
  }

  const deviceStatusList = getDeviceConnectionStatus();
  const activeDevices = getActiveDevices();

  return (
  <div className="container">
    <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
      🚌 バス置き去り検知
    </h1>

    {/* 警告表示 */}
    {alert && (
      <div className={`alert ${activeDevices.length === 1 ? 'alert-danger' : 'alert-warning'}`} style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ whiteSpace: 'pre-line', flex: 1 }}>
            <strong style={{ fontSize: '18px' }}>
              {activeDevices.length === 1 ? '🚨 緊急警告' : '📶 通信状況'}
            </strong>
            <p style={{ marginTop: '8px', fontSize: '16px', lineHeight: '1.5' }}>{alert}</p>
          </div>
          <button
            onClick={() => setAlert(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'white',
              fontSize: '24px',
              cursor: 'pointer',
              minWidth: '30px',
              padding: '4px'
            }}
          >
            ×
          </button>
        </div>
      </div>
    )}

    <div className="grid grid-2">
      {/* バス内デバイス一覧 */}
      <div className="card">
        <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          🚌 バス内のデバイス ({activeDevices.length}台)
        </h3>
        
        <div style={{ 
          marginBottom: '16px', 
          padding: '12px', 
          backgroundColor: '#F0F8FF', 
          borderRadius: '8px',
          fontSize: '14px',
          color: '#1976D2',
          border: '1px solid #E3F2FD'
        }}>
          💡 <strong>判定基準:</strong> RSSI {rssiThreshold}dBm以上 かつ 5分以内の受信
        </div>
        
        {activeDevices.length > 0 ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            {activeDevices.map(device => {
              const latestBleData = device.bleData?.find(ble => ble.beaconId === selectedBeacon);
              const distance = latestBleData ? estimateDistance(latestBleData.rssi) : -1;
              const rssiPercentage = latestBleData ? Math.max(0, Math.min(100, ((latestBleData.rssi + 90) / 60) * 100)) : 0;
              
              return (
                <div
                  key={device.id}
                  style={{
                    padding: '16px',
                    backgroundColor: '#F8F9FA',
                    borderRadius: '8px',
                    border: '2px solid #E8F5E8'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 'bold' }}>
                        {device.name}
                      </h4>
                      {device.deviceId && device.deviceId !== device.name && (
                        <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666', fontFamily: 'monospace' }}>
                          ID: {device.deviceId}
                        </p>
                      )}
                    </div>
                    <div style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      backgroundColor: '#4CAF50'
                    }} />
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
                    <div>
                      <strong>📶 信号強度</strong>
                      <div style={{ marginTop: '4px' }}>
                        <div style={{
                          fontSize: '16px',
                          fontWeight: 'bold',
                          color: latestBleData && latestBleData.rssi >= -60 ? '#4CAF50' : 
                                 latestBleData && latestBleData.rssi >= -70 ? '#FF9800' : '#F44336'
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
                            backgroundColor: latestBleData && latestBleData.rssi >= -60 ? '#4CAF50' : 
                                           latestBleData && latestBleData.rssi >= -70 ? '#FF9800' : '#F44336',
                            borderRadius: '2px'
                          }} />
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <strong>📏 推定距離</strong>
                      <div style={{ marginTop: '4px' }}>
                        <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#333' }}>
                          {distance > 0 ? `${distance.toFixed(1)}m` : 'N/A'}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ marginTop: '12px', fontSize: '12px', color: '#666' }}>
                    🕐 最終受信: {latestBleData ? new Date(latestBleData.timestamp).toLocaleString('ja-JP') : 'N/A'}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📶</div>
            <h4 style={{ margin: '0 0 8px 0' }}>バス内のデバイスはありません</h4>
            <p style={{ margin: 0, fontSize: '14px' }}>
              RSSI {rssiThreshold}dBm以上のデバイスが検出されていません
            </p>
          </div>
        )}
      </div>

      {/* 設定パネル */}
      <div className="card">
        <h3 style={{ marginBottom: '16px' }}>⚙️ 設定</h3>
        
        {/* ビーコン選択 */}
        <div className="form-group">
          <label className="form-label">監視対象ビーコン</label>
          <select
            className="form-select"
            value={selectedBeacon}
            onChange={(e) => setSelectedBeacon(e.target.value)}
          >
            <option value="">選択してください</option>
            {beacons.map(beacon => (
              <option key={beacon.id} value={beacon.id}>
                {beacon.name} {beacon.mac && `(${beacon.mac})`}
              </option>
            ))}
          </select>
          {selectedBeacon && (
            <div style={{ 
              marginTop: '8px', 
              padding: '12px', 
              backgroundColor: '#E8F5E8', 
              borderRadius: '6px',
              fontSize: '14px',
              border: '1px solid #C8E6C9'
            }}>
              <p style={{ margin: '0 0 4px 0', fontWeight: 'bold', color: '#2E7D32' }}>
                ✅ 選択中: {beacons.find(b => b.id === selectedBeacon)?.name}
              </p>
              <p style={{ margin: 0, color: '#666' }}>
                MAC: {beacons.find(b => b.id === selectedBeacon)?.mac || '未設定'}
              </p>
            </div>
          )}
        </div>
        
        {/* RSSI閾値設定 */}
        <div className="form-group">
          <label className="form-label">バス内判定RSSI閾値（dBm）</label>
          <input
            type="number"
            className="form-input"
            value={rssiThreshold}
            onChange={(e) => setRssiThreshold(Number(e.target.value))}
            min={-90}
            max={-30}
            step={5}
          />
          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            この値以上のRSSIでバス内と判定
          </div>
          <div style={{ fontSize: '11px', color: '#888', marginTop: '6px', lineHeight: '1.4' }}>
            💡 <strong>目安値:</strong><br />
            • -50dBm: 約1m（非常に近い）<br />
            • -60dBm: 約2-3m（近い）<br />
            • -70dBm: 約3-5m（標準）<br />
            • -80dBm: 約5-10m（遠い）
          </div>
        </div>
        
        {/* 警告時間設定 */}
        <div className="form-group">
          <label className="form-label">警告までの時間（分）</label>
          <input
            type="number"
            className="form-input"
            value={alertThreshold}
            onChange={(e) => setAlertThreshold(Number(e.target.value))}
            min={1}
            max={10}
          />
          <p style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            1台のみの検知が続く時間の閾値
          </p>
        </div>
        
        {/* 警告有効/無効 */}
        <div className="form-group">
          <label className="form-label">置き去り警告</label>
          <button
            onClick={() => setAlertEnabled(!alertEnabled)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              borderRadius: '25px',
              border: 'none',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              backgroundColor: alertEnabled ? '#4CAF50' : '#E0E0E0',
              color: alertEnabled ? 'white' : '#666',
              transition: 'all 0.3s ease'
            }}
          >
            <div
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                backgroundColor: 'white',
                transition: 'transform 0.3s ease',
                transform: alertEnabled ? 'translateX(0)' : 'translateX(-4px)'
              }}
            />
            {alertEnabled ? '有効' : '無効'}
          </button>
        </div>
        
        {/* 警告音設定 */}
        <div className="form-group">
          <label className="form-label">警告音</label>
          <button
            onClick={() => setAlertSound(!alertSound)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              borderRadius: '25px',
              border: 'none',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              backgroundColor: alertSound ? '#4CAF50' : '#E0E0E0',
              color: alertSound ? 'white' : '#666',
              transition: 'all 0.3s ease'
            }}
          >
            <div
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                backgroundColor: 'white',
                transition: 'transform 0.3s ease',
                transform: alertSound ? 'translateX(0)' : 'translateX(-4px)'
              }}
            />
            {alertSound ? '有効' : '無効'}
          </button>
        </div>

        {/* 通信タイムアウト設定 */}
        <div className="form-group">
          <label className="form-label">通信タイムアウト（分）</label>
          <input
            type="number"
            className="form-input"
            value={connectionTimeout}
            onChange={(e) => setConnectionTimeout(Number(e.target.value))}
            min={1}
            max={60}
          />
          <p style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            この時間内に通信がない場合はオフラインと判定
          </p>
        </div>

        {/* 全デバイス表示切り替え */}
        <div className="form-group">
          <label className="form-label">全デバイス表示</label>
          <button
            onClick={() => setShowAllDevices(!showAllDevices)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              borderRadius: '25px',
              border: 'none',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              backgroundColor: showAllDevices ? '#4CAF50' : '#E0E0E0',
              color: showAllDevices ? 'white' : '#666',
              transition: 'all 0.3s ease'
            }}
          >
            <div
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                backgroundColor: 'white',
                transition: 'transform 0.3s ease',
                transform: showAllDevices ? 'translateX(0)' : 'translateX(-4px)'
              }}
            />
            {showAllDevices ? '表示中' : '非表示'}
          </button>
          <p style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            バス外・オフラインデバイスも表示
          </p>
        </div>

        {/* テスト警告音ボタン */}
        <div className="form-group">
          <button
            onClick={playAlertSound}
            className="btn btn-outline"
            style={{ width: '100%' }}
          >
            🔊 警告音をテスト
          </button>
        </div>
      </div>
    </div>

      {/* 全デバイス通信状況一覧を追加 */}
      <div className="card" style={{ marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            📡 全デバイス通信状況 ({deviceStatusList.length}台)
          </h3>
          <div style={{ fontSize: '12px', color: '#666', textAlign: 'right' }}>
            監視中ビーコン: {selectedBeacon ? beacons.find(b => b.id === selectedBeacon)?.name || '不明' : '未選択'}
          </div>
        </div>

        {/* 通信状況サマリー */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', 
          gap: '12px', 
          marginBottom: '20px',
          padding: '16px',
          backgroundColor: '#F8F9FA',
          borderRadius: '8px'
        }}>
          {['excellent', 'good', 'weak', 'poor', 'offline'].map(status => {
            const count = deviceStatusList.filter(d => d.connectionStatus === status).length;
            const display = getConnectionDisplay(status);
            return (
              <div key={status} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>{display.icon}</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: display.color }}>{count}</div>
                <div style={{ fontSize: '12px', color: '#666' }}>{display.text}</div>
              </div>
            );
          })}
        </div>

        {/* デバイス一覧 */}
        <div style={{ display: 'grid', gap: '12px' }}>
          {deviceStatusList
            .filter(device => showAllDevices || device.connectionStatus !== 'offline')
            .sort((a, b) => {
              // 接続状況順でソート
              const statusOrder: Record<string, number> = { 
                excellent: 0, 
                good: 1, 
                weak: 2, 
                poor: 3, 
                offline: 4 
              };
              return (statusOrder[a.connectionStatus] || 99) - (statusOrder[b.connectionStatus] || 99);
            })
            .map(device => {
              const display = getConnectionDisplay(device.connectionStatus, device.rssiValue || undefined);
              const distance = device.rssiValue ? estimateDistance(device.rssiValue) : -1;
              const isInBus = activeDevices.some(active => active.id === device.id);
              
              return (
                <div
                  key={device.id}
                  style={{
                    padding: '16px',
                    backgroundColor: display.bgColor,
                    borderRadius: '8px',
                    border: `2px solid ${display.color}`,
                    opacity: device.connectionStatus === 'offline' ? 0.7 : 1
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
                          {device.name}
                        </h4>
                        {isInBus && (
                          <span style={{
                            padding: '2px 8px',
                            backgroundColor: '#4CAF50',
                            color: 'white',
                            borderRadius: '12px',
                            fontSize: '10px',
                            fontWeight: 'bold'
                          }}>
                            バス内
                          </span>
                        )}
                      </div>
                      {device.deviceId && device.deviceId !== device.name && (
                        <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666', fontFamily: 'monospace' }}>
                          ID: {device.deviceId}
                        </p>
                      )}
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ fontSize: '24px' }}>{display.icon}</div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '14px', fontWeight: 'bold', color: display.color }}>
                          {display.text}
                        </div>
                        {device.connectionStatus !== 'offline' && device.rssiValue && (
                          <div style={{ fontSize: '12px', color: '#666' }}>
                            {device.rssiValue}dBm
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 信号強度情報 */}
                  {device.connectionStatus !== 'offline' && device.rssiValue ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                      <div>
                        <strong style={{ fontSize: '12px', color: '#666' }}>📶 信号強度</strong>
                        <div style={{ marginTop: '4px' }}>
                          <div style={{ fontSize: '14px', fontWeight: 'bold', color: display.color }}>
                            {device.rssiValue} dBm
                          </div>
                          <div style={{
                            width: '100%',
                            height: '4px',
                            backgroundColor: '#E0E0E0',
                            borderRadius: '2px',
                            marginTop: '2px'
                          }}>
                            <div style={{
                              width: `${getRssiBarWidth(device.rssiValue)}%`,
                              height: '100%',
                              backgroundColor: display.color,
                              borderRadius: '2px'
                            }} />
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <strong style={{ fontSize: '12px', color: '#666' }}>📏 推定距離</strong>
                        <div style={{ marginTop: '4px' }}>
                          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#333' }}>
                            {distance > 0 ? `${distance.toFixed(1)}m` : 'N/A'}
                          </div>
                        </div>
                      </div>

                      <div>
                        <strong style={{ fontSize: '12px', color: '#666' }}>⏱️ 品質</strong>
                        <div style={{ marginTop: '4px' }}>
                          <div style={{ fontSize: '14px', fontWeight: 'bold', color: display.color }}>
                            {(() => {
                              if (device.rssiValue >= -50) return '優秀';
                              if (device.rssiValue >= -60) return '良好';
                              if (device.rssiValue >= -70) return '普通';
                              if (device.rssiValue >= -80) return '弱い';
                              return '貧弱';
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ 
                      padding: '12px', 
                      textAlign: 'center', 
                      backgroundColor: 'rgba(158, 158, 158, 0.1)',
                      borderRadius: '4px',
                      marginBottom: '12px'
                    }}>
                      <div style={{ fontSize: '14px', color: '#666' }}>通信データなし</div>
                    </div>
                  )}

                  {/* 最終通信時間 */}
                  <div style={{ fontSize: '12px', color: '#666', borderTop: '1px solid rgba(0,0,0,0.1)', paddingTop: '8px' }}>
                    {device.lastConnectionTime ? (
                      <>
                        🕐 最終通信: {device.lastConnectionTime.toLocaleString('ja-JP')}
                        {device.timeSinceLastConnection && (
                          <span style={{ marginLeft: '8px' }}>
                            ({Math.floor(device.timeSinceLastConnection / 60000)}分前)
                          </span>
                        )}
                      </>
                    ) : (
                      '🕐 通信履歴なし'
                    )}
                  </div>

                  {/* オフライン警告 */}
                  {device.connectionStatus === 'offline' && device.lastConnectionTime && (
                    <div style={{
                      marginTop: '8px',
                      padding: '8px',
                      backgroundColor: '#FFEBEE',
                      borderRadius: '4px',
                      border: '1px solid #F44336',
                      fontSize: '12px',
                      color: '#D32F2F'
                    }}>
                      ⚠️ 通信が途絶えています。デバイスの状態を確認してください。
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {/* フィルタ結果の表示 */}
        {!showAllDevices && (
          <div style={{ 
            marginTop: '16px', 
            padding: '12px', 
            backgroundColor: '#E3F2FD', 
            borderRadius: '6px',
            fontSize: '14px',
            color: '#1976D2',
            textAlign: 'center'
          }}>
            💡 オフラインデバイス {deviceStatusList.filter(d => d.connectionStatus === 'offline').length}台を非表示中。
            全て表示するには上記の「全デバイス表示」を有効にしてください。
          </div>
        )}
      </div>

      {/* バス外デバイスの参考表示を追加 */}
      {(() => {
        const busOutsideDevices = devices.filter(device => {
          if (!selectedBeacon || !device.bleData) return false;
          const latestBleData = device.bleData.find(ble => ble && ble.beaconId === selectedBeacon);
          if (!latestBleData) return false;

          try {
            const bleTimestamp = new Date(latestBleData.timestamp);
            const timeSinceLastBle = new Date().getTime() - bleTimestamp.getTime();
            const isRecentlyReceived = timeSinceLastBle < 5 * 60 * 1000;
            const isWithinBusRange = latestBleData.rssi >= rssiThreshold;
            
            return isRecentlyReceived && !isWithinBusRange;
          } catch {
            return false;
          }
        });

        if (busOutsideDevices.length > 0) {
          return (
            <div className="card" style={{ marginTop: '16px' }}>
              <h4 style={{ fontSize: '16px', color: '#FF9800', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                📡 バス外参考情報 ({busOutsideDevices.length}台)
              </h4>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
                受信はしているがRSSI {rssiThreshold}dBm未満のデバイス
              </div>
              <div style={{ display: 'grid', gap: '8px' }}>
                {busOutsideDevices.map(device => {
                  const latestBleData = device.bleData?.find(ble => ble && ble.beaconId === selectedBeacon);
                  const distance = latestBleData ? estimateDistance(latestBleData.rssi) : -1;
                  
                  return (
                    <div
                      key={device.id}
                      style={{
                        padding: '12px',
                        backgroundColor: '#FFF8E1',
                        borderRadius: '6px',
                        fontSize: '14px',
                        border: '1px solid #FFE082'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>{device.name}</strong>
                          <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
                            RSSI: {latestBleData?.rssi}dBm
                            {distance > 0 && ` (推定${distance.toFixed(1)}m)`}
                          </div>
                        </div>
                        <div style={{ fontSize: '12px', color: '#FF9800' }}>範囲外</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* 使い方説明を更新 */}
      <div className="card" style={{ marginTop: '24px' }}>
        <h3 style={{ marginBottom: '16px' }}>📖 機能2: バス置き去り検知について</h3>
        
        <div style={{ 
          marginBottom: '20px', 
          padding: '16px', 
          backgroundColor: '#E3F2FD', 
          borderRadius: '8px',
          border: '1px solid #BBDEFB'
        }}>
          <h4 style={{ margin: '0 0 12px 0', color: '#1976D2' }}>🎯 検知の仕組み</h4>
          <ol style={{ paddingLeft: '20px', lineHeight: '1.8', color: '#1976D2', margin: 0 }}>
            <li>バスにビーコンを1台設置し、監視対象として選択</li>
            <li><strong>RSSI閾値でバス内の範囲を定義</strong>（電波強度による距離判定）</li>
            <li>各トラッカーがビーコンからのBLE信号を受信し、リアルタイムで監視</li>
            <li>RSSI閾値以上の信号を受信しているトラッカーが<strong>1台のみ</strong>の状態が設定時間続くと警告</li>
            <li>複数台または0台の場合は正常状態として扱う</li>
          </ol>
        </div>

        <div style={{ 
          padding: '16px', 
          backgroundColor: '#FFF3CD', 
          borderRadius: '8px',
          border: '1px solid #FFE082'
        }}>
          <h4 style={{ margin: '0 0 12px 0', color: '#856404' }}>⚠️ 重要な注意事項</h4>
          <ul style={{ paddingLeft: '20px', lineHeight: '1.6', color: '#856404', margin: 0 }}>
            <li><strong>GPS機能との干渉:</strong> BLE通信中はGPS測位が困難になる場合があります</li>
            <li><strong>環境による影響:</strong> 電波強度は周囲の環境（金属、建物など）により変動します</li>
            <li><strong>閾値の調整:</strong> 実際の運用前に適切なRSSI閾値をテストして設定してください</li>
            <li><strong>緊急時対応:</strong> 警告発生時は必ず目視確認も併用してください</li>
            <li><strong>電池残量:</strong> ビーコンとトラッカーの電池残量を定期的に確認してください</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
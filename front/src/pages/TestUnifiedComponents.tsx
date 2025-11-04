// 統合ダッシュボード（旧テスト環境を簡素化）

import { useState, useEffect, useCallback } from 'react';
import ModeSelector from '../components/unified/ModeSelector';
import ErrorBoundary from '../components/common/ErrorBoundary';
import { Alert, Device, Mode, ModeConfig, RoomLayout, BeaconDevice, GPSPosition } from '../types';
import { 
  collection, 
  getDocs,
  doc,
  getDoc,
  where 
} from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import { db, rtdb } from '../firebase';

// 各モードのダッシュボードコンポーネント
import Mode1Indoor from './Mode1Indoor';
import Mode2Bus from './Mode2Bus';
import Mode3GPS from './Mode3GPS';

export default function Dashboard() {
  // === 基本状態管理 ===
  const [currentMode, setCurrentMode] = useState<Mode>('indoor');
  const [devices, setDevices] = useState<Device[]>([]);
  const [beacons, setBeacons] = useState<BeaconDevice[]>([]);
  const [selectedBeacon, setSelectedBeacon] = useState<string>('');
  const [selectedParentId, setSelectedParentId] = useState<string>('');
  const [maxDistance] = useState<number>(50); // GPS用の最大距離
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // === モード設定 ===
  const modeConfigs: Record<Mode, ModeConfig> = {
    indoor: {
      title: '室内追跡',
      description: 'BLEビーコンを使用した室内位置推定',
      color: '#4A90E2',
      icon: '🏠'
    },
    bus: {
      title: 'バス監視',
      description: 'バス内での置き去り防止システム',
      color: '#FF9800',
      icon: '🚌'
    },
    gps: {
      title: 'GPS追跡',
      description: '屋外での高精度位置追跡',
      color: '#4CAF50',
      icon: '🌍'
    }
  };

  // === Firebase データ取得 ===
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];

    // 🔥 Mode1-3と同じ方式に変更: 初期データはFirestoreから一度だけ取得
    const loadInitialData = async () => {
      try {
        console.log('🔥 初期データ読み込み開始');
        
        // デバイス一覧を一度だけ取得（orderByを削除）
        const devicesSnapshot = await getDocs(collection(db, 'devices'));
        const devicesData = devicesSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            lastUpdate: data.lastUpdate?.toDate?.() || new Date(data.lastUpdate) || new Date(),
            bleData: data.bleData || [],
            position: data.position || null
          } as Device;
        });
        
        console.log('🔥 Firestoreからデバイス取得完了:', devicesData.length, '台');
        setDevices(devicesData);
        
        // 初回読み込み時の親デバイス設定
        if (devicesData.length > 0 && !selectedParentId) {
          const activeDevice = devicesData.find(d => {
            return (
              d.status === 'active' && 
              d.position && 
              d.id && 
              typeof d.id === 'string' && 
              d.id.trim() !== ''
            );
          });
          
          if (activeDevice && activeDevice.id) {
            console.log('🔥 親デバイス自動選択:', activeDevice.id, activeDevice.userName || activeDevice.name);
            setSelectedParentId(activeDevice.id);
          }
        }

        // 🔥 Mode1-3と同じ方式: Realtime Databaseでリアルタイム監視を開始
        devicesData.forEach(device => {
          const normalizedDevEUI = device.devEUI?.toLowerCase();
          if (!normalizedDevEUI) {
            console.warn(`⚠️ ${device.name}: devEUIが設定されていません`);
            return;
          }

          console.log(`📡 ${device.name}(${normalizedDevEUI})のRTDB監視開始`);

          const trackerRef = ref(rtdb, `devices/${normalizedDevEUI}`);
          const unsubscribeRTDB = onValue(trackerRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
              console.log(`📊 ${device.name}のRTDB更新:`, {
                timestamp: data.beaconsUpdatedAt || data.gnssUpdatedAt,
                hasBeacons: !!data.beacons,
                hasGnss: !!data.gnss
              });

              // デバイス情報を更新（Mode1-3と同じパターン）
              setDevices(prevDevices => 
                prevDevices.map(prevDevice => {
                  if (prevDevice.devEUI === device.devEUI) {
                    const updatedDevice = { ...prevDevice };
                    
                    // BLEデータの更新（Mode2と同じ）
                    if (data.beacons) {
                      updatedDevice.bleData = data.beacons
                        .filter((beacon: any) => beacon.mac && beacon.rssi && beacon.rssi !== -1)
                        .map((beacon: any) => ({
                          beaconId: beacon.beaconId || 'unknown',
                          rssi: beacon.rssi,
                          timestamp: data.beaconsUpdatedAt || new Date().toISOString(),
                          mac: beacon.mac.toUpperCase().replace(/:/g, "")
                        }));
                    }
                    
                    // GPS位置の更新（Mode3と同じ）
                    if (data.gnss && typeof data.gnss.lat === 'number' && typeof data.gnss.lon === 'number') {
                      updatedDevice.position = {
                        lat: data.gnss.lat,
                        lon: data.gnss.lon, // 統一してlonを使用
                        timestamp: data.gnss.utc_iso || new Date().toISOString(),
                        accuracy: undefined
                      };
                    }
                    
                    // lastUpdateの更新
                    updatedDevice.lastUpdate = new Date();
                    
                    return updatedDevice;
                  }
                  return prevDevice;
                })
              );
            }
          }, (error) => {
            console.error(`❌ ${device.name}のRTDB監視エラー:`, error);
          });

          unsubscribes.push(unsubscribeRTDB);
        });

        setLoading(false);
        
      } catch (error) {
        console.error('❌ 初期データ読み込みエラー:', error);
        setError('デバイス情報の取得に失敗しました');
        setLoading(false);
      }
    };

    // ビーコン一覧を取得（既存のコードと同じ）
    const loadBeacons = async () => {
      try {
        const beaconsSnapshot = await getDocs(collection(db, 'beacons'));
        const beaconsData = beaconsSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            lastSeen: data.lastSeen || new Date().toISOString()
          } as BeaconDevice;
        });
        
        console.log('🔥 Firebaseからビーコン取得完了:', beaconsData.length, '台');
        setBeacons(beaconsData);
        
        // 初回読み込み時のビーコン設定
        if (beaconsData.length > 0 && !selectedBeacon) {
          const busBeacon = beaconsData.find(b => b.name?.includes('バス') || b.id.includes('bus'));
          setSelectedBeacon(busBeacon?.id || beaconsData[0].id);
        }
      } catch (error) {
        console.error('❌ ビーコン取得エラー:', error);
      }
    };

    // 両方を並行実行
    Promise.all([loadInitialData(), loadBeacons()]);

    // クリーンアップ
    return () => {
      console.log('🔥 RTDB監視クリーンアップ');
      unsubscribes.forEach(unsubscribe => unsubscribe());
    };
  }, []); // 🔥 依存配列を空に変更

  const handleModeChange = useCallback((mode: Mode) => {
    console.log('モード変更:', currentMode, '→', mode);
    setCurrentMode(mode);
  }, [currentMode]);

  // === 状態計算関数 ===
  
  // Mode1: 室内追跡の状態
  const getIndoorStatus = (device: Device) => {
    const hasRecentBleData = device.bleData && device.bleData.length > 0 && 
      device.bleData.some(ble => {
        const timestamp = new Date(ble.timestamp);
        const now = new Date();
        return (now.getTime() - timestamp.getTime()) < 30000; // 30秒以内
      });
    
    if (device.status !== 'active') return { status: 'オフライン', color: '#dc3545', bgColor: '#f8d7da' };
    if (hasRecentBleData) return { status: '室内', color: '#155724', bgColor: '#d4edda' };
    return { status: '不明', color: '#856404', bgColor: '#fff3cd' };
  };

  // Mode2: バス監視の状態
  const getBusStatus = (device: Device) => {
    const selectedBeaconDevice = beacons.find(b => b.id === selectedBeacon);
    const isInBus = device.bleData?.some(ble => 
      selectedBeaconDevice && ble.mac === selectedBeaconDevice.mac && 
      (new Date().getTime() - new Date(ble.timestamp).getTime()) < 180000 // 3分以内に変更
    );
    
    if (device.status !== 'active') return { status: 'オフライン', color: '#dc3545', bgColor: '#f8d7da' };
    if (isInBus) return { status: 'バス内', color: '#155724', bgColor: '#d4edda' };
    return { status: 'バス外', color: '#721c24', bgColor: '#f8d7da' };
  };

  // Mode3: GPS追跡の状態
  const getGpsStatus = (device: Device) => {
    // 基本チェック
    if (device.status !== 'active') {
      return { status: 'オフライン', color: '#dc3545', bgColor: '#f8d7da' };
    }
    
    // デバイス位置チェック
    if (!device.position || !isValidPosition(device.position)) {
      return { status: '位置不明', color: '#856404', bgColor: '#fff3cd' };
    }
    
    // 親デバイス検索
    const parentDevice = devices.find(d => d.id === selectedParentId);
    
    // 親デバイス自身の場合
    if (device.id === selectedParentId) {
      return { status: '親', color: '#dc3545', bgColor: '#ffe6e6' };
    }
    
    // 親デバイスが存在しない、または位置不明の場合
    if (!parentDevice || !parentDevice.position || !isValidPosition(parentDevice.position)) {
      return { status: '親位置不明', color: '#856404', bgColor: '#fff3cd' };
    }

    try {
      // 距離計算（Haversine formula）
      const distance = calculateDistance(parentDevice.position, device.position);
      
      if (isNaN(distance) || distance < 0) {
        return { status: '距離計算エラー', color: '#856404', bgColor: '#fff3cd' };
      }
      
      if (distance > maxDistance) {
        return { status: `離れすぎ (${distance.toFixed(0)}m)`, color: '#721c24', bgColor: '#f8d7da' };
      }
      
      return { status: `安全 (${distance.toFixed(0)}m)`, color: '#155724', bgColor: '#d4edda' };
      
    } catch (error) {
      console.error('GPS状態計算エラー:', error);
      return { status: '計算エラー', color: '#dc3545', bgColor: '#f8d7da' };
    }
  };

  // 🔥 ヘルパー関数を追加
  const isValidPosition = (position: GPSPosition | null | undefined): position is GPSPosition => {
    return position !== null && 
          position !== undefined &&
          typeof position.lat === 'number' && 
          typeof position.lng === 'number' &&
          !isNaN(position.lat) && 
          !isNaN(position.lng) &&
          position.lat >= -90 && position.lat <= 90 &&
          position.lng >= -180 && position.lng <= 180;
  };

  const calculateDistance = (pos1: GPSPosition, pos2: GPSPosition): number => {
    const R = 6371e3; // 地球の半径（メートル）
    const φ1 = pos1.lat * Math.PI/180;
    const φ2 = pos2.lat * Math.PI/180;
    const Δφ = (pos2.lat - pos1.lat) * Math.PI/180;
    const Δλ = (pos2.lon - pos1.lon) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  };

  // 現在のモードに応じた状態取得
  const getDeviceStatus = (device: Device) => {
    switch (currentMode) {
      case 'indoor': return getIndoorStatus(device);
      case 'bus': return getBusStatus(device);
      case 'gps': return getGpsStatus(device);
      default: return { status: '不明', color: '#6c757d', bgColor: '#e9ecef' };
    }
  };

  // === ローディング・エラー表示 ===
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '40px',
          textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <div style={{
            fontSize: '48px',
            marginBottom: '16px'
          }}>⏳</div>
          <h2 style={{ color: '#2c3e50', marginBottom: '8px' }}>データを読み込んでいます...</h2>
          <p style={{ color: '#666', margin: 0 }}>Firebaseからトラッカー情報を取得中</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '40px',
          textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <div style={{
            fontSize: '48px',
            marginBottom: '16px'
          }}>❌</div>
          <h2 style={{ color: '#dc3545', marginBottom: '8px' }}>エラーが発生しました</h2>
          <p style={{ color: '#666', margin: 0 }}>{error}</p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary 
      context="ui"
      onError={(error, errorInfo, errorId) => {
        console.log('Dashboard error:', { error, errorInfo, errorId });
      }}
    >
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
        padding: '20px'
      }}>
        {/* ヘッダー */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <h1 style={{
            fontSize: '28px',
            fontWeight: 'bold',
            color: '#2c3e50',
            marginBottom: '8px',
            textAlign: 'center'
          }}>
            📊 統合ダッシュボード
          </h1>
          <p style={{
            fontSize: '16px',
            color: '#666',
            margin: 0,
            textAlign: 'center'
          }}>
            全モード統合監視システム - リアルタイム更新
          </p>
        </div>

        {/* モード選択 */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <ModeSelector
            currentMode={currentMode}
            onModeChange={handleModeChange}
            modeConfigs={modeConfigs}
            compact={false}
          />
        </div>

        {/* トラッカー状態表示テーブル */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px'
          }}>
            <h2 style={{
              fontSize: '20px',
              fontWeight: 'bold',
              color: modeConfigs[currentMode].color,
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              {modeConfigs[currentMode].icon} 登録トラッカー状態 - {modeConfigs[currentMode].title}モード
            </h2>
            
            {/* リアルタイム更新インジケーター */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: '#666'
            }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#28a745',
                animation: 'pulse 2s infinite'
              }}></div>
              リアルタイム更新中
            </div>
          </div>

          {/* 設定エリア（Mode2とMode3のみ）*/}
          {(currentMode === 'bus' || currentMode === 'gps') && (
            <div style={{
              backgroundColor: '#f8f9fa',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '16px',
              display: 'flex',
              gap: '20px',
              alignItems: 'center'
            }}>
              {currentMode === 'bus' && beacons.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '14px', fontWeight: '600' }}>監視対象ビーコン:</label>
                  <select
                    value={selectedBeacon}
                    onChange={(e) => setSelectedBeacon(e.target.value)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid #ccc',
                      fontSize: '14px'
                    }}
                  >
                    {beacons.map(beacon => (
                      <option key={beacon.id} value={beacon.id}>
                        {beacon.name} ({beacon.mac})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              
              {currentMode === 'gps' && devices.filter(d => d.status === 'active' && d.position && isValidPosition(d.position)).length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '14px', fontWeight: '600' }}>親トラッカー:</label>
                  <select
                    value={selectedParentId}
                    onChange={(e) => setSelectedParentId(e.target.value)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid #ccc',
                      fontSize: '14px'
                    }}
                  >
                    <option value="">選択してください</option>
                    {devices.filter(d => d.status === 'active' && d.position && isValidPosition(d.position)).map(device => (
                      <option key={device.id} value={device.id}>
                        {device.userName || device.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
          
          {devices.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '40px',
              color: '#666',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📱</div>
              <h3 style={{ margin: '0 0 8px 0' }}>トラッカーが登録されていません</h3>
              <p style={{ margin: 0, fontSize: '14px' }}>
                デバイスを登録してからダッシュボードをご利用ください
              </p>
            </div>
          ) : (
            <>
              <div style={{
                border: '1px solid #e1e8ed',
                borderRadius: '8px',
                overflow: 'hidden'
              }}>
                {/* テーブルヘッダー */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr 1fr',
                  backgroundColor: '#f8f9fa',
                  borderBottom: '1px solid #e1e8ed',
                  padding: '12px 16px',
                  fontWeight: '600',
                  fontSize: '14px',
                  color: '#495057'
                }}>
                  <div>トラッカー名</div>
                  <div>デバイス状態</div>
                  <div>{currentMode === 'indoor' ? '室内状態' : currentMode === 'bus' ? 'バス状態' : 'GPS状態'}</div>
                  <div>最終更新</div>
                </div>
                
                {/* テーブル行 */}
                {devices.map((device, index) => {
                  const deviceStatus = getDeviceStatus(device);
                  const isOffline = device.status !== 'active';
                  const lastUpdate = device.lastUpdate ? new Date(device.lastUpdate) : null;
                  const timeSinceUpdate = lastUpdate ? Math.floor((new Date().getTime() - lastUpdate.getTime()) / 1000) : null;
                  
                  return (
                    <div 
                      key={device.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr 1fr',
                        padding: '12px 16px',
                        borderBottom: index < devices.length - 1 ? '1px solid #e1e8ed' : 'none',
                        backgroundColor: index % 2 === 0 ? 'white' : '#f8f9fa',
                        alignItems: 'center'
                      }}
                    >
                      {/* トラッカー名 */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}>
                        <div style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: isOffline ? '#dc3545' : '#28a745'
                        }}></div>
                        <div>
                          <div style={{
                            fontWeight: '600',
                            fontSize: '14px',
                            color: isOffline ? '#6c757d' : '#212529'
                          }}>
                            {device.userName || device.name}
                          </div>
                          <div style={{
                            fontSize: '11px',
                            color: '#999'
                          }}>
                            {device.deviceId}
                          </div>
                        </div>
                      </div>
                      
                      {/* デバイス状態 */}
                      <div>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: '600',
                          backgroundColor: isOffline ? '#f8d7da' : '#d4edda',
                          color: isOffline ? '#721c24' : '#155724'
                        }}>
                          {isOffline ? 'オフライン' : 'オンライン'}
                        </span>
                      </div>
                      
                      {/* モード別状態 */}
                      <div>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: '600',
                          backgroundColor: deviceStatus.bgColor,
                          color: deviceStatus.color
                        }}>
                          {deviceStatus.status}
                        </span>
                      </div>
                      
                      {/* 最終更新 */}
                      <div style={{
                        fontSize: '12px',
                        color: '#6c757d'
                      }}>
                        {lastUpdate ? (
                          <div>
                            <div>{lastUpdate.toLocaleTimeString('ja-JP')}</div>
                            <div style={{ fontSize: '10px', color: '#999' }}>
                              {timeSinceUpdate !== null && (
                                timeSinceUpdate < 60 ? `${timeSinceUpdate}秒前` :
                                timeSinceUpdate < 3600 ? `${Math.floor(timeSinceUpdate / 60)}分前` :
                                timeSinceUpdate < 86400 ? `${Math.floor(timeSinceUpdate / 3600)}時間前` :
                                `${Math.floor(timeSinceUpdate / 86400)}日前`
                              )}
                            </div>
                          </div>
                        ) : (
                          '不明'
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* サマリー情報 */}
              <div style={{
                marginTop: '16px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: '12px'
              }}>
                <div style={{
                  textAlign: 'center',
                  padding: '8px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '6px'
                }}>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: modeConfigs[currentMode].color }}>
                    {devices.length}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>総トラッカー数</div>
                </div>
                
                <div style={{
                  textAlign: 'center',
                  padding: '8px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '6px'
                }}>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#28a745' }}>
                    {devices.filter(d => d.status === 'active').length}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>オンライン</div>
                </div>
                
                <div style={{
                  textAlign: 'center',
                  padding: '8px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '6px'
                }}>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#dc3545' }}>
                    {devices.filter(d => d.status !== 'active').length}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>オフライン</div>
                </div>
                
                <div style={{
                  textAlign: 'center',
                  padding: '8px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '6px'
                }}>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#28a745' }}>
                    {currentMode === 'indoor' ? 
                      devices.filter(d => getIndoorStatus(d).status === '室内').length :
                     currentMode === 'bus' ?
                      devices.filter(d => getBusStatus(d).status === 'バス内').length :
                      devices.filter(d => getGpsStatus(d).status.includes('安全')).length
                    }
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    {currentMode === 'indoor' ? '室内' : currentMode === 'bus' ? 'バス内' : '安全'}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* モード別ダッシュボード */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          minHeight: '600px'
        }}>
          {currentMode === 'indoor' && (
            <div>
              <h2 style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: modeConfigs.indoor.color,
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                {modeConfigs.indoor.icon} {modeConfigs.indoor.title} ダッシュボード
              </h2>
              <Mode1Indoor />
            </div>
          )}
          
          {currentMode === 'bus' && (
            <div>
              <h2 style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: modeConfigs.bus.color,
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                {modeConfigs.bus.icon} {modeConfigs.bus.title} ダッシュボード
              </h2>
              <Mode2Bus />
            </div>
          )}
          
          {currentMode === 'gps' && (
            <div>
              <h2 style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: modeConfigs.gps.color,
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                {modeConfigs.gps.icon} {modeConfigs.gps.title} ダッシュボード
              </h2>
              <Mode3GPS />
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>
    </ErrorBoundary>
  );
}


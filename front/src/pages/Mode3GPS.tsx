import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { collection, getDocs } from 'firebase/firestore';
import { db, rtdb } from '../firebase';
import { MapContainer, TileLayer, Marker, Circle, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { calculateGPSDistance } from '../utils/positioning';

// Leafletのデフォルトアイコンの問題を修正
import 'leaflet/dist/leaflet.css';

// デフォルトアイコンの修正
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// 型定義
interface TrackerDevice {
  id: string;
  deviceId?: string;
  devEUI?: string;
  name: string;
  userName?: string;
  bleData?: any[];
  position?: {
    lat: number;
    lon: number;
    timestamp?: string;
    accuracy?: number;
  };
  lastUpdate?: Date;
}

// アイコンの定義
const parentIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const childIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const alertIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

export default function Mode3GPS() {
  const [trackers, setTrackers] = useState<TrackerDevice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [parentTrackers, setParentTrackers] = useState<string[]>([]);
  const [maxDistance, setMaxDistance] = useState(30);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [alertSound, setAlertSound] = useState(true);
  const [mapCenter, setMapCenter] = useState({ lat: 38.2559, lon: 140.8398 });

  // 初期データ読み込みとクリーンアップ
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    
    const initializeGPS = async () => {
      await loadDevicesAndGPS();
    };
    
    initializeGPS();

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, []);

  // デバイス一覧とGPS情報を読み込み
  const loadDevicesAndGPS = async () => {
    try {
      setIsLoading(true);
      
      // 1. Firestoreからデバイス一覧を取得（Mode2と同じ方式）
      const devicesSnapshot = await getDocs(collection(db, 'devices'));
      const devicesList: TrackerDevice[] = devicesSnapshot.docs.map(doc => {
        const raw = doc.data() as any;
        return {
          id: doc.id,
          deviceId: raw.deviceId || doc.id,
          devEUI: raw.devEUI,
          name: raw.userName || raw.deviceId || doc.id,
          userName: raw.userName,
          bleData: Array.isArray(raw.bleData) ? raw.bleData : [], // Mode2との互換性
        };
      });

      console.log('✅ デバイス一覧取得完了:', devicesList.length, '台');
      
      // 2. 各デバイスのGPS情報をRealtimeDatabaseから取得
      const trackersWithGPS: TrackerDevice[] = [];
      
      for (const device of devicesList) {
        try {
          const gpsData = await getDeviceGPS(device.devEUI);
          const trackerWithGPS: TrackerDevice = {
            ...device,
            position: gpsData || undefined,
            lastUpdate: gpsData ? new Date(gpsData.timestamp || Date.now()) : undefined
          };
          trackersWithGPS.push(trackerWithGPS);
        } catch (error) {
          console.error(`❌ ${device.name} GPS取得失敗:`, error);
          // GPS取得失敗でもデバイス情報は保持
          trackersWithGPS.push({
            ...device,
            position: undefined,
            lastUpdate: undefined
          });
        }
      }

      // 3. 状態を更新
      setTrackers(trackersWithGPS);

      // 4. マップ中心位置の設定
      const validTrackers = trackersWithGPS.filter(tracker => tracker.position);
      if (validTrackers.length > 0) {
        const avgLat = validTrackers.reduce((sum, t) => sum + (t.position!.lat), 0) / validTrackers.length;
        const avgLon = validTrackers.reduce((sum, t) => sum + (t.position!.lon), 0) / validTrackers.length;
        setMapCenter({ lat: avgLat, lon: avgLon });
        console.log('📍 マップ中心設定:', { lat: avgLat, lon: avgLon });
      }

      console.log('✅ GPS情報取得完了:', validTrackers.length, '/', trackersWithGPS.length, '台');
      
      // 5. リアルタイム監視を開始
      setupRealtimeGPSMonitoring(devicesList);
      
    } catch (error) {
      console.error('❌ デバイス・GPS情報取得エラー:', error);
      // エラー時は空配列を設定
      setTrackers([]);
    } finally {
      setIsLoading(false);
    }
  };

  // 個別デバイスのGPS情報を取得（実際の構造に対応）
  const getDeviceGPS = (devEUI?: string): Promise<{lat: number, lon: number, timestamp: string, accuracy?: number} | null> => {
    return new Promise((resolve) => {
      if (!devEUI) {
        console.log('⚠️ devEUIが未設定');
        resolve(null);
        return;
      }

      const normalizedDevEUI = devEUI.toLowerCase();
      // 🔥 修正: gnss部分のみ監視
      const gnssRef = ref(rtdb, `devices/${normalizedDevEUI}/gnss`);
      
      let resolved = false;
      let unsubscribe: (() => void) | null = null;
      
      // タイムアウト設定（5秒）
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (unsubscribe) unsubscribe();
          console.log(`⏰ ${devEUI}: GPS取得タイムアウト`);
          resolve(null);
        }
      }, 5000);
      
      unsubscribe = onValue(gnssRef, (snapshot) => {
        if (resolved) return;
        
        try {
          const gnssData = snapshot.val();
          
          // 🔥 修正: 実際のフィールド名に変更（lon, utc_iso）
          if (gnssData && typeof gnssData.lat === 'number' && typeof gnssData.lon === 'number') {
            resolved = true;
            clearTimeout(timeout);
            if (unsubscribe) unsubscribe();
            
            console.log(`📍 ${devEUI} GPS取得成功:`, {
              lat: gnssData.lat,
              lon: gnssData.lon,
              utc_iso: gnssData.utc_iso
            });
            
            resolve({
              lat: gnssData.lat,
              lon: gnssData.lon, // フロントエンドでは統一してlonを使用
              timestamp: gnssData.utc_iso || new Date().toISOString(),
              accuracy: undefined // accuracyは存在しない
            });
          } else {
            resolved = true;
            clearTimeout(timeout);
            if (unsubscribe) unsubscribe();
            console.log(`📍 ${devEUI}: GNSS情報なし`);
            resolve(null);
          }
        } catch (error) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            if (unsubscribe) unsubscribe();
            console.error(`❌ ${devEUI} GNSS解析エラー:`, error);
            resolve(null);
          }
        }
      }, (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          if (unsubscribe) unsubscribe();
          console.error(`❌ ${devEUI} Firebase接続エラー:`, error);
          resolve(null);
        }
      });
    });
  };

  // リアルタイムGPS監視（実際の構造に対応）
  const setupRealtimeGPSMonitoring = (devicesList: TrackerDevice[]) => {
    const unsubscribers = devicesList.map(device => {
      if (!device.devEUI) {
        console.log(`⚠️ ${device.name}: devEUIなし、監視スキップ`);
        return null;
      }

      const normalizedDevEUI = device.devEUI.toLowerCase();
      // 🔥 修正: gnss部分のみ監視
      const gnssRef = ref(rtdb, `devices/${normalizedDevEUI}/gnss`);
      
      console.log(`🔄 ${device.name} GNSS専用監視開始`);
      
      return onValue(gnssRef, (snapshot) => {
        try {
          const gnssData = snapshot.val();
          
          // 🔥 修正: 実際のフィールド名に変更（lon, utc_iso）
          if (gnssData && typeof gnssData.lat === 'number' && typeof gnssData.lon === 'number') {
            // GPS情報が更新された場合、該当デバイスを更新
            setTrackers(prevTrackers => {
              const updatedTrackers = prevTrackers.map(tracker => 
                tracker.devEUI === device.devEUI 
                  ? {
                      ...tracker,
                      position: {
                        lat: gnssData.lat,
                        lon: gnssData.lon, // フロントエンドでは統一してlonを使用
                        timestamp: gnssData.utc_iso || new Date().toISOString(),
                        accuracy: undefined // accuracyは存在しない
                      },
                      lastUpdate: new Date()
                    }
                  : tracker
              );
              
              console.log(`🔄 ${device.name} GNSS更新:`, {
                lat: gnssData.lat,
                lon: gnssData.lon,
                utc_iso: gnssData.utc_iso
              });
              return updatedTrackers;
            });
          }
        } catch (error) {
          console.error(`❌ ${device.name} GNSS監視エラー:`, error);
        }
      }, (error) => {
        console.error(`❌ ${device.name} GNSS監視接続エラー:`, error);
      });
    }).filter(Boolean);

    console.log(`✅ ${unsubscribers.length}台のGNSS専用監視開始`);

    // クリーンアップ関数を返す
    return () => {
      console.log('🔄 GNSS専用監視停止');
      unsubscribers.forEach(unsub => unsub && unsub());
    };
  };

  // 距離チェック
  useEffect(() => {
    if (alertEnabled) {
      checkDistances();
    }
  }, [trackers, parentTrackers, maxDistance, alertEnabled]);

  // checkDistances関数を完全に書き直し

  const checkDistances = () => {
    const newAlerts: string[] = [];
    
    // 最初にGPS情報があるデバイスのみフィルタリング
    const parentsWithGPS = trackers.filter(t => 
      parentTrackers.includes(t.id) && t.position
    );
    const childrenWithGPS = trackers.filter(t => 
      !parentTrackers.includes(t.id) && t.position
    );

    // 親トラッカーが1台以上ある場合のみ処理
    if (parentsWithGPS.length === 0) {
      console.log('⚠️ GPS情報を持つ親トラッカーがありません');
      setAlerts([]);
      return;
    }

    childrenWithGPS.forEach(child => {
      // 各子トラッカーについて、最も近い親との距離を計算
      const distances: { parent: TrackerDevice; distance: number }[] = [];

      parentsWithGPS.forEach(parent => {
        try {
          const distance = calculateGPSDistance(
            parent.position!.lat,
            parent.position!.lon,
            child.position!.lat,
            child.position!.lon
          );
          
          // 有効な距離が計算できた場合のみ記録
          if (!isNaN(distance) && distance >= 0) {
            distances.push({ parent, distance });
          }
        } catch (error) {
          console.error(`❌ ${child.name} と ${parent.name} の距離計算エラー:`, error);
        }
      });

      // 最も近い親を見つける
      if (distances.length > 0) {
        const nearest = distances.reduce((min, current) => 
          current.distance < min.distance ? current : min
        );

        // 距離が閾値を超えている場合は警告
        if (nearest.distance > maxDistance) {
          newAlerts.push(
            `🚨 ${child.name} が ${nearest.parent.name} から ${nearest.distance.toFixed(0)}m 離れています！`
          );
        }
      } else {
        console.warn(`⚠️ ${child.name}: 有効な親トラッカーとの距離を計算できませんでした`);
      }
    });

    setAlerts(newAlerts);

    // 警告音再生
    if (newAlerts.length > 0 && alertSound) {
      playAlertSound();
    }
  };

  // 警告音再生
  const playAlertSound = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
      console.error('❌ 警告音再生エラー:', error);
    }
  };

  // 子トラッカーが離れすぎているかチェック
  const isChildTooFar = (trackerId: string): boolean => {
    const child = trackers.find(t => t.id === trackerId);
    
    // 基本条件チェック
    if (!child || !child.position || parentTrackers.includes(trackerId)) {
      return false;
    }

    // GPS情報を持つ親トラッカーのみフィルタリング
    const parentsWithGPS = trackers.filter(t => 
      parentTrackers.includes(t.id) && t.position
    );
    
    // 親トラッカーが1台以上ある場合のみ処理
    if (parentsWithGPS.length === 0) {
      return false;
    }

    let minDistance = Infinity;
    let hasValidDistance = false;
    
    parentsWithGPS.forEach(parent => {
      try {
        // この時点でparent.positionは確実に存在
        const distance = calculateGPSDistance(
          parent.position!.lat,
          parent.position!.lon,
          child.position!.lat,
          child.position!.lon
        );
        
        // 有効な距離が計算できた場合のみ更新
        if (!isNaN(distance) && distance >= 0) {
          hasValidDistance = true;
          if (distance < minDistance) {
            minDistance = distance;
          }
        }
      } catch (error) {
        console.error(`❌ ${child.name} の距離計算エラー:`, error);
      }
    });

    // 有効な距離が計算できて、かつ閾値を超えている場合のみtrue
    return hasValidDistance && minDistance > maxDistance && minDistance !== Infinity;
  };

  // ローディング画面
  if (isLoading) {
    return (
      <div className="container">
        <div className="card">
          <h2>🔄 GPS情報を読み込み中...</h2>
          <p>デバイスの位置情報を取得しています。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
        🌍 機能3: 屋外GPS追跡
      </h1>

      {/* 警告表示 */}
      {alerts.map((alert, index) => (
        <div key={index} className="alert alert-danger" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>⚠️ 警告</strong>
              <p style={{ marginTop: '8px', margin: 0 }}>{alert}</p>
            </div>
            <button
              onClick={() => setAlerts(alerts.filter((_, i) => i !== index))}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'white',
                fontSize: '24px',
                cursor: 'pointer'
              }}
            >
              ×
            </button>
          </div>
        </div>
      ))}

      {/* リアルタイム位置追跡マップ */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>📍 リアルタイム位置追跡</h2>
        <div style={{ height: '500px', borderRadius: '12px', overflow: 'hidden' }}>
          <MapContainer
            center={[mapCenter.lat, mapCenter.lon]}
            zoom={16}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            
            {/* 親トラッカーとその検知範囲 */}
            {trackers.filter(t => parentTrackers.includes(t.id) && t.position).map(tracker => (
              <div key={tracker.id}>
                <Marker position={[tracker.position!.lat, tracker.position!.lon]} icon={parentIcon}>
                  <Popup>
                    <div>
                      <strong>{tracker.name}</strong><br />
                      🔵 親トラッカー<br />
                      📡 検知範囲: {maxDistance}m<br />
                      🕐 更新: {tracker.lastUpdate?.toLocaleTimeString('ja-JP') || 'N/A'}
                      {tracker.position?.accuracy && (
                        <><br />📍 精度: ±{tracker.position.accuracy}m</>
                      )}
                    </div>
                  </Popup>
                </Marker>
                <Circle
                  center={[tracker.position!.lat, tracker.position!.lon]}
                  radius={maxDistance}
                  pathOptions={{ color: '#4A90E2', fillColor: '#4A90E2', fillOpacity: 0.1 }}
                />
              </div>
            ))}

            {/* 子トラッカー */}
            {trackers.filter(t => !parentTrackers.includes(t.id) && t.position).map(tracker => {
              const tooFar = isChildTooFar(tracker.id);
              const parent = trackers.find(t => parentTrackers.includes(t.id) && t.position);
              
              return (
                <div key={tracker.id}>
                  <Marker
                    position={[tracker.position!.lat, tracker.position!.lon]}
                    icon={tooFar ? alertIcon : childIcon}
                  >
                    <Popup>
                      <div>
                        <strong>{tracker.name}</strong><br />
                        {tooFar ? '🔴 子トラッカー（警告）' : '🟢 子トラッカー（正常）'}<br />
                        🕐 更新: {tracker.lastUpdate?.toLocaleTimeString('ja-JP') || 'N/A'}
                        {tracker.position?.accuracy && (
                          <><br />📍 精度: ±{tracker.position.accuracy}m</>
                        )}
                        {tooFar && <><br /><span style={{ color: '#E74C3C' }}>⚠️ 親から離れすぎています</span></>}
                      </div>
                    </Popup>
                  </Marker>
                  
                  {/* 親との接続線 */}
                  {parent && parent.position && (
                    <Polyline
                      positions={[
                        [parent.position.lat, parent.position.lon],
                        [tracker.position!.lat, tracker.position!.lon]
                      ]}
                      pathOptions={{
                        color: tooFar ? '#E74C3C' : '#4A90E2',
                        weight: 2,
                        dashArray: '5, 10'
                      }}
                    />
                  )}
                </div>
              );
            })}
          </MapContainer>
        </div>
      
        {/* GPS情報サマリー */}
        <div style={{ 
          marginTop: '12px', 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', 
          gap: '12px',
          fontSize: '14px',
          color: '#666'
        }}>
          <div>📍 追跡中: {trackers.filter(t => t.position).length}台</div>
          <div>🔵 親トラッカー: {trackers.filter(t => parentTrackers.includes(t.id)).length}台</div>
          <div>🟢 子トラッカー: {trackers.filter(t => !parentTrackers.includes(t.id)).length}台</div>
          <div>⚠️ 警告中: {trackers.filter(t => !parentTrackers.includes(t.id) && isChildTooFar(t.id)).length}台</div>
        </div>
      </div>

      {/* 既存のトラッカー一覧と設定パネル */}
      <div className="grid grid-2">
        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>📱 トラッカー一覧</h3>
          {trackers.length > 0 ? trackers.map(tracker => {
            const isParent = parentTrackers.includes(tracker.id);
            const tooFar = !isParent && isChildTooFar(tracker.id);
            
            return (
              <div
                key={tracker.id}
                style={{
                  padding: '16px',
                  borderBottom: '1px solid #e1e8ed',
                  backgroundColor: tooFar ? '#FFEBEE' : (isParent ? '#E3F2FD' : '#F8F9FA')
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <strong style={{ fontSize: '16px' }}>{tracker.name}</strong>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        backgroundColor: isParent ? '#2196F3' : '#4CAF50',
                        color: 'white'
                      }}>
                        {isParent ? '親' : '子'}
                      </span>
                      {tooFar && (
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '10px',
                          fontWeight: 'bold',
                          backgroundColor: '#F44336',
                          color: 'white'
                        }}>
                          警告
                        </span>
                      )}
                    </div>
                    
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                      ID: {tracker.deviceId || tracker.id}
                    </div>
                    
                    {tracker.position ? (
                      <div style={{ fontSize: '12px', color: '#666' }}>
                        📍 GPS取得済み
                        {tracker.lastUpdate && (
                          <span style={{ marginLeft: '8px' }}>
                            更新: {tracker.lastUpdate.toLocaleTimeString('ja-JP')}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#999' }}>
                        📭 GPS待機中
                      </div>
                    )}
                  </div>
                  
                  <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={isParent}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setParentTrackers([...parentTrackers, tracker.id]);
                          } else {
                            setParentTrackers(parentTrackers.filter(id => id !== tracker.id));
                          }
                        }}
                        style={{ transform: 'scale(1.2)' }}
                      />
                      親に設定
                    </label>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📱</div>
              <h4 style={{ margin: '0 0 8px 0' }}>トラッカーがありません</h4>
              <p style={{ margin: 0, fontSize: '14px' }}>
                Firestoreにデバイスが登録されていません
              </p>
            </div>
          )}
        </div>

        {/* 既存の設定パネル */}
        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>⚙️ 設定</h3>
          <div className="form-group">
            <label className="form-label">
              最大距離（メートル）
            </label>
            <input
              type="number"
              className="form-input"
              value={maxDistance}
              onChange={(e) => setMaxDistance(Number(e.target.value))}
              min={10}
              max={100}
              step={5}
            />
            <p style={{ fontSize: '12px', marginTop: '4px', color: '#7f8c8d' }}>
              親トラッカーからこの距離を超えると警告します
            </p>
          </div>
          <div className="form-group">
            <label className="form-label">位置逸脱警告</label>
            <button
              onClick={() => setAlertEnabled(!alertEnabled)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '20px',
                border: 'none',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                backgroundColor: alertEnabled ? '#50C878' : '#E0E0E0',
                color: alertEnabled ? 'white' : '#666'
              }}
            >
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: 'white',
                  transition: 'transform 0.3s ease'
                }}
              />
              {alertEnabled ? '有効' : '無効'}
            </button>
          </div>
          <div className="form-group">
            <label className="form-label">警告音</label>
            <button
              onClick={() => setAlertSound(!alertSound)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '20px',
                border: 'none',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                backgroundColor: alertSound ? '#50C878' : '#E0E0E0',
                color: alertSound ? 'white' : '#666'
              }}
            >
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: 'white',
                  transition: 'transform 0.3s ease'
                }}
              />
              {alertSound ? '有効' : '無効'}
            </button>
          </div>
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

      {/* 使い方説明 */}
      <div className="card" style={{ marginTop: '24px' }}>
        <h3 style={{ marginBottom: '16px' }}>📖 使い方</h3>
        <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>保護者（親）が持つトラッカーを「親トラッカー」として設定します</li>
          <li>子どもが持つトラッカーは自動的に「子トラッカー」になります</li>
          <li>子トラッカーが親トラッカーから設定距離（デフォルト30m）以上離れると警告します</li>
          <li>複数の親トラッカーを設定できます（いずれかの親から離れると警告）</li>
          <li>リアルタイムでGPS位置情報が更新され、距離を監視します</li>
        </ol>
      </div>
    </div>
  );
}

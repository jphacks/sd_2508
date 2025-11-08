import { useState, useEffect, useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { MapContainer, TileLayer, Marker, Circle, Popup, Polyline, Tooltip, useMapEvent } from 'react-leaflet';
import L from 'leaflet';
import { calculateGPSDistance } from '../utils/positioning';

// 共通typesから使用
import { Device } from '../types';

// Leafletのデフォルトアイコンの問題を修正
import 'leaflet/dist/leaflet.css';

// デフォルトアイコンの修正（変更なし）
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// 重複するTrackerDevice型定義を削除し、共通Device型を使用
type TrackerDevice = Device;

// TestUnifiedComponentsからのデータを受け取るためのProps
interface Mode3Props {
  devices?: Device[];                 // 外部から渡されるデバイスデータ
  parentTrackers?: string[];          // 選択された親トラッカー一覧（外部管理）
  onParentTrackersChange?: (ids: string[]) => void; // 親トラッカー変更コールバック
  baseLocation?: { lat: number; lon: number } | null; // 基準位置
  onBaseLocationChange?: (location: { lat: number; lon: number } | null) => void; // 基準位置変更コールバック
  baseLocationDistance?: number;
  onBaseLocationDistanceChange?: (distance: number) => void; // 基準位置距離変更コールバック
}

// アイコンの定義（変更なし）
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

const baseLocationIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-violet.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// ズームレベル変化をリッスンするコンポーネント
function MapZoomListener({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  useMapEvent('zoomend', (e) => {
    onZoomChange(e.target.getZoom());
  });
  
  useMapEvent('zoom', (e) => {
    onZoomChange(e.target.getZoom());
  });
  
  return null;
}

export default function Mode3GPS({ 
  devices: externalDevices, 
  parentTrackers: externalParentTrackers = [], 
  onParentTrackersChange,
  baseLocation: externalBaseLocation = null,
  onBaseLocationChange,
  baseLocationDistance: externalBaseLocationDistance = 50,
  onBaseLocationDistanceChange
}: Mode3Props) {
  // 重複するstate管理を削除し、必要最小限に
  const [trackers, setTrackers] = useState<TrackerDevice[]>(externalDevices || []);
  const [isLoading, setIsLoading] = useState(true);
  const [parentTrackers, setParentTrackers] = useState<string[]>(externalParentTrackers);
  const [maxDistance, setMaxDistance] = useState(30);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [mapCenter, setMapCenter] = useState({ lat: 38.2559, lon: 140.8398 });
  const [zoomLevel, setZoomLevel] = useState(16);
  const [baseLocation, setBaseLocation] = useState<{ lat: number; lon: number } | null>(externalBaseLocation);
  const [baseLocationDistance, setBaseLocationDistance] = useState(externalBaseLocationDistance);
  const [isSettingBaseLocation, setIsSettingBaseLocation] = useState(false);

  // 重複するuseEffectを削除し、外部データ依存に変更
  useEffect(() => {
    if (externalDevices) {
      // 外部データが渡されている場合は重複読み込みをスキップ
      setTrackers(externalDevices);
      setIsLoading(false);
      
      // マップ中心位置の設定
      const validTrackers = externalDevices.filter(tracker => tracker.position);
      if (validTrackers.length > 0) {
        const avgLat = validTrackers.reduce((sum, t) => sum + (t.position!.lat), 0) / validTrackers.length;
        const avgLon = validTrackers.reduce((sum, t) => sum + (t.position!.lon), 0) / validTrackers.length;
        setMapCenter({ lat: avgLat, lon: avgLon });
      }
    } else {
      // 従来の独立読み込み（TestUnifiedComponents以外から使用される場合）
      loadDevicesAndGPS();
    }
  }, [externalDevices]);

  // 外部データの更新を反映
  useEffect(() => {
    if (externalDevices) {
      setTrackers(externalDevices);
    }
  }, [externalDevices]);

  // 重複するloadDevicesAndGPS関数を簡素化（独立使用時のみ）
  const loadDevicesAndGPS = async () => {
    try {
      setIsLoading(true);
      
      // Firestoreからデバイス一覧を取得のみ（GPS監視はTestUnifiedComponentsが担当）
      const devicesSnapshot = await getDocs(collection(db, 'devices'));
      const devicesList: TrackerDevice[] = devicesSnapshot.docs.map(doc => {
        const raw = doc.data() as any;
        return {
          id: doc.id,
          deviceId: raw.deviceId || doc.id,
          devEUI: raw.devEUI,
          name: raw.userName || raw.deviceId || doc.id,
          userName: raw.userName,
          bleData: Array.isArray(raw.bleData) ? raw.bleData : [],
          position: raw.position || null,
          lastUpdate: raw.lastUpdate || null,
          statusData: null
        };
      });

      setTrackers(devicesList);
      
    } catch (error) {
      console.error('デバイス情報取得エラー:', error);
      setTrackers([]);
    } finally {
      setIsLoading(false);
    }
  };

  // 距離チェック（変更なし）
  useEffect(() => {
    if (alertEnabled) {
      checkDistances();
    }
  }, [trackers, parentTrackers, maxDistance, alertEnabled]);

  // checkDistances関数（変更なし）
  const checkDistances = () => {
    const newAlerts: string[] = [];
    
    const parentsWithGPS = trackers.filter(t => 
      parentTrackers.includes(t.id) && t.position
    );
    const childrenWithGPS = trackers.filter(t => 
      !parentTrackers.includes(t.id) && t.position
    );

    if (parentsWithGPS.length === 0) {
      setAlerts([]);
      return;
    }

    childrenWithGPS.forEach(child => {
      const distances: { parent: TrackerDevice; distance: number }[] = [];

      parentsWithGPS.forEach(parent => {
        try {
          const distance = calculateGPSDistance(
            parent.position!.lat,
            parent.position!.lon,
            child.position!.lat,
            child.position!.lon
          );
          
          if (!isNaN(distance) && distance >= 0) {
            distances.push({ parent, distance });
          }
        } catch (error) {
          console.error(`${child.name} と ${parent.name} の距離計算エラー:`, error);
        }
      });

      if (distances.length > 0) {
        const nearest = distances.reduce((min, current) => 
          current.distance < min.distance ? current : min
        );

        if (nearest.distance > maxDistance) {
          newAlerts.push(
            `🚨 ${child.name} が ${nearest.parent.name} から ${nearest.distance.toFixed(0)}m 離れています！`
          );
        }
      }
    });

    setAlerts(newAlerts);
  };

  // ズームレベルに応じたフォントサイズを計算
  const getTooltipFontSize = (): number => {
    // ズームレベルが高いほど大きく、低いほど小さくなるように調整
    // ズームレベル16の時は12px、ズームレベル12の時は8px、18の時は14px
    const baseFontSize = 12;
    const zoomDifference = zoomLevel - 16;
    return Math.max(8, baseFontSize + (zoomDifference * 0.5));
  };

  // 子トラッカーが離れすぎているかチェック（変更なし）
  const isChildTooFar = (trackerId: string): boolean => {
    const child = trackers.find(t => t.id === trackerId);
    
    if (!child || !child.position || parentTrackers.includes(trackerId)) {
      return false;
    }

    const parentsWithGPS = trackers.filter(t => 
      parentTrackers.includes(t.id) && t.position
    );
    
    if (parentsWithGPS.length === 0) {
      return false;
    }

    let minDistance = Infinity;
    let hasValidDistance = false;
    
    parentsWithGPS.forEach(parent => {
      try {
        const distance = calculateGPSDistance(
          parent.position!.lat,
          parent.position!.lon,
          child.position!.lat,
          child.position!.lon
        );
        
        if (!isNaN(distance) && distance >= 0) {
          hasValidDistance = true;
          if (distance < minDistance) {
            minDistance = distance;
          }
        }
      } catch (error) {
        console.error(`${child.name} の距離計算エラー:`, error);
      }
    });

    return hasValidDistance && minDistance > maxDistance && minDistance !== Infinity;
  };

  useEffect(() => {
    setParentTrackers(externalParentTrackers);
  }, [externalParentTrackers]);

  // 外部の基準位置設定を反映
  useEffect(() => {
    setBaseLocation(externalBaseLocation);
  }, [externalBaseLocation]);

  useEffect(() => {
    setBaseLocationDistance(externalBaseLocationDistance);
  }, [externalBaseLocationDistance]);

  // 親トラッカー変更時に外部へ通知
  const handleParentTrackerToggle = useCallback((trackerId: string) => {
    setParentTrackers(prev => {
      const newParents = prev.includes(trackerId)
        ? prev.filter(id => id !== trackerId)
        : [...prev, trackerId];
      
      // 外部コールバックがあれば通知
      if (onParentTrackersChange) {
        onParentTrackersChange(newParents);
      }
      
      return newParents;
    });
  }, [onParentTrackersChange]);

  const MapClickHandler = () => {
    useMapEvent('click', (e) => {
      if (isSettingBaseLocation) {
        const newLocation = { lat: e.latlng.lat, lon: e.latlng.lng };
        setBaseLocation(newLocation);
        if (onBaseLocationChange) {
          onBaseLocationChange(newLocation);
        }
        setIsSettingBaseLocation(false);
      }
    });
    return null;
  };

  // UI部分は変更なし（レンダリング部分）
  if (isLoading) {
    return (
      <div className="container">
        <div className="card">
          <h2>GPS情報を読み込み中...</h2>
          <p>デバイスの位置情報を取得しています。</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* 機能見出しは不要のため削除 */}

      {/* 警告表示 */}
      {alerts.map((alert, index) => (
        <div key={index} className="alert alert-danger" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>警告</strong>
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

      {/* 設定パネルとマップの横並びレイアウト */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '3fr 7fr', 
        gap: '24px', 
        marginBottom: '24px', 
        alignItems: 'start' 
      }}>
        {/* 設定パネル（左側） */}
        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>設定</h3>
          
          {/* 親トラッカー選択 */}
          <div className="form-group">
            <label className="form-label">親トラッカー選択</label>
            <p style={{ fontSize: '12px', color: '#7f8c8d', marginBottom: '12px' }}>
              保護者が持つトラッカーを選択してください
            </p>
            {trackers.length > 0 ? (
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '8px',
                maxHeight: '200px',
                overflowY: 'auto',
                padding: '8px',
                border: '1px solid #e1e8ed',
                borderRadius: '8px',
                backgroundColor: '#f8f9fa'
              }}>
                {trackers.map(tracker => {
                  const isParent = parentTrackers.includes(tracker.id);
                  return (
                    <label 
                      key={tracker.id}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        padding: '8px',
                        backgroundColor: isParent ? '#E3F2FD' : 'white',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isParent}
                        onChange={(e) => {
                          // if (e.target.checked) {
                          //   setParentTrackers([...parentTrackers, tracker.id]);
                          // } else {
                          //   setParentTrackers(parentTrackers.filter(id => id !== tracker.id));
                          // }
                          handleParentTrackerToggle(tracker.id);
                        }}
                        style={{ transform: 'scale(1.2)' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: '500' }}>{tracker.name}</div>
                        <div style={{ fontSize: '11px', color: '#666' }}>ID: {tracker.deviceId || tracker.id}</div>
                      </div>
                      {isParent && (
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '10px',
                          fontWeight: 'bold',
                          backgroundColor: '#2196F3',
                          color: 'white'
                        }}>
                          親
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            ) : (
              <div style={{ 
                padding: '16px', 
                textAlign: 'center', 
                color: '#999',
                backgroundColor: '#f8f9fa',
                borderRadius: '8px'
              }}>
                トラッカーがありません
              </div>
            )}
          </div>

          {/* 親トラッカー設定時のみ表示 */}
          {parentTrackers.length > 0 && (
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
          )}

          {/* 基準位置設定（親トラッカー未設定時のみ表示） */}
          {parentTrackers.length === 0 && (
            <>
              <div className="form-group">
                <label className="form-label">基準位置設定</label>
                <p style={{ fontSize: '12px', color: '#7f8c8d', marginBottom: '8px' }}>
                  マップをクリックして基準位置を設定できます
                </p>
                <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                  <button
                    onClick={() => setIsSettingBaseLocation(!isSettingBaseLocation)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      backgroundColor: isSettingBaseLocation ? '#FF9800' : '#4A90E2',
                      color: 'white',
                      transition: 'all 0.2s'
                    }}
                  >
                    {isSettingBaseLocation ? 'マップをクリック' : '基準位置を設定'}
                  </button>
                  {baseLocation && (
                    <button
                      onClick={() => {
                        setBaseLocation(null);
                        if (onBaseLocationChange) {
                          onBaseLocationChange(null);
                        }
                      }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #E74C3C',
                        fontSize: '12px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        backgroundColor: 'white',
                        color: '#E74C3C'
                      }}
                    >
                      基準位置をクリア
                    </button>
                  )}
                </div>
                {baseLocation && (
                  <div style={{ 
                    marginTop: '8px', 
                    padding: '8px', 
                    backgroundColor: '#f8f9fa', 
                    borderRadius: '6px',
                    fontSize: '12px'
                  }}>
                    位置情報： {baseLocation.lat.toFixed(6)}, {baseLocation.lon.toFixed(6)}
                  </div>
                )}
              </div>

              {baseLocation && (
                <div className="form-group">
                  <label className="form-label">
                    基準位置からの距離（メートル）
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    value={baseLocationDistance}
                    onChange={(e) => {
                      const distance = Number(e.target.value);
                      setBaseLocationDistance(distance);
                      if (onBaseLocationDistanceChange) {
                        onBaseLocationDistanceChange(distance);
                      }
                    }}
                    min={10}
                    max={500}
                    step={10}
                  />
                  <p style={{ fontSize: '12px', marginTop: '4px', color: '#7f8c8d' }}>
                    基準位置からこの距離を超えると警告します
                  </p>
                </div>
              )}
            </>
          )}



          <div className="form-group">
            <label className="form-label">はぐれ警告</label>
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
        </div>

        {/* マップ（右側） */}
        <div className="card">
          <h2 style={{ marginBottom: '16px' }}>リアルタイム位置追跡</h2>
          <div style={{ height: '500px', borderRadius: '12px', overflow: 'hidden' }}>
            <MapContainer
              center={[mapCenter.lat, mapCenter.lon]}
              zoom={16}
              style={{ height: '100%', width: '100%' }}
            >
            <MapZoomListener onZoomChange={setZoomLevel} />
              <MapClickHandler />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            
            {/* 基準位置マーカー（親トラッカー未設定時のみ表示） */}
            {parentTrackers.length === 0 && baseLocation && (
              <>
                <Marker position={[baseLocation.lat, baseLocation.lon]} icon={baseLocationIcon}>
                  <Tooltip permanent={true} direction="top" offset={[0, -30]} className="marker-tooltip">
                    <div style={{ fontSize: `${getTooltipFontSize()}px`, fontWeight: 'bold' }}>基準位置</div>
                  </Tooltip>
                  <Popup>
                    <div>
                      <strong>基準位置</strong><br />
                      検知範囲: {baseLocationDistance}m<br />
                      座標: {baseLocation.lat.toFixed(6)}, {baseLocation.lon.toFixed(6)}
                    </div>
                  </Popup>
                </Marker>
                <Circle
                  center={[baseLocation.lat, baseLocation.lon]}
                  radius={baseLocationDistance}
                  pathOptions={{ color: '#9C27B0', fillColor: '#9C27B0', fillOpacity: 0.1 }}
                />
              </>
            )}


            {/* 親トラッカーとその検知範囲 */}
            {trackers.filter(t => parentTrackers.includes(t.id) && t.position).map(tracker => (
              <div key={tracker.id}>
                <Marker position={[tracker.position!.lat, tracker.position!.lon]} icon={parentIcon}>
                    <Tooltip permanent={true} direction="top" offset={[0, -30]} className="marker-tooltip">
                      <div style={{ fontSize: `${getTooltipFontSize()}px`, fontWeight: 'bold' }}>{tracker.name}</div>
                    </Tooltip>
                    <Popup>
                      <div>
                        <strong>{tracker.name}</strong><br />
                        ID: {tracker.deviceId || tracker.id}<br />
                        親トラッカー<br />
                        検知範囲: {maxDistance}m<br />
                        更新: {tracker.lastUpdate?.toLocaleTimeString('ja-JP') || 'N/A'}
                        {tracker.position?.accuracy && (
                          <><br />精度: ±{tracker.position.accuracy}m</>
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
            {trackers.filter(t => {
              // 親トラッカー設定時は親以外を表示
              if (parentTrackers.length > 0) {
                return !parentTrackers.includes(t.id) && t.position;
              }
              // 基準位置設定時は全デバイスを表示
              return t.position;
            }).map(tracker => {
              let tooFar = false;
              let parent = null;
              let distanceFromBase = null;

              if (parentTrackers.length > 0) {
                tooFar = isChildTooFar(tracker.id);
                parent = trackers.find(t => parentTrackers.includes(t.id) && t.position);
              } else if (baseLocation) {
                distanceFromBase = calculateGPSDistance(
                  baseLocation.lat,
                  baseLocation.lon,
                  tracker.position!.lat,
                  tracker.position!.lon
                );
                tooFar = distanceFromBase > baseLocationDistance;
              }
              
              return (
                <div key={tracker.id}>
                  <Marker
                    position={[tracker.position!.lat, tracker.position!.lon]}
                    icon={tooFar ? alertIcon : childIcon}
                  >
                    <Tooltip permanent={true} direction="top" offset={[0, -30]} className="marker-tooltip">
                      <div style={{ fontSize: `${getTooltipFontSize()}px`, fontWeight: 'bold' }}>{tracker.name}</div>
                    </Tooltip>
                    <Popup>
                      <div>
                        <strong>{tracker.name}</strong><br />
                        ID: {tracker.deviceId || tracker.id}<br />
                        {parentTrackers.length > 0 
                          ? (tooFar ? '子トラッカー（警告）' : '子トラッカー（正常）')
                          : (tooFar ? '範囲外' : '範囲内')
                        }<br />
                        更新: {tracker.lastUpdate?.toLocaleTimeString('ja-JP') || 'N/A'}
                        {tracker.position?.accuracy && (
                          <><br />精度: ±{tracker.position.accuracy}m</>
                        )}
                        {distanceFromBase !== null && (
                          <><br />基準位置から: {distanceFromBase.toFixed(0)}m</>
                        )}
                        {parentTrackers.length > 0 && tooFar && (
                          <><br /><span style={{ color: '#E74C3C' }}>親から離れすぎています</span></>
                        )}
                        {parentTrackers.length === 0 && tooFar && (
                          <><br /><span style={{ color: '#E74C3C' }}>基準位置から離れすぎています</span></>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                  
                  {/* 親トラッカーとの接続線 */}
                  {parentTrackers.length > 0 && parent && parent.position && (
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

                  {/* 基準位置との接続線 */}
                  {parentTrackers.length === 0 && baseLocation && (
                    <Polyline
                      positions={[
                        [baseLocation.lat, baseLocation.lon],
                        [tracker.position!.lat, tracker.position!.lon]
                      ]}
                      pathOptions={{
                        color: tooFar ? '#E74C3C' : '#9C27B0',
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
            gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', 
            gap: '12px',
            fontSize: '14px',
            color: '#666'
          }}>
            <div>追跡中: {trackers.filter(t => t.position).length}台</div>
            {parentTrackers.length > 0 && (
              <>
                <div>親: {trackers.filter(t => parentTrackers.includes(t.id)).length}台</div>
                <div>子: {trackers.filter(t => !parentTrackers.includes(t.id)).length}台</div>
                <div>警告: {trackers.filter(t => !parentTrackers.includes(t.id) && isChildTooFar(t.id)).length}台</div>
              </>
            )}
            {parentTrackers.length === 0 && baseLocation && (
              <>
                <div>基準位置設定済み</div>
                <div>警告: {trackers.filter(t => {
                  if (!t.position) return false;
                  const distance = calculateGPSDistance(
                    baseLocation.lat, baseLocation.lon,
                    t.position.lat, t.position.lon
                  );
                  return distance > baseLocationDistance;
                }).length}台</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

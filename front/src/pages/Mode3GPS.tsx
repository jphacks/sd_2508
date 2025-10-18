import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { calculateGPSDistance } from '../utils/positioning';

// 宮城県仙台市青葉区荒巻青葉6−3付近（東北大学）
const SENDAI_CENTER = { lat: 38.2559, lng: 140.8398 };

// モックデータ
const MOCK_TRACKERS = [
  { id: 'parent-1', name: '母', isParent: true, position: { lat: 38.2559, lng: 140.8398 } },
  { id: 'child-1', name: '太郎', isParent: false, position: { lat: 38.2563, lng: 140.8405 } },
  { id: 'child-2', name: '花子', isParent: false, position: { lat: 38.2555, lng: 140.8390 } },
  { id: 'child-3', name: '次郎', isParent: false, position: { lat: 38.2570, lng: 140.8420 } } // 離れている
];

export default function Mode3GPS() {
  const [trackers, setTrackers] = useState(MOCK_TRACKERS);
  const [parentTrackers, setParentTrackers] = useState<string[]>(['parent-1']);
  const [maxDistance, setMaxDistance] = useState(30); // メートル
  const [alerts, setAlerts] = useState<string[]>([]);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [alertSound, setAlertSound] = useState(true);

  useEffect(() => {
    // 距離チェック
    checkDistances();
  }, [trackers, parentTrackers, maxDistance]);

  const checkDistances = () => {
    const newAlerts: string[] = [];
    const parents = trackers.filter(t => parentTrackers.includes(t.id));
    const children = trackers.filter(t => !parentTrackers.includes(t.id));

    children.forEach(child => {
      let minDistance = Infinity;
      parents.forEach(parent => {
        const distance = calculateGPSDistance(
          parent.position.lat,
          parent.position.lng,
          child.position.lat,
          child.position.lng
        );
        minDistance = Math.min(minDistance, distance);
      });

      if (minDistance > maxDistance) {
        newAlerts.push(`${child.name} が親トラッカーから ${minDistance.toFixed(0)}m 離れています！`);
      }
    });

    setAlerts(newAlerts);
  };

  // アイコンの設定
  const parentIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  const childIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
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

  const isChildTooFar = (childId: string): boolean => {
    const child = trackers.find(t => t.id === childId);
    if (!child) return false;

    const parents = trackers.filter(t => parentTrackers.includes(t.id));
    let minDistance = Infinity;

    parents.forEach(parent => {
      const distance = calculateGPSDistance(
        parent.position.lat,
        parent.position.lng,
        child.position.lat,
        child.position.lng
      );
      minDistance = Math.min(minDistance, distance);
    });

    return minDistance > maxDistance;
  };

  return (
    <div className="container">
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
        機能3: 屋外GPS追跡
      </h1>

      <div className="card" style={{ marginBottom: '16px', background: '#FFF3CD', borderLeft: '4px solid #F39C12' }}>
        <p style={{ margin: 0 }}>
          <strong>ℹ️ モック機能:</strong> この機能は現在モックデータで動作しています。
          表示位置: 宮城県仙台市青葉区荒巻青葉6−3付近（東北大学）
        </p>
      </div>

      {alerts.map((alert, index) => (
        <div key={index} className="alert alert-danger">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>⚠️ 警告</strong>
              <p style={{ marginTop: '8px' }}>{alert}</p>
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

      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>リアルタイム位置</h2>
        <div style={{ height: '500px', borderRadius: '12px', overflow: 'hidden' }}>
          <MapContainer
            center={[SENDAI_CENTER.lat, SENDAI_CENTER.lng]}
            zoom={16}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            
            {/* 親トラッカーとその検知範囲 */}
            {trackers.filter(t => parentTrackers.includes(t.id)).map(tracker => (
              <div key={tracker.id}>
                <Marker position={[tracker.position.lat, tracker.position.lng]} icon={parentIcon}>
                  <Popup>
                    <strong>{tracker.name}</strong><br />
                    親トラッカー<br />
                    検知範囲: {maxDistance}m
                  </Popup>
                </Marker>
                <Circle
                  center={[tracker.position.lat, tracker.position.lng]}
                  radius={maxDistance}
                  pathOptions={{ color: '#50C878', fillColor: '#50C878', fillOpacity: 0.1 }}
                />
              </div>
            ))}

            {/* 子トラッカー */}
            {trackers.filter(t => !parentTrackers.includes(t.id)).map(tracker => {
              const tooFar = isChildTooFar(tracker.id);
              const parent = trackers.find(t => parentTrackers.includes(t.id));
              
              return (
                <div key={tracker.id}>
                  <Marker
                    position={[tracker.position.lat, tracker.position.lng]}
                    icon={tooFar ? alertIcon : childIcon}
                  >
                    <Popup>
                      <strong>{tracker.name}</strong><br />
                      子トラッカー<br />
                      {tooFar && <span style={{ color: '#E74C3C' }}>⚠️ 離れすぎています</span>}
                    </Popup>
                  </Marker>
                  
                  {/* 親との接続線 */}
                  {parent && (
                    <Polyline
                      positions={[
                        [parent.position.lat, parent.position.lng],
                        [tracker.position.lat, tracker.position.lng]
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
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>トラッカー一覧</h3>
          {trackers.map(tracker => {
            const isParent = parentTrackers.includes(tracker.id);
            const tooFar = !isParent && isChildTooFar(tracker.id);
            
            return (
              <div
                key={tracker.id}
                style={{
                  padding: '12px',
                  borderBottom: '1px solid #e1e8ed',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <strong>{tracker.name}</strong>
                  <p style={{ fontSize: '12px', marginTop: '4px', color: '#7f8c8d' }}>
                    {isParent ? '親トラッカー' : '子トラッカー'}
                  </p>
                  {tooFar && (
                    <p style={{ fontSize: '12px', marginTop: '4px', color: '#E74C3C' }}>
                      ⚠️ 離れすぎています
                    </p>
                  )}
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
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
                    />
                    親に設定
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>設定</h3>
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
            <label className="form-label">位置更新間隔</label>
            <select className="form-select" defaultValue="60">
              <option value="30">30秒</option>
              <option value="60">1分</option>
              <option value="120">2分</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '24px' }}>
        <h3 style={{ marginBottom: '16px' }}>使い方</h3>
        <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>保護者（親）が持つトラッカーを「親トラッカー」として設定します</li>
          <li>子どもが持つトラッカーは自動的に「子トラッカー」になります</li>
          <li>子トラッカーが親トラッカーから設定距離（デフォルト30m）以上離れると警告します</li>
          <li>複数の親トラッカーを設定できます（いずれかの親から離れると警告）</li>
        </ol>
      </div>
    </div>
  );
}

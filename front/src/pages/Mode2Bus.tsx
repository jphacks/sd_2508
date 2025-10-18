import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Circle, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

// TODO: モックデータ。実際はFirebaseから取得
const MOCK_BEACON_POSITION = { lat: 38.2601, lng: 140.8699 };
const MOCK_DEVICES = [
  { id: 'device-1', name: '太郎', inRange: true, lastSeen: new Date() },
  { id: 'device-2', name: '花子', inRange: true, lastSeen: new Date() },
  { id: 'device-3', name: '次郎', inRange: false, lastSeen: new Date(Date.now() - 5 * 60 * 1000) }
];

export default function Mode2Bus() {
  const [devices, setDevices] = useState(MOCK_DEVICES);
  const [alert, setAlert] = useState<string | null>(null);
  const [selectedBeacon, setSelectedBeacon] = useState<string>('beacon-1');
  const [alertThreshold, setAlertThreshold] = useState(3);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [alertSound, setAlertSound] = useState(true);

  useEffect(() => {
    // モック: 3分以上単独検知のデバイスがいないかチェック
    const interval = setInterval(() => {
      const now = new Date();
      const aloneDevices = devices.filter(d => {
        const otherDevices = devices.filter(other => other.id !== d.id && other.inRange);
        const timeSinceLastSeen = (now.getTime() - d.lastSeen.getTime()) / 1000 / 60;
        return d.inRange && otherDevices.length === 0 && timeSinceLastSeen >= 3;
      });

      if (aloneDevices.length > 0) {
        setAlert(`${aloneDevices[0].name} がバスに置き去りにされている可能性があります！`);
      }
    }, 10000); // 10秒ごとにチェック

    return () => clearInterval(interval);
  }, [devices]);

  // Leafletアイコンの設定
  const beaconIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  return (
    <div className="container">
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
        機能2: バス置き去り検知
      </h1>

      <div className="card" style={{ marginBottom: '16px', background: '#FFF3CD', borderLeft: '4px solid #F39C12' }}>
        <p style={{ margin: 0 }}>
          <strong>ℹ️ モック機能:</strong> この機能は現在モックデータで動作しています。
          実際のビーコンとトラッカーのデータは接続されていません。
        </p>
      </div>

      {alert && (
        <div className="alert alert-danger">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>⚠️ 警告</strong>
              <p style={{ marginTop: '8px' }}>{alert}</p>
            </div>
            <button
              onClick={() => setAlert(null)}
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
      )}

      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>ビーコン位置</h2>
        <div style={{ height: '400px', borderRadius: '12px', overflow: 'hidden' }}>
          <MapContainer
            center={[MOCK_BEACON_POSITION.lat, MOCK_BEACON_POSITION.lng]}
            zoom={15}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[MOCK_BEACON_POSITION.lat, MOCK_BEACON_POSITION.lng]} icon={beaconIcon}>
              <Popup>
                ビーコン位置<br />
                検知範囲: 約50m
              </Popup>
            </Marker>
            <Circle
              center={[MOCK_BEACON_POSITION.lat, MOCK_BEACON_POSITION.lng]}
              radius={50}
              pathOptions={{ color: '#4A90E2', fillColor: '#4A90E2', fillOpacity: 0.2 }}
            />
          </MapContainer>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>検知中のデバイス</h3>
          {devices.filter(d => d.inRange).map(device => (
            <div
              key={device.id}
              style={{
                padding: '12px',
                borderBottom: '1px solid #e1e8ed',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <strong>{device.name}</strong>
                <p style={{ fontSize: '12px', marginTop: '4px', color: '#7f8c8d' }}>
                  最終検知: {device.lastSeen.toLocaleTimeString()}
                </p>
              </div>
              <div
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: '#50C878'
                }}
              />
            </div>
          ))}
          {devices.filter(d => d.inRange).length === 0 && (
            <p style={{ color: '#7f8c8d', textAlign: 'center', padding: '20px' }}>
              検知中のデバイスはありません
            </p>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>設定</h3>
          <div className="form-group">
            <label className="form-label">使用するビーコン</label>
            <select
              className="form-select"
              value={selectedBeacon}
              onChange={(e) => setSelectedBeacon(e.target.value)}
            >
              <option value="beacon-1">ビーコン 1</option>
              <option value="beacon-2">ビーコン 2</option>
              <option value="beacon-3">ビーコン 3</option>
            </select>
          </div>
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
          </div>
          <div className="form-group">
            <label className="form-label">単独検知時の警告</label>
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
        </div>
      </div>

      <div className="card" style={{ marginTop: '24px' }}>
        <h3 style={{ marginBottom: '16px' }}>使い方</h3>
        <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>バスなどの移動物にビーコンを1台設置します</li>
          <li>ビーコンが検知するトラッカーの数を自動でチェックします</li>
          <li>1台のみの状態が3分続くと、置き去りの疑いがあると判定します</li>
          <li>警告が表示された場合は、すぐに確認してください</li>
        </ol>
      </div>
    </div>
  );
}

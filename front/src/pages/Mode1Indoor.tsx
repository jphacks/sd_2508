import { useEffect, useState, useRef } from 'react';
import { ref, onValue } from 'firebase/database';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { rtdb, db } from '../firebase';
import { Device, BLEScan, RoomProfile, Alert } from '../types';
import { estimatePositionByFingerprinting } from '../utils/positioning';

export default function Mode1Indoor() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [roomProfile, setRoomProfile] = useState<RoomProfile | null>(null);
  const [devicePositions, setDevicePositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // TODO: 実際のユーザーIDを使用
      const userId = 'demo-user';

      // デバイス一覧を取得
      const devicesSnapshot = await getDocs(collection(db, 'devices'));
      const devicesData = devicesSnapshot.docs.map(doc => ({ 
        id: doc.id,
        ...doc.data()
      } as Device & { id: string }));
      setDevices(devicesData);

      // TODO: アクティブな部屋プロファイルを取得
      // 仮のデータ
      const mockRoomProfile: RoomProfile = {
        roomId: 'room-001',
        name: '会議室A',
        beacons: ['beacon-1', 'beacon-2', 'beacon-3'],
        calibrationPoints: [
          {
            id: 'p1',
            position: { x: 0, y: 0 },
            label: '左上隅',
            measurements: []
          },
          {
            id: 'p2',
            position: { x: 10, y: 0 },
            label: '右上隅',
            measurements: []
          },
          {
            id: 'p3',
            position: { x: 10, y: 8 },
            label: '右下隅',
            measurements: []
          },
          {
            id: 'p4',
            position: { x: 0, y: 8 },
            label: '左下隅',
            measurements: []
          },
          {
            id: 'p5',
            position: { x: 5, y: 4 },
            label: '中央',
            measurements: []
          }
        ],
        outline: { width: 10, height: 8 },
        furniture: [
          { id: 'f1', type: 'desk', position: { x: 3, y: 3 }, width: 2, height: 1 },
          { id: 'f2', type: 'door', position: { x: 5, y: 0 }, width: 1, height: 0.2 }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      setRoomProfile(mockRoomProfile);

      // 各デバイスのBLEスキャンデータを監視
      devicesData.forEach(device => {
        const scansRef = ref(rtdb, `devices/${device.devEUI}/ble_scans`);
        onValue(scansRef, (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const scans = Object.values(data) as BLEScan[];
            const latestScan = scans[scans.length - 1];
            
            if (latestScan && mockRoomProfile) {
              // RSSI値を抽出
              const rssiMap: { [mac: string]: number } = {};
              latestScan.beacons.forEach(beacon => {
                rssiMap[beacon.mac] = beacon.rssi;
              });

              // 位置を推定
              const position = estimatePositionByFingerprinting(
                rssiMap,
                mockRoomProfile.calibrationPoints
              );

              if (position) {
                setDevicePositions(prev => {
                  const newMap = new Map(prev);
                  newMap.set(device.devEUI, { x: position.x, y: position.y });
                  return newMap;
                });

                // 部屋の外に出たかチェック
                checkRoomExit(device, position, mockRoomProfile);
              }
            }
          }
        });
      });

      setLoading(false);
    } catch (error) {
      console.error('データ読み込みエラー:', error);
      setLoading(false);
    }
  };

  const checkRoomExit = (
    device: Device,
    position: { x: number; y: number },
    room: RoomProfile
  ) => {
    const margin = 0.5;
    const isInside =
      position.x >= -margin &&
      position.x <= room.outline!.width + margin &&
      position.y >= -margin &&
      position.y <= room.outline!.height + margin;

    if (!isInside) {
      const alert: Alert = {
        id: `alert-${Date.now()}`,
        type: 'exit_room',
        message: `${device.userName || device.deviceId} が部屋から出ました！`,
        deviceId: device.devEUI,
        deviceName: device.userName,
        timestamp: new Date().toISOString(),
        dismissed: false
      };
      
      setAlerts(prev => [...prev, alert]);
      
      // アラート音を鳴らす
      if (audioRef.current) {
        audioRef.current.play();
      }

      // 5秒後に自動で消す
      setTimeout(() => {
        setAlerts(prev => prev.filter(a => a.id !== alert.id));
      }, 5000);
    }
  };

  const dismissAlert = (alertId: string) => {
    setAlerts(prev => prev.filter(a => a.id !== alertId));
  };

  useEffect(() => {
    if (roomProfile && canvasRef.current) {
      drawRoom();
    }
  }, [roomProfile, devicePositions]);

  const drawRoom = () => {
    const canvas = canvasRef.current;
    if (!canvas || !roomProfile) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const padding = 40;
    const width = canvas.width - padding * 2;
    const height = canvas.height - padding * 2;
    
    const scaleX = width / roomProfile.outline!.width;
    const scaleY = height / roomProfile.outline!.height;
    const scale = Math.min(scaleX, scaleY);

    // クリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 背景
    ctx.fillStyle = '#f5f7fa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 部屋の輪郭
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 3;
    ctx.strokeRect(
      padding,
      padding,
      roomProfile.outline!.width * scale,
      roomProfile.outline!.height * scale
    );

    // 家具を描画
    roomProfile.furniture?.forEach(furniture => {
      ctx.fillStyle = '#95a5a6';
      const x = padding + furniture.position.x * scale;
      const y = padding + furniture.position.y * scale;
      const w = (furniture.width || 1) * scale;
      const h = (furniture.height || 1) * scale;
      
      ctx.fillRect(x, y, w, h);
      
      // ラベル
      ctx.fillStyle = '#2c3e50';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(furniture.type, x + w / 2, y + h / 2 + 4);
    });

    // デバイスの位置を描画
    devicePositions.forEach((position, deviceId) => {
      const device = devices.find(d => d.devEUI === deviceId);
      const x = padding + position.x * scale;
      const y = padding + position.y * scale;

      // デバイスの円
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#4A90E2';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 名前
      ctx.fillStyle = '#2c3e50';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(device?.userName || device?.deviceId || deviceId, x, y - 20);
    });

    // グリッド線（オプション）
    ctx.strokeStyle = '#e1e8ed';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    for (let i = 1; i < roomProfile.outline!.width; i++) {
      const x = padding + i * scale;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, padding + roomProfile.outline!.height * scale);
      ctx.stroke();
    }
    for (let i = 1; i < roomProfile.outline!.height; i++) {
      const y = padding + i * scale;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + roomProfile.outline!.width * scale, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
        機能1: 室内位置追跡
      </h1>

      {alerts.map(alert => (
        <div key={alert.id} className="alert alert-danger">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>⚠️ 警告</strong>
              <p style={{ marginTop: '8px' }}>{alert.message}</p>
            </div>
            <button
              onClick={() => dismissAlert(alert.id)}
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
        <h2 style={{ marginBottom: '16px' }}>
          部屋: {roomProfile?.name || '未設定'}
        </h2>
        <div style={{ position: 'relative', width: '100%', height: '600px' }}>
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            style={{ width: '100%', height: '100%', border: '1px solid #e1e8ed', borderRadius: '8px' }}
          />
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3 style={{ marginBottom: '12px' }}>トラッカー一覧</h3>
          {devices.map(device => {
            const position = devicePositions.get(device.devEUI);
            return (
              <div
                key={device.devEUI}
                style={{
                  padding: '12px',
                  borderBottom: '1px solid #e1e8ed',
                  display: 'flex',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <strong>{device.userName || device.deviceId}</strong>
                  {position && (
                    <p style={{ fontSize: '12px', marginTop: '4px', color: '#7f8c8d' }}>
                      位置: ({position.x.toFixed(2)}m, {position.y.toFixed(2)}m)
                    </p>
                  )}
                </div>
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    backgroundColor: position ? '#50C878' : '#95a5a6',
                    marginTop: '4px'
                  }}
                />
              </div>
            );
          })}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '12px' }}>設定</h3>
          <div className="form-group">
            <label className="form-label">部屋退出時の警告</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" defaultChecked />
              有効
            </label>
          </div>
          <div className="form-group">
            <label className="form-label">警告音</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" defaultChecked />
              有効
            </label>
          </div>
        </div>
      </div>

      {/* アラート音 */}
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGmi78OScTgwOUKXh8bllHAU2jdXxxn0pBSl+zPLaizsKFFux6OyrWBgLTKXh8bxpIgU1gtDy04k3CBtmue7mnlENDlCn4fG2Yx0FNo3V8cV9KwUqfsvy2os6CxJbrefrqVYZCkyk4PG8aScGOILN8tiIOAgZZ7jt5Z9PDw5Rrerlsl0dBTiO1/HGfSwHKn3L8tuKOwsTWbHn66hWGQpNpOHxvGknBjiCzfLYiDgIGWe47eWfTw8OUq3q5bJdHQU4jtfxxn0sByp9y/LbizsLE1mw5+uoVhkKTKTh8bxpJwY4gs3y2Ig4CBlnuO3ln08PDlKs6eWyXRwGOI7X8cZ9LAcqfcvy24s7CxNZsOfrqFYZCkyk4fG8aScGOILN8tiIOAgZZ7jt5Z9PDw5SrOrlsl0cBjiO1/HGfSwHKn3L8tuKOwsTWbDn66hWGQpMo+HxvGknBjiCzfLYiDgIGWe47eWfTw8OUqvq5bJdHQU4jtfxxn0sByp9y/LbijsLE1mw5+uoVRkKTKPh8bxpJwY4gs3y2Ig4CBlnuO3ln08PDlKr6uWyXRwGOI7X8cZ9KwcqfMvy24o6CxNZr+frqFYZCkyi4PG8aScGOILN8tiIOQgZZ7jt5Z9PDw5Sq+rlsl0cBjiO1/HGfSsHKnzL8tuKOgsTWa/n66hWGQpMouDxvGknBjiCzfLYiDkIGWe47eWfTw8OUqvq5bJdHAY4jtfxxnwrByp8y/LbijsLE1mw5+uoVhkKTKLg8bxpJwY4gs3y2Ig5CBlnuO3ln08PDlKr6uWyXRwGOI7X8cZ8KwcqfMvy24o6CxNZsOfrqFYZCkyi4PG8aScGOILN8tiIOQgZZ7jt5Z9PDw5Sq+rlsl0cBjiO1/HGfCsHKnzL8tuKOgsTWbDn66hWGQpMouDxvGknBjiCzfLYiDkIGWe47eWfTw8OUqvq5bJdHAY4jtfxxnwrByp8y/LbijsLE1mw5+uoVhkKTKLg8bxpJwY4gs3y2Ig5CBlnuO3ln08PDlKr6uWyXRwGOI7X8cZ8KwcqfMvy24o6CxNZsOfrqFYZCkyi4PG8aScGOILN8tiIOQgZZ7jt5Z9PDw5Sq+rlsl0cBjiO1/HGfCsHKnzL8tuKOgsTWbDn66hWGQpMouDxvGknBjiCzfLYiDkIGWe47eWfTw8OU=" />
    </div>
  );
}

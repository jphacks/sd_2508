import { useEffect, useState, useRef } from 'react';
import { ref, onValue } from 'firebase/database';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { rtdb, db } from '../firebase';
import { Device, BLEScan, RoomProfile, Alert, Beacon } from '../types';
import { estimatePositionHybrid } from '../utils/positioning';

const FURNITURE_TYPES = {
  desk: { label: '机', width: 2, height: 1, color: '#8B4513' },
  tv: { label: 'テレビ', width: 3, height: 0.5, color: '#2C3E50' },
  piano: { label: 'ピアノ', width: 2, height: 1.5, color: '#1A1A1A' },
  chair: { label: '椅子', width: 0.8, height: 0.8, color: '#CD853F' },
  door: { label: 'ドア', width: 1, height: 0.2, color: '#D2691E' }
} as const;

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

      // アクティブな部屋プロファイルを取得
      const configSnapshot = await getDocs(collection(db, 'appConfig'));
      const userConfig = configSnapshot.docs.find(d => d.data().userId === userId);
      
      let activeRoomId: string | null = null;
      if (userConfig && userConfig.data().mode1?.roomId) {
        activeRoomId = userConfig.data().mode1.roomId;
      }

      if (!activeRoomId) {
        // アクティブなルームが設定されていない場合、最新のルームを使用
        const roomsSnapshot = await getDocs(collection(db, 'rooms'));
        if (roomsSnapshot.docs.length > 0) {
          const latestRoom = roomsSnapshot.docs.sort((a, b) => {
            const aTime = new Date(a.data().createdAt).getTime();
            const bTime = new Date(b.data().createdAt).getTime();
            return bTime - aTime;
          })[0];
          activeRoomId = latestRoom.id;
        }
      }

      if (activeRoomId) {
        const roomDoc = await getDoc(doc(db, 'rooms', activeRoomId));
        if (roomDoc.exists()) {
          const roomData = { roomId: roomDoc.id, ...roomDoc.data() } as RoomProfile;
          setRoomProfile(roomData);

          // ビーコン情報を取得（三辺測量用）
          const beaconsSnapshot = await getDocs(collection(db, 'beacons'));
          const beaconsData = beaconsSnapshot.docs.map(doc => ({
            firestoreId: doc.id,
            ...doc.data()
          } as Beacon & { firestoreId: string }));

          // ルームで使用するビーコンの位置情報を構築
          const beaconPositions = roomData.beacons
            .map(beaconId => {
              const beacon = beaconsData.find(b => b.firestoreId === beaconId);
              if (beacon && beacon.place) {
                return {
                  x: beacon.place.x,
                  y: beacon.place.y,
                  mac: beacon.mac,
                  beaconId: beaconId
                };
              }
              return null;
            })
            .filter(b => b !== null) as Array<{ x: number; y: number; mac: string; beaconId: string }>;

          // 各デバイスのBLEスキャンデータを監視
          devicesData.forEach(device => {
            const trackerRef = ref(rtdb, `CARDS/${device.devEUI}`);
            onValue(trackerRef, (snapshot) => {
              const data = snapshot.val();
              if (data && data.ble && roomData) {
                // 各ビーコンからRSSI値を取得して平均化
                const rssiMap: { [beaconId: string]: number } = {};
                
                Object.entries(data.ble).forEach(([beaconId, beaconData]: [string, any]) => {
                  if (beaconData.rssi_data && Array.isArray(beaconData.rssi_data)) {
                    // rssi_data配列から平均RSSI値を計算
                    const rssiValues = beaconData.rssi_data.map((item: any) => item.rssi);
                    const averageRssi = rssiValues.reduce((sum: number, rssi: number) => sum + rssi, 0) / rssiValues.length;
                    rssiMap[beaconId] = averageRssi;
                  }
                });

                // ハイブリッド位置推定（Fingerprinting + 三辺測量）
                const position = estimatePositionHybrid(
                  rssiMap,
                  roomData.calibrationPoints,
                  beaconPositions.length >= 3 ? beaconPositions : undefined
                );

                if (position) {
                  setDevicePositions(prev => {
                    const newMap = new Map(prev);
                    newMap.set(device.devEUI, { x: position.x, y: position.y });
                    return newMap;
                  });

                  // 部屋の外に出たかチェック
                  checkRoomExit(device, position, roomData);
                  
                  // デバッグ用にメソッド情報を表示（オプション）
                  console.log(`${device.deviceId}: ${position.method} (信頼度: ${(position.confidence * 100).toFixed(1)}%)`);
                }
              }
            });
          });
        }
      }

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


  // drawRoom関数の完全版

  const drawRoom = () => {
    const canvas = canvasRef.current;
    if (!canvas || !roomProfile) {
      console.log('Canvas or roomProfile not ready');
      return;
    }

    console.log('Drawing room...', { 
      furniture: roomProfile.furniture?.length || 0,
      devices: devicePositions.size 
    });

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

    // グリッド線（最背面）
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

    // 家具を描画（中間層）
    if (roomProfile.furniture && roomProfile.furniture.length > 0) {
      console.log('Drawing furniture:', roomProfile.furniture.length);
      roomProfile.furniture.forEach(furniture => {
        const furnitureType = FURNITURE_TYPES[furniture.type as keyof typeof FURNITURE_TYPES];
        const furnitureColor = furnitureType?.color || '#95a5a6';
        
        ctx.fillStyle = furnitureColor;
        const x = padding + furniture.position.x * scale;
        const y = padding + furniture.position.y * scale;
        const w = (furniture.width || 1) * scale;
        const h = (furniture.height || 1) * scale;
        
        ctx.fillRect(x, y, w, h);
        
        // 家具の境界線
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        
        // ラベル
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 2;
        
        ctx.strokeText(furnitureType?.label || furniture.type, x + w / 2, y + h / 2 + 4);
        ctx.fillText(furnitureType?.label || furniture.type, x + w / 2, y + h / 2 + 4);
      });
    }

    // デバイスの位置を描画（最前面）
    if (devicePositions.size > 0) {
      console.log('Drawing devices:', devicePositions.size);
      devicePositions.forEach((position, deviceId) => {
        const device = devices.find(d => d.devEUI === deviceId);
        const x = padding + position.x * scale;
        const y = padding + position.y * scale;

        // デバイスの影
        ctx.beginPath();
        ctx.arc(x + 2, y + 2, 14, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fill();

        // デバイスの円（メイン）
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#4A90E2';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();

        // 内側の小さな円
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // 名前（背景付き）
        const deviceName = device?.userName || device?.deviceId || deviceId;
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        
        const textMetrics = ctx.measureText(deviceName);
        const textWidth = textMetrics.width + 8;
        const textHeight = 16;
      
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(
          x - textWidth / 2, 
          y - 35 - textHeight / 2, 
          textWidth, 
          textHeight
        );

        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 1;
        ctx.strokeRect(
          x - textWidth / 2, 
          y - 35 - textHeight / 2, 
          textWidth, 
          textHeight
        );

        ctx.fillStyle = '#2c3e50';
        ctx.fillText(deviceName, x, y - 30);

        // 位置座標
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#7f8c8d';
        ctx.fillText(
          `(${position.x.toFixed(1)}, ${position.y.toFixed(1)})`, 
          x, 
          y + 25
        );
      });
    }

    console.log('Room drawing completed');
  };

  useEffect(() => {
    console.log('Drawing trigger - roomProfile:', !!roomProfile, 'devices:', devicePositions.size);
    if (roomProfile) {
      // 少し遅延させて確実に描画
      const timer = setTimeout(() => {
        drawRoom();
      }, 50);
      
      return () => clearTimeout(timer);
    }
  }, [roomProfile, devicePositions, devices]);

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

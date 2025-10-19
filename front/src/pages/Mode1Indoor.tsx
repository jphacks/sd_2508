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
  const [deviceTimestamps, setDeviceTimestamps] = useState<Map<string, string>>(new Map());
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [alertOnExit, setAlertOnExit] = useState(true);
  const [alertSound, setAlertSound] = useState(true);
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
            // デバイスIDを小文字に正規化（RTDBと一致させる）
            const normalizedDeviceId = device.devEUI.toLowerCase();
            const trackerRef = ref(rtdb, `devices/${normalizedDeviceId}`);
            
            console.log(`📍 Mode1: ${device.deviceId}の監視開始`, { devEUI: device.devEUI, normalized: normalizedDeviceId });
            
            onValue(trackerRef, (snapshot) => {
              const data = snapshot.val();
              if (data && data.beacons && roomData) {
                console.log(`📡 ${device.deviceId}のRTDB更新:`, { timestamp: data.beaconsUpdatedAt, beaconsCount: data.beacons.length });
                
                // タイムスタンプを保存
                if (data.beaconsUpdatedAt) {
                  setDeviceTimestamps(prev => {
                    const newMap = new Map(prev);
                    newMap.set(device.devEUI, data.beaconsUpdatedAt);
                    return newMap;
                  });
                }

                // 各ビーコンからRSSI値を取得
                const rssiMap: { [beaconId: string]: number } = {};
                
                data.beacons.forEach((beacon: any) => {
                  if (beacon.mac && beacon.rssi) {
                    // MACアドレスを正規化（コロン区切りを大文字に統一）
                    const normalizedMac = beacon.mac.toUpperCase().replace(/:/g, '');
                    rssiMap[normalizedMac] = beacon.rssi;
                  }
                });
                
                console.log(`📊 ${device.deviceId}のRSSI値:`, rssiMap);

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

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffSecs = Math.floor((diffMs % 60000) / 1000);

      if (diffMins === 0) {
        return `${diffSecs}秒前`;
      } else if (diffMins < 60) {
        return `${diffMins}分前`;
      } else {
        const hours = Math.floor(diffMins / 60);
        if (hours < 24) {
          return `${hours}時間前`;
        } else {
          return date.toLocaleString('ja-JP', { 
            month: '2-digit', 
            day: '2-digit', 
            hour: '2-digit', 
            minute: '2-digit' 
          });
        }
      }
    } catch {
      return '不明';
    }
  };

  useEffect(() => {
    if (roomProfile && canvasRef.current) {
      drawRoom();
    }
  }, [roomProfile, devicePositions]);

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
        // 正規化座標（0-1）× ルームサイズ = 実際のメートル位置
        const furnitureX = furniture.position.x * roomProfile.outline!.width;
        const furnitureY = furniture.position.y * roomProfile.outline!.height;
        const furnitureW = furniture.width * roomProfile.outline!.width;
        const furnitureH = furniture.height * roomProfile.outline!.height;
        
        const x = padding + furnitureX * scale;
        const y = padding + furnitureY * scale;
        const w = furnitureW * scale;
        const h = furnitureH * scale;
        
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

    // ドアを描画（キャリブレーションポイントから取得）
    if (roomProfile.calibrationPoints) {
      const doorInside = roomProfile.calibrationPoints.find(p => p.id === 'door_inside');
      const doorOutside = roomProfile.calibrationPoints.find(p => p.id === 'door_outside');
      
      if (doorInside && doorOutside) {
        // ドアの中心位置を計算
        const doorCenterX = (doorInside.position.x + doorOutside.position.x) / 2;
        const doorCenterY = (doorInside.position.y + doorOutside.position.y) / 2;
        
        // ドアの向きを計算（内側→外側のベクトル）
        const doorVectorX = doorOutside.position.x - doorInside.position.x;
        const doorVectorY = doorOutside.position.y - doorInside.position.y;
        const doorAngle = Math.atan2(doorVectorY, doorVectorX);
        
        // ドアのサイズ（メートル単位）
        const doorWidth = 0.9; // 0.9m幅
        const doorThickness = 0.05; // 5cm厚
        
        // メートル位置に変換
        const doorDisplayX = doorCenterX * roomProfile.outline!.width;
        const doorDisplayY = doorCenterY * roomProfile.outline!.height;
        
        const x = padding + doorDisplayX * scale;
        const y = padding + doorDisplayY * scale;
        
        // ドアを描画（回転を考慮）
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(doorAngle + Math.PI / 2); // ベクトルに垂直
        
        // ドアの矩形（幅0.9m、厚さ5cm）
        const doorW = doorWidth * scale;
        const doorH = doorThickness * scale;
        
        ctx.fillStyle = '#D2691E';
        ctx.fillRect(-doorW / 2, -doorH / 2, doorW, doorH);
        
        // ドアの境界線
        ctx.strokeStyle = '#8B4513';
        ctx.lineWidth = 2;
        ctx.strokeRect(-doorW / 2, -doorH / 2, doorW, doorH);
        
        // ドアノブ（小さい円）
        ctx.beginPath();
        ctx.arc(doorW / 2 - 10, 0, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#FFD700';
        ctx.fill();
        ctx.strokeStyle = '#DAA520';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        ctx.restore();
        
        // ドアアイコンとラベル
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#8B4513';
        ctx.fillText('🚪', x, y);
        
        // ラベル「ドア」
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#8B4513';
        ctx.lineWidth = 3;
        ctx.strokeText('ドア', x, y + 20);
        ctx.fillText('ドア', x, y + 20);
      }
    }

    // デバイスの位置を描画（最前面）
    if (devicePositions.size > 0) {
      console.log('Drawing devices:', devicePositions.size);
      devicePositions.forEach((position, deviceId) => {
        const device = devices.find(d => d.devEUI === deviceId);
        
        // 位置座標を変換：正規化座標（0-1）× ルームサイズ（メートル）
        const displayX = position.x * roomProfile.outline!.width;
        const displayY = position.y * roomProfile.outline!.height;
        
        const x = padding + displayX * scale;
        const y = padding + displayY * scale;

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

        // 位置座標（正規化座標 × ルームサイズ = 実際のメートル位置）
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#7f8c8d';
        ctx.fillText(
          `(${displayX.toFixed(1)}m, ${displayY.toFixed(1)}m)`, 
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700', margin: 0 }}>
          機能1 : 室内位置追跡
        </h1>
        <h2 style={{ fontSize: '24px', fontWeight: '600', color: '#2c3e50', margin: 0 }}>
          部屋: {roomProfile?.name || '未設定'}
        </h2>
      </div>

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

      <div style={{ display: 'flex', gap: '24px', flexDirection: window.innerWidth <= 768 ? 'column' : 'row' }}>
        {/* 左側: ユーザー名と設定 */}
        <div style={{ width: window.innerWidth <= 768 ? '100%' : '300px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="card">
            <h3 style={{ marginBottom: '12px' }}>ユーザー名</h3>
            {devices.map(device => {
              const position = devicePositions.get(device.devEUI);
              const timestamp = deviceTimestamps.get(device.devEUI);
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
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                      <strong>{device.userName || device.deviceId}</strong>
                      <span style={{ fontSize: '12px', color: '#95a5a6' }}>
                        ({device.deviceId})
                      </span>
                    </div>
                    {position && (
                      <p style={{ fontSize: '12px', marginTop: '4px', color: '#7f8c8d' }}>
                        位置: ({position.x.toFixed(2)}m, {position.y.toFixed(2)}m)
                      </p>
                    )}
                    {timestamp && (
                      <p style={{ fontSize: '12px', marginTop: '2px', color: '#95a5a6' }}>
                        更新: {formatTimestamp(timestamp)}
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
              <button
                onClick={() => setAlertOnExit(!alertOnExit)}
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
                  backgroundColor: alertOnExit ? '#50C878' : '#E0E0E0',
                  color: alertOnExit ? 'white' : '#666'
                }}
              >
                <div
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    backgroundColor: 'white',
                    transition: 'transform 0.3s ease',
                    transform: alertOnExit ? 'translateX(0)' : 'translateX(0)'
                  }}
                />
                {alertOnExit ? '有効' : '無効'}
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
                    transition: 'transform 0.3s ease',
                    transform: alertSound ? 'translateX(0)' : 'translateX(0)'
                  }}
                />
                {alertSound ? '有効' : '無効'}
              </button>
            </div>
          </div>
        </div>

        {/* 右側: 部屋表示パネル */}
        <div className="card" style={{ flex: 1 }}>
          <div style={{ position: 'relative', width: '100%', height: window.innerWidth <= 768 ? '400px' : '600px' }}>
            <canvas
              ref={canvasRef}
              width={800}
              height={600}
              style={{ width: '100%', height: '100%', border: '1px solid #e1e8ed', borderRadius: '8px' }}
            />
          </div>
        </div>
      </div>

      {/* アラート音 */}
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGmi78OScTgwOUKXh8bllHAU2jdXxxn0pBSl+zPLaizsKFFux6OyrWBgLTKXh8bxpIgU1gtDy04k3CBtmue7mnlENDlCn4fG2Yx0FNo3V8cV9KwUqfsvy2os6CxJbrefrqVYZCkyk4PG8aScGOILN8tiIOAgZZ7jt5Z9PDw5Rrerlsl0dBTiO1/HGfSwHKn3L8tuKOwsTWbHn66hWGQpNpOHxvGknBjiCzfLYiDgIGWe47eWfTw8OUq3q5bJdHQU4jtfxxn0sByp9y/LbizsLE1mw5+uoVhkKTKTh8bxpJwY4gs3y2Ig4CBlnuO3ln08PDlKs6eWyXRwGOI7X8cZ9LAcqfcvy24s7CxNZsOfrqFYZCkyk4fG8aScGOILN8tiIOAgZZ7jt5Z9PDw5SrOrlsl0cBjiO1/HGfSwHKn3L8tuKOwsTWbDn66hWGQpMo+HxvGknBjiCzfLYiDgIGWe47eWfTw8OUqvq5bJdHQU4jtfxxn0sByp9y/LbijsLE1mw5+uoVRkKTKPh8bxpJwY4gs3y2Ig4CBlnuO3ln08PDlKr6uWyXRwGOI7X8cZ9KwcqfMvy24o6CxNZr+frqFYZCkyi4PG8aScGOILN8tiIOQgZZ7jt5Z9PDw5Sq+rlsl0cBjiO1/HGfSsHKnzL8tuKOgsTWa/n66hWGQpMouDxvGknBjiCzfLYiDkIGWe47eWfTw8OUqvq5bJdHAY4jtfxxnwrByp8y/LbijsLE1mw5+uoVhkKTKLg8bxpJwY4gs3y2Ig5CBlnuO3ln08PDlKr6uWyXRwGOI7X8cZ8KwcqfMvy24o6CxNZsOfrqFYZCkyi4PG8aScGOILN8tiIOQgZZ7jt5Z9PDw5Sq+rlsl0cBjiO1/HGfCsHKnzL8tuKOgsTWbDn66hWGQpMouDxvGknBjiCzfLYiDkIGWe47eWfTw8OUqvq5bJdHAY4jtfxxnwrByp8y/LbijsLE1mw5+uoVhkKTKLg8bxpJwY4gs3y2Ig5CBlnuO3ln08PDlKr6uWyXRwGOI7X8cZ8KwcqfMvy24o6CxNZsOfrqFYZCkyi4PG8aScGOILN8tiIOQgZZ7jt5Z9PDw5Sq+rlsl0cBjiO1/HGfCsHKnzL8tuKOgsTWbDn66hWGQpMouDxvGknBjiCzfLYiDkIGWe47eWfTw8OU=" />
    </div>
  );
}

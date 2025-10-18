import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, onValue, off } from 'firebase/database';
import { db, rtdb } from '../firebase';
import { RoomProfile, Device, CalibrationPoint } from '../types';

export default function AddCalibrationPoint() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  
  const [room, setRoom] = useState<RoomProfile | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [selectedPosition, setSelectedPosition] = useState<{ x: number; y: number } | null>(null);
  const [pointLabel, setPointLabel] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [currentMeasurement, setCurrentMeasurement] = useState<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRoom();
    loadDevices();
  }, [roomId]);

  useEffect(() => {
    if (room && canvasRef.current) {
      drawRoom();
    }
  }, [room, selectedPosition]);

  const loadRoom = async () => {
    if (!roomId) return;
    
    try {
      const roomDoc = await getDoc(doc(db, 'rooms', roomId));
      if (roomDoc.exists()) {
        const roomData = { roomId: roomDoc.id, ...roomDoc.data() } as RoomProfile;
        setRoom(roomData);
      } else {
        alert('ルームが見つかりません');
        navigate('/management');
      }
      setLoading(false);
    } catch (error) {
      console.error('ルーム読み込みエラー:', error);
      setLoading(false);
    }
  };

  const loadDevices = async () => {
    try {
      const devicesSnapshot = await (await import('firebase/firestore')).getDocs(
        (await import('firebase/firestore')).collection(db, 'devices')
      );
      const data = devicesSnapshot.docs.map(doc => ({ 
        id: doc.id,
        ...doc.data()
      } as Device & { id: string }));
      setDevices(data);
    } catch (error) {
      console.error('デバイス読み込みエラー:', error);
    }
  };

  const drawRoom = () => {
    const canvas = canvasRef.current;
    if (!canvas || !room) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const padding = 40;
    const width = canvas.width - padding * 2;
    const height = canvas.height - padding * 2;
    
    const scaleX = width / (room.outline?.width || 10);
    const scaleY = height / (room.outline?.height || 8);
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
      (room.outline?.width || 10) * scale,
      (room.outline?.height || 8) * scale
    );

    // 家具を描画
    if (room.furniture) {
      room.furniture.forEach(item => {
        const x = padding + item.position.x * scale;
        const y = padding + item.position.y * scale;
        const w = (item.width || 1) * scale;
        const h = (item.height || 1) * scale;

        ctx.fillStyle = '#95a5a6';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#7f8c8d';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        // 家具タイプのラベル
        ctx.fillStyle = '#2c3e50';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(item.type, x + w / 2, y + h / 2 + 4);
      });
    }

    // 既存のキャリブレーション点を描画
    ctx.fillStyle = '#3498db';
    room.calibrationPoints.forEach(point => {
      const x = padding + point.position.x * scale;
      const y = padding + point.position.y * scale;
      
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.fill();
      
      // ラベル
      ctx.fillStyle = '#2c3e50';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(point.label, x, y - 10);
      ctx.fillStyle = '#3498db';
    });

    // 選択された位置を描画
    if (selectedPosition) {
      const x = padding + selectedPosition.x * scale;
      const y = padding + selectedPosition.y * scale;
      
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, 2 * Math.PI);
      ctx.fill();
      
      // 十字マーク
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 12, y);
      ctx.lineTo(x + 12, y);
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x, y + 12);
      ctx.stroke();

      // ラベル
      if (pointLabel) {
        ctx.fillStyle = '#e74c3c';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(pointLabel, x, y - 15);
      }
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !room) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const padding = 40;
    const width = canvas.width - padding * 2;
    const height = canvas.height - padding * 2;
    
    const scaleX = width / (room.outline?.width || 10);
    const scaleY = height / (room.outline?.height || 8);
    const scale = Math.min(scaleX, scaleY);

    // クリック位置を部屋座標に変換
    const roomX = (clickX - padding) / scale;
    const roomY = (clickY - padding) / scale;

    // 部屋の範囲内かチェック
    if (roomX >= 0 && roomX <= (room.outline?.width || 10) &&
        roomY >= 0 && roomY <= (room.outline?.height || 8)) {
      setSelectedPosition({ x: roomX, y: roomY });
    }
  };

  const startMeasurement = () => {
    if (!selectedDevice) {
      alert('測定に使用するデバイスを選択してください');
      return;
    }

    if (!selectedPosition) {
      alert('マップ上で測定位置をクリックしてください');
      return;
    }

    if (!pointLabel.trim()) {
      alert('測定ポイントのラベルを入力してください');
      return;
    }

    setIsScanning(true);
    
    // RTDBから該当トラッカーのデータを監視
    const trackerRef = ref(rtdb, `CARDS/${selectedDevice}`);
    
    // 測定開始時のタイムスタンプを記録
    let initialTimestamp: string | null = null;
    
    const listener = onValue(trackerRef, (snapshot) => {
      const data = snapshot.val();
      
      if (data && data.ble) {
        const currentTimestamp = data.ts;
        
        // 初回の呼び出しでタイムスタンプを記録
        if (initialTimestamp === null) {
          initialTimestamp = currentTimestamp;
          return;
        }
        
        // タイムスタンプが更新されたら新しいデータと判定
        if (currentTimestamp !== initialTimestamp) {
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
          
          setCurrentMeasurement({
            deviceId: selectedDevice,
            timestamp: currentTimestamp,
            rssiValues: rssiMap
          });
          
          setIsScanning(false);
          off(trackerRef);
        }
      }
    });

    // 65秒後にタイムアウト
    setTimeout(() => {
      if (isScanning) {
        setIsScanning(false);
        off(trackerRef);
        alert('測定がタイムアウトしました。トラッカーがデータを送信するまで最大1分かかります。もう一度試してください。');
      }
    }, 65000);
  };

  const saveCalibrationPoint = async () => {
    if (!currentMeasurement || !selectedPosition || !room) {
      alert('測定を完了してください');
      return;
    }

    if (!pointLabel.trim()) {
      alert('測定ポイントのラベルを入力してください');
      return;
    }

    try {
      // 新しいキャリブレーション点を作成
      const newPoint: CalibrationPoint = {
        id: `custom-${Date.now()}`,
        position: { x: selectedPosition.x, y: selectedPosition.y },
        label: pointLabel.trim(),
        measurements: [currentMeasurement]
      };

      // 既存のキャリブレーション点に追加
      const updatedPoints = [...room.calibrationPoints, newPoint];

      // Firestoreを更新
      await updateDoc(doc(db, 'rooms', roomId!), {
        calibrationPoints: updatedPoints,
        updatedAt: new Date().toISOString()
      });

      alert('キャリブレーション点を追加しました！');
      navigate('/management');
    } catch (error) {
      console.error('保存エラー:', error);
      alert('保存に失敗しました');
    }
  };

  if (loading) {
    return (
      <div className="container">
        <p>読み込み中...</p>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="container">
        <p>ルームが見つかりません</p>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
        キャリブレーション点を追加
      </h1>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>{room.name}</h2>
        <p style={{ marginBottom: '16px', color: '#7f8c8d' }}>
          マップ上で測定したい位置をクリックして選択してください。<br />
          既存のキャリブレーション点は<span style={{ color: '#3498db', fontWeight: 'bold' }}>青色</span>、
          新規追加する点は<span style={{ color: '#e74c3c', fontWeight: 'bold' }}>赤色</span>で表示されます。
        </p>

        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
          <canvas
            ref={canvasRef}
            width={600}
            height={480}
            style={{
              border: '2px solid #e1e8ed',
              borderRadius: '8px',
              cursor: 'crosshair',
              backgroundColor: '#f5f7fa'
            }}
            onClick={handleCanvasClick}
          />
        </div>

        {selectedPosition && (
          <div style={{ 
            padding: '16px', 
            backgroundColor: '#E3F2FD', 
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <p style={{ margin: '0 0 8px 0', color: '#1976D2', fontWeight: 'bold' }}>
              ✓ 測定位置を選択しました
            </p>
            <p style={{ margin: 0, fontSize: '14px', color: '#424242' }}>
              座標: ({selectedPosition.x.toFixed(2)}m, {selectedPosition.y.toFixed(2)}m)
            </p>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">測定ポイントのラベル *</label>
          <input
            type="text"
            className="form-input"
            placeholder="例: テーブル横、窓際、入口付近"
            value={pointLabel}
            onChange={(e) => setPointLabel(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">測定に使用するトラッカー *</label>
          <select
            className="form-select"
            value={selectedDevice}
            onChange={(e) => setSelectedDevice(e.target.value)}
          >
            <option value="">選択してください</option>
            {devices.map(device => (
              <option key={device.devEUI} value={device.devEUI}>
                {device.deviceId || device.userName}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <button
            className="btn btn-primary"
            onClick={startMeasurement}
            disabled={isScanning || !selectedDevice || !selectedPosition || !pointLabel.trim()}
          >
            {isScanning ? '測定中...' : 'ここで測定'}
          </button>
        </div>

        {currentMeasurement && (
          <div style={{ 
            marginBottom: '16px', 
            padding: '16px', 
            backgroundColor: '#D4EDDA', 
            borderRadius: '8px' 
          }}>
            <p style={{ margin: 0, color: '#155724' }}>
              ✓ 測定完了<br />
              検出されたビーコン: {Object.keys(currentMeasurement.rssiValues).length}台
            </p>
            <div style={{ marginTop: '12px' }}>
              <button className="btn btn-primary" onClick={saveCalibrationPoint}>
                この測定を保存
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
          <button
            className="btn btn-outline"
            onClick={() => navigate('/management')}
          >
            キャンセル
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '16px' }}>使い方</h3>
        <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>マップ上で測定したい位置をクリックして選択します</li>
          <li>測定ポイントのラベル（名前）を入力します</li>
          <li>測定に使用するトラッカーを選択します</li>
          <li>選択した位置にトラッカーを持って移動します</li>
          <li>「ここで測定」ボタンをクリックします（最大1分待機）</li>
          <li>測定完了後、「この測定を保存」ボタンで追加完了です</li>
        </ol>
        <p style={{ marginTop: '16px', color: '#7f8c8d', fontSize: '14px' }}>
          ※ 測定は静止した状態で行うと精度が上がります<br />
          ※ 追加したキャリブレーション点は即座に位置推定に反映されます
        </p>
      </div>
    </div>
  );
}

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

  // 操作モード: 'new' | 'remeasure' | 'door_position' | 'door_inside' | 'door_outside'
  const [mode, setMode] = useState<'new' | 'remeasure' | 'door_position' | 'door_inside' | 'door_outside'>('new');
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [doorPosition, setDoorPosition] = useState<{ x: number; y: number } | null>(null);

  // 測定キャンセル用
  const trackerRefRef = useRef<any>(null);
  const listenerRef = useRef<any>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadRoom();
    loadDevices();
  }, [roomId]);

  useEffect(() => {
    if (room && canvasRef.current) {
      drawRoom();
    }
  }, [room, selectedPosition, doorPosition, mode]);

  useEffect(() => {
    // モード切り替え時にリセット
    setSelectedPosition(null);
    setSelectedPointId(null);
    setPointLabel('');
    setCurrentMeasurement(null);
    setSelectedDevice('');
    
    // ドアの位置を初期化
    if (room) {
      const doorPoint = room.calibrationPoints.find(p => p.id === 'door_inside' || p.id === 'door_outside');
      if (doorPoint) {
        // ドアの推定位置を計算
        const doorInside = room.calibrationPoints.find(p => p.id === 'door_inside');
        const doorOutside = room.calibrationPoints.find(p => p.id === 'door_outside');
        if (doorInside && doorOutside) {
          setDoorPosition({
            x: (doorInside.position.x + doorOutside.position.x) / 2,
            y: (doorInside.position.y + doorOutside.position.y) / 2
          });
        }
      }
    }
  }, [mode, room]);

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
        const roomWidth = room.outline?.width || 10;
        const roomHeight = room.outline?.height || 8;
        const x = padding + item.position.x * roomWidth * scale;
        const y = padding + item.position.y * roomHeight * scale;
        const w = item.width * roomWidth * scale;
        const h = item.height * roomHeight * scale;

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
    room.calibrationPoints.forEach(point => {
      const roomWidth = room.outline?.width || 10;
      const roomHeight = room.outline?.height || 8;
      const x = padding + point.position.x * roomWidth * scale;
      const y = padding + point.position.y * roomHeight * scale;
      
      // 再測定モードで選択されているポイントはハイライト
      if (mode === 'remeasure' && selectedPointId === point.id) {
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        ctx.fillStyle = '#3498db';
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, 2 * Math.PI);
        ctx.fill();
      }
      
      // ラベル
      ctx.fillStyle = '#2c3e50';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(point.label, x, y - 12);
    });

    // ドア位置の描画
    if (doorPosition) {
      const roomWidth = room.outline?.width || 10;
      const roomHeight = room.outline?.height || 8;
      const x = padding + doorPosition.x * roomWidth * scale;
      const y = padding + doorPosition.y * roomHeight * scale;
      
      ctx.fillStyle = mode === 'door_position' ? '#f39c12' : '#9b59b6';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.fillStyle = '#2c3e50';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🚪', x, y + 4);
    }

    // 選択された位置を描画（新規追加モード、ドア内外測定モード）
    if (selectedPosition && (mode === 'new' || mode === 'door_inside' || mode === 'door_outside')) {
      const roomWidth = room.outline?.width || 10;
      const roomHeight = room.outline?.height || 8;
      const x = padding + selectedPosition.x * roomWidth * scale;
      const y = padding + selectedPosition.y * roomHeight * scale;
      
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
      if (pointLabel || mode === 'door_inside' || mode === 'door_outside') {
        ctx.fillStyle = '#e74c3c';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        const label = mode === 'door_inside' ? 'ドア内' : mode === 'door_outside' ? 'ドア外' : pointLabel;
        ctx.fillText(label, x, y - 15);
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
    
    const roomWidth = room.outline?.width || 10;
    const roomHeight = room.outline?.height || 8;
    const scaleX = width / roomWidth;
    const scaleY = height / roomHeight;
    const scale = Math.min(scaleX, scaleY);

    // クリック位置を正規化座標に変換
    const normalizedX = (clickX - padding) / scale / roomWidth;
    const normalizedY = (clickY - padding) / scale / roomHeight;

    // 部屋の範囲内かチェック
    if (normalizedX >= 0 && normalizedX <= 1 &&
        normalizedY >= 0 && normalizedY <= 1) {
      
      if (mode === 'new' || mode === 'door_inside' || mode === 'door_outside') {
        setSelectedPosition({ x: normalizedX, y: normalizedY });
      } else if (mode === 'door_position') {
        setDoorPosition({ x: normalizedX, y: normalizedY });
      } else if (mode === 'remeasure') {
        // 既存のポイントをクリックで選択
        const clickedPoint = room.calibrationPoints.find(point => {
          const px = padding + point.position.x * roomWidth * scale;
          const py = padding + point.position.y * roomHeight * scale;
          const distance = Math.sqrt(Math.pow(clickX - px, 2) + Math.pow(clickY - py, 2));
          return distance < 15; // 15px以内ならクリックと判定
        });
        
        if (clickedPoint) {
          setSelectedPointId(clickedPoint.id);
          setPointLabel(clickedPoint.label);
          setSelectedPosition(clickedPoint.position);
        }
      }
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
    // デバイスIDを小文字に正規化（RTDBと一致させる）
    const normalizedDeviceId = selectedDevice.toLowerCase();
    const trackerRef = ref(rtdb, `devices/${normalizedDeviceId}`);
    trackerRefRef.current = trackerRef;
    
    console.log('📍 測定開始:', { selectedDevice, normalizedDeviceId, path: `devices/${normalizedDeviceId}` });
    
    // 測定開始時のタイムスタンプを記録
    let initialTimestamp: string | null = null;
    
    const listener = onValue(trackerRef, (snapshot) => {
      const data = snapshot.val();
      console.log('📡 RTDB更新検知:', { data, timestamp: data?.beaconsUpdatedAt });
      
      if (data && data.beacons) {
        const currentTimestamp = data.beaconsUpdatedAt;
        console.log('⏰ タイムスタンプ比較:', { initialTimestamp, currentTimestamp, isNew: currentTimestamp !== initialTimestamp });
        
        // 初回の呼び出しでタイムスタンプを記録
        if (initialTimestamp === null) {
          initialTimestamp = currentTimestamp;
          console.log('✅ 初回タイムスタンプ記録:', initialTimestamp);
          return;
        }
        
        // タイムスタンプが更新されたら新しいデータと判定
        if (currentTimestamp !== initialTimestamp) {
          console.log('🎯 新しいデータ検知！測定完了');
          
          // 各ビーコンからRSSI値を取得
          const rssiMap: { [beaconId: string]: number } = {};
          
          data.beacons.forEach((beacon: any) => {
            if (beacon.mac && beacon.rssi) {
              // MACアドレスを正規化（コロン区切りを大文字に統一）
              const normalizedMac = beacon.mac.toUpperCase().replace(/:/g, '');
              rssiMap[normalizedMac] = beacon.rssi;
            }
          });
          
          console.log('📊 取得したRSSI値:', rssiMap);
          
          setCurrentMeasurement({
            deviceId: selectedDevice,
            timestamp: currentTimestamp,
            rssiValues: rssiMap
          });
          
          setIsScanning(false);
          off(trackerRef);
          trackerRefRef.current = null;
          listenerRef.current = null;
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        }
      } else {
        console.log('⚠️ beaconsデータが見つかりません', data);
      }
    }, (error) => {
      console.error('❌ RTDB読み込みエラー:', error);
      setIsScanning(false);
    });

    listenerRef.current = listener;

    // 65秒後にタイムアウト
    const timeout = setTimeout(() => {
      if (isScanning) {
        console.log('⏱️ 測定がタイムアウト');
        setIsScanning(false);
        off(trackerRef);
        trackerRefRef.current = null;
        listenerRef.current = null;
        alert('測定がタイムアウトしました。トラッカーがデータを送信するまで最大1分かかります。もう一度試してください。');
      }
    }, 65000);

    timeoutRef.current = timeout;
  };

  const cancelMeasurement = () => {
    console.log('❌ 測定をキャンセル');
    setIsScanning(false);
    
    if (trackerRefRef.current) {
      off(trackerRefRef.current);
      trackerRefRef.current = null;
    }
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    listenerRef.current = null;
    setCurrentMeasurement(null);
  };

  const saveCalibrationPoint = async () => {
    if (!currentMeasurement || !room) {
      alert('測定を完了してください');
      return;
    }

    try {
      let updatedPoints = [...room.calibrationPoints];

      if (mode === 'new') {
        // 新規キャリブレーション点を追加
        if (!selectedPosition || !pointLabel.trim()) {
          alert('位置とラベルを設定してください');
          return;
        }

        const newPoint: CalibrationPoint = {
          id: `custom-${Date.now()}`,
          position: { x: selectedPosition.x, y: selectedPosition.y },
          label: pointLabel.trim(),
          measurements: [currentMeasurement]
        };

        updatedPoints.push(newPoint);
      } else if (mode === 'remeasure') {
        // 既存のキャリブレーション点に測定を追加
        if (!selectedPointId) {
          alert('再測定するポイントを選択してください');
          return;
        }

        updatedPoints = updatedPoints.map(point => {
          if (point.id === selectedPointId) {
            return {
              ...point,
              measurements: [...point.measurements, currentMeasurement]
            };
          }
          return point;
        });
      } else if (mode === 'door_inside' || mode === 'door_outside') {
        // ドアの内側または外側の測定を更新
        if (!selectedPosition || !doorPosition) {
          alert('ドア位置と測定位置を設定してください');
          return;
        }

        updatedPoints = updatedPoints.map(point => {
          if (point.id === mode) {
            return {
              ...point,
              position: { x: selectedPosition.x, y: selectedPosition.y },
              measurements: [currentMeasurement] // 新しい測定で置き換え
            };
          }
          return point;
        });
      }

      // Firestoreを更新
      await updateDoc(doc(db, 'rooms', roomId!), {
        calibrationPoints: updatedPoints,
        updatedAt: new Date().toISOString()
      });

      const message = mode === 'new' ? 'キャリブレーション点を追加しました！' :
                      mode === 'remeasure' ? 'キャリブレーション点を再測定しました！' :
                      'ドアの測定点を更新しました！';
      alert(message);
      navigate(`/edit-room/${roomId}`);
    } catch (error) {
      console.error('保存エラー:', error);
      alert('保存に失敗しました');
    }
  };

  const saveDoorPosition = async () => {
    if (!doorPosition || !room) {
      alert('ドアの位置を選択してください');
      return;
    }

    try {
      // ドアの内側・外側のポイントを更新
      let updatedPoints = room.calibrationPoints.map(point => {
        if (point.id === 'door_inside') {
          // ドアの内側は部屋の中心寄りに配置（仮の位置）
          return {
            ...point,
            position: {
              x: doorPosition.x + (0.5 - doorPosition.x) * 0.1,
              y: doorPosition.y + (0.5 - doorPosition.y) * 0.1
            }
          };
        } else if (point.id === 'door_outside') {
          // ドアの外側は部屋の外側寄りに配置（仮の位置）
          return {
            ...point,
            position: {
              x: doorPosition.x - (0.5 - doorPosition.x) * 0.1,
              y: doorPosition.y - (0.5 - doorPosition.y) * 0.1
            }
          };
        }
        return point;
      });

      await updateDoc(doc(db, 'rooms', roomId!), {
        calibrationPoints: updatedPoints,
        updatedAt: new Date().toISOString()
      });

      alert('ドアの位置を更新しました！内側・外側の測定点を再測定してください。');
      setMode('new');
      loadRoom();
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
        キャリブレーション点の管理
      </h1>

      {/* モード選択 */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>📋 操作を選択</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <button
            className={`btn ${mode === 'new' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setMode('new')}
            style={{ padding: '16px' }}
          >
            ➕ 新規追加
          </button>
          <button
            className={`btn ${mode === 'remeasure' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setMode('remeasure')}
            style={{ padding: '16px' }}
          >
            🔄 既存点を再測定
          </button>
          <button
            className={`btn ${mode === 'door_position' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setMode('door_position')}
            style={{ padding: '16px' }}
          >
            🚪 ドア位置変更
          </button>
          <button
            className={`btn ${mode === 'door_inside' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setMode('door_inside')}
            style={{ padding: '16px' }}
          >
            🚪➡️ ドア内側再測定
          </button>
          <button
            className={`btn ${mode === 'door_outside' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setMode('door_outside')}
            style={{ padding: '16px' }}
          >
            🚪⬅️ ドア外側再測定
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>{room.name}</h2>
        
        {/* モード別の説明 */}
        {mode === 'new' && (
          <p style={{ marginBottom: '16px', color: '#7f8c8d' }}>
            マップ上で測定したい位置をクリックして選択してください。<br />
            既存のキャリブレーション点は<span style={{ color: '#3498db', fontWeight: 'bold' }}>青色</span>、
            新規追加する点は<span style={{ color: '#e74c3c', fontWeight: 'bold' }}>赤色</span>で表示されます。
          </p>
        )}
        {mode === 'remeasure' && (
          <p style={{ marginBottom: '16px', color: '#7f8c8d' }}>
            マップ上の<span style={{ color: '#3498db', fontWeight: 'bold' }}>青色のキャリブレーション点</span>をクリックして選択してください。<br />
            選択した点で追加測定を行うと、位置推定の精度が向上します。
          </p>
        )}
        {mode === 'door_position' && (
          <p style={{ marginBottom: '16px', color: '#7f8c8d' }}>
            マップ上でドアの新しい位置をクリックして選択してください。<br />
            ドア位置を変更した後、内側・外側の測定点を再測定することをお勧めします。
          </p>
        )}
        {mode === 'door_inside' && (
          <p style={{ marginBottom: '16px', color: '#7f8c8d' }}>
            <span style={{ color: '#9b59b6', fontWeight: 'bold' }}>🚪ドア位置</span>から部屋の内側の地点をクリックして選択してください。<br />
            その位置で測定を行います。
          </p>
        )}
        {mode === 'door_outside' && (
          <p style={{ marginBottom: '16px', color: '#7f8c8d' }}>
            <span style={{ color: '#9b59b6', fontWeight: 'bold' }}>🚪ドア位置</span>から部屋の外側の地点をクリックして選択してください。<br />
            その位置で測定を行います。
          </p>
        )}

        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
          <canvas
            ref={canvasRef}
            width={600}
            height={480}
            style={{
              border: '2px solid #e1e8ed',
              borderRadius: '8px',
              cursor: mode === 'remeasure' ? 'pointer' : 'crosshair',
              backgroundColor: '#f5f7fa'
            }}
            onClick={handleCanvasClick}
          />
        </div>

        {/* ドア位置選択モード */}
        {mode === 'door_position' && doorPosition && (
          <div style={{ 
            padding: '16px', 
            backgroundColor: '#F3E5F5', 
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <p style={{ margin: '0 0 8px 0', color: '#7B1FA2', fontWeight: 'bold' }}>
              ✓ ドア位置を選択しました
            </p>
            <p style={{ margin: 0, fontSize: '14px', color: '#424242' }}>
              正規化座標: ({doorPosition.x.toFixed(3)}, {doorPosition.y.toFixed(3)})
            </p>
            <button
              className="btn btn-primary"
              onClick={saveDoorPosition}
              style={{ marginTop: '12px' }}
            >
              ドア位置を保存
            </button>
          </div>
        )}

        {/* 位置選択の確認表示 */}
        {(mode === 'new' || mode === 'door_inside' || mode === 'door_outside') && selectedPosition && (
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
              正規化座標: ({selectedPosition.x.toFixed(3)}, {selectedPosition.y.toFixed(3)})
            </p>
          </div>
        )}

        {/* 既存点選択の確認表示 */}
        {mode === 'remeasure' && selectedPointId && (
          <div style={{ 
            padding: '16px', 
            backgroundColor: '#E8F5E9', 
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <p style={{ margin: '0 0 8px 0', color: '#2E7D32', fontWeight: 'bold' }}>
              ✓ キャリブレーション点を選択しました
            </p>
            <p style={{ margin: 0, fontSize: '14px', color: '#424242' }}>
              ラベル: <strong>{pointLabel}</strong><br />
              正規化座標: ({selectedPosition?.x.toFixed(3)}, {selectedPosition?.y.toFixed(3)})
            </p>
          </div>
        )}

        {/* 新規追加モードのラベル入力 */}
        {mode === 'new' && (
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
        )}

        {/* 測定関連のUI（ドア位置変更モード以外） */}
        {mode !== 'door_position' && (
          <>
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
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  className="btn btn-primary"
                  onClick={startMeasurement}
                  disabled={
                    isScanning || 
                    !selectedDevice || 
                    !selectedPosition || 
                    (mode === 'new' && !pointLabel.trim()) ||
                    (mode === 'remeasure' && !selectedPointId)
                  }
                >
                  {isScanning ? '測定中...' : 'ここで測定'}
                </button>
                {isScanning && (
                  <button
                    className="btn btn-outline"
                    onClick={cancelMeasurement}
                  >
                    測定キャンセル
                  </button>
                )}
              </div>
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
                    {mode === 'new' ? 'この測定を保存' : 
                     mode === 'remeasure' ? '追加測定を保存' : 
                     'ドア測定点を更新'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
          <button
            className="btn btn-outline"
            onClick={() => navigate(`/edit-room/${roomId}`)}
          >
            戻る
          </button>
        </div>
      </div>

      {/* 使い方の説明 */}
      <div className="card">
        <h3 style={{ marginBottom: '16px' }}>💡 使い方</h3>
        
        {mode === 'new' && (
          <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
            <li>マップ上で測定したい位置をクリックして選択します</li>
            <li>測定ポイントのラベル（名前）を入力します</li>
            <li>測定に使用するトラッカーを選択します</li>
            <li>選択した位置にトラッカーを持って移動します</li>
            <li>「ここで測定」ボタンをクリックします（最大1分待機）</li>
            <li>測定完了後、「この測定を保存」ボタンで追加完了です</li>
          </ol>
        )}
        
        {mode === 'remeasure' && (
          <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
            <li>マップ上の青いキャリブレーション点をクリックして選択します</li>
            <li>測定に使用するトラッカーを選択します</li>
            <li>選択したキャリブレーション点の位置にトラッカーを持って移動します</li>
            <li>「ここで測定」ボタンをクリックします（最大1分待機）</li>
            <li>測定完了後、「追加測定を保存」ボタンで完了です</li>
          </ol>
        )}
        
        {mode === 'door_position' && (
          <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
            <li>マップ上でドアの新しい位置をクリックして選択します</li>
            <li>「ドア位置を保存」ボタンをクリックします</li>
            <li>ドア位置を変更した後、「ドア内側再測定」「ドア外側再測定」で測定点を更新してください</li>
          </ol>
        )}
        
        {(mode === 'door_inside' || mode === 'door_outside') && (
          <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
            <li>マップ上でドアの{mode === 'door_inside' ? '内側' : '外側'}の測定位置をクリックして選択します</li>
            <li>測定に使用するトラッカーを選択します</li>
            <li>選択した位置にトラッカーを持って移動します</li>
            <li>「ここで測定」ボタンをクリックします（最大1分待機）</li>
            <li>測定完了後、「ドア測定点を更新」ボタンで完了です</li>
          </ol>
        )}
        
        <p style={{ marginTop: '16px', color: '#7f8c8d', fontSize: '14px' }}>
          ※ 測定は静止した状態で行うと精度が上がります<br />
          ※ 複数回測定することで位置推定の精度が向上します
        </p>
      </div>
    </div>
  );
}

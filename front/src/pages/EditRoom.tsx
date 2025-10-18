import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { RoomProfile } from '../types';

export default function EditRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  
  const [room, setRoom] = useState<RoomProfile | null>(null);
  const [roomWidth, setRoomWidth] = useState<string>('');
  const [roomHeight, setRoomHeight] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRoom();
  }, [roomId]);

  const loadRoom = async () => {
    if (!roomId) return;
    
    try {
      const roomDoc = await getDoc(doc(db, 'rooms', roomId));
      if (roomDoc.exists()) {
        const roomData = { roomId: roomDoc.id, ...roomDoc.data() } as RoomProfile;
        setRoom(roomData);
        
        // 既存の部屋サイズを設定
        if (roomData.outline) {
          setRoomWidth(roomData.outline.width.toString());
          setRoomHeight(roomData.outline.height.toString());
        }
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

  const saveRoomSize = async () => {
    if (!roomId || !room) return;

    const parsedWidth = roomWidth ? parseFloat(roomWidth) : undefined;
    const parsedHeight = roomHeight ? parseFloat(roomHeight) : undefined;

    if (roomWidth && roomHeight && (!parsedWidth || !parsedHeight || parsedWidth <= 0 || parsedHeight <= 0)) {
      alert('有効な部屋サイズを入力してください');
      return;
    }

    try {
      const updateData: Partial<RoomProfile> = {
        outline: parsedWidth && parsedHeight 
          ? { width: parsedWidth, height: parsedHeight }
          : undefined,
        updatedAt: new Date().toISOString()
      };

      await updateDoc(doc(db, 'rooms', roomId), updateData);
      
      const sizeInfo = parsedWidth && parsedHeight 
        ? `${parsedWidth}m × ${parsedHeight}m` 
        : '正規化座標';
      alert(`部屋サイズを「${sizeInfo}」に更新しました`);
      
      // ルーム情報を再読み込み
      loadRoom();
    } catch (error) {
      console.error('保存エラー:', error);
      alert('保存に失敗しました');
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="container">
        <h1>ルームが見つかりません</h1>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700' }}>
          ルームの編集: {room.name}
        </h1>
        <button 
          className="btn btn-outline"
          onClick={() => navigate('/management')}
        >
          ← 一覧に戻る
        </button>
      </div>

      {/* 部屋サイズの設定・編集 */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>📏 部屋サイズの設定</h2>
        <p style={{ marginBottom: '16px', fontSize: '14px', color: '#7f8c8d' }}>
          実際の部屋サイズを入力すると、メートル単位で保存されます。<br />
          未入力の場合は、0~1の正規化座標で保存されます。
        </p>

        {!room.outline && (
          <div style={{
            padding: '12px',
            backgroundColor: '#FFF3CD',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '14px',
            borderLeft: '4px solid #FFC107'
          }}>
            <strong>ℹ️ 注意:</strong> 現在、部屋サイズが未設定のため、正規化座標（0~1）で保存されています。
            実際の部屋サイズを入力すると、より正確な位置表示が可能になります。
          </div>
        )}

        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px', fontWeight: '600' }}>
              幅（メートル）
            </label>
            <input
              type="number"
              className="form-input"
              placeholder="例: 10.5"
              value={roomWidth}
              onChange={(e) => setRoomWidth(e.target.value)}
              step="0.1"
              min="0"
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px', fontWeight: '600' }}>
              高さ（メートル）
            </label>
            <input
              type="number"
              className="form-input"
              placeholder="例: 8.2"
              value={roomHeight}
              onChange={(e) => setRoomHeight(e.target.value)}
              step="0.1"
              min="0"
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={saveRoomSize}
            style={{ marginBottom: '0' }}
          >
            {room.outline ? 'サイズを更新' : 'サイズを設定'}
          </button>
        </div>

        <div style={{
          padding: '12px',
          backgroundColor: '#E3F2FD',
          borderRadius: '8px',
          fontSize: '14px'
        }}>
          <strong>現在の設定:</strong>{' '}
          {room.outline 
            ? `${room.outline.width}m × ${room.outline.height}m（実寸）` 
            : '正規化座標（0~1）で保存されています'}
        </div>
      </div>

      {/* キャリブレーション点の追加 */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>📍 キャリブレーション点の管理</h2>
        <p style={{ marginBottom: '16px', fontSize: '14px', color: '#7f8c8d' }}>
          キャリブレーション点を追加することで、位置推定の精度を向上できます。
        </p>

        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>現在のキャリブレーション点</h3>
          {room.calibrationPoints && room.calibrationPoints.length > 0 ? (
            <ul style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
              {room.calibrationPoints.map((point, index) => (
                <li key={point.id || index}>
                  <strong>{point.label}</strong> - 
                  位置: ({point.position.x.toFixed(2)}, {point.position.y.toFixed(2)}) - 
                  測定数: {point.measurements.length}回
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: '#7f8c8d' }}>キャリブレーション点がありません</p>
          )}
        </div>

        <button
          className="btn btn-primary"
          onClick={() => navigate(`/add-calibration-point/${roomId}`)}
        >
          ＋ キャリブレーション点を追加
        </button>
      </div>

      {/* ビーコンとその他の情報 */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>📡 ビーコン情報</h2>
        <p style={{ marginBottom: '8px' }}>
          <strong>使用ビーコン数:</strong> {room.beacons.length}台
        </p>
        {room.beaconPositions && room.beaconPositions.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>ビーコン配置</h3>
            <ul style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
              {room.beaconPositions.map((beacon, index) => (
                <li key={index}>
                  <strong>{beacon.name}</strong> - 
                  位置: ({(beacon.position.x * 100).toFixed(0)}%, {(beacon.position.y * 100).toFixed(0)}%)
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 家具情報 */}
      {room.furniture && room.furniture.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: '16px' }}>🪑 配置されている家具</h2>
          <p style={{ marginBottom: '8px' }}>
            <strong>家具数:</strong> {room.furniture.length}個
          </p>
          <ul style={{ paddingLeft: '20px', lineHeight: '1.8', fontSize: '14px' }}>
            {room.furniture.map((item, index) => (
              <li key={item.id || index}>
                {item.type} - 
                位置: ({(item.position.x * 100).toFixed(0)}%, {(item.position.y * 100).toFixed(0)}%)
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ヒント */}
      <div className="card" style={{ marginTop: '24px' }}>
        <h3 style={{ marginBottom: '16px' }}>💡 使い方のヒント</h3>
        <ul style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li><strong>部屋サイズ:</strong> 実際の部屋サイズを入力することで、より正確な位置表示が可能になります</li>
          <li><strong>正規化座標:</strong> サイズ未設定の場合、座標は0~1の範囲で保存されます（後から実寸に変換可能）</li>
          <li><strong>キャリブレーション点の追加:</strong> 部屋の複雑な形状や電波が届きにくいエリアで追加測定すると精度が向上します</li>
          <li><strong>推奨:</strong> 最初のキャリブレーション後、実際に使用してみて精度が低いと感じる場所で追加測定を行うと効果的です</li>
        </ul>
      </div>
    </div>
  );
}

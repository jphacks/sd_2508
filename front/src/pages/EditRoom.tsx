import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { RoomProfile, Beacon } from '../types';

export default function EditRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  
  const [room, setRoom] = useState<RoomProfile | null>(null);
  const [roomWidth, setRoomWidth] = useState<string>('');
  const [roomHeight, setRoomHeight] = useState<string>('');
  const [exitMargin, setExitMargin] = useState<string>('0.5');
  const [loading, setLoading] = useState(true);
  const [beaconMap, setBeaconMap] = useState<{ [key: string]: Beacon }>({});


  useEffect(() => {
    loadRoom();
    loadBeacons();
  }, [roomId]);

  const loadBeacons = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'beacons'));
      const map: { [key: string]: Beacon } = {};
      snapshot.docs.forEach(doc => {
        map[doc.id] = { ...doc.data(), firestoreId: doc.id } as Beacon & { firestoreId: string };
      });
      setBeaconMap(map);
    } catch (error) {
      console.error('ビーコン読み込みエラー:', error);
    }
  };

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
        if (typeof roomData.exitMargin === 'number') {
          setExitMargin(roomData.exitMargin.toString());
        } else {
          setExitMargin('0.5');
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
    const parsedMargin = exitMargin !== '' ? parseFloat(exitMargin) : 0.5;
    if (!Number.isFinite(parsedMargin) || parsedMargin < 0) {
      alert('有効な退室マージンを入力してください（0以上の値）');
      return;
    }

    try {
      const updateData: Partial<RoomProfile> = {
        outline: parsedWidth && parsedHeight 
          ? { width: parsedWidth, height: parsedHeight }
          : undefined,
        exitMargin: parsedMargin,
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
          onClick={() => navigate('/calibration')}
        >
          戻る
        </button>
      </div>

      {/* 部屋サイズの設定とビーコン情報 */}
      <div
        style={{
          display: 'flex',
          gap: '24px',
          marginBottom: '24px',
          flexWrap: 'wrap',
          alignItems: 'stretch'
        }}
      >
        <div className="card" style={{ flex: '1 1 340px', marginBottom: 0 }}>
          <h2 style={{ marginBottom: '16px' }}>部屋サイズの設定</h2>
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
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px', fontWeight: '600' }}>
              退室判定マージン（メートル）
            </label>
            <input
              type="number"
              className="form-input"
              placeholder="例: 0.5"
              value={exitMargin}
              onChange={(e) => setExitMargin(e.target.value)}
              step="0.1"
              min="0"
            />
            <p style={{ fontSize: '12px', color: '#7f8c8d', marginTop: '4px' }}>
              室内判定に使う境界からの余白です。値を大きくすると退室判定が厳しくなります。
            </p>
          </div>
        </div>

        <div className="card" style={{ flex: '1 1 340px', marginBottom: 0 }}>
          <h2 style={{ marginBottom: '16px' }}>ビーコン情報</h2>
          <p style={{ marginBottom: '16px', fontSize: '14px' }}>
            <strong>使用ビーコン数:</strong> {room.beacons.length}台
          </p>
          {room.beacons && room.beacons.length > 0 ? (
            <div>
              <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>ビーコン配置</h3>
              <ul style={{ paddingLeft: '20px', lineHeight: '2', fontSize: '14px' }}>
                {room.beacons.map((beaconId, index) => {
                  const beaconData = beaconMap[beaconId];
                  const beaconPosition = room.beaconPositions?.find(bp => bp.id === beaconId);
                  const displayName = beaconData?.beaconId || beaconData?.name || beaconId;
                  
                  if (beaconPosition) {
                    const displayX = room.outline ? (beaconPosition.position.x * room.outline.width).toFixed(2) : (beaconPosition.position.x * 100).toFixed(0);
                    const displayY = room.outline ? (beaconPosition.position.y * room.outline.height).toFixed(2) : (beaconPosition.position.y * 100).toFixed(0);
                    const unit = room.outline ? 'm' : '%';
                    
                    return (
                      <li key={beaconId}>
                        <strong>{displayName}</strong><br />
                        <span style={{ fontSize: '12px', color: '#7f8c8d', marginLeft: '8px' }}>
                          位置: ({displayX}{unit}, {displayY}{unit})
                        </span>
                      </li>
                    );
                  }
                  
                  return (
                    <li key={beaconId}>
                      <strong>{displayName}</strong><br />
                      <span style={{ fontSize: '12px', color: '#7f8c8d', marginLeft: '8px' }}>
                        位置: 未設定
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p style={{ color: '#7f8c8d' }}>ビーコンが配置されていません</p>
          )}
        </div>
      </div>

      {/* キャリブレーション点と家具情報を並べて表示 */}
      <div style={{ display: 'flex', gap: '24px', marginBottom: '24px' }}>
        {/* キャリブレーション点の追加 */}
        <div className="card" style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>キャリブレーション点の管理</h2>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/add-calibration-point/${roomId}`)}
              style={{ marginBottom: 0 }}
            >
              編集
            </button>
          </div>
          
          <p style={{ marginBottom: '16px', fontSize: '14px', color: '#7f8c8d' }}>
            キャリブレーション点を追加することで、位置推定の精度を向上できます。
          </p>

          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>現在のキャリブレーション点</h3>
            {room.calibrationPoints && room.calibrationPoints.length > 0 ? (
              <ul style={{ paddingLeft: '20px', lineHeight: '1.8', fontSize: '14px' }}>
                {room.calibrationPoints.map((point, index) => {
                  // 部屋サイズが設定されている場合はメートル単位で表示、それ以外は正規化座標で表示
                  const displayX = room.outline ? (point.position.x * room.outline.width).toFixed(2) : point.position.x.toFixed(2);
                  const displayY = room.outline ? (point.position.y * room.outline.height).toFixed(2) : point.position.y.toFixed(2);
                  const unit = room.outline ? 'm' : '(正規化)';
                  
                  return (
                    <li key={point.id || index}>
                      <strong>{point.label}</strong> - 
                      位置: ({displayX}, {displayY}){unit} - 
                      測定数: {point.measurements.length}回
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p style={{ color: '#7f8c8d' }}>キャリブレーション点がありません</p>
            )}
          </div>
        </div>

        {/* 家具情報と編集ボタン */}
        <div className="card" style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>家具とオブジェクトの配置</h2>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/edit-furniture/${roomId}`)}
              style={{ marginBottom: 0 }}
            >
              編集
            </button>
          </div>
          
          {room.furniture && room.furniture.length > 0 ? (
            <>
              <p style={{ marginBottom: '12px', fontSize: '14px' }}>
                <strong>配置済み家具:</strong> {room.furniture.length}個
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', maxHeight: '300px', overflowY: 'auto' }}>
                {room.furniture.map((item, index) => (
                  <div
                    key={item.id || index}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#F8F9FA',
                      borderRadius: '4px',
                      fontSize: '13px',
                      border: '1px solid #E1E8ED'
                    }}
                  >
                    <strong>{item.type}</strong><br />
                    <span style={{ color: '#7f8c8d', fontSize: '12px' }}>
                      位置: ({item.position.x.toFixed(1)}, {item.position.y.toFixed(1)})<br />
                      サイズ: {item.width.toFixed(1)} × {item.height.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px', color: '#7f8c8d' }}>
              <p style={{ marginBottom: '12px', fontSize: '14px' }}>まだ家具が配置されていません</p>
              <button
                className="btn btn-outline"
                onClick={() => navigate(`/edit-furniture/${roomId}`)}
              >
                配置を開始
              </button>
            </div>
          )}
        </div>
      </div>

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

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { RoomProfile } from '../types';

export default function CalibrationRoomList() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<(RoomProfile & { id: string })[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRooms();
    loadActiveRoom();
  }, []);

  useEffect(() => {
    // ルームが1つもない場合は、キャリブレーション画面にリダイレクト
    if (!loading && rooms.length === 0) {
      navigate('/calibration/mode1');
    }
  }, [loading, rooms, navigate]);

  const loadRooms = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'rooms'));
      const data = snapshot.docs.map(doc => ({ 
        id: doc.id,
        ...doc.data()
      } as RoomProfile & { id: string }));
      setRooms(data);
    } catch (error) {
      console.error('ルーム読み込みエラー:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadActiveRoom = async () => {
    try {
      // TODO: 実際のユーザーIDを使用
      const userId = 'demo-user';
      const configDoc = await getDocs(collection(db, 'appConfig'));
      const userConfig = configDoc.docs.find(d => d.data().userId === userId);
      
      if (userConfig && userConfig.data().mode1?.roomId) {
        setActiveRoomId(userConfig.data().mode1.roomId);
      }
    } catch (error) {
      console.error('アクティブルーム読み込みエラー:', error);
    }
  };

  const setActiveRoom = async (roomId: string) => {
    try {
      // TODO: 実際のユーザーIDを使用
      const userId = 'demo-user';
      
      // appConfigコレクションでユーザーの設定を更新
      await setDoc(doc(db, 'appConfig', userId), {
        userId,
        currentMode: 'mode1',
        mode1: {
          roomId,
          alertOnExit: true,
          calibrated: true
        }
      }, { merge: true });
      
      setActiveRoomId(roomId);
    } catch (error) {
      console.error('アクティブルーム設定エラー:', error);
      alert('アクティブルームの設定に失敗しました');
    }
  };

  const deleteRoom = async (roomId: string) => {
    if (!confirm('本当にこのルームを削除しますか？キャリブレーションデータも失われます。')) return;
    
    try {
      await deleteDoc(doc(db, 'rooms', roomId));
      if (activeRoomId === roomId) {
        setActiveRoomId(null);
      }
      loadRooms();
    } catch (error) {
      console.error('ルーム削除エラー:', error);
      alert('ルームの削除に失敗しました');
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  const handleEditFurniture = (roomId: string) => {
    navigate(`/calibration/furniture/${roomId}`);
  };

  // ルームが0の場合はリダイレクトされるのでここには来ない
  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700', margin: 0 }}>
          キャリブレーション
        </h1>
        <button 
          className="btn btn-primary"
          onClick={() => navigate('/calibration/mode1')}
        >
          ＋ 新規ルーム作成
        </button>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: '16px' }}>キャリブレーション済みルーム</h2>
        <p style={{ marginBottom: '16px', color: '#7f8c8d' }}>
          機能1（室内測位）で有効化するルームを選択してください。
        </p>

        <div className="table-container">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e1e8ed', textAlign: 'left' }}>
                <th style={{ padding: '10px' }}>ルーム名</th>
                <th style={{ padding: '10px' }}>ビーコン数</th>
                <th style={{ padding: '10px' }}>キャリブレーション点</th>
                <th style={{ padding: '10px' }}>家具数</th>
                <th style={{ padding: '10px' }}>サイズ</th>
                <th style={{ padding: '10px' }}>作成日</th>
                <th style={{ padding: '10px' }}>状態</th>
                <th style={{ padding: '10px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map(room => {
                const isActive = activeRoomId === room.id;
                return (
                  <tr key={room.id} style={{ 
                    borderBottom: '1px solid #e1e8ed',
                    backgroundColor: isActive ? '#E3F2FD' : 'transparent'
                  }}>
                    <td style={{ padding: '10px' }}>
                      <strong>{room.name}</strong>
                      {isActive && (
                        <span style={{
                          marginLeft: '8px',
                          padding: '2px 6px',
                          borderRadius: '8px',
                          fontSize: '10px',
                          backgroundColor: '#4A90E2',
                          color: 'white'
                        }}>
                          使用中
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px' }}>{room.beacons.length}台</td>
                    <td style={{ padding: '10px' }}>{room.calibrationPoints.length}ヶ所</td>
                    <td style={{ padding: '10px' }}>{room.furniture?.length || 0}個</td>
                    <td style={{ padding: '10px' }}>
                      {room.outline ? `${room.outline.width}m × ${room.outline.height}m` : '未設定'}
                    </td>
                    <td style={{ padding: '10px', fontSize: '14px', color: '#7f8c8d' }}>
                      {new Date(room.createdAt).toLocaleDateString('ja-JP')}
                    </td>
                    <td style={{ padding: '7px' }}>
                      {isActive ? (
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          backgroundColor: '#D4EDDA',
                          color: '#155724'
                        }}>
                          使用中
                        </span>
                      ) : (
                        <button
                          onClick={() => setActiveRoom(room.id)}
                          style={{
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            backgroundColor: '#F8F9FA',
                            color: '#6C757D',
                            border: '1px solid #E1E8ED',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            fontWeight: 'normal'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#E3F2FD';
                            e.currentTarget.style.color = '#1976D2';
                            e.currentTarget.style.borderColor = '#1976D2';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = '#F8F9FA';
                            e.currentTarget.style.color = '#6C757D';
                            e.currentTarget.style.borderColor = '#E1E8ED';
                          }}
                        >
                          未使用
                        </button>
                      )}
                    </td>
                    <td style={{ padding: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-outline btn-compact"
                        onClick={() => navigate(`/edit-room/${room.id}`)}
                      >
                        編集
                      </button>
                      {/* <button
                        className="btn btn-outline"
                        style={{ padding: '6px 9px', fontSize: '10px', backgroundColor: '#FFF3CD', borderColor: '#FFEAA7', color: '#856404' }}
                        onClick={() => handleEditFurniture(room.id)}
                      >
                        家具編集
                      </button> */}
                      <button
                        className="btn btn-danger btn-compact"
                        onClick={() => deleteRoom(room.id)}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: '24px' }}>
        <h3 style={{ marginBottom: '16px' }}>💡 使い方</h3>
        <ul style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li><strong>新規ルーム作成:</strong> 新しい部屋のキャリブレーションを行う場合は「新規ルーム作成」ボタンをクリック</li>
          <li><strong>使用する:</strong> このルームを機能1（室内測位）で使用する場合に選択</li>
          <li><strong>編集:</strong> 既存のルームの部屋サイズを変更したり、キャリブレーション点を追加して精度を向上</li>
        </ul>
      </div>
    </div>
  );
}

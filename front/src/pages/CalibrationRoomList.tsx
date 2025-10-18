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
      alert('アクティブなルームを設定しました');
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

  // ルームが0の場合はリダイレクトされるのでここには来ない
  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700' }}>
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
        <h2 style={{ marginBottom: '16px' }}>キャリブレーション済みルーム一覧</h2>
        <p style={{ marginBottom: '16px', color: '#7f8c8d' }}>
          機能1（室内測位）で使用するルームを選択してください。
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e1e8ed', textAlign: 'left' }}>
                <th style={{ padding: '12px' }}>ルーム名</th>
                <th style={{ padding: '12px' }}>ビーコン数</th>
                <th style={{ padding: '12px' }}>キャリブレーション点</th>
                <th style={{ padding: '12px' }}>サイズ</th>
                <th style={{ padding: '12px' }}>作成日</th>
                <th style={{ padding: '12px' }}>状態</th>
                <th style={{ padding: '12px' }}>操作</th>
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
                    <td style={{ padding: '12px' }}>
                      <strong>{room.name}</strong>
                      {isActive && (
                        <span style={{
                          marginLeft: '8px',
                          padding: '2px 8px',
                          borderRadius: '8px',
                          fontSize: '11px',
                          backgroundColor: '#4A90E2',
                          color: 'white'
                        }}>
                          アクティブ
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px' }}>{room.beacons.length}台</td>
                    <td style={{ padding: '12px' }}>{room.calibrationPoints.length}ヶ所</td>
                    <td style={{ padding: '12px' }}>
                      {room.outline ? `${room.outline.width}m × ${room.outline.height}m` : '未設定'}
                    </td>
                    <td style={{ padding: '12px', fontSize: '14px', color: '#7f8c8d' }}>
                      {new Date(room.createdAt).toLocaleDateString('ja-JP')}
                    </td>
                    <td style={{ padding: '12px' }}>
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
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          backgroundColor: '#F8F9FA',
                          color: '#6C757D'
                        }}>
                          未使用
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {!isActive && (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '6px 12px', fontSize: '14px' }}
                          onClick={() => setActiveRoom(room.id)}
                        >
                          使用する
                        </button>
                      )}
                      <button
                        className="btn btn-outline"
                        style={{ padding: '6px 12px', fontSize: '14px' }}
                        onClick={() => navigate(`/add-calibration-point/${room.id}`)}
                      >
                        追加測定
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '6px 12px', fontSize: '14px' }}
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
        <h3 style={{ marginBottom: '16px' }}>💡 使い方のヒント</h3>
        <ul style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li><strong>新規ルーム作成:</strong> 新しい部屋のキャリブレーションを行う場合は「新規ルーム作成」ボタンをクリック</li>
          <li><strong>使用する:</strong> このルームを機能1（室内測位）で使用する場合に選択</li>
          <li><strong>追加測定:</strong> 既存のルームにキャリブレーション点を追加して精度を向上</li>
          <li><strong>削除:</strong> 不要になったルームを削除（復元できないのでご注意ください）</li>
        </ul>
      </div>
    </div>
  );
}

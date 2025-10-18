import { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Device, Beacon, RoomProfile } from '../types';

export default function Management() {
  const [activeTab, setActiveTab] = useState<'devices' | 'beacons' | 'rooms'>('devices');
  const [devices, setDevices] = useState<Device[]>([]);
  const [beacons, setBeacons] = useState<Beacon[]>([]);
  const [rooms, setRooms] = useState<(RoomProfile & { id: string })[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [showAddBeacon, setShowAddBeacon] = useState(false);
  const [editingBeaconId, setEditingBeaconId] = useState<string | null>(null);
  const [editRssiAt1m, setEditRssiAt1m] = useState<string>('');

  useEffect(() => {
    loadDevices();
    loadBeacons();
    loadRooms();
    loadActiveRoom();
  }, []);

  const loadDevices = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'devices'));
      const data = snapshot.docs.map(doc => ({ 
        id: doc.id,
        ...doc.data()
      } as Device & { id: string }));
      setDevices(data);
    } catch (error) {
      console.error('トラッカー読み込みエラー:', error);
    }
  };

  const loadBeacons = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'beacons'));
      const data = snapshot.docs.map(doc => {
        const raw = doc.data() as any;
        // Firestore のドキュメント内部に beaconId フィールドが保存されている場合はそちらを優先
        const resolvedBeaconId = typeof raw.beaconId === 'string' && raw.beaconId.length > 0 ? raw.beaconId : doc.id;
        return {
          ...raw,
          rssiAt1m: (typeof raw.rssiAt1m === 'number') ? raw.rssiAt1m : -59,
          name: resolvedBeaconId,
        } as Beacon;
      });
      setBeacons(data);
    } catch (error) {
      console.error('ビーコン読み込みエラー:', error);
    }
  };

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

  const handleAddDevice = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const newDevice: Partial<Device> = {
      deviceId: formData.get('deviceId') as string,
      userName: formData.get('userName') as string,
      devEUI: formData.get('devEUI') as string,
      model: formData.get('model') as string || 'SenseCAP T1000-A',
      ownerUid: 'demo-user', // TODO: 実際のユーザーID
      status: 'active',
      tags: []
    };

    try {
      await addDoc(collection(db, 'devices'), newDevice);
      setShowAddDevice(false);
      loadDevices();
    } catch (error) {
      console.error('トラッカー追加エラー:', error);
      alert('トラッカーの追加に失敗しました');
    }
  };

  const handleAddBeacon = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const parsedRssi = Number(formData.get('rssiAt1m'));
    const referenceRssi = Number.isFinite(parsedRssi) ? parsedRssi : -59;

    const newBeacon: Partial<Beacon> = {
      // beaconId: formData.get('beaconId') as string,
      name: formData.get('name') as string,
      mac: formData.get('mac') as string,
      type: 'ibeacon',
      rssiAt1m: referenceRssi,
      tags: []
    };

    try {
      await addDoc(collection(db, 'beacons'), newBeacon);
      setShowAddBeacon(false);
      loadBeacons();
    } catch (error) {
      console.error('ビーコン追加エラー:', error);
      alert('ビーコンの追加に失敗しました');
    }
  };

  const handleDeleteDevice = async (id: string) => {
    if (!confirm('本当にこのトラッカーを削除しますか？')) return;
    
    try {
      await deleteDoc(doc(db, 'devices', id));
      loadDevices();
    } catch (error) {
      console.error('トラッカー削除エラー:', error);
      alert('トラッカーの削除に失敗しました');
    }
  };

  const handleDeleteBeacon = async (beaconId: string) => {
    if (!confirm('本当にこのビーコンを削除しますか？')) return;
    
    try {
      await deleteDoc(doc(db, 'beacons', beaconId));
      loadBeacons();
    } catch (error) {
      console.error('ビーコン削除エラー:', error);
      alert('ビーコンの削除に失敗しました');
    }
  };

  const startEditBeacon = (beacon: Beacon) => {
    setEditingBeaconId(beacon.beaconId);
    const initialValue = (beacon.rssiAt1m ?? -59).toString();
    setEditRssiAt1m(initialValue);
  };

  const cancelEditBeacon = () => {
    setEditingBeaconId(null);
    setEditRssiAt1m('');
  };

  const handleUpdateBeaconReferenceRssi = async () => {
    if (!editingBeaconId) return;

    const trimmedValue = editRssiAt1m.trim();
    if (trimmedValue === '') {
      alert('RSSI@1mの値を入力してください');
      return;
    }

    const newReferenceRssi = Number(trimmedValue);
    if (!Number.isFinite(newReferenceRssi)) {
      alert('RSSI@1mの値が正しくありません');
      return;
    }

    try {
      await updateDoc(doc(db, 'beacons', editingBeaconId), {
        rssiAt1m: newReferenceRssi
      });
      cancelEditBeacon();
      loadBeacons();
    } catch (error) {
      console.error('ビーコン更新エラー:', error);
      alert('RSSI@1mの更新に失敗しました');
    }
  };

  return (
    <div className="container">
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
        管理画面
      </h1>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <button
          className={`btn ${activeTab === 'devices' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveTab('devices')}
        >
          トラッカー管理
        </button>
        <button
          className={`btn ${activeTab === 'beacons' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveTab('beacons')}
        >
          ビーコン管理
        </button>
        <button
          className={`btn ${activeTab === 'rooms' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveTab('rooms')}
        >
          ルーム管理
        </button>
      </div>

      {activeTab === 'devices' && (
        <div>
          <div className="card" style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2>トラッカー一覧</h2>
              <button className="btn btn-primary" onClick={() => setShowAddDevice(true)}>
                ＋ トラッカー追加
              </button>
            </div>

            {devices.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '40px', color: '#7f8c8d' }}>
                登録されているトラッカーはありません
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e1e8ed', textAlign: 'left' }}>
                      <th style={{ padding: '12px' }}>トラッカー名</th>
                      <th style={{ padding: '12px' }}>所持者</th>
                      <th style={{ padding: '12px' }}>DevEUI</th>
                      <th style={{ padding: '12px' }}>モデル</th>
                      <th style={{ padding: '12px' }}>状態</th>
                      <th style={{ padding: '12px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device, index) => (
                      <tr key={(device as any).id || index} style={{ borderBottom: '1px solid #e1e8ed' }}>
                        <td style={{ padding: '12px' }}><strong>{device.deviceId || '未設定'}</strong></td>
                        <td style={{ padding: '12px' }}>{device.userName || '未設定'}</td>
                        <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
                          {device.devEUI}
                        </td>
                        <td style={{ padding: '12px' }}>{device.model}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            backgroundColor: device.status === 'active' ? '#D4EDDA' : '#F8D7DA',
                            color: device.status === 'active' ? '#155724' : '#721C24'
                          }}>
                            {device.status === 'active' ? 'アクティブ' : '非アクティブ'}
                          </span>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <button
                            className="btn btn-danger"
                            style={{ padding: '6px 12px', fontSize: '14px' }}
                            onClick={() => handleDeleteDevice((device as any).id)}
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {showAddDevice && (
            <div className="card">
              <h3 style={{ marginBottom: '16px' }}>新しいトラッカーを追加</h3>
              <form onSubmit={handleAddDevice}>
                <div className="form-group">
                  <label className="form-label">トラッカー名 *</label>
                  <input
                    type="text"
                    name="deviceId"
                    className="form-input"
                    placeholder="例: トラッカー01"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">所持者名 *</label>
                  <input
                    type="text"
                    name="userName"
                    className="form-input"
                    placeholder="例: 太郎"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">DevEUI *</label>
                  <input
                    type="text"
                    name="devEUI"
                    className="form-input"
                    placeholder="例: 2CF7F1C07030002F"
                    required
                  />
                  <small style={{ color: '#7f8c8d', fontSize: '12px' }}>
                    LoRaWANデバイスの64ビットEUI（16桁の16進数）
                  </small>
                </div>
                <div className="form-group">
                  <label className="form-label">モデル</label>
                  <input
                    type="text"
                    name="model"
                    className="form-input"
                    defaultValue="SenseCAP T1000-A"
                  />
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button type="submit" className="btn btn-primary">
                    追加
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setShowAddDevice(false)}
                  >
                    キャンセル
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {activeTab === 'beacons' && (
        <div>
          <div className="card" style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2>ビーコン一覧</h2>
              <button className="btn btn-primary" onClick={() => setShowAddBeacon(true)}>
                ＋ ビーコン追加
              </button>
            </div>

            {beacons.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '40px', color: '#7f8c8d' }}>
                登録されているビーコンはありません
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e1e8ed', textAlign: 'left' }}>
                      <th style={{ padding: '12px' }}>ビーコン名</th>
                      <th style={{ padding: '12px' }}>MACアドレス</th>
                      <th style={{ padding: '12px' }}>RSSI@1m</th>
                      <th style={{ padding: '12px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {beacons.map(beacon => {
                      const isEditing = editingBeaconId === beacon.beaconId;
                      const displayRssi = beacon.rssiAt1m;
                      return (
                        <tr key={beacon.beaconId} style={{ borderBottom: '1px solid #e1e8ed' }}>
                          <td style={{ padding: '12px' }}>
                            <strong>{beacon.name || '未設定'}</strong>
                          </td>
                          <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
                            {beacon.mac}
                          </td>
                          <td style={{ padding: '12px' }}>
                            {isEditing ? (
                              <input
                                type="number"
                                value={editRssiAt1m}
                                onChange={e => setEditRssiAt1m(e.target.value)}
                                className="form-input"
                                style={{ width: '140px' }}
                              />
                            ) : (
                              displayRssi !== undefined ? `${displayRssi} dBm` : '未設定'
                            )}
                          </td>
                          <td style={{ padding: '12px', display: 'flex', gap: '8px' }}>
                            {isEditing ? (
                              <>
                                <button
                                  className="btn btn-primary"
                                  style={{ padding: '6px 12px', fontSize: '14px' }}
                                  onClick={handleUpdateBeaconReferenceRssi}
                                >
                                  保存
                                </button>
                                <button
                                  className="btn btn-outline"
                                  style={{ padding: '6px 12px', fontSize: '14px' }}
                                  onClick={cancelEditBeacon}
                                >
                                  キャンセル
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="btn btn-outline"
                                  style={{ padding: '6px 12px', fontSize: '14px' }}
                                  onClick={() => startEditBeacon(beacon)}
                                >
                                  編集
                                </button>
                                <button
                                  className="btn btn-danger"
                                  style={{ padding: '6px 12px', fontSize: '14px' }}
                                  onClick={() => handleDeleteBeacon(beacon.beaconId)}
                                >
                                  削除
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {showAddBeacon && (
            <div className="card">
              <h3 style={{ marginBottom: '16px' }}>新しいビーコンを追加</h3>
              <form onSubmit={handleAddBeacon}>
                {/* <div className="form-group">
                  <label className="form-label"> *</label>
                  <input
                    type="text"
                    name="beaconId"
                    className="form-input"
                    placeholder="例: beacon-001"
                    required
                  />
                </div> */}
                <div className="form-group">
                  <label className="form-label">名前 *</label>
                  <input
                    type="text"
                    name="name"
                    className="form-input"
                    placeholder="例: ビーコン1"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">MACアドレス *</label>
                  <input
                    type="text"
                    name="mac"
                    className="form-input"
                    placeholder="例: AA:BB:CC:DD:EE:FF"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">RSSI@1m（dBm）*</label>
                  <input
                    type="number"
                    name="rssiAt1m"
                    className="form-input"
                    defaultValue={-59}
                    placeholder="例: -59"
                    required
                  />
                  <small style={{ color: '#7f8c8d', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                    ビーコン設置後、トラッカーをビーコンから1m離れた位置に置いて測定したRSSI値を入力してください。
                    <br />
                    この値はキャリブレーションの基準として使用されます。
                  </small>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button type="submit" className="btn btn-primary">
                    追加
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setShowAddBeacon(false)}
                  >
                    キャンセル
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {activeTab === 'rooms' && (
        <div>
          <div className="card">
            <h2 style={{ marginBottom: '16px' }}>ルーム一覧</h2>
            <p style={{ marginBottom: '16px', color: '#7f8c8d' }}>
              キャリブレーション済みのルームが表示されます。<br />
              機能1で使用するルームを選択してください。
            </p>

            {rooms.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '40px', color: '#7f8c8d' }}>
                キャリブレーション済みのルームはありません。<br />
                機能1のキャリブレーション画面からルームを作成してください。
              </p>
            ) : (
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
                          <td style={{ padding: '12px', display: 'flex', gap: '8px' }}>
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { RoomLayout, BeaconDevice } from '../../types'; // 🔥 修正: typesからimport
import { sampleRoomLayouts } from './IndoorMap'; // 🔥 修正: サンプルデータのみimport

interface Props {
  selectedRoomId?: string;
  onRoomSelect: (roomId: string) => void;
  onRoomLayoutChange?: (layout: RoomLayout) => void;
  availableBeacons?: BeaconDevice[];
  className?: string;
  mode?: 'selector' | 'manager'; // 選択モードか管理モードか
}

export default function RoomSelector({ 
  selectedRoomId,
  onRoomSelect,
  onRoomLayoutChange,
  availableBeacons = [],
  className,
  mode = 'selector'
}: Props) {
  
  const [rooms, setRooms] = useState<Record<string, RoomLayout>>({});
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [showBeaconConfig, setShowBeaconConfig] = useState(false);
  
  // 初期データの読み込み
  useEffect(() => {
    loadRooms();
  }, []);

  const loadRooms = () => {
    // 実際の実装では、Firestoreから部屋データを取得
    // 今回はサンプルデータを使用
    setRooms({
      ...sampleRoomLayouts,
      // ユーザーカスタム部屋があれば追加
      ...loadCustomRooms()
    });
  };

  const loadCustomRooms = (): Record<string, RoomLayout> => {
    // LocalStorageからカスタム部屋を読み込み
    try {
      const saved = localStorage.getItem('customRooms');
      return saved ? JSON.parse(saved) : {};
    } catch (error) {
      console.error('カスタム部屋の読み込みエラー:', error);
      return {};
    }
  };

  const saveCustomRooms = (customRooms: Record<string, RoomLayout>) => {
    try {
      localStorage.setItem('customRooms', JSON.stringify(customRooms));
    } catch (error) {
      console.error('カスタム部屋の保存エラー:', error);
    }
  };

  // 部屋選択
  const handleRoomSelect = (roomId: string) => {
    onRoomSelect(roomId);
    if (onRoomLayoutChange && rooms[roomId]) {
      onRoomLayoutChange(rooms[roomId]);
    }
  };

  // 部屋作成
  const createNewRoom = () => {
    const newRoom: RoomLayout = {
      id: `custom-room-${Date.now()}`,
      name: '新しい部屋',
      width: 5,
      height: 4,
      beacons: [],
      obstacles: [],
      zones: []
    };
    
    setRooms(prev => ({
      ...prev,
      [newRoom.id]: newRoom
    }));
    
    setEditingRoom(newRoom.id);
    setIsCreatingRoom(false);
  };

  // 部屋編集の保存
  const saveRoomEdit = (roomId: string, updatedRoom: RoomLayout) => {
    const newRooms = {
      ...rooms,
      [roomId]: updatedRoom
    };
    
    setRooms(newRooms);
    
    // カスタム部屋のみLocalStorageに保存
    const customRooms = Object.fromEntries(
      Object.entries(newRooms).filter(([id]) => id.startsWith('custom-'))
    );
    saveCustomRooms(customRooms);
    
    if (onRoomLayoutChange && selectedRoomId === roomId) {
      onRoomLayoutChange(updatedRoom);
    }
    
    setEditingRoom(null);
  };

  // 部屋削除
  const deleteRoom = (roomId: string) => {
    if (roomId.startsWith('custom-') && confirm('この部屋を削除しますか？')) {
      const newRooms = { ...rooms };
      delete newRooms[roomId];
      setRooms(newRooms);
      
      const customRooms = Object.fromEntries(
        Object.entries(newRooms).filter(([id]) => id.startsWith('custom-'))
      );
      saveCustomRooms(customRooms);
      
      if (selectedRoomId === roomId) {
        onRoomSelect('');
      }
    }
  };

  // ビーコンの状態判定
  const getBeaconStatus = (beacon: any) => {
    const now = Date.now();
    if (!beacon.lastSeen) return { status: 'unknown', color: '#9E9E9E', text: '未確認' };
    
    const lastSeenTime = new Date(beacon.lastSeen).getTime();
    const timeDiff = now - lastSeenTime;
    
    if (timeDiff < 30000) { // 30秒以内
      return { status: 'active', color: '#4CAF50', text: 'オンライン' };
    } else if (timeDiff < 300000) { // 5分以内
      return { status: 'stale', color: '#FF9800', text: '信号弱' };
    } else {
      return { status: 'offline', color: '#9E9E9E', text: 'オフライン' };
    }
  };

  // 選択モード（シンプル）
  if (mode === 'selector') {
    return (
      <div className={`room-selector ${className || ''}`}>
        <div className="card">
          <h3 style={{
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '16px',
            fontWeight: 'bold'
          }}>
            🏠 部屋を選択
          </h3>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '12px'
          }}>
            {Object.values(rooms).map(room => {
              const isSelected = selectedRoomId === room.id;
              const activeBeacons = room.beacons.filter(beacon => 
                availableBeacons.find(b => b.mac === beacon.mac && b.isActive)
              ).length;
              
              return (
                <div
                  key={room.id}
                  onClick={() => handleRoomSelect(room.id)}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    border: isSelected ? '3px solid #4A90E2' : '2px solid #e1e8ed',
                    backgroundColor: isSelected ? '#4A90E210' : 'white',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    boxShadow: isSelected 
                      ? '0 4px 16px rgba(74, 144, 226, 0.3)' 
                      : '0 2px 8px rgba(0,0,0,0.1)'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.15)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                    }
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '12px'
                  }}>
                    <h4 style={{
                      margin: 0,
                      fontSize: '14px',
                      fontWeight: 'bold',
                      color: isSelected ? '#4A90E2' : '#333'
                    }}>
                      {room.name}
                    </h4>
                    {isSelected && (
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        backgroundColor: '#4A90E2',
                        color: 'white',
                        borderRadius: '8px',
                        fontWeight: 'bold'
                      }}>
                        選択中
                      </span>
                    )}
                  </div>

                  <div style={{
                    fontSize: '12px',
                    color: '#666',
                    marginBottom: '8px'
                  }}>
                    📐 {room.width}m × {room.height}m
                  </div>

                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    color: '#888'
                  }}>
                    <span>📡 {activeBeacons}/{room.beacons.length} ビーコン</span>
                    <span>🪑 {room.obstacles?.length || 0} 家具</span>
                  </div>

                  {activeBeacons < room.beacons.length && (
                    <div style={{
                      marginTop: '8px',
                      padding: '4px 8px',
                      backgroundColor: '#fff3cd',
                      borderRadius: '4px',
                      fontSize: '10px',
                      color: '#856404'
                    }}>
                      ⚠️ 一部ビーコンがオフライン
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {Object.keys(rooms).length === 0 && (
            <div style={{
              textAlign: 'center',
              padding: '40px',
              color: '#666'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏠</div>
              <p>利用可能な部屋がありません</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 管理モード（詳細）
  return (
    <div className={`room-manager ${className || ''}`}>
      {/* ヘッダー */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px'
        }}>
          <h2 style={{
            margin: 0,
            fontSize: '18px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            🏠 部屋管理
          </h2>
          
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowBeaconConfig(!showBeaconConfig)}
              style={{
                padding: '8px 16px',
                backgroundColor: showBeaconConfig ? '#4A90E2' : '#f8f9fa',
                color: showBeaconConfig ? 'white' : '#666',
                border: '2px solid #e1e8ed',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              📡 ビーコン設定
            </button>
            
            <button
              onClick={() => setIsCreatingRoom(true)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              ➕ 新しい部屋
            </button>
          </div>
        </div>

        {/* 統計情報 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: '16px',
          padding: '16px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#2c3e50' }}>
              {Object.keys(rooms).length}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>登録済み部屋</div>
          </div>
          
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#3498db' }}>
              {Object.values(rooms).reduce((sum, room) => sum + room.beacons.length, 0)}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>設置ビーコン</div>
          </div>
          
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#4CAF50' }}>
              {availableBeacons.filter(b => b.isActive).length}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>アクティブ</div>
          </div>
          
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: selectedRoomId ? '#e74c3c' : '#9E9E9E' }}>
              {selectedRoomId ? '1' : '0'}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>選択中</div>
          </div>
        </div>
      </div>

      {/* ビーコン設定パネル */}
      {showBeaconConfig && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{
            marginBottom: '16px',
            fontSize: '16px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            📡 利用可能ビーコン
          </h3>

          {availableBeacons.length > 0 ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '12px'
            }}>
              {availableBeacons.map(beacon => {
                const status = getBeaconStatus(beacon);
                
                return (
                  <div
                    key={beacon.id}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: `2px solid ${status.color}30`,
                      backgroundColor: `${status.color}05`
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '8px'
                    }}>
                      <div>
                        <h4 style={{
                          margin: '0 0 4px 0',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          color: '#333'
                        }}>
                          {beacon.name}
                        </h4>
                        <div style={{
                          fontSize: '11px',
                          color: '#666',
                          fontFamily: 'monospace'
                        }}>
                          {beacon.mac}
                        </div>
                      </div>
                      
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <div
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: status.color
                          }}
                        />
                        <span style={{
                          fontSize: '10px',
                          fontWeight: 'bold',
                          color: status.color
                        }}>
                          {status.text}
                        </span>
                      </div>
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gap: '8px',
                      fontSize: '11px',
                      color: '#666'
                    }}>
                      <div>
                        RSSI: {beacon.rssi ? `${beacon.rssi}dBm` : 'N/A'}
                      </div>
                      <div>
                        バッテリー: {beacon.battery ? `${beacon.battery}%` : 'N/A'}
                      </div>
                      <div>
                        最終: {beacon.lastSeen ? 
                          new Date(beacon.lastSeen).toLocaleTimeString() : 
                          'N/A'
                        }
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '40px',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px',
              color: '#666'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📡</div>
              <p>利用可能なビーコンがありません</p>
              <p style={{ fontSize: '12px', marginTop: '8px' }}>
                ビーコンデバイスの電源とBluetooth接続を確認してください
              </p>
            </div>
          )}
        </div>
      )}

      {/* 部屋一覧 */}
      <div className="card">
        <h3 style={{
          marginBottom: '16px',
          fontSize: '16px',
          fontWeight: 'bold'
        }}>
          🏠 部屋一覧
        </h3>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '16px'
        }}>
          {Object.values(rooms).map(room => {
            const isSelected = selectedRoomId === room.id;
            const isEditing = editingRoom === room.id;
            const isCustom = room.id.startsWith('custom-');
            const activeBeacons = room.beacons.filter(beacon => 
              availableBeacons.find(b => b.mac === beacon.mac && b.isActive)
            );

            if (isEditing) {
              return (
                <RoomEditor
                  key={room.id}
                  room={room}
                  availableBeacons={availableBeacons}
                  onSave={(updatedRoom) => saveRoomEdit(room.id, updatedRoom)}
                  onCancel={() => setEditingRoom(null)}
                />
              );
            }

            return (
              <div
                key={room.id}
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  border: isSelected ? '3px solid #4A90E2' : '2px solid #e1e8ed',
                  backgroundColor: isSelected ? '#4A90E210' : 'white',
                  position: 'relative',
                  transition: 'all 0.3s ease'
                }}
              >
                {/* 部屋ヘッダー */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '12px'
                }}>
                  <div style={{ flex: 1 }}>
                    <h4 style={{
                      margin: '0 0 4px 0',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      color: isSelected ? '#4A90E2' : '#333',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      {room.name}
                      {isCustom && (
                        <span style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          backgroundColor: '#9b59b6',
                          color: 'white',
                          borderRadius: '8px'
                        }}>
                          カスタム
                        </span>
                      )}
                    </h4>
                    <div style={{
                      fontSize: '12px',
                      color: '#666'
                    }}>
                      📐 {room.width}m × {room.height}m
                    </div>
                  </div>

                  {/* 操作ボタン */}
                  <div style={{
                    display: 'flex',
                    gap: '4px'
                  }}>
                    <button
                      onClick={() => handleRoomSelect(room.id)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: isSelected ? '#4A90E2' : '#f8f9fa',
                        color: isSelected ? 'white' : '#666',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '10px',
                        cursor: 'pointer'
                      }}
                    >
                      {isSelected ? '✓' : '📍'}
                    </button>
                    
                    <button
                      onClick={() => setEditingRoom(room.id)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#f39c12',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '10px',
                        cursor: 'pointer'
                      }}
                    >
                      ✏️
                    </button>
                    
                    {isCustom && (
                      <button
                        onClick={() => deleteRoom(room.id)}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: '#e74c3c',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '10px',
                          cursor: 'pointer'
                        }}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>

                {/* ビーコン状況 */}
                <div style={{
                  marginBottom: '12px'
                }}>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: '#333',
                    marginBottom: '6px'
                  }}>
                    📡 ビーコン ({activeBeacons.length}/{room.beacons.length})
                  </div>
                  
                  {room.beacons.length > 0 ? (
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '4px'
                    }}>
                      {room.beacons.map(beacon => {
                        const availableBeacon = availableBeacons.find(b => b.mac === beacon.mac);
                        const status = availableBeacon ? getBeaconStatus(availableBeacon) : 
                          { status: 'unknown', color: '#9E9E9E', text: '未検出' };
                        
                        return (
                          <div
                            key={beacon.id}
                            style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              backgroundColor: `${status.color}20`,
                              color: status.color,
                              borderRadius: '8px',
                              fontWeight: '600',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                            title={`${beacon.name} (${beacon.mac})`}
                          >
                            <div
                              style={{
                                width: '4px',
                                height: '4px',
                                borderRadius: '50%',
                                backgroundColor: status.color
                              }}
                            />
                            {beacon.name}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{
                      fontSize: '11px',
                      color: '#999',
                      fontStyle: 'italic'
                    }}>
                      ビーコンが設定されていません
                    </div>
                  )}
                </div>

                {/* 詳細情報 */}
                <div style={{
                  fontSize: '11px',
                  color: '#666',
                  borderTop: '1px solid #e1e8ed',
                  paddingTop: '8px',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px'
                }}>
                  <div>🪑 家具: {room.obstacles?.length || 0}個</div>
                  <div>🏷️ ゾーン: {room.zones?.length || 0}個</div>
                </div>

                {activeBeacons.length < room.beacons.length && (
                  <div style={{
                    marginTop: '8px',
                    padding: '6px 8px',
                    backgroundColor: '#fff3cd',
                    borderRadius: '4px',
                    fontSize: '10px',
                    color: '#856404',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    ⚠️ 一部ビーコンがオフライン
                  </div>
                )}
              </div>
            );
          })}

          {/* 新規作成ボタン */}
          {isCreatingRoom && (
            <div
              style={{
                padding: '16px',
                borderRadius: '12px',
                border: '2px dashed #4CAF50',
                backgroundColor: '#4CAF5010',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '200px',
                gap: '12px'
              }}
            >
              <div style={{
                fontSize: '48px',
                color: '#4CAF50'
              }}>
                ➕
              </div>
              <div style={{
                fontSize: '14px',
                fontWeight: 'bold',
                color: '#4CAF50',
                textAlign: 'center'
              }}>
                新しい部屋を作成しますか？
              </div>
              <div style={{
                display: 'flex',
                gap: '8px'
              }}>
                <button
                  onClick={createNewRoom}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  作成
                </button>
                <button
                  onClick={() => setIsCreatingRoom(false)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#9E9E9E',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}
        </div>

        {Object.keys(rooms).length === 0 && !isCreatingRoom && (
          <div style={{
            textAlign: 'center',
            padding: '60px',
            color: '#666'
          }}>
            <div style={{ fontSize: '64px', marginBottom: '16px' }}>🏠</div>
            <h4 style={{ margin: '0 0 8px 0' }}>部屋が登録されていません</h4>
            <p style={{ margin: '0 0 16px 0', fontSize: '14px' }}>
              最初の部屋を作成してください
            </p>
            <button
              onClick={() => setIsCreatingRoom(true)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              ➕ 新しい部屋を作成
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// === 部屋編集コンポーネント ===
interface RoomEditorProps {
  room: RoomLayout;
  availableBeacons: BeaconDevice[];
  onSave: (room: RoomLayout) => void;
  onCancel: () => void;
}

function RoomEditor({ room, availableBeacons, onSave, onCancel }: RoomEditorProps) {
  const [editingRoom, setEditingRoom] = useState<RoomLayout>({ ...room });

  const handleSave = () => {
    if (editingRoom.name.trim() && editingRoom.width > 0 && editingRoom.height > 0) {
      onSave(editingRoom);
    }
  };

  return (
    <div style={{
      padding: '16px',
      borderRadius: '12px',
      border: '2px solid #f39c12',
      backgroundColor: '#fff3cd10'
    }}>
      <h4 style={{
        margin: '0 0 16px 0',
        fontSize: '14px',
        fontWeight: 'bold',
        color: '#f39c12',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        ✏️ 部屋編集
      </h4>

      {/* 基本情報 */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{
          display: 'block',
          fontSize: '12px',
          fontWeight: 'bold',
          color: '#333',
          marginBottom: '4px'
        }}>
          部屋名
        </label>
        <input
          type="text"
          value={editingRoom.name}
          onChange={(e) => setEditingRoom(prev => ({ ...prev, name: e.target.value }))}
          style={{
            width: '100%',
            padding: '8px',
            borderRadius: '4px',
            border: '2px solid #e1e8ed',
            fontSize: '14px'
          }}
        />
      </div>

      {/* サイズ設定 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
        marginBottom: '16px'
      }}>
        <div>
          <label style={{
            display: 'block',
            fontSize: '12px',
            fontWeight: 'bold',
            color: '#333',
            marginBottom: '4px'
          }}>
            幅 (m)
          </label>
          <input
            type="number"
            min="1"
            max="20"
            step="0.5"
            value={editingRoom.width}
            onChange={(e) => setEditingRoom(prev => ({ 
              ...prev, 
              width: parseFloat(e.target.value) || 1 
            }))}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '2px solid #e1e8ed',
              fontSize: '14px'
            }}
          />
        </div>
        
        <div>
          <label style={{
            display: 'block',
            fontSize: '12px',
            fontWeight: 'bold',
            color: '#333',
            marginBottom: '4px'
          }}>
            高さ (m)
          </label>
          <input
            type="number"
            min="1"
            max="20"
            step="0.5"
            value={editingRoom.height}
            onChange={(e) => setEditingRoom(prev => ({ 
              ...prev, 
              height: parseFloat(e.target.value) || 1 
            }))}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '2px solid #e1e8ed',
              fontSize: '14px'
            }}
          />
        </div>
      </div>

      {/* 簡易ビーコン設定 */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{
          display: 'block',
          fontSize: '12px',
          fontWeight: 'bold',
          color: '#333',
          marginBottom: '8px'
        }}>
          使用するビーコン
        </label>
        <div style={{
          maxHeight: '120px',
          overflowY: 'auto',
          border: '1px solid #e1e8ed',
          borderRadius: '4px',
          padding: '8px'
        }}>
          {availableBeacons.map(beacon => {
            const isUsed = editingRoom.beacons.some(b => b.mac === beacon.mac);
            
            return (
              <label
                key={beacon.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  checked={isUsed}
                  onChange={(e) => {
                    if (e.target.checked) {
                      // ビーコンを追加
                      setEditingRoom(prev => ({
                        ...prev,
                        beacons: [
                          ...prev.beacons,
                          {
                            id: beacon.id,
                            name: beacon.name,
                            mac: beacon.mac,
                            x: 50, // デフォルト位置（中央）
                            y: 50,
                            range: 3
                          }
                        ]
                      }));
                    } else {
                      // ビーコンを削除
                      setEditingRoom(prev => ({
                        ...prev,
                        beacons: prev.beacons.filter(b => b.mac !== beacon.mac)
                      }));
                    }
                  }}
                />
                <span>{beacon.name}</span>
                <span style={{ color: '#666', fontSize: '10px' }}>
                  ({beacon.mac})
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* 操作ボタン */}
      <div style={{
        display: 'flex',
        gap: '8px',
        justifyContent: 'flex-end'
      }}>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 16px',
            backgroundColor: '#9E9E9E',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          キャンセル
        </button>
        <button
          onClick={handleSave}
          disabled={!editingRoom.name.trim()}
          style={{
            padding: '8px 16px',
            backgroundColor: editingRoom.name.trim() ? '#4CAF50' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: editingRoom.name.trim() ? 'pointer' : 'not-allowed'
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}
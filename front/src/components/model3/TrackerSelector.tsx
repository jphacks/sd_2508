// トラッカー選択・管理コンポーネント

import { useState, useEffect, useCallback, useRef } from 'react';
import { Device } from '../../types';

interface DeviceStatus {
  deviceId: string;
  isOnline: boolean;
  lastSeen: string;
  batteryLevel?: number;
  signalStrength: number; // RSSI
  location?: {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: string;
  };
  firmware?: string;
  uptime: number; // 稼働時間（秒）
  dataRate?: string;
  frequency?: number;
}

interface TrackerGroup {
  id: string;
  name: string;
  parentDeviceId: string;
  childDeviceIds: string[];
  createdAt: string;
  settings: {
    maxDistance: number;
    alertEnabled: boolean;
    trackingInterval: number;
    geofencing: boolean;
  };
  members: {
    deviceId: string;
    role: 'parent' | 'child';
    joinedAt: string;
    permissions: string[];
  }[];
}

interface DeviceFilter {
  role?: 'parent' | 'child' | 'all';
  status?: 'online' | 'offline' | 'all';
  group?: string | 'all';
  batteryLevel?: 'low' | 'normal' | 'all';
}

interface DeviceSort {
  field: 'name' | 'lastSeen' | 'battery' | 'signal' | 'distance';
  direction: 'asc' | 'desc';
}

interface Props {
  devices: Device[];
  selectedDeviceId?: string;
  selectedParentId?: string;
  groups?: TrackerGroup[];
  onDeviceSelect?: (deviceId: string) => void;
  onParentSelect?: (parentId: string) => void;
  onGroupCreate?: (group: Omit<TrackerGroup, 'id' | 'createdAt'>) => void;
  onGroupUpdate?: (groupId: string, updates: Partial<TrackerGroup>) => void;
  onGroupDelete?: (groupId: string) => void;
  onDeviceStatusUpdate?: (deviceId: string, status: DeviceStatus) => void;
  className?: string;
}

// TrackerSelector の型定義を確認
interface TrackerSelectorProps {
  devices: Device[];
  selectedDeviceId: string;
  selectedParentId: string;
  groups: TrackerGroup[]; // この型が問題の可能性
  onDeviceSelect: (deviceId: string) => void;
  onParentSelect: (deviceId: string) => void;
  onGroupCreate: (groupData: Omit<TrackerGroup, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onGroupUpdate: (groupId: string, updates: Partial<TrackerGroup>) => void;
  onGroupDelete: (groupId: string) => void;
  onDeviceStatusUpdate: (deviceId: string, status: Partial<DeviceStatus>) => void;
}

export default function TrackerSelector({
  devices,
  selectedDeviceId,
  selectedParentId,
  groups = [],
  onDeviceSelect,
  onParentSelect,
  onGroupCreate,
  onGroupUpdate,
  onGroupDelete,
  onDeviceStatusUpdate,
  className
}: Props) {

  // === State管理 ===
  const [deviceStatuses, setDeviceStatuses] = useState<Record<string, DeviceStatus>>({});
  const [filter, setFilter] = useState<DeviceFilter>({ role: 'all', status: 'all', group: 'all', batteryLevel: 'all' });
  const [sort, setSort] = useState<DeviceSort>({ field: 'name', direction: 'asc' });
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [showDeviceDetails, setShowDeviceDetails] = useState<string | null>(null);
  const [newGroupForm, setNewGroupForm] = useState({
    name: '',
    parentDeviceId: '',
    childDeviceIds: [] as string[],
    maxDistance: 50,
    alertEnabled: true,
    trackingInterval: 5,
    geofencing: true
  });
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [isStatusPolling, setIsStatusPolling] = useState(true);

  // === Refs ===
  const statusPollingRef = useRef<NodeJS.Timeout>();

  // === ユーティリティ関数 ===
  const getDeviceRole = useCallback((device: Device): 'parent' | 'child' | 'unknown' => {
    // デバイス設定またはグループ情報から役割を判定
    const group = groups.find(g => 
      g.parentDeviceId === device.deviceId || 
      g.childDeviceIds.includes(device.deviceId)
    );
    
    if (group) {
      return group.parentDeviceId === device.deviceId ? 'parent' : 'child';
    }
    
    // デバイス自体に役割情報がある場合
    return (device as any).role || 'unknown';
  }, [groups]);

  const calculateDistance = useCallback((device1: Device, device2: Device): number => {
    if (!device1.position || !device2.position) return 0;
    
    // 安全なプロパティアクセス
    const lat1 = device1.position.lat;
    const lat2 = device2.position.lat;
    const lng1 = (device1.position as any).lng || (device1.position as any).lon || (device1.position as any).longitude;
    const lng2 = (device2.position as any).lng || (device2.position as any).lon || (device2.position as any).longitude;
    
    // 経度が取得できない場合は0を返す
    if (lng1 === undefined || lng2 === undefined) return 0;
    
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }, []);

  const generateDeviceStatus = useCallback((device: Device): DeviceStatus => {
    const now = Date.now();
    const deviceAny = device as any;
    const lastSeenTime = deviceAny.lastSeenAt ? new Date(deviceAny.lastSeenAt).getTime() : now;
    const timeDiff = now - lastSeenTime;
    const isOnline = timeDiff < 300000;

    // 安全な位置情報処理
    const getLocationData = () => {
      if (!device.position) return undefined;
      
      const position = device.position as any;
      const lat = position.lat || position.latitude;
      const lng = position.lng || position.lon || position.longitude;
      const accuracy = position.accuracy || 10;
      const timestamp = position.timestamp || new Date().toISOString();
      
      // lat, lngが数値として存在するかチェック
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        console.warn('Invalid position data:', device.position);
        return undefined;
      }
      
      return {
        lat,
        lng,
        accuracy,
        timestamp
      };
    };

    return {
      deviceId: device.deviceId,
      isOnline,
      lastSeen: deviceAny.lastSeenAt || new Date().toISOString(),
      batteryLevel: deviceAny.batteryLevel || Math.floor(Math.random() * 100),
      signalStrength: deviceAny.rssi || -60 - Math.floor(Math.random() * 60),
      location: getLocationData(),
      firmware: deviceAny.firmware || '1.2.3',
      uptime: Math.floor(timeDiff / 1000),
      dataRate: 'SF7BW125',
      frequency: 923.2
    };
  }, []);

  // === 状態監視 ===
  const updateDeviceStatuses = useCallback(() => {
    const newStatuses: Record<string, DeviceStatus> = {};
    
    devices.forEach(device => {
      const status = generateDeviceStatus(device);
      newStatuses[device.deviceId] = status;
      
      // コールバックで状態更新を通知
      if (onDeviceStatusUpdate) {
        onDeviceStatusUpdate(device.deviceId, status);
      }
    });
    
    setDeviceStatuses(newStatuses);
  }, [devices, generateDeviceStatus, onDeviceStatusUpdate]);

  const startStatusPolling = useCallback(() => {
    if (statusPollingRef.current) {
      clearInterval(statusPollingRef.current);
    }
    
    setIsStatusPolling(true);
    statusPollingRef.current = setInterval(() => {
      updateDeviceStatuses();
    }, 10000); // 10秒間隔
    
    // 初回実行
    updateDeviceStatuses();
  }, [updateDeviceStatuses]);

  const stopStatusPolling = useCallback(() => {
    if (statusPollingRef.current) {
      clearInterval(statusPollingRef.current);
      statusPollingRef.current = undefined;
    }
    setIsStatusPolling(false);
  }, []);

  // === フィルタリング・ソート ===
  const getFilteredAndSortedDevices = useCallback(() => {
    let filteredDevices = devices.filter(device => {
      const role = getDeviceRole(device);
      const status = deviceStatuses[device.deviceId];
      
      // 役割フィルター
      if (filter.role !== 'all' && role !== filter.role) return false;
      
      // 状態フィルター
      if (filter.status !== 'all') {
        const isOnline = status?.isOnline ?? false;
        if ((filter.status === 'online' && !isOnline) || 
            (filter.status === 'offline' && isOnline)) return false;
      }
      
      // グループフィルター
      if (filter.group !== 'all') {
        const belongsToGroup = groups.some(g => 
          g.id === filter.group && 
          (g.parentDeviceId === device.deviceId || g.childDeviceIds.includes(device.deviceId))
        );
        if (!belongsToGroup) return false;
      }
      
      // バッテリーフィルター
      if (filter.batteryLevel !== 'all') {
        const batteryLevel = status?.batteryLevel ?? 100;
        if ((filter.batteryLevel === 'low' && batteryLevel > 20) ||
            (filter.batteryLevel === 'normal' && batteryLevel <= 20)) return false;
      }
      
      return true;
    });

    // ソート
    filteredDevices.sort((a, b) => {
      const statusA = deviceStatuses[a.deviceId];
      const statusB = deviceStatuses[b.deviceId];
      const direction = sort.direction === 'asc' ? 1 : -1;
      
      switch (sort.field) {
        case 'name':
          return direction * (a.name || a.deviceId).localeCompare(b.name || b.deviceId);
        case 'lastSeen':
          const timeA = new Date(statusA?.lastSeen || 0).getTime();
          const timeB = new Date(statusB?.lastSeen || 0).getTime();
          return direction * (timeA - timeB);
        case 'battery':
          return direction * ((statusA?.batteryLevel || 0) - (statusB?.batteryLevel || 0));
        case 'signal':
          return direction * ((statusA?.signalStrength || -100) - (statusB?.signalStrength || -100));
        case 'distance':
          if (!selectedParentId) return 0;
          const parent = devices.find(d => d.deviceId === selectedParentId);
          if (!parent) return 0;
          const distA = calculateDistance(a, parent);
          const distB = calculateDistance(b, parent);
          return direction * (distA - distB);
        default:
          return 0;
      }
    });

    return filteredDevices;
  }, [devices, deviceStatuses, filter, sort, groups, getDeviceRole, selectedParentId, calculateDistance]);

  // === グループ管理 ===
  const handleCreateGroup = useCallback(() => {
    if (!newGroupForm.name || !newGroupForm.parentDeviceId) return;
    
    const newGroup: Omit<TrackerGroup, 'id' | 'createdAt'> = {
      name: newGroupForm.name,
      parentDeviceId: newGroupForm.parentDeviceId,
      childDeviceIds: newGroupForm.childDeviceIds,
      settings: {
        maxDistance: newGroupForm.maxDistance,
        alertEnabled: newGroupForm.alertEnabled,
        trackingInterval: newGroupForm.trackingInterval,
        geofencing: newGroupForm.geofencing
      },
      members: [
        {
          deviceId: newGroupForm.parentDeviceId,
          role: 'parent',
          joinedAt: new Date().toISOString(),
          permissions: ['manage', 'view', 'alert']
        },
        ...newGroupForm.childDeviceIds.map(deviceId => ({
          deviceId,
          role: 'child' as const,
          joinedAt: new Date().toISOString(),
          permissions: ['view']
        }))
      ]
    };
    
    if (onGroupCreate) {
      onGroupCreate(newGroup);
    }
    
    // フォームリセット
    setNewGroupForm({
      name: '',
      parentDeviceId: '',
      childDeviceIds: [],
      maxDistance: 50,
      alertEnabled: true,
      trackingInterval: 5,
      geofencing: true
    });
    setShowGroupManager(false);
  }, [newGroupForm, onGroupCreate]);

  const handleAddChildToGroup = useCallback((groupId: string, childDeviceId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group || group.childDeviceIds.includes(childDeviceId)) return;
    
    const updates: Partial<TrackerGroup> = {
      childDeviceIds: [...group.childDeviceIds, childDeviceId],
      members: [
        ...group.members,
        {
          deviceId: childDeviceId,
          role: 'child',
          joinedAt: new Date().toISOString(),
          permissions: ['view']
        }
      ]
    };
    
    if (onGroupUpdate) {
      onGroupUpdate(groupId, updates);
    }
  }, [groups, onGroupUpdate]);

  const handleRemoveFromGroup = useCallback((groupId: string, deviceId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    
    const updates: Partial<TrackerGroup> = {
      childDeviceIds: group.childDeviceIds.filter(id => id !== deviceId),
      members: group.members.filter(m => m.deviceId !== deviceId)
    };
    
    if (onGroupUpdate) {
      onGroupUpdate(groupId, updates);
    }
  }, [groups, onGroupUpdate]);

  // === Effects ===
  useEffect(() => {
    startStatusPolling();
    
    return () => {
      stopStatusPolling();
    };
  }, [startStatusPolling, stopStatusPolling]);

  // === レンダー関数 ===
  const renderDeviceCard = (device: Device) => {
    const status = deviceStatuses[device.deviceId];
    const role = getDeviceRole(device);
    const isSelected = device.deviceId === selectedDeviceId;
    const isParentSelected = device.deviceId === selectedParentId;
    const group = groups.find(g => 
      g.parentDeviceId === device.deviceId || 
      g.childDeviceIds.includes(device.deviceId)
    );

    const getBatteryColor = (level?: number) => {
      if (!level) return '#95a5a6';
      if (level > 50) return '#27ae60';
      if (level > 20) return '#f39c12';
      return '#e74c3c';
    };

    const getSignalBars = (rssi?: number) => {
      if (!rssi) return 0;
      if (rssi > -50) return 4;
      if (rssi > -70) return 3;
      if (rssi > -85) return 2;
      if (rssi > -100) return 1;
      return 0;
    };

    const getDistanceFromParent = () => {
      if (!selectedParentId || device.deviceId === selectedParentId) return null;
      const parent = devices.find(d => d.deviceId === selectedParentId);
      if (!parent) return null;
      return calculateDistance(device, parent);
    };

    const distance = getDistanceFromParent();

    return (
      <div
        key={device.deviceId}
        onClick={() => onDeviceSelect?.(device.deviceId)}
        style={{
          padding: '16px',
          backgroundColor: isSelected ? '#e3f2fd' : 'white',
          border: `2px solid ${
            isSelected ? '#2196f3' : 
            isParentSelected ? '#4caf50' : 
            '#e1e8ed'
          }`,
          borderRadius: '12px',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          position: 'relative',
          marginBottom: '12px'
        }}
      >
        {/* ヘッダー */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '12px'
        }}>
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '4px'
            }}>
              <h4 style={{ 
                margin: 0, 
                fontSize: '16px',
                color: isSelected ? '#2196f3' : '#333'
              }}>
                {device.userName || device.name || device.deviceId}
              </h4>
              
              {/* 役割バッジ */}
              <span style={{
                padding: '2px 8px',
                backgroundColor: role === 'parent' ? '#4caf50' : role === 'child' ? '#2196f3' : '#95a5a6',
                color: 'white',
                borderRadius: '12px',
                fontSize: '10px',
                fontWeight: 'bold'
              }}>
                {role === 'parent' ? '👨‍👩‍👧‍👦 保護者' : role === 'child' ? '🧒 子供' : '❓ 不明'}
              </span>
              
              {/* オンライン状態 */}
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: status?.isOnline ? '#4caf50' : '#e74c3c'
              }} />
            </div>
            
            <div style={{ fontSize: '12px', color: '#666' }}>
              {device.deviceId}
            </div>
            
            {group && (
              <div style={{ fontSize: '11px', color: '#2196f3', marginTop: '2px' }}>
                📁 {group.name}
              </div>
            )}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowDeviceDetails(showDeviceDetails === device.deviceId ? null : device.deviceId);
            }}
            style={{
              padding: '4px 8px',
              backgroundColor: '#f8f9fa',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '10px',
              cursor: 'pointer'
            }}
          >
            📊 詳細
          </button>
        </div>

        {/* 状態インジケーター */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(60px, 1fr))',
          gap: '8px',
          marginBottom: '8px'
        }}>
          {/* バッテリー */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>
              バッテリー
            </div>
            <div style={{
              fontSize: '12px',
              fontWeight: 'bold',
              color: getBatteryColor(status?.batteryLevel)
            }}>
              🔋 {status?.batteryLevel || 0}%
            </div>
          </div>

          {/* 信号強度 */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>
              信号強度
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1px' }}>
              {[1, 2, 3, 4].map(bar => (
                <div
                  key={bar}
                  style={{
                    width: '3px',
                    height: `${bar * 2 + 4}px`,
                    backgroundColor: bar <= getSignalBars(status?.signalStrength) ? '#4caf50' : '#e0e0e0',
                    borderRadius: '1px'
                  }}
                />
              ))}
            </div>
          </div>

          {/* 最終更新 */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>
              最終更新
            </div>
            <div style={{ fontSize: '10px', fontWeight: 'bold' }}>
              {status ? new Date(status.lastSeen).toLocaleTimeString() : '--:--'}
            </div>
          </div>

          {/* 距離（保護者選択時のみ） */}
          {distance !== null && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>
                距離
              </div>
              <div style={{ 
                fontSize: '10px', 
                fontWeight: 'bold',
                color: distance > 100 ? '#e74c3c' : distance > 50 ? '#f39c12' : '#4caf50'
              }}>
                📏 {distance.toFixed(1)}m
              </div>
            </div>
          )}
        </div>

        {/* 詳細情報（展開時） */}
        {showDeviceDetails === device.deviceId && status && (
          <div style={{
            marginTop: '12px',
            padding: '12px',
            backgroundColor: '#f8f9fa',
            borderRadius: '8px',
            fontSize: '11px'
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: '8px'
            }}>
              <div>
                <strong>デバイスEUI:</strong><br />
                {device.devEUI || 'N/A'}
              </div>
              <div>
                <strong>ファームウェア:</strong><br />
                {status.firmware}
              </div>
              <div>
                <strong>データレート:</strong><br />
                {status.dataRate}
              </div>
              <div>
                <strong>周波数:</strong><br />
                {status.frequency} MHz
              </div>
              <div>
                <strong>稼働時間:</strong><br />
                {Math.floor(status.uptime / 3600)}時間
              </div>
              {status.location && (
                <div>
                  <strong>位置精度:</strong><br />
                  ±{status.location.accuracy}m
                </div>
              )}
            </div>
          </div>
        )}

        {/* アクションボタン */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginTop: '8px'
        }}>
          {role === 'parent' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onParentSelect?.(device.deviceId);
              }}
              style={{
                padding: '4px 8px',
                backgroundColor: isParentSelected ? '#4caf50' : '#e0e0e0',
                color: isParentSelected ? 'white' : '#333',
                border: 'none',
                borderRadius: '4px',
                fontSize: '10px',
                cursor: 'pointer'
              }}
            >
              {isParentSelected ? '✓ 選択中' : '保護者に設定'}
            </button>
          )}
          
          {!group && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setNewGroupForm(prev => ({
                  ...prev,
                  [role === 'parent' ? 'parentDeviceId' : 'childDeviceIds']: 
                    role === 'parent' ? device.deviceId : [...prev.childDeviceIds, device.deviceId]
                }));
                setShowGroupManager(true);
              }}
              style={{
                padding: '4px 8px',
                backgroundColor: '#2196f3',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '10px',
                cursor: 'pointer'
              }}
            >
              📁 グループに追加
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderGroupManager = () => (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px'
      }}>
        <h4 style={{ margin: 0, fontSize: '16px' }}>
          👨‍👩‍👧‍👦 グループ管理
        </h4>
        <button
          onClick={() => setShowGroupManager(!showGroupManager)}
          style={{
            padding: '6px 12px',
            backgroundColor: '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            cursor: 'pointer'
          }}
        >
          {showGroupManager ? '✕ 閉じる' : '＋ 新規グループ'}
        </button>
      </div>

      {/* 既存グループ一覧 */}
      <div style={{ marginBottom: '16px' }}>
        <h5 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>既存グループ</h5>
        {groups.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '20px',
            color: '#666',
            fontSize: '14px'
          }}>
            グループがありません
          </div>
        ) : (
          groups.map(group => (
            <div
              key={group.id}
              style={{
                padding: '12px',
                backgroundColor: selectedGroup === group.id ? '#e3f2fd' : '#f8f9fa',
                border: '1px solid #e1e8ed',
                borderRadius: '8px',
                marginBottom: '8px'
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '8px'
              }}>
                <div>
                  <h6 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>
                    {group.name}
                  </h6>
                  <div style={{ fontSize: '11px', color: '#666' }}>
                    作成日: {new Date(group.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => setSelectedGroup(selectedGroup === group.id ? 'all' : group.id)}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: selectedGroup === group.id ? '#2196f3' : '#e0e0e0',
                      color: selectedGroup === group.id ? 'white' : '#333',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                  >
                    {selectedGroup === group.id ? '選択中' : '選択'}
                  </button>
                  <button
                    onClick={() => onGroupDelete?.(group.id)}
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
                    削除
                  </button>
                </div>
              </div>
              
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '8px',
                fontSize: '11px'
              }}>
                <div>
                  <strong>保護者:</strong><br />
                  {devices.find(d => d.deviceId === group.parentDeviceId)?.userName || group.parentDeviceId}
                </div>
                <div>
                  <strong>子供 ({group.childDeviceIds.length}):</strong><br />
                  {group.childDeviceIds.map(id => 
                    devices.find(d => d.deviceId === id)?.userName || id
                  ).join(', ') || 'なし'}
                </div>
                <div>
                  <strong>最大距離:</strong><br />
                  {group.settings.maxDistance}m
                </div>
                <div>
                  <strong>追跡間隔:</strong><br />
                  {group.settings.trackingInterval}秒
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 新規グループ作成フォーム */}
      {showGroupManager && (
        <div style={{
          padding: '16px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '1px solid #e1e8ed'
        }}>
          <h5 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>新規グループ作成</h5>
          
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
            marginBottom: '12px'
          }}>
            <div>
              <label style={{ fontSize: '12px', color: '#666' }}>グループ名</label>
              <input
                type="text"
                value={newGroupForm.name}
                onChange={(e) => setNewGroupForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="家族グループ"
                style={{
                  width: '100%',
                  padding: '6px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '12px'
                }}
              />
            </div>
            
            <div>
              <label style={{ fontSize: '12px', color: '#666' }}>保護者デバイス</label>
              <select
                value={newGroupForm.parentDeviceId}
                onChange={(e) => setNewGroupForm(prev => ({ ...prev, parentDeviceId: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '6px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '12px'
                }}
              >
                <option value="">選択してください</option>
                {devices.filter(d => getDeviceRole(d) !== 'child').map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.userName || device.name || device.deviceId}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label style={{ fontSize: '12px', color: '#666' }}>最大距離 (m)</label>
              <input
                type="number"
                value={newGroupForm.maxDistance}
                onChange={(e) => setNewGroupForm(prev => ({ ...prev, maxDistance: parseInt(e.target.value) }))}
                style={{
                  width: '100%',
                  padding: '6px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '12px'
                }}
              />
            </div>
            
            <div>
              <label style={{ fontSize: '12px', color: '#666' }}>追跡間隔 (秒)</label>
              <input
                type="number"
                value={newGroupForm.trackingInterval}
                onChange={(e) => setNewGroupForm(prev => ({ ...prev, trackingInterval: parseInt(e.target.value) }))}
                style={{
                  width: '100%',
                  padding: '6px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '12px'
                }}
              />
            </div>
          </div>
          
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '12px'
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
              <input
                type="checkbox"
                checked={newGroupForm.alertEnabled}
                onChange={(e) => setNewGroupForm(prev => ({ ...prev, alertEnabled: e.target.checked }))}
              />
              アラート有効
            </label>
            
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
              <input
                type="checkbox"
                checked={newGroupForm.geofencing}
                onChange={(e) => setNewGroupForm(prev => ({ ...prev, geofencing: e.target.checked }))}
              />
              ジオフェンシング
            </label>
          </div>
          
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ fontSize: '11px', color: '#666' }}>
              子供デバイス: {newGroupForm.childDeviceIds.length}台選択済み
            </div>
            <button
              onClick={handleCreateGroup}
              disabled={!newGroupForm.name || !newGroupForm.parentDeviceId}
              style={{
                padding: '8px 16px',
                backgroundColor: newGroupForm.name && newGroupForm.parentDeviceId ? '#4caf50' : '#e0e0e0',
                color: newGroupForm.name && newGroupForm.parentDeviceId ? 'white' : '#666',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                cursor: newGroupForm.name && newGroupForm.parentDeviceId ? 'pointer' : 'not-allowed'
              }}
            >
              ✓ グループ作成
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const filteredDevices = getFilteredAndSortedDevices();

  return (
    <div className={`tracker-selector ${className || ''}`}>
      {/* ヘッダー */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px'
      }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>
          📱 トラッカー選択
        </h3>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <div style={{
            fontSize: '11px',
            color: isStatusPolling ? '#4caf50' : '#e74c3c'
          }}>
            {isStatusPolling ? '🟢 監視中' : '🔴 停止中'}
          </div>
          <button
            onClick={isStatusPolling ? stopStatusPolling : startStatusPolling}
            style={{
              padding: '6px 12px',
              backgroundColor: isStatusPolling ? '#e74c3c' : '#4caf50',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            {isStatusPolling ? '⏹️ 停止' : '▶️ 開始'}
          </button>
        </div>
      </div>

      {/* 統計情報 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
        gap: '12px',
        marginBottom: '16px',
        padding: '12px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#2196f3' }}>
            {devices.length}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>総デバイス数</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#4caf50' }}>
            {Object.values(deviceStatuses).filter(s => s.isOnline).length}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>オンライン</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ff9800' }}>
            {devices.filter(d => getDeviceRole(d) === 'parent').length}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>保護者</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#9c27b0' }}>
            {devices.filter(d => getDeviceRole(d) === 'child').length}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>子供</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#e91e63' }}>
            {groups.length}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>グループ数</div>
        </div>
      </div>

      {/* グループ管理 */}
      {renderGroupManager()}

      {/* フィルター・ソート */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '12px',
          alignItems: 'end'
        }}>
          <div>
            <label style={{ fontSize: '12px', color: '#666' }}>役割</label>
            <select
              value={filter.role}
              onChange={(e) => setFilter(prev => ({ ...prev, role: e.target.value as any }))}
              style={{
                width: '100%',
                padding: '6px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '12px'
              }}
            >
              <option value="all">すべて</option>
              <option value="parent">保護者</option>
              <option value="child">子供</option>
            </select>
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: '#666' }}>状態</label>
            <select
              value={filter.status}
              onChange={(e) => setFilter(prev => ({ ...prev, status: e.target.value as any }))}
              style={{
                width: '100%',
                padding: '6px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '12px'
              }}
            >
              <option value="all">すべて</option>
              <option value="online">オンライン</option>
              <option value="offline">オフライン</option>
            </select>
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: '#666' }}>グループ</label>
            <select
              value={filter.group}
              onChange={(e) => setFilter(prev => ({ ...prev, group: e.target.value }))}
              style={{
                width: '100%',
                padding: '6px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '12px'
              }}
            >
              <option value="all">すべて</option>
              {groups.map(group => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: '#666' }}>ソート</label>
            <select
              value={`${sort.field}-${sort.direction}`}
              onChange={(e) => {
                const [field, direction] = e.target.value.split('-');
                setSort({ field: field as any, direction: direction as any });
              }}
              style={{
                width: '100%',
                padding: '6px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '12px'
              }}
            >
              <option value="name-asc">名前 (昇順)</option>
              <option value="name-desc">名前 (降順)</option>
              <option value="lastSeen-desc">更新日時 (新しい順)</option>
              <option value="lastSeen-asc">更新日時 (古い順)</option>
              <option value="battery-desc">バッテリー (高い順)</option>
              <option value="battery-asc">バッテリー (低い順)</option>
              <option value="signal-desc">信号強度 (強い順)</option>
              <option value="signal-asc">信号強度 (弱い順)</option>
              {selectedParentId && (
                <>
                  <option value="distance-asc">距離 (近い順)</option>
                  <option value="distance-desc">距離 (遠い順)</option>
                </>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* デバイス一覧 */}
      <div className="card">
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>
          📋 デバイス一覧 ({filteredDevices.length}台)
        </h4>
        
        {filteredDevices.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px',
            color: '#666',
            fontSize: '14px'
          }}>
            条件に合うデバイスがありません
          </div>
        ) : (
          filteredDevices.map(renderDeviceCard)
        )}
      </div>
    </div>
  );
}
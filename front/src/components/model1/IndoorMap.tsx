import { useState, useEffect, useRef } from 'react';
import { Device, BeaconData } from '../../types';

interface BeaconPosition {
  id: string;
  name: string;
  x: number; // マップ上のX座標 (0-100%)
  y: number; // マップ上のY座標 (0-100%)
  mac: string;
  range?: number; // 検知範囲（メートル）
}

interface RoomLayout {
  id: string;
  name: string;
  width: number; // 実際の幅（メートル）
  height: number; // 実際の高さ（メートル）
  beacons: BeaconPosition[];
  obstacles?: Array<{ // 障害物（壁、家具など）
    x: number;
    y: number;
    width: number;
    height: number;
    type: 'wall' | 'furniture' | 'door';
    label?: string;
  }>;
  zones?: Array<{ // エリア定義
    id: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
  }>;
}

interface Props {
  devices: Device[];
  selectedDeviceId?: string;
  onDeviceSelect?: (deviceId: string) => void;
  roomLayout: RoomLayout;
  showBeacons?: boolean;
  showRanges?: boolean;
  showDeviceTrails?: boolean;
  mapStyle?: 'realistic' | 'minimal' | 'blueprint';
  className?: string;
}

export default function IndoorMap({ 
  devices, 
  selectedDeviceId,
  onDeviceSelect,
  roomLayout,
  showBeacons = true,
  showRanges = false,
  showDeviceTrails = false,
  mapStyle = 'realistic',
  className 
}: Props) {
  
  const [devicePositions, setDevicePositions] = useState<Record<string, {x: number, y: number, confidence: number}>>({});
  const [deviceTrails, setDeviceTrails] = useState<Record<string, Array<{x: number, y: number, timestamp: number}>>>({});
  const mapRef = useRef<HTMLDivElement>(null);

  // デバイス位置の計算（三角測量）
  useEffect(() => {
    calculateDevicePositions();
  }, [devices, roomLayout]);

  const calculateDevicePositions = () => {
    const newPositions: Record<string, {x: number, y: number, confidence: number}> = {};

    devices.forEach(device => {
      if (!device.bleData || device.bleData.length === 0) return;

      // 最新のBLEデータを取得
      const recentBeacons = device.bleData
        .filter(data => {
          const age = Date.now() - new Date(data.timestamp).getTime();
          return age < 30000; // 30秒以内のデータのみ
        })
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 4); // 最大4つのビーコン

      if (recentBeacons.length === 0) return;

      // RSSI値から距離を推定
      const beaconDistances = recentBeacons.map(beacon => {
        const roomBeacon = roomLayout.beacons.find(b => b.mac === beacon.mac);
        if (!roomBeacon) return null;

        // RSSI to distance conversion (simplified)
        const distance = Math.max(0.1, Math.pow(10, (beacon.rssi + 59) / -20));
        
        return {
          beacon: roomBeacon,
          distance,
          rssi: beacon.rssi
        };
      }).filter(Boolean);

      if (beaconDistances.length === 0) return;

      let estimatedPosition: {x: number, y: number, confidence: number};

      if (beaconDistances.length === 1) {
        // 1つのビーコンの場合：ビーコン位置を中心とした円周上
        const beacon = beaconDistances[0];
        estimatedPosition = {
          x: beacon!.beacon.x,
          y: beacon!.beacon.y,
          confidence: 0.3 // 低信頼度
        };
      } else if (beaconDistances.length === 2) {
        // 2つのビーコンの場合：重心計算
        const [beacon1, beacon2] = beaconDistances;
        const totalWeight = (1 / beacon1!.distance) + (1 / beacon2!.distance);
        estimatedPosition = {
          x: ((beacon1!.beacon.x / beacon1!.distance) + (beacon2!.beacon.x / beacon2!.distance)) / totalWeight,
          y: ((beacon1!.beacon.y / beacon1!.distance) + (beacon2!.beacon.y / beacon2!.distance)) / totalWeight,
          confidence: 0.6 // 中信頼度
        };
      } else {
        // 3つ以上のビーコンの場合：加重平均による三角測量
        const weightedX = beaconDistances.reduce((sum, beacon) => 
          sum + (beacon!.beacon.x / beacon!.distance), 0
        );
        const weightedY = beaconDistances.reduce((sum, beacon) => 
          sum + (beacon!.beacon.y / beacon!.distance), 0
        );
        const totalWeight = beaconDistances.reduce((sum, beacon) => 
          sum + (1 / beacon!.distance), 0
        );

        estimatedPosition = {
          x: weightedX / totalWeight,
          y: weightedY / totalWeight,
          confidence: Math.min(0.9, 0.4 + (beaconDistances.length * 0.15)) // 高信頼度
        };
      }

      // 境界チェック（マップ内に収める）
      estimatedPosition.x = Math.max(2, Math.min(98, estimatedPosition.x));
      estimatedPosition.y = Math.max(2, Math.min(98, estimatedPosition.y));

      newPositions[device.id || device.deviceId] = estimatedPosition;

      // トレイル記録
      if (showDeviceTrails) {
        const deviceKey = device.id || device.deviceId;
        setDeviceTrails(prev => {
          const currentTrail = prev[deviceKey] || [];
          const newTrail = [
            ...currentTrail,
            {
              x: estimatedPosition.x,
              y: estimatedPosition.y,
              timestamp: Date.now()
            }
          ].filter(point => Date.now() - point.timestamp < 300000) // 5分間のトレイル
          .slice(-50); // 最大50ポイント

          return {
            ...prev,
            [deviceKey]: newTrail
          };
        });
      }
    });

    setDevicePositions(newPositions);
  };

  // デバイスの状態を取得
  const getDeviceStatus = (device: Device) => {
    const now = new Date();
    if (device.bleData && device.bleData.length > 0) {
      const latestBle = device.bleData[0];
      const bleTime = new Date(latestBle.timestamp);
      const timeDiff = now.getTime() - bleTime.getTime();
      
      if (timeDiff < 30000) {
        return { status: 'active', color: '#4CAF50' };
      } else if (timeDiff < 120000) {
        return { status: 'stale', color: '#FF9800' };
      }
    }
    return { status: 'inactive', color: '#9E9E9E' };
  };

  // マップスタイルの設定
  const getMapStyles = () => {
    switch (mapStyle) {
      case 'blueprint':
        return {
          background: '#1e3a5f',
          gridColor: '#2980b9',
          wallColor: '#ecf0f1',
          furnitureColor: '#95a5a6',
          textColor: '#ecf0f1'
        };
      case 'minimal':
        return {
          background: '#ffffff',
          gridColor: '#e1e8ed',
          wallColor: '#34495e',
          furnitureColor: '#bdc3c7',
          textColor: '#2c3e50'
        };
      case 'realistic':
      default:
        return {
          background: '#f8f9fa',
          gridColor: '#dee2e6',
          wallColor: '#6c757d',
          furnitureColor: '#adb5bd',
          textColor: '#495057'
        };
    }
  };

  const mapStyles = getMapStyles();

  // デバイスクリックハンドラー
  const handleDeviceClick = (deviceId: string) => {
    if (onDeviceSelect) {
      onDeviceSelect(deviceId);
    }
  };

  return (
    <div className={`indoor-map ${className || ''}`}>
      {/* マップヘッダー */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        padding: '12px 16px',
        backgroundColor: mapStyles.background,
        borderRadius: '8px 8px 0 0',
        border: `2px solid ${mapStyles.gridColor}`
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '16px',
          fontWeight: 'bold',
          color: mapStyles.textColor,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          🗺️ {roomLayout.name}
          <span style={{
            fontSize: '12px',
            padding: '4px 8px',
            backgroundColor: mapStyle === 'blueprint' ? '#3498db' : '#e9ecef',
            color: mapStyle === 'blueprint' ? 'white' : '#666',
            borderRadius: '12px',
            fontWeight: 'normal'
          }}>
            {roomLayout.width}m × {roomLayout.height}m
          </span>
        </h3>

        {/* 凡例 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          fontSize: '12px'
        }}>
          {showBeacons && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{
                width: '8px',
                height: '8px',
                backgroundColor: '#3498db',
                borderRadius: '50%'
              }} />
              <span style={{ color: mapStyles.textColor }}>ビーコン</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '8px',
              height: '8px',
              backgroundColor: '#4CAF50',
              borderRadius: '50%'
            }} />
            <span style={{ color: mapStyles.textColor }}>アクティブ</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '8px',
              height: '8px',
              backgroundColor: '#FF9800',
              borderRadius: '50%'
            }} />
            <span style={{ color: mapStyles.textColor }}>信号弱</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '8px',
              height: '8px',
              backgroundColor: '#9E9E9E',
              borderRadius: '50%'
            }} />
            <span style={{ color: mapStyles.textColor }}>圏外</span>
          </div>
        </div>
      </div>

      {/* メインマップエリア */}
      <div
        ref={mapRef}
        style={{
          position: 'relative',
          width: '100%',
          height: '500px',
          backgroundColor: mapStyles.background,
          border: `2px solid ${mapStyles.gridColor}`,
          borderRadius: '0 0 8px 8px',
          overflow: 'hidden',
          backgroundImage: mapStyle !== 'blueprint' ? 
            `radial-gradient(circle, ${mapStyles.gridColor} 1px, transparent 1px)` : 
            'none',
          backgroundSize: '20px 20px'
        }}
      >
        {/* グリッド（ブループリントモード用） */}
        {mapStyle === 'blueprint' && (
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none'
            }}
          >
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke={mapStyles.gridColor} strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        )}

        {/* ゾーン表示 */}
        {roomLayout.zones?.map(zone => (
          <div
            key={zone.id}
            style={{
              position: 'absolute',
              left: `${zone.x}%`,
              top: `${zone.y}%`,
              width: `${zone.width}%`,
              height: `${zone.height}%`,
              backgroundColor: `${zone.color}20`,
              border: `2px dashed ${zone.color}`,
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              fontWeight: 'bold',
              color: zone.color,
              pointerEvents: 'none'
            }}
          >
            {zone.name}
          </div>
        ))}

        {/* 障害物（壁、家具） */}
        {roomLayout.obstacles?.map((obstacle, index) => (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: `${obstacle.x}%`,
              top: `${obstacle.y}%`,
              width: `${obstacle.width}%`,
              height: `${obstacle.height}%`,
              backgroundColor: obstacle.type === 'wall' ? mapStyles.wallColor : mapStyles.furnitureColor,
              borderRadius: obstacle.type === 'furniture' ? '4px' : '0',
              border: obstacle.type === 'door' ? '3px solid #e74c3c' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              color: 'white',
              fontWeight: 'bold',
              textShadow: '1px 1px 2px rgba(0,0,0,0.5)'
            }}
            title={obstacle.label}
          >
            {obstacle.type === 'door' && '🚪'}
            {obstacle.label && obstacle.width > 15 && obstacle.height > 8 && (
              <span>{obstacle.label}</span>
            )}
          </div>
        ))}

        {/* ビーコン表示 */}
        {showBeacons && roomLayout.beacons.map(beacon => (
          <div key={beacon.id} style={{ position: 'absolute' }}>
            {/* ビーコン検知範囲 */}
            {showRanges && beacon.range && (
              <div
                style={{
                  position: 'absolute',
                  left: `${beacon.x}%`,
                  top: `${beacon.y}%`,
                  width: `${(beacon.range / roomLayout.width) * 100 * 2}%`,
                  height: `${(beacon.range / roomLayout.height) * 100 * 2}%`,
                  transform: 'translate(-50%, -50%)',
                  border: '2px dashed #3498db50',
                  borderRadius: '50%',
                  backgroundColor: '#3498db10',
                  pointerEvents: 'none'
                }}
              />
            )}
            
            {/* ビーコンアイコン */}
            <div
              style={{
                position: 'absolute',
                left: `${beacon.x}%`,
                top: `${beacon.y}%`,
                transform: 'translate(-50%, -50%)',
                width: '16px',
                height: '16px',
                backgroundColor: '#3498db',
                borderRadius: '50%',
                border: '3px solid white',
                boxShadow: '0 2px 8px rgba(52, 152, 219, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '8px',
                color: 'white',
                fontWeight: 'bold',
                cursor: 'help',
                zIndex: 10
              }}
              title={`${beacon.name} (${beacon.mac})`}
            >
              📡
            </div>
            
            {/* ビーコン名 */}
            <div
              style={{
                position: 'absolute',
                left: `${beacon.x}%`,
                top: `${beacon.y + 4}%`,
                transform: 'translateX(-50%)',
                fontSize: '10px',
                fontWeight: 'bold',
                color: mapStyles.textColor,
                textAlign: 'center',
                backgroundColor: mapStyles.background,
                padding: '2px 6px',
                borderRadius: '4px',
                border: `1px solid ${mapStyles.gridColor}`,
                whiteSpace: 'nowrap',
                zIndex: 9
              }}
            >
              {beacon.name}
            </div>
          </div>
        ))}

        {/* デバイストレイル */}
        {showDeviceTrails && Object.entries(deviceTrails).map(([deviceKey, trail]) => (
          <svg
            key={`trail-${deviceKey}`}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 5
            }}
          >
            {trail.length > 1 && (
              <path
                d={`M ${trail.map(point => `${point.x}% ${point.y}%`).join(' L ')}`}
                stroke="#e74c3c"
                strokeWidth="2"
                strokeOpacity="0.6"
                strokeDasharray="4,4"
                fill="none"
              />
            )}
          </svg>
        ))}

        {/* デバイス位置表示 */}
        {devices.map(device => {
          const deviceKey = device.id || device.deviceId;
          const position = devicePositions[deviceKey];
          const deviceStatus = getDeviceStatus(device);
          const isSelected = selectedDeviceId === deviceKey;
          
          if (!position) return null;

          return (
            <div
              key={deviceKey}
              onClick={() => handleDeviceClick(deviceKey)}
              style={{
                position: 'absolute',
                left: `${position.x}%`,
                top: `${position.y}%`,
                transform: 'translate(-50%, -50%)',
                zIndex: isSelected ? 20 : 15,
                cursor: onDeviceSelect ? 'pointer' : 'default'
              }}
            >
              {/* 信頼度インジケーター */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: `${20 + (position.confidence * 20)}px`,
                  height: `${20 + (position.confidence * 20)}px`,
                  backgroundColor: `${deviceStatus.color}30`,
                  borderRadius: '50%',
                  border: `2px solid ${deviceStatus.color}60`,
                  animation: deviceStatus.status === 'active' ? 'pulse 2s infinite' : 'none'
                }}
              />
              
              {/* デバイスアイコン */}
              <div
                style={{
                  position: 'relative',
                  width: '24px',
                  height: '24px',
                  backgroundColor: deviceStatus.color,
                  borderRadius: '50%',
                  border: isSelected ? '4px solid #2c3e50' : '3px solid white',
                  boxShadow: isSelected 
                    ? '0 4px 16px rgba(44, 62, 80, 0.4)' 
                    : '0 2px 8px rgba(0,0,0,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  color: 'white',
                  fontWeight: 'bold',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                  if (onDeviceSelect) {
                    e.currentTarget.style.transform = 'scale(1.2)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (onDeviceSelect) {
                    e.currentTarget.style.transform = 'scale(1)';
                  }
                }}
              >
                📱
              </div>
              
              {/* デバイス名 */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '100%',
                  transform: 'translateX(-50%)',
                  marginTop: '4px',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  color: mapStyles.textColor,
                  textAlign: 'center',
                  backgroundColor: mapStyles.background,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: `1px solid ${mapStyles.gridColor}`,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                  zIndex: 25
                }}
              >
                {device.userName || device.name || device.deviceId}
                {isSelected && (
                  <div style={{
                    fontSize: '8px',
                    color: '#666',
                    marginTop: '2px'
                  }}>
                    選択中
                  </div>
                )}
              </div>
              
              {/* 信頼度表示 */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '-25px',
                  transform: 'translateX(-50%)',
                  fontSize: '8px',
                  color: deviceStatus.color,
                  backgroundColor: mapStyles.background,
                  padding: '1px 4px',
                  borderRadius: '4px',
                  border: `1px solid ${deviceStatus.color}`,
                  whiteSpace: 'nowrap'
                }}
              >
                {Math.round(position.confidence * 100)}%
              </div>
            </div>
          );
        })}

        {/* 統計情報オーバーレイ */}
        <div
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            padding: '12px',
            backgroundColor: `${mapStyles.background}f0`,
            borderRadius: '8px',
            border: `1px solid ${mapStyles.gridColor}`,
            fontSize: '11px',
            color: mapStyles.textColor,
            backdropFilter: 'blur(4px)'
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>📊 統計</div>
          <div>アクティブ: {devices.filter(d => getDeviceStatus(d).status === 'active').length}台</div>
          <div>検知中: {Object.keys(devicePositions).length}台</div>
          <div>ビーコン: {roomLayout.beacons.length}台</div>
        </div>
      </div>

      {/* アニメーション用CSS */}
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            50% { opacity: 0.7; transform: translate(-50%, -50%) scale(1.1); }
            100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          }
        `}
      </style>
    </div>
  );
}

// === サンプルルームレイアウト ===
export const sampleRoomLayouts: Record<string, RoomLayout> = {
  livingRoom: {
    id: 'living-room',
    name: 'リビングルーム',
    width: 6,
    height: 4,
    beacons: [
      { id: 'beacon-1', name: 'TV前', x: 20, y: 15, mac: 'AA:BB:CC:DD:EE:01', range: 3 },
      { id: 'beacon-2', name: 'ソファ', x: 50, y: 70, mac: 'AA:BB:CC:DD:EE:02', range: 2.5 },
      { id: 'beacon-3', name: '窓際', x: 80, y: 30, mac: 'AA:BB:CC:DD:EE:03', range: 3 },
      { id: 'beacon-4', name: '入口', x: 15, y: 85, mac: 'AA:BB:CC:DD:EE:04', range: 2 }
    ],
    obstacles: [
      { x: 10, y: 10, width: 30, height: 8, type: 'furniture', label: 'TVボード' },
      { x: 35, y: 60, width: 30, height: 20, type: 'furniture', label: 'ソファ' },
      { x: 70, y: 75, width: 15, height: 15, type: 'furniture', label: 'テーブル' },
      { x: 5, y: 80, width: 15, height: 6, type: 'door', label: '入口' }
    ],
    zones: [
      { id: 'tv-area', name: 'TV視聴エリア', x: 5, y: 5, width: 40, height: 30, color: '#3498db' },
      { id: 'relax-area', name: 'くつろぎエリア', x: 30, y: 50, width: 50, height: 40, color: '#2ecc71' }
    ]
  },
  bedroom: {
    id: 'bedroom',
    name: '寝室',
    width: 4,
    height: 3,
    beacons: [
      { id: 'beacon-5', name: 'ベッド横', x: 25, y: 30, mac: 'AA:BB:CC:DD:EE:05', range: 2 },
      { id: 'beacon-6', name: 'クローゼット', x: 75, y: 20, mac: 'AA:BB:CC:DD:EE:06', range: 1.5 }
    ],
    obstacles: [
      { x: 10, y: 20, width: 40, height: 25, type: 'furniture', label: 'ベッド' },
      { x: 70, y: 10, width: 25, height: 40, type: 'furniture', label: 'クローゼット' },
      { x: 5, y: 85, width: 20, height: 6, type: 'door', label: '入口' }
    ],
    zones: [
      { id: 'sleep-area', name: '睡眠エリア', x: 5, y: 15, width: 50, height: 35, color: '#9b59b6' }
    ]
  }
};
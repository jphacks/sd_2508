import { useState, useEffect, useRef } from 'react';
import { Device, BeaconDevice, RoomLayout } from '../../types';

interface BeaconSignalData {
  beaconId: string;
  mac: string;
  rssi: number;
  distance: number;
  timestamp: number;
  deviceId: string;
  deviceName?: string;
}

interface Props {
  devices: Device[];
  beacons: BeaconDevice[];
  roomLayout?: RoomLayout;
  selectedDeviceId?: string;
  onBeaconSelect?: (beaconId: string) => void;
  showRSSI?: boolean;
  showDistance?: boolean;
  showNetwork?: boolean;
  showHistory?: boolean;
  visualMode?: 'radar' | 'heatmap' | 'network' | 'list';
  className?: string;
}

export default function BeaconVisualizer({
  devices,
  beacons,
  roomLayout,
  selectedDeviceId,
  onBeaconSelect,
  showRSSI = true,
  showDistance = true,
  showNetwork = false,
  showHistory = false,
  visualMode = 'radar',
  className
}: Props) {
  
  const [signalData, setSignalData] = useState<BeaconSignalData[]>([]);
  const [signalHistory, setSignalHistory] = useState<Record<string, BeaconSignalData[]>>({});
  const [selectedBeaconId, setSelectedBeaconId] = useState<string>('');
  const [animationEnabled, setAnimationEnabled] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  // シグナルデータの更新
  useEffect(() => {
    updateSignalData();
  }, [devices, beacons]);

  // キャンバス描画
  useEffect(() => {
    if (visualMode === 'radar' || visualMode === 'network') {
      drawVisualization();
    }
  }, [signalData, selectedBeaconId, visualMode, animationEnabled]);

  const updateSignalData = () => {
    const newSignalData: BeaconSignalData[] = [];
    const now = Date.now();

    devices.forEach(device => {
      if (!device.bleData) return;

      device.bleData.forEach(bleSignal => {
        const beacon = beacons.find(b => b.mac === bleSignal.mac);
        if (!beacon) return;

        // RSSI値から距離を推定 (簡易計算)
        const distance = Math.max(0.1, Math.pow(10, (bleSignal.rssi + 59) / -20));
        
        const signalEntry: BeaconSignalData = {
          beaconId: beacon.id,
          mac: beacon.mac,
          rssi: bleSignal.rssi,
          distance,
          timestamp: new Date(bleSignal.timestamp).getTime(),
          deviceId: device.id || device.deviceId,
          deviceName: device.userName || device.name
        };

        newSignalData.push(signalEntry);

        // 履歴データの更新
        if (showHistory) {
          const key = `${beacon.id}-${device.id}`;
          setSignalHistory(prev => {
            const currentHistory = prev[key] || [];
            const newHistory = [
              ...currentHistory,
              signalEntry
            ].filter(entry => now - entry.timestamp < 300000) // 5分間の履歴
             .slice(-100); // 最大100ポイント

            return {
              ...prev,
              [key]: newHistory
            };
          });
        }
      });
    });

    setSignalData(newSignalData);
  };

  // RSSI値を色に変換
  const rssiToColor = (rssi: number) => {
    if (rssi >= -50) return '#4CAF50'; // 強い信号（緑）
    if (rssi >= -70) return '#FF9800'; // 中程度（オレンジ）
    if (rssi >= -85) return '#F44336'; // 弱い信号（赤）
    return '#9E9E9E'; // 非常に弱い（グレー）
  };

  // 距離を円のサイズに変換
  const distanceToRadius = (distance: number) => {
    return Math.max(10, Math.min(100, 60 - (distance * 10)));
  };

  // ビーコンクリックハンドラー
  const handleBeaconClick = (beaconId: string) => {
    setSelectedBeaconId(prev => prev === beaconId ? '' : beaconId);
    if (onBeaconSelect) {
      onBeaconSelect(beaconId);
    }
  };

  // レーダー・ネットワーク可視化の描画
  const drawVisualization = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(width, height) / 2 - 20;

    // キャンバスクリア
    ctx.clearRect(0, 0, width, height);

    if (visualMode === 'radar') {
      drawRadarMode(ctx, centerX, centerY, maxRadius);
    } else if (visualMode === 'network') {
      drawNetworkMode(ctx, width, height);
    }
  };

  // レーダーモードの描画
  const drawRadarMode = (ctx: CanvasRenderingContext2D, centerX: number, centerY: number, maxRadius: number) => {
    // レーダー背景
    ctx.strokeStyle = '#e1e8ed';
    ctx.lineWidth = 1;
    
    // 同心円
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, (maxRadius / 4) * i, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // 十字線
    ctx.beginPath();
    ctx.moveTo(centerX - maxRadius, centerY);
    ctx.lineTo(centerX + maxRadius, centerY);
    ctx.moveTo(centerX, centerY - maxRadius);
    ctx.lineTo(centerX, centerY + maxRadius);
    ctx.stroke();

    // 距離ラベル
    ctx.font = '10px Arial';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    for (let i = 1; i <= 4; i++) {
      const radius = (maxRadius / 4) * i;
      const distance = (10 / 4) * i; // 最大10mとして計算
      ctx.fillText(`${distance}m`, centerX + radius - 10, centerY - 5);
    }

    // ビーコン信号の描画
    const beaconPositions = new Map();
    
    beacons.forEach((beacon, index) => {
      const angle = (index / beacons.length) * 2 * Math.PI;
      const x = centerX + Math.cos(angle) * maxRadius * 0.8;
      const y = centerY + Math.sin(angle) * maxRadius * 0.8;
      beaconPositions.set(beacon.id, { x, y, angle });

      // ビーコン描画
      const isSelected = selectedBeaconId === beacon.id;
      const beaconSignals = signalData.filter(s => s.beaconId === beacon.id);
      const avgRSSI = beaconSignals.length > 0 ? 
        beaconSignals.reduce((sum, s) => sum + s.rssi, 0) / beaconSignals.length : -100;

      ctx.fillStyle = beacon.isActive ? rssiToColor(avgRSSI) : '#9E9E9E';
      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 12 : 8, 0, 2 * Math.PI);
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // ビーコン名
      ctx.fillStyle = '#333';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(beacon.name, x, y + 25);
    });

    // デバイス信号の描画
    signalData.forEach(signal => {
      const beaconPos = beaconPositions.get(signal.beaconId);
      if (!beaconPos) return;

      const distance = Math.min(signal.distance, 10); // 最大10m
      const signalRadius = (distance / 10) * maxRadius;
      
      // 信号円
      const isDeviceSelected = selectedDeviceId === signal.deviceId;
      ctx.strokeStyle = rssiToColor(signal.rssi);
      ctx.lineWidth = isDeviceSelected ? 3 : 1;
      ctx.globalAlpha = isDeviceSelected ? 0.8 : 0.3;
      
      ctx.beginPath();
      ctx.arc(beaconPos.x, beaconPos.y, signalRadius, 0, 2 * Math.PI);
      ctx.stroke();
      
      ctx.globalAlpha = 1;

      // RSSI値表示
      if (showRSSI && isDeviceSelected) {
        ctx.fillStyle = rssiToColor(signal.rssi);
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(
          `${signal.rssi}dBm`,
          beaconPos.x + Math.cos(beaconPos.angle + 0.3) * 30,
          beaconPos.y + Math.sin(beaconPos.angle + 0.3) * 30
        );
      }
    });

    // アニメーション効果
    if (animationEnabled) {
      const time = Date.now() * 0.001;
      ctx.globalAlpha = 0.1;
      
      signalData.forEach(signal => {
        const beaconPos = beaconPositions.get(signal.beaconId);
        if (!beaconPos) return;

        const animRadius = distanceToRadius(signal.distance) * (1 + Math.sin(time * 2) * 0.1);
        ctx.strokeStyle = rssiToColor(signal.rssi);
        ctx.lineWidth = 2;
        
        ctx.beginPath();
        ctx.arc(beaconPos.x, beaconPos.y, animRadius, 0, 2 * Math.PI);
        ctx.stroke();
      });
      
      ctx.globalAlpha = 1;
      animationRef.current = requestAnimationFrame(drawVisualization);
    }
  };

  // ネットワークモードの描画
  const drawNetworkMode = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // ビーコンをグリッド配置
    const cols = Math.ceil(Math.sqrt(beacons.length));
    const rows = Math.ceil(beacons.length / cols);
    const cellWidth = width / cols;
    const cellHeight = height / rows;

    beacons.forEach((beacon, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = col * cellWidth + cellWidth / 2;
      const y = row * cellHeight + cellHeight / 2;

      // ビーコン描画
      const beaconSignals = signalData.filter(s => s.beaconId === beacon.id);
      const isSelected = selectedBeaconId === beacon.id;
      
      ctx.fillStyle = beacon.isActive ? '#3498db' : '#9E9E9E';
      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 20 : 15, 0, 2 * Math.PI);
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // ビーコン名
      ctx.fillStyle = '#333';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(beacon.name, x, y + 35);

      // 接続デバイス数
      ctx.fillStyle = '#666';
      ctx.font = '10px Arial';
      ctx.fillText(`${beaconSignals.length} devices`, x, y + 50);

      // 接続線
      beaconSignals.forEach(signal => {
        const isDeviceSelected = selectedDeviceId === signal.deviceId;
        const lineWidth = isDeviceSelected ? 3 : 1;
        const alpha = isDeviceSelected ? 0.8 : 0.3;
        
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = rssiToColor(signal.rssi);
        ctx.lineWidth = lineWidth;
        
        // 接続線を描画（簡略化されたネットワーク表現）
        const endX = x + (Math.random() - 0.5) * 60;
        const endY = y + (Math.random() - 0.5) * 60;
        
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        
        // デバイス名
        if (isDeviceSelected) {
          ctx.fillStyle = rssiToColor(signal.rssi);
          ctx.font = '8px Arial';
          ctx.fillText(
            signal.deviceName || signal.deviceId,
            endX,
            endY - 5
          );
        }
      });
      
      ctx.globalAlpha = 1;
    });
  };

  // ヒートマップモード
  const renderHeatmap = () => {
    if (!roomLayout) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '300px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          color: '#666'
        }}>
          ヒートマップにはルームレイアウトが必要です
        </div>
      );
    }

    return (
      <div style={{ position: 'relative', width: '100%', height: '400px' }}>
        {/* 簡易ヒートマップ実装 */}
        <svg width="100%" height="100%" style={{ position: 'absolute' }}>
          <defs>
            <radialGradient id="signalGradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4CAF50" stopOpacity="0.8"/>
              <stop offset="50%" stopColor="#FF9800" stopOpacity="0.4"/>
              <stop offset="100%" stopColor="#F44336" stopOpacity="0.1"/>
            </radialGradient>
          </defs>
          
          {roomLayout.beacons.map(beacon => {
            const beaconSignals = signalData.filter(s => s.beaconId === beacon.id);
            if (beaconSignals.length === 0) return null;

            const avgDistance = beaconSignals.reduce((sum, s) => sum + s.distance, 0) / beaconSignals.length;
            const radius = Math.max(50, 200 - avgDistance * 20);

            return (
              <circle
                key={beacon.id}
                cx={`${beacon.x}%`}
                cy={`${beacon.y}%`}
                r={radius}
                fill="url(#signalGradient)"
                onClick={() => handleBeaconClick(beacon.id)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}
        </svg>
      </div>
    );
  };

  // リストモード
  const renderList = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {beacons.map(beacon => {
        const beaconSignals = signalData.filter(s => s.beaconId === beacon.id);
        const isSelected = selectedBeaconId === beacon.id;
        const avgRSSI = beaconSignals.length > 0 ? 
          beaconSignals.reduce((sum, s) => sum + s.rssi, 0) / beaconSignals.length : null;

        return (
          <div
            key={beacon.id}
            onClick={() => handleBeaconClick(beacon.id)}
            style={{
              padding: '16px',
              borderRadius: '8px',
              border: isSelected ? '2px solid #3498db' : '1px solid #e1e8ed',
              backgroundColor: isSelected ? '#3498db10' : 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    backgroundColor: beacon.isActive ? 
                      (avgRSSI ? rssiToColor(avgRSSI) : '#4CAF50') : '#9E9E9E'
                  }}
                />
                <h4 style={{
                  margin: 0,
                  fontSize: '14px',
                  fontWeight: 'bold'
                }}>
                  {beacon.name}
                </h4>
                <span style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  backgroundColor: beacon.isActive ? '#4CAF5020' : '#9E9E9E20',
                  color: beacon.isActive ? '#4CAF50' : '#9E9E9E',
                  borderRadius: '8px',
                  fontWeight: 'bold'
                }}>
                  {beacon.isActive ? 'オンライン' : 'オフライン'}
                </span>
              </div>

              <div style={{
                fontSize: '12px',
                color: '#666'
              }}>
                {beaconSignals.length} 接続
              </div>
            </div>

            <div style={{
              fontSize: '11px',
              color: '#666',
              fontFamily: 'monospace',
              marginBottom: '8px'
            }}>
              MAC: {beacon.mac}
            </div>

            {beaconSignals.length > 0 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: '8px',
                fontSize: '11px'
              }}>
                {showRSSI && avgRSSI && (
                  <div>
                    <span style={{ color: '#666' }}>平均RSSI: </span>
                    <span style={{ 
                      fontWeight: 'bold', 
                      color: rssiToColor(avgRSSI) 
                    }}>
                      {avgRSSI.toFixed(1)}dBm
                    </span>
                  </div>
                )}
                
                {showDistance && (
                  <div>
                    <span style={{ color: '#666' }}>平均距離: </span>
                    <span style={{ fontWeight: 'bold' }}>
                      {(beaconSignals.reduce((sum, s) => sum + s.distance, 0) / beaconSignals.length).toFixed(1)}m
                    </span>
                  </div>
                )}

                <div>
                  <span style={{ color: '#666' }}>最終更新: </span>
                  <span style={{ fontWeight: 'bold' }}>
                    {beacon.lastSeen ? 
                      new Date(beacon.lastSeen).toLocaleTimeString() : 
                      'N/A'
                    }
                  </span>
                </div>

                {beacon.battery && (
                  <div>
                    <span style={{ color: '#666' }}>バッテリー: </span>
                    <span style={{ 
                      fontWeight: 'bold',
                      color: beacon.battery > 20 ? '#4CAF50' : '#F44336'
                    }}>
                      {beacon.battery}%
                    </span>
                  </div>
                )}
              </div>
            )}

            {isSelected && beaconSignals.length > 0 && (
              <div style={{
                marginTop: '12px',
                padding: '8px',
                backgroundColor: '#f8f9fa',
                borderRadius: '4px'
              }}>
                <h5 style={{ margin: '0 0 8px 0', fontSize: '12px' }}>接続デバイス</h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {beaconSignals.map((signal, index) => (
                    <div
                      key={index}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '10px',
                        padding: '4px 0'
                      }}
                    >
                      <span>{signal.deviceName || signal.deviceId}</span>
                      <span style={{ color: rssiToColor(signal.rssi), fontWeight: 'bold' }}>
                        {signal.rssi}dBm ({signal.distance.toFixed(1)}m)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return (
    <div className={`beacon-visualizer ${className || ''}`}>
      {/* ヘッダー */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        padding: '12px 16px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        border: '1px solid #e1e8ed'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '16px',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          📡 ビーコン可視化
          <span style={{
            fontSize: '12px',
            padding: '2px 8px',
            backgroundColor: '#3498db',
            color: 'white',
            borderRadius: '8px',
            fontWeight: 'normal'
          }}>
            {visualMode}
          </span>
        </h3>

        {/* 表示モード切り替え */}
        <div style={{
          display: 'flex',
          gap: '4px'
        }}>
          {(['radar', 'heatmap', 'network', 'list'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setAnimationEnabled(prev => mode !== visualMode ? true : prev)}
              onClickCapture={() => setSelectedBeaconId('')}
              style={{
                padding: '6px 12px',
                backgroundColor: visualMode === mode ? '#3498db' : '#f8f9fa',
                color: visualMode === mode ? 'white' : '#666',
                border: 'none',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {{
                radar: '🎯 レーダー',
                heatmap: '🔥 ヒート',
                network: '🕸️ ネット',
                list: '📋 リスト'
              }[mode]}
            </button>
          ))}
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
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#3498db' }}>
            {beacons.length}
          </div>
          <div style={{ fontSize: '11px', color: '#666' }}>総ビーコン</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#4CAF50' }}>
            {beacons.filter(b => b.isActive).length}
          </div>
          <div style={{ fontSize: '11px', color: '#666' }}>アクティブ</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#FF9800' }}>
            {signalData.length}
          </div>
          <div style={{ fontSize: '11px', color: '#666' }}>接続数</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#e74c3c' }}>
            {selectedBeaconId ? '1' : '0'}
          </div>
          <div style={{ fontSize: '11px', color: '#666' }}>選択中</div>
        </div>
      </div>

      {/* メインビジュアライゼーション */}
      <div className="card">
        {visualMode === 'radar' || visualMode === 'network' ? (
          <div style={{ position: 'relative' }}>
            <canvas
              ref={canvasRef}
              width={800}
              height={600}
              style={{
                width: '100%',
                height: 'auto',
                border: '1px solid #e1e8ed',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
              onClick={(e) => {
                // キャンバスクリック処理（ビーコン選択）
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                // TODO: クリック位置からビーコン特定ロジック
              }}
            />
            
            {/* アニメーション制御 */}
            <div style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 8px',
              backgroundColor: 'rgba(255,255,255,0.9)',
              borderRadius: '4px',
              fontSize: '10px'
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="checkbox"
                  checked={animationEnabled}
                  onChange={(e) => setAnimationEnabled(e.target.checked)}
                />
                アニメーション
              </label>
            </div>
          </div>
        ) : visualMode === 'heatmap' ? (
          renderHeatmap()
        ) : (
          renderList()
        )}
      </div>

      {/* 選択されたビーコンの詳細 */}
      {selectedBeaconId && (
        <div className="card" style={{ marginTop: '16px' }}>
          {(() => {
            const selectedBeacon = beacons.find(b => b.id === selectedBeaconId);
            const beaconSignals = signalData.filter(s => s.beaconId === selectedBeaconId);
            
            if (!selectedBeacon) return null;

            return (
              <div>
                <h4 style={{
                  margin: '0 0 12px 0',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  📡 {selectedBeacon.name} - 詳細情報
                  <button
                    onClick={() => setSelectedBeaconId('')}
                    style={{
                      padding: '2px 6px',
                      backgroundColor: '#e74c3c',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                  >
                    ✕
                  </button>
                </h4>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '12px',
                  marginBottom: '12px'
                }}>
                  <div>
                    <div style={{ fontSize: '11px', color: '#666' }}>MAC Address</div>
                    <div style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: 'bold' }}>
                      {selectedBeacon.mac}
                    </div>
                  </div>
                  
                  <div>
                    <div style={{ fontSize: '11px', color: '#666' }}>状態</div>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 'bold',
                      color: selectedBeacon.isActive ? '#4CAF50' : '#F44336'
                    }}>
                      {selectedBeacon.isActive ? 'オンライン' : 'オフライン'}
                    </div>
                  </div>
                  
                  <div>
                    <div style={{ fontSize: '11px', color: '#666' }}>接続デバイス数</div>
                    <div style={{ fontSize: '12px', fontWeight: 'bold' }}>
                      {beaconSignals.length}台
                    </div>
                  </div>
                  
                  {selectedBeacon.battery && (
                    <div>
                      <div style={{ fontSize: '11px', color: '#666' }}>バッテリー</div>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: 'bold',
                        color: selectedBeacon.battery > 20 ? '#4CAF50' : '#F44336'
                      }}>
                        {selectedBeacon.battery}%
                      </div>
                    </div>
                  )}
                </div>

                {beaconSignals.length > 0 && (
                  <div>
                    <h5 style={{ margin: '12px 0 8px 0', fontSize: '12px' }}>
                      接続デバイス
                    </h5>
                    <div style={{
                      maxHeight: '200px',
                      overflowY: 'auto',
                      border: '1px solid #e1e8ed',
                      borderRadius: '4px'
                    }}>
                      {beaconSignals.map((signal, index) => (
                        <div
                          key={index}
                          style={{
                            padding: '8px 12px',
                            borderBottom: index < beaconSignals.length - 1 ? '1px solid #e1e8ed' : 'none',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: 'bold' }}>
                              {signal.deviceName || signal.deviceId}
                            </div>
                            <div style={{ fontSize: '10px', color: '#666' }}>
                              {new Date(signal.timestamp).toLocaleTimeString()}
                            </div>
                          </div>
                          
                          <div style={{ textAlign: 'right' }}>
                            <div style={{
                              fontSize: '11px',
                              fontWeight: 'bold',
                              color: rssiToColor(signal.rssi)
                            }}>
                              {signal.rssi}dBm
                            </div>
                            <div style={{ fontSize: '10px', color: '#666' }}>
                              ~{signal.distance.toFixed(1)}m
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
import { Device, Mode } from '../../types';

interface Props {
  devices: Device[];
  currentMode: Mode;
  modeColor: string;
  onDeviceSelect?: (deviceId: string) => void;
  selectedDeviceId?: string;
}

export default function TrackerList({ 
  devices, 
  currentMode, 
  modeColor, 
  onDeviceSelect,
  selectedDeviceId 
}: Props) {
  
  // デバイスの状態を取得
  const getDeviceStatus = (device: Device) => {
    const now = new Date();
    
    // モード別の状態判定
    switch (currentMode) {
      case 'indoor':
        // BLEデータの有無と更新時刻
        if (device.bleData && device.bleData.length > 0) {
          const latestBle = device.bleData[0];
          const bleTime = new Date(latestBle.timestamp);
          const timeDiff = now.getTime() - bleTime.getTime();
          
          if (timeDiff < 30000) { // 30秒以内
            return { 
              status: 'active', 
              text: '室内検知中', 
              color: '#4CAF50',
              detail: `RSSI: ${latestBle.rssi}dBm`
            };
          } else if (timeDiff < 120000) { // 2分以内
            return { 
              status: 'stale', 
              text: '信号弱', 
              color: '#FF9800',
              detail: '信号が古くなっています'
            };
          }
        }
        return { 
          status: 'inactive', 
          text: '圏外', 
          color: '#9E9E9E',
          detail: 'BLE信号なし'
        };
        
      case 'bus':
        // RSSI値による判定
        if (device.bleData && device.bleData.length > 0) {
          const latestBle = device.bleData[0];
          const bleTime = new Date(latestBle.timestamp);
          const timeDiff = now.getTime() - bleTime.getTime();
          
          if (timeDiff > 60000) { // 1分以上古い
            return { 
              status: 'stale', 
              text: 'データ古', 
              color: '#FF9800',
              detail: '信号が古くなっています'
            };
          }
          
          if (latestBle.rssi >= -60) {
            return { 
              status: 'active', 
              text: 'バス内(近)', 
              color: '#4CAF50',
              detail: `RSSI: ${latestBle.rssi}dBm (強い)`
            };
          } else if (latestBle.rssi >= -75) {
            return { 
              status: 'active', 
              text: 'バス内', 
              color: '#4CAF50',
              detail: `RSSI: ${latestBle.rssi}dBm`
            };
          } else if (latestBle.rssi >= -90) {
            return { 
              status: 'weak', 
              text: 'バス外(近)', 
              color: '#4CAF50',
              detail: `RSSI: ${latestBle.rssi}dBm (弱い)`
            };
          }
          return { 
            status: 'inactive', 
            text: 'バス外', 
            color: '#4CAF50',
            detail: `RSSI: ${latestBle.rssi}dBm (圏外)`
          };
        }
        return { 
          status: 'inactive', 
          text: '圏外', 
          color: '#9E9E9E',
          detail: 'BLE信号なし'
        };
        
      case 'gps':
        // GPS位置情報の有無と精度
        if (device.position) {
          const gpsTime = device.position.timestamp ? new Date(device.position.timestamp) : device.lastUpdate;
          const timeDiff = gpsTime ? now.getTime() - gpsTime.getTime() : Infinity;
          
          if (timeDiff < 60000) { // 1分以内
            const accuracy = device.position.accuracy;
            if (accuracy && accuracy <= 10) {
              return { 
                status: 'active', 
                text: 'GPS取得中(高精度)', 
                color: '#4CAF50',
                detail: `精度: ±${accuracy}m`
              };
            } else if (accuracy && accuracy <= 50) {
              return { 
                status: 'active', 
                text: 'GPS取得中', 
                color: '#4CAF50',
                detail: `精度: ±${accuracy}m`
              };
            } else {
              return { 
                status: 'weak', 
                text: 'GPS取得中(低精度)', 
                color: '#FF9800',
                detail: accuracy ? `精度: ±${accuracy}m` : '精度不明'
              };
            }
          } else if (timeDiff < 300000) { // 5分以内
            return { 
              status: 'stale', 
              text: 'GPS古', 
              color: '#FF9800',
              detail: 'GPS情報が古くなっています'
            };
          }
        }
        return { 
          status: 'inactive', 
          text: 'GPS待機中', 
          color: '#9E9E9E',
          detail: 'GPS信号なし'
        };
        
      default:
        return { 
          status: 'inactive', 
          text: '不明', 
          color: '#9E9E9E',
          detail: '状態不明'
        };
    }
  };

  // 最終更新時刻のフォーマット
  const formatLastUpdate = (device: Device) => {
    // モード別の最新タイムスタンプを取得
    let latestTime: Date | null = null;
    
    switch (currentMode) {
      case 'indoor':
      case 'bus':
        if (device.bleData && device.bleData.length > 0) {
          latestTime = new Date(device.bleData[0].timestamp);
        }
        break;
      case 'gps':
        if (device.position?.timestamp) {
          latestTime = new Date(device.position.timestamp);
        }
        break;
    }
    
    // 共通のlastUpdateも確認
    if (!latestTime && device.lastUpdate) {
      latestTime = device.lastUpdate;
    }
    
    if (latestTime) {
      const now = new Date();
      const diffMs = now.getTime() - latestTime.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      
      if (diffMinutes < 1) {
        return 'たった今';
      } else if (diffMinutes < 60) {
        return `${diffMinutes}分前`;
      } else if (diffMinutes < 24 * 60) {
        const diffHours = Math.floor(diffMinutes / 60);
        return `${diffHours}時間前`;
      } else {
        return latestTime.toLocaleString('ja-JP', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    }
    
    return 'N/A';
  };

  // モード別の詳細情報を取得
  const getModeSpecificInfo = (device: Device) => {
    switch (currentMode) {
      case 'indoor':
        return {
          icon: '🏠',
          title: '室内位置',
          data: device.bleData ? [
            `📡 ビーコン受信: ${device.bleData.length}件`,
            device.bleData[0] ? `📶 最新RSSI: ${device.bleData[0].rssi}dBm` : '',
            device.bleData[0] ? `📍 ビーコンID: ${device.bleData[0].beaconId}` : ''
          ].filter(Boolean) : ['📡 信号なし']
        };
        
      case 'bus':
        const bleData = device.bleData?.[0];
        return {
          icon: '🚌',
          title: 'バス検知',
          data: bleData ? [
            `📶 信号強度: ${bleData.rssi}dBm`,
            `📏 推定距離: ${Math.max(0.1, Math.pow(10, (bleData.rssi + 59) / -20)).toFixed(1)}m`,
            `📡 MAC: ${bleData.mac.substring(0, 8)}...`
          ] : ['📡 信号なし']
        };
        
      case 'gps':
        const position = device.position;
        return {
          icon: '🌍',
          title: 'GPS位置',
          data: position ? [
            `📍 座標: ${position.lat.toFixed(6)}, ${(position.lng || position.lon || 0).toFixed(6)}`,
            position.accuracy ? `📏 精度: ±${position.accuracy}m` : '',
            position.altitude ? `⬆️ 高度: ${position.altitude.toFixed(1)}m` : '',
            position.speed ? `🚀 速度: ${(position.speed * 3.6).toFixed(1)}km/h` : ''
          ].filter(Boolean) : ['📍 位置情報なし']
        };
        
      default:
        return {
          icon: '📱',
          title: 'デバイス',
          data: ['情報なし']
        };
    }
  };

  // デバイスカードのクリックハンドラー
  const handleDeviceClick = (deviceId: string) => {
    if (onDeviceSelect) {
      onDeviceSelect(deviceId);
    }
  };

  return (
    <div className="card">
      <h3 style={{ 
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        📱 トラッカー一覧 ({devices.length}台)
        <span style={{
          fontSize: '12px',
          padding: '4px 8px',
          borderRadius: '12px',
          backgroundColor: modeColor,
          color: 'white',
          fontWeight: 'normal'
        }}>
          {currentMode === 'indoor' && '🏠 室内モード'}
          {currentMode === 'bus' && '🚌 バスモード'}
          {currentMode === 'gps' && '🌍 GPSモード'}
        </span>
      </h3>

      {devices.length > 0 ? (
        <>
          {/* サマリー情報 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
            gap: '8px',
            marginBottom: '16px',
            padding: '12px',
            backgroundColor: '#f8f9fa',
            borderRadius: '8px'
          }}>
            {(() => {
              const statusCounts = devices.reduce((counts, device) => {
                const status = getDeviceStatus(device).status;
                counts[status] = (counts[status] || 0) + 1;
                return counts;
              }, {} as Record<string, number>);

              return [
                { label: 'アクティブ', count: statusCounts.active || 0, color: '#4CAF50' },
                { label: '弱信号', count: statusCounts.weak || 0, color: '#FF9800' },
                { label: '古いデータ', count: statusCounts.stale || 0, color: '#FF9800' },
                { label: '圏外', count: statusCounts.inactive || 0, color: '#9E9E9E' }
              ].map(({ label, count, color }) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div style={{ 
                    fontSize: '18px', 
                    fontWeight: 'bold', 
                    color: color 
                  }}>
                    {count}
                  </div>
                  <div style={{ 
                    fontSize: '10px', 
                    color: '#666' 
                  }}>
                    {label}
                  </div>
                </div>
              ));
            })()}
          </div>

          {/* デバイス一覧 */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', 
            gap: '16px' 
          }}>
            {devices
              // 🔥 修正: 有効なIDを持つデバイスのみをフィルタリング
              .filter(device => device.id || device.deviceId)
              .map(device => {
                const deviceStatus = getDeviceStatus(device);
                const modeInfo = getModeSpecificInfo(device);
                // 🔥 修正: フォールバック付きでIDを取得
                const deviceId = device.id || device.deviceId || `temp-${Math.random().toString(36).substr(2, 9)}`;
                const isSelected = selectedDeviceId === deviceId;
                
                return (
                  <div
                    key={deviceId}
                    onClick={() => {
                      // 🔥 修正: IDが存在する場合のみクリックハンドラーを実行
                      if (deviceId && onDeviceSelect) {
                        handleDeviceClick(deviceId);
                      }
                    }}
                    style={{
                      padding: '16px',
                      borderRadius: '12px',
                      border: isSelected 
                        ? `3px solid ${modeColor}` 
                        : `2px solid ${deviceStatus.color}`,
                      backgroundColor: isSelected 
                        ? `${modeColor}05` 
                        : `${deviceStatus.color}05`,
                      cursor: (onDeviceSelect && deviceId) ? 'pointer' : 'default',
                      transition: 'all 0.3s ease',
                      boxShadow: isSelected 
                        ? `0 4px 16px ${modeColor}30` 
                        : '0 2px 8px rgba(0,0,0,0.1)',
                      // IDがない場合は半透明にして無効化
                      opacity: deviceId ? 1 : 0.6
                    }}
                    onMouseEnter={(e) => {
                      if (onDeviceSelect && deviceId) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.15)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (onDeviceSelect && deviceId) {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = isSelected 
                          ? `0 4px 16px ${modeColor}30` 
                          : '0 2px 8px rgba(0,0,0,0.1)';
                      }
                    }}
                  >
                    {/* デバイスヘッダー */}
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
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}>
                          <span style={{ fontSize: '18px' }}>{modeInfo.icon}</span>
                          {device.userName || device.name || device.deviceId || deviceId}
                          {/* IDがない場合の警告 */}
                          {!device.id && !device.deviceId && (
                            <span style={{
                              fontSize: '10px',
                              padding: '2px 4px',
                              backgroundColor: '#F44336',
                              color: 'white',
                              borderRadius: '4px'
                            }}>
                              ID不明
                            </span>
                          )}
                        </h4>
                        <div style={{ 
                          fontSize: '11px', 
                          color: '#666',
                          fontFamily: 'monospace'
                        }}>
                          ID: {device.deviceId || deviceId}
                          {device.devEUI && (
                            <><br />EUI: {device.devEUI.substring(0, 8)}...</>
                          )}
                        </div>
                      </div>
                      
                      {/* 状態インジケーター */}
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: '4px'
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}>
                          <div
                            style={{
                              width: '10px',
                              height: '10px',
                              borderRadius: '50%',
                              backgroundColor: deviceStatus.color,
                              animation: deviceStatus.status === 'active' ? 'pulse 2s infinite' : 'none'
                            }}
                          />
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 'bold',
                            color: deviceStatus.color
                          }}>
                            {deviceStatus.text}
                          </span>
                        </div>
                        {isSelected && (
                          <span style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            backgroundColor: modeColor,
                            color: 'white',
                            borderRadius: '8px',
                            fontWeight: 'bold'
                          }}>
                            選択中
                          </span>
                        )}
                      </div>
                    </div>

                    {/* モード別の詳細情報 */}
                    <div style={{ 
                      fontSize: '12px', 
                      color: '#666',
                      lineHeight: '1.4'
                    }}>
                      <div style={{ 
                        fontWeight: 'bold', 
                        marginBottom: '6px',
                        color: deviceStatus.color 
                      }}>
                        {modeInfo.title}
                      </div>
                      {modeInfo.data.map((info, index) => (
                        <div key={index} style={{ marginBottom: '2px' }}>
                          {info}
                        </div>
                      ))}
                      
                      {/* 詳細状態 */}
                      <div style={{ 
                        marginTop: '8px', 
                        paddingTop: '8px', 
                        borderTop: '1px solid #e1e8ed',
                        color: deviceStatus.color,
                        fontSize: '11px'
                      }}>
                        💡 {deviceStatus.detail}
                      </div>
                    </div>
                    
                    {/* 最終更新時刻 */}
                    <div style={{
                      marginTop: '12px',
                      paddingTop: '8px',
                      borderTop: '1px solid #e1e8ed',
                      fontSize: '11px',
                      color: '#888',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span>🕐 最終更新: {formatLastUpdate(device)}</span>
                      {onDeviceSelect && deviceId && (
                        <span style={{ color: modeColor }}>
                          👆 クリックで選択
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </>
      ) : (
        <div style={{ 
          textAlign: 'center', 
          padding: '40px', 
          color: '#666' 
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📱</div>
          <h4 style={{ margin: '0 0 8px 0' }}>トラッカーがありません</h4>
          <p style={{ margin: 0, fontSize: '14px' }}>
            Firestoreにデバイスが登録されていないか、<br />
            現在のモードで利用可能なデバイスがありません
          </p>
        </div>
      )}

      {/* アニメーション用のスタイル */}
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
        `}
      </style>
    </div>
  );
}
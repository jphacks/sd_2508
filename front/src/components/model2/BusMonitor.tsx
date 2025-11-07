import { useState, useEffect, useRef } from 'react';
import { Device, BeaconDevice, Alert } from '../../types';

interface BusInfo {
  id: string;
  name: string;
  route: string;
  currentStop?: string;
  nextStop?: string;
  isRunning: boolean;
  position?: {
    lat: number;
    lng: number;
    timestamp: string;
  };
  beaconMac: string; // バス固有のビーコンMAC
  capacity: number;
  driver?: {
    name: string;
    id: string;
  };
}

interface PassengerStatus {
  deviceId: string;
  deviceName: string;
  userName: string;
  status: 'onboard' | 'left' | 'unknown'; // 🔥 修正: 3つの状態に簡素化
  lastSignalTime: string;
  signalStrength: number; // RSSI
  seatArea?: string;
  isChild: boolean;
  guardianDeviceId?: string;
}

interface BusJourney {
  id: string;
  startTime: string;
  endTime?: string;
  route: string;
  passengers: PassengerStatus[];
  stops: Array<{
    name: string;
    arrivalTime?: string;
    departureTime?: string;
    passengersBoarded: number;
    passengersLeft: number;
  }>;
  alerts: Alert[];
}

interface Props {
  devices: Device[];
  busInfo: BusInfo;
  onAlertGenerate?: (alert: Alert) => void;
  onPassengerStatusChange?: (passengers: PassengerStatus[]) => void;
  autoMode?: boolean; // 自動運行モード
  className?: string;
}

export default function BusMonitor({
  devices,
  busInfo,
  onAlertGenerate,
  onPassengerStatusChange,
  autoMode = false,
  className
}: Props) {
  
  const [passengers, setPassengers] = useState<PassengerStatus[]>([]);
  const [currentJourney, setCurrentJourney] = useState<BusJourney | null>(null);
  const [busBeaconStatus, setBusBeaconStatus] = useState<'online' | 'offline' | 'weak'>('offline');
  const [departureCountdown, setDepartureCountdown] = useState<number | null>(null);
  const [isCheckingPassengers, setIsCheckingPassengers] = useState(false);
  const [alertQueue, setAlertQueue] = useState<Alert[]>([]);
  const [systemStatus, setSystemStatus] = useState<'ready' | 'monitoring' | 'checking' | 'emergency'>('ready');
  
  const checkIntervalRef = useRef<NodeJS.Timeout>();
  const departureTimerRef = useRef<NodeJS.Timeout>();

  // === 初期化 ===
  useEffect(() => {
    initializeBusMonitoring();
    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
      if (departureTimerRef.current) clearTimeout(departureTimerRef.current);
    };
  }, []);

  // === バス監視の初期化 ===
  const initializeBusMonitoring = () => {
    // 新しい運行記録を開始
    if (busInfo.isRunning && !currentJourney) {
      startNewJourney();
    }
    
    // 定期チェック開始
    checkIntervalRef.current = setInterval(() => {
      updatePassengerStatus();
      checkBusBeaconStatus();
      performSafetyChecks();
    }, 2000); // 2秒間隔

    setSystemStatus('monitoring');
  };

  // === 新しい運行開始 ===
  const startNewJourney = () => {
    const newJourney: BusJourney = {
      id: `journey-${Date.now()}`,
      startTime: new Date().toISOString(),
      route: busInfo.route,
      passengers: [],
      stops: [],
      alerts: []
    };
    
    setCurrentJourney(newJourney);
  };

  // === 乗客状態の更新 ===
  const updatePassengerStatus = () => {
    const now = Date.now();
    const newPassengers: PassengerStatus[] = [];

    devices.forEach(device => {
      // バスビーコンとの接続を確認
      const busSignal = device.bleData?.find(ble => ble.mac === busInfo.beaconMac);
      
      if (!busSignal) {
        // バス外（信号なし）
        const existingPassenger = passengers.find(p => p.deviceId === device.deviceId);
        if (existingPassenger && existingPassenger.status !== 'left') {
          // 乗車していたが信号が消えた
          newPassengers.push({
            ...existingPassenger,
            status: 'left',
            lastSignalTime: new Date().toISOString(),
            signalStrength: -100
          });
          
          // 置き去りチェック
          if (busInfo.isRunning && existingPassenger.status === 'onboard') {
            generateAlert('bus_alone', `${device.userName}がバスに置き去りになった可能性があります！`, device, 'critical');
          }
        }
        return;
      }

      // バス内（信号あり）
      const signalAge = now - new Date(busSignal.timestamp).getTime();
      const signalStrength = busSignal.rssi;
      
      let status: PassengerStatus['status'] = 'unknown';
      let seatArea = '';

      // 🔥 修正: シンプルな状態判定
      if (signalAge <= 10000) { // 10秒以内の信号
        status = 'onboard'; // バス内
        
        // RSSI値からエリアを推定（表示用）
        if (signalStrength >= -60) {
          seatArea = '入口エリア';
        } else if (signalStrength >= -80) {
          seatArea = '座席エリア';
        } else {
          seatArea = '奥座席エリア';
        }
      } else {
        status = 'unknown'; // 信号が古い = 状態不明
        seatArea = '不明';
      }

      const passenger: PassengerStatus = {
        deviceId: device.deviceId,
        deviceName: device.name || device.deviceId,
        userName: device.userName || 'Unknown',
        status,
        lastSignalTime: busSignal.timestamp,
        signalStrength,
        seatArea,
        isChild: device.userName?.includes('ちゃん') || device.userName?.includes('くん') || false,
        guardianDeviceId: undefined // TODO: 保護者デバイスの関連付け
      };

      newPassengers.push(passenger);
    });

    setPassengers(newPassengers);
    
    if (onPassengerStatusChange) {
      onPassengerStatusChange(newPassengers);
    }

    // 運行記録の更新
    if (currentJourney) {
      setCurrentJourney(prev => prev ? {
        ...prev,
        passengers: newPassengers
      } : null);
    }
  };

  // === バスビーコン状態チェック ===
  const checkBusBeaconStatus = () => {
    // バス自体のビーコン状態をチェック
    const busBeaconDevice = devices.find(d => 
      d.bleData?.some(ble => ble.mac === busInfo.beaconMac)
    );

    if (!busBeaconDevice) {
      setBusBeaconStatus('offline');
      return;
    }

    const busSignal = busBeaconDevice.bleData?.find(ble => ble.mac === busInfo.beaconMac);
    if (!busSignal) {
      setBusBeaconStatus('offline');
      return;
    }

    const signalAge = Date.now() - new Date(busSignal.timestamp).getTime();
    if (signalAge > 30000) { // 30秒以上古い
      setBusBeaconStatus('offline');
    } else if (busSignal.rssi < -80) {
      setBusBeaconStatus('weak');
    } else {
      setBusBeaconStatus('online');
    }
  };

  // === 安全チェック実行 ===
  const performSafetyChecks = () => {
    if (!busInfo.isRunning) return;

    // 🔥 修正: 乗車中のみカウント
    const boardedPassengers = passengers.filter(p => p.status === 'onboard');
    
    const childrenAlone = boardedPassengers.filter(p => 
      p.isChild && !boardedPassengers.some(guardian => 
        guardian.guardianDeviceId === p.deviceId
      )
    );

    // 子供の単独乗車チェック
    childrenAlone.forEach(child => {
      const device = devices.find(d => d.deviceId === child.deviceId);
      if (device) {
        generateAlert('bus_alone', `${child.userName}が単独でバスに乗っています`, device, 'high');
      }
    });

    // 容量オーバーチェック
    if (boardedPassengers.length > busInfo.capacity) {
      generateAlert('bus_alone', `バスの定員を超過しています (${boardedPassengers.length}/${busInfo.capacity})`, undefined, 'medium');
    }
  };

  // === アラート生成 ===
  const generateAlert = (type: Alert['type'], message: string, device?: Device, severity: Alert['severity'] = 'medium') => {
    const alert: Alert = {
      id: `bus-alert-${Date.now()}`,
      type,
      message,
      deviceId: device?.devEUI || 'bus-system',
      deviceName: device?.userName || busInfo.name,
      timestamp: new Date().toISOString(),
      dismissed: false,
      severity,
      mode: 'bus'
    };

    setAlertQueue(prev => [alert, ...prev]);
    
    if (onAlertGenerate) {
      onAlertGenerate(alert);
    }

    // 緊急時はシステム状態を変更
    if (severity === 'critical') {
      setSystemStatus('emergency');
    }
  };

  // === 発車準備チェック ===
  const startDepartureCheck = () => {
    setIsCheckingPassengers(true);
    setSystemStatus('checking');
    
    // 30秒のカウントダウン
    setDepartureCountdown(30);
    
    departureTimerRef.current = setInterval(() => {
      setDepartureCountdown(prev => {
        if (prev === null || prev <= 1) {
          finalizeDepartureCheck();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // === 発車確認完了 ===
  const finalizeDepartureCheck = () => {
    if (departureTimerRef.current) {
      clearInterval(departureTimerRef.current);
    }
    
    setIsCheckingPassengers(false);
    setDepartureCountdown(null);
    setSystemStatus('monitoring');
    
    // 🔥 修正: 乗車中のみカウント
    const finalPassengers = passengers.filter(p => p.status === 'onboard');
    
    // 発車記録
    if (currentJourney) {
      const currentStop = {
        name: busInfo.currentStop || '停留所',
        departureTime: new Date().toISOString(),
        passengersBoarded: finalPassengers.length,
        passengersLeft: 0
      };
      
      setCurrentJourney(prev => prev ? {
        ...prev,
        stops: [...prev.stops, currentStop]
      } : null);
    }
  };

  // === 緊急停止 ===
  const emergencyStop = () => {
    setSystemStatus('emergency');
    generateAlert('bus_alone', '緊急停止が実行されました！', undefined, 'critical');
    
    if (departureTimerRef.current) {
      clearInterval(departureTimerRef.current);
    }
    setIsCheckingPassengers(false);
    setDepartureCountdown(null);
  };

  // === 状態に応じた色とメッセージ ===
  const getStatusDisplay = () => {
    switch (systemStatus) {
      case 'ready':
        return { color: '#3498db', icon: '🚌', message: '待機中' };
      case 'monitoring':
        return { color: '#4CAF50', icon: '👀', message: '監視中' };
      case 'checking':
        return { color: '#FF9800', icon: '🔍', message: '安全確認中' };
      case 'emergency':
        return { color: '#e74c3c', icon: '🚨', message: '緊急事態' };
      default:
        return { color: '#9E9E9E', icon: '❓', message: '不明' };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div className={`bus-monitor ${className || ''}`}>
      {/* ヘッダー - バス情報 */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px'
        }}>
          <div>
            <h2 style={{
              margin: 0,
              fontSize: '20px',
              fontWeight: 'bold',
              color: '#2c3e50',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              🚌 {busInfo.name}
              <span style={{
                fontSize: '12px',
                padding: '4px 8px',
                backgroundColor: busInfo.isRunning ? '#4CAF50' : '#9E9E9E',
                color: 'white',
                borderRadius: '8px',
                fontWeight: 'normal'
              }}>
                {busInfo.isRunning ? '運行中' : '停止中'}
              </span>
            </h2>
            <div style={{
              fontSize: '14px',
              color: '#666',
              marginTop: '4px'
            }}>
              路線: {busInfo.route} | 定員: {busInfo.capacity}名
              {busInfo.driver && ` | 運転手: ${busInfo.driver.name}`}
            </div>
          </div>

          {/* システム状態 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              backgroundColor: `${statusDisplay.color}20`,
              borderRadius: '8px',
              border: `2px solid ${statusDisplay.color}50`
            }}>
              <span style={{ fontSize: '16px' }}>{statusDisplay.icon}</span>
              <span style={{
                fontSize: '12px',
                fontWeight: 'bold',
                color: statusDisplay.color
              }}>
                {statusDisplay.message}
              </span>
            </div>

            {/* ビーコン状態 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: {
                    'online': '#4CAF50',
                    'weak': '#FF9800',
                    'offline': '#e74c3c'
                  }[busBeaconStatus]
                }}
              />
              <span style={{
                fontSize: '10px',
                color: '#666'
              }}>
                ビーコン{{'online': 'オンライン', 'weak': '信号弱', 'offline': 'オフライン'}[busBeaconStatus]}
              </span>
            </div>
          </div>
        </div>

        {/* 現在位置・次の停留所 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          padding: '12px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px'
        }}>
          <div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>現在位置</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
              {busInfo.currentStop || '移動中'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>次の停留所</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
              {busInfo.nextStop || '終点'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>乗車人数</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
              {/* 🔥 修正: 乗車中のみカウント */}
              {passengers.filter(p => p.status === 'onboard').length}/{busInfo.capacity}名
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>最終更新</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
              {new Date().toLocaleTimeString()}
            </div>
          </div>
        </div>
      </div>

      {/* 発車確認カウントダウン */}
      {isCheckingPassengers && departureCountdown !== null && (
        <div className="card" style={{
          marginBottom: '20px',
          border: '3px solid #FF9800',
          backgroundColor: '#FFF3E0'
        }}>
          <div style={{
            textAlign: 'center',
            padding: '20px'
          }}>
            <div style={{
              fontSize: '48px',
              fontWeight: 'bold',
              color: '#FF9800',
              marginBottom: '8px'
            }}>
              {departureCountdown}
            </div>
            <div style={{
              fontSize: '18px',
              fontWeight: 'bold',
              color: '#FF9800',
              marginBottom: '16px'
            }}>
              🔍 発車前安全確認中
            </div>
            <div style={{
              fontSize: '14px',
              color: '#666',
              marginBottom: '20px'
            }}>
              全乗客の確認を行っています。問題があれば緊急停止ボタンを押してください。
            </div>
            <button
              onClick={emergencyStop}
              style={{
                padding: '12px 24px',
                backgroundColor: '#e74c3c',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              🚨 緊急停止
            </button>
          </div>
        </div>
      )}

      {/* 乗客一覧 */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px'
        }}>
          <h3 style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: 'bold'
          }}>
            {/* 🔥 修正: 乗車中のみカウント */}
            👥 乗客状況 ({passengers.filter(p => p.status === 'onboard').length}名)
          </h3>

          {/* 操作ボタン */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {!isCheckingPassengers && busInfo.isRunning && (
              <button
                onClick={startDepartureCheck}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#FF9800',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                🔍 発車確認開始
              </button>
            )}
            
            <button
              onClick={() => setAlertQueue([])}
              style={{
                padding: '8px 16px',
                backgroundColor: '#95a5a6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              🗑️ アラート削除
            </button>
          </div>
        </div>

        {passengers.length > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '12px'
          }}>
            {passengers.map((passenger, index) => {
              // 🔥 修正: 3つの状態に対応した色とラベル
              const statusColors = {
                'onboard': '#4CAF50',    // 乗車中（緑）
                'left': '#95a5a6',       // 降車済（グレー）
                'unknown': '#FF9800'     // 不明（オレンジ）
              };

              const statusLabels = {
                'onboard': '🚌 乗車中',
                'left': '👋 降車済',
                'unknown': '❓ 不明'
              };

              return (
                <div
                  key={passenger.deviceId}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: `2px solid ${statusColors[passenger.status]}30`,
                    backgroundColor: `${statusColors[passenger.status]}05`
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
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        {passenger.isChild && '👶'}
                        {passenger.userName}
                      </h4>
                      <div style={{
                        fontSize: '10px',
                        color: '#666',
                        fontFamily: 'monospace'
                      }}>
                        {passenger.deviceId}
                      </div>
                    </div>

                    <div style={{
                      fontSize: '10px',
                      padding: '4px 8px',
                      backgroundColor: statusColors[passenger.status],
                      color: 'white',
                      borderRadius: '8px',
                      fontWeight: 'bold'
                    }}>
                      {statusLabels[passenger.status]}
                    </div>
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                    fontSize: '11px',
                    color: '#666'
                  }}>
                    <div>
                      <span>信号強度: </span>
                      <span style={{
                        fontWeight: 'bold',
                        color: passenger.signalStrength >= -60 ? '#4CAF50' :
                              passenger.signalStrength >= -80 ? '#FF9800' : '#e74c3c'
                      }}>
                        {passenger.signalStrength}dBm
                      </span>
                    </div>
                    
                    <div>
                      <span>エリア: </span>
                      <span style={{ fontWeight: 'bold' }}>
                        {passenger.seatArea}
                      </span>
                    </div>
                    
                    <div style={{ gridColumn: 'span 2' }}>
                      <span>最終確認: </span>
                      <span style={{ fontWeight: 'bold' }}>
                        {new Date(passenger.lastSignalTime).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  {passenger.isChild && (
                    <div style={{
                      marginTop: '8px',
                      padding: '6px 8px',
                      backgroundColor: '#fff3cd',
                      borderRadius: '4px',
                      fontSize: '10px',
                      color: '#856404'
                    }}>
                      👶 お子様 - 特別監視対象
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{
            textAlign: 'center',
            padding: '40px',
            color: '#666'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚌</div>
            <p>現在乗客はいません</p>
          </div>
        )}
      </div>

      {/* アラート履歴 */}
      {alertQueue.length > 0 && (
        <div className="card">
          <h3 style={{
            marginBottom: '16px',
            fontSize: '16px',
            fontWeight: 'bold'
          }}>
            🚨 最近のアラート
          </h3>
          <div style={{
            maxHeight: '200px',
            overflowY: 'auto'
          }}>
            {alertQueue.slice(0, 5).map(alert => {
              // 🔥 修正: severityのデフォルト値を設定
              const severity = alert.severity || 'medium';
              
              return (
                <div
                  key={alert.id}
                  style={{
                    padding: '8px 12px',
                    marginBottom: '8px',
                    borderRadius: '6px',
                    backgroundColor: {
                      'critical': '#ffebee',
                      'high': '#fff3e0',
                      'medium': '#e8f5e8',
                      'low': '#f3f4f6'
                    }[severity], // 🔥 修正: severityを使用
                    borderLeft: `4px solid ${
                      {
                        'critical': '#e74c3c',
                        'high': '#FF9800',
                        'medium': '#4CAF50',
                        'low': '#95a5a6'
                      }[severity] // 🔥 修正: severityを使用
                    }`
                  }}
                >
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 'bold',
                    marginBottom: '4px'
                  }}>
                    {alert.message}
                  </div>
                  <div style={{
                    fontSize: '10px',
                    color: '#666'
                  }}>
                    {new Date(alert.timestamp).toLocaleTimeString()} - {alert.deviceName}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 運行記録（デバッグ用） */}
      {currentJourney && (
        <details style={{ marginTop: '20px' }}>
          <summary style={{
            cursor: 'pointer',
            padding: '8px',
            backgroundColor: '#f8f9fa',
            borderRadius: '4px'
          }}>
            📋 運行記録 (ID: {currentJourney.id})
          </summary>
          <div style={{
            marginTop: '12px',
            fontSize: '12px',
            fontFamily: 'monospace',
            backgroundColor: '#f8f9fa',
            padding: '12px',
            borderRadius: '4px',
            overflow: 'auto'
          }}>
            <pre>{JSON.stringify(currentJourney, null, 2)}</pre>
          </div>
        </details>
      )}
    </div>
  );
}

// === サンプルバス情報 ===
export const sampleBusInfo: BusInfo = {
  id: 'bus-001',
  name: '市営バス1号',
  route: '駅前 ⇔ 住宅街',
  currentStop: '市民センター前',
  nextStop: '小学校前',
  isRunning: true,
  position: {
    lat: 35.6812,
    lng: 139.7671,
    timestamp: new Date().toISOString()
  },
  beaconMac: 'BB:CC:DD:EE:FF:01',
  capacity: 20,
  driver: {
    name: '田中運転手',
    id: 'driver-001'
  }
};

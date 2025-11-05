// 距離監視・アラート管理コンポーネント

import { useState, useEffect, useCallback, useRef } from 'react';
import { Device, Alert } from '../../types';

interface DistanceRecord {
  id: string;
  timestamp: string;
  deviceId: string;
  deviceName: string;
  parentDeviceId: string;
  distance: number;
  alertLevel: 'safe' | 'warning' | 'danger';
  duration: number; // 秒
  location: {
    lat: number;
    lng: number;
    address?: string;
  };
}

interface DistanceSettings {
  warningDistance: number;    // 警告距離（メートル）
  dangerDistance: number;     // 危険距離（メートル）
  alertCooldown: number;      // アラート間隔（秒）
  autoTracking: boolean;      // 自動追跡
  soundAlerts: boolean;       // 音声アラート
  vibrationAlerts: boolean;   // バイブレーション
  enableGeofencing: boolean;  // ジオフェンシング
  trackingInterval: number;   // 追跡間隔（秒）
}

interface ActiveAlert {
  id: string;
  deviceId: string;
  alertLevel: 'warning' | 'danger';
  startTime: string;
  lastDistance: number;
  acknowledged: boolean;
  escalated: boolean;
}

interface DistanceStatus {
  deviceId: string;
  deviceName: string;
  currentDistance: number;
  previousDistance: number;
  alertLevel: 'safe' | 'warning' | 'danger';
  trend: 'approaching' | 'distancing' | 'stable';
  lastUpdate: string;
  accuracy: number;
  speed: number; // m/s
  duration: number; // 現在の状態継続時間（秒）
}

interface Props {
  devices: Device[];
  parentDeviceId: string;
  selectedDeviceId?: string;
  onAlertGenerate?: (alert: Alert) => void;
  onSettingsChange?: (settings: DistanceSettings) => void;
  className?: string;
}

export default function DistanceMonitor({
  devices,
  parentDeviceId,
  selectedDeviceId,
  onAlertGenerate,
  onSettingsChange,
  className
}: Props) {

  // === State管理 ===
  const [settings, setSettings] = useState<DistanceSettings>({
    warningDistance: 50,
    dangerDistance: 100,
    alertCooldown: 30,
    autoTracking: true,
    soundAlerts: true,
    vibrationAlerts: true,
    enableGeofencing: true,
    trackingInterval: 5
  });

  const [distanceStatuses, setDistanceStatuses] = useState<Record<string, DistanceStatus>>({});
  const [activeAlerts, setActiveAlerts] = useState<Record<string, ActiveAlert>>({});
  const [distanceHistory, setDistanceHistory] = useState<DistanceRecord[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [lastAlertTimes, setLastAlertTimes] = useState<Record<string, number>>({});

  // === Refs ===
  const monitoringIntervalRef = useRef<NodeJS.Timeout>();
  const audioContextRef = useRef<AudioContext>();
  const alertSoundRef = useRef<HTMLAudioElement>();

  // === ユーティリティ関数 ===
  const calculateDistance = useCallback((pos1: any, pos2: any): number => {
    if (!pos1 || !pos2) return 0;
    
    const R = 6371e3; // 地球の半径（メートル）
    const φ1 = (pos1.lat || pos1.latitude) * Math.PI / 180;
    const φ2 = (pos2.lat || pos2.latitude) * Math.PI / 180;
    const Δφ = ((pos2.lat || pos2.latitude) - (pos1.lat || pos1.latitude)) * Math.PI / 180;
    const Δλ = ((pos2.lng || pos2.lon || pos2.longitude) - (pos1.lng || pos1.lon || pos1.longitude)) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }, []);

  const getAlertLevel = useCallback((distance: number): 'safe' | 'warning' | 'danger' => {
    if (distance >= settings.dangerDistance) return 'danger';
    if (distance >= settings.warningDistance) return 'warning';
    return 'safe';
  }, [settings.warningDistance, settings.dangerDistance]);

  const getTrend = useCallback((current: number, previous: number): 'approaching' | 'distancing' | 'stable' => {
    const diff = current - previous;
    if (Math.abs(diff) < 2) return 'stable'; // 2m以内は安定とみなす
    return diff > 0 ? 'distancing' : 'approaching';
  }, []);

  // === 音声・バイブレーション ===
  const playAlertSound = useCallback((alertLevel: 'warning' | 'danger') => {
    if (!settings.soundAlerts) return;

    try {
      // Web Audio APIを使用した警告音生成
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // 警告レベルに応じて音程を変更
      oscillator.frequency.setValueAtTime(
        alertLevel === 'danger' ? 800 : 600, 
        audioContext.currentTime
      );
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
      console.warn('音声再生エラー:', error);
    }
  }, [settings.soundAlerts]);

  const triggerVibration = useCallback((pattern: number[]) => {
    if (!settings.vibrationAlerts || !navigator.vibrate) return;
    
    try {
      navigator.vibrate(pattern);
    } catch (error) {
      console.warn('バイブレーション不対応:', error);
    }
  }, [settings.vibrationAlerts]);

  // === 距離監視メイン処理 ===
  const updateDistanceStatuses = useCallback(() => {
    const parentDevice = devices.find(d => d.deviceId === parentDeviceId);
    if (!parentDevice?.position) return;

    const newStatuses: Record<string, DistanceStatus> = {};

    devices.forEach(device => {
      if (device.deviceId === parentDeviceId || !device.position) return;

      const currentDistance = calculateDistance(parentDevice.position, device.position);
      const previousStatus = distanceStatuses[device.id];
      const previousDistance = previousStatus?.currentDistance || currentDistance;
      
      const alertLevel = getAlertLevel(currentDistance);
      const trend = getTrend(currentDistance, previousDistance);
      
      // 速度計算（m/s）
      const timeDiff = previousStatus ? 
        (Date.now() - new Date(previousStatus.lastUpdate).getTime()) / 1000 : 0;
      const distanceDiff = Math.abs(currentDistance - previousDistance);
      const speed = timeDiff > 0 ? distanceDiff / timeDiff : 0;

      // 状態継続時間計算
      const duration = previousStatus && previousStatus.alertLevel === alertLevel ?
        previousStatus.duration + settings.trackingInterval :
        0;

      newStatuses[device.deviceId] = {
        deviceId: device.deviceId,
        deviceName: device.userName || device.name || device.deviceId,
        currentDistance,
        previousDistance,
        alertLevel,
        trend,
        lastUpdate: new Date().toISOString(),
        accuracy: device.position.accuracy || 0,
        speed,
        duration
      };

      // アラート処理
      checkAndGenerateAlert(device, currentDistance, alertLevel, previousStatus);
    });

    setDistanceStatuses(newStatuses);
  }, [devices, parentDeviceId, distanceStatuses, settings, calculateDistance, getAlertLevel, getTrend]);

  // === アラート生成処理 ===
  const checkAndGenerateAlert = useCallback((
    device: Device, 
    distance: number, 
    alertLevel: 'safe' | 'warning' | 'danger',
    previousStatus?: DistanceStatus
  ) => {
    const now = Date.now();
    const lastAlertTime = lastAlertTimes[device.deviceId] || 0;
    const cooldownPassed = (now - lastAlertTime) >= (settings.alertCooldown * 1000);

    // 安全レベルの場合はアラート解除
    if (alertLevel === 'safe') {
      setActiveAlerts(prev => {
        const newAlerts = { ...prev };
        delete newAlerts[device.deviceId];
        return newAlerts;
      });
      return;
    }

    // 既存アラートの更新
    const existingAlert = activeAlerts[device.deviceId];
    if (existingAlert) {
      setActiveAlerts(prev => ({
        ...prev,
        [device.deviceId]: {
          ...existingAlert,
          lastDistance: distance,
          escalated: existingAlert.alertLevel === 'warning' && alertLevel === 'danger'
        }
      }));

      // エスカレーション時のアラート
      if (existingAlert.alertLevel === 'warning' && alertLevel === 'danger' && cooldownPassed) {
        generateAlert(device, distance, 'danger', '警告から危険レベルにエスカレートしました');
        playAlertSound('danger');
        triggerVibration([200, 100, 200, 100, 200]);
      }
      return;
    }

    // 新規アラート生成（クールダウン確認）
    if ((alertLevel === 'warning' || alertLevel === 'danger') && cooldownPassed) {
      // アクティブアラート登録
      const alertId = `alert-${device.deviceId}-${now}`;
      setActiveAlerts(prev => ({
        ...prev,
        [device.id]: {
          id: alertId,
          deviceId: device.deviceId,
          alertLevel: alertLevel as 'warning' | 'danger',
          startTime: new Date().toISOString(),
          lastDistance: distance,
          acknowledged: false,
          escalated: false
        }
      }));

      // アラート生成
      const message = alertLevel === 'danger' 
        ? `${device.userName || device.name}が危険距離(${distance.toFixed(1)}m)に離れています`
        : `${device.userName || device.name}が警告距離(${distance.toFixed(1)}m)に離れています`;

      generateAlert(device, distance, alertLevel, message);
      
      // 音声・バイブレーション
      playAlertSound(alertLevel as 'warning' | 'danger');
      if (alertLevel === 'danger') {
        triggerVibration([300, 100, 300, 100, 300]);
      } else {
        triggerVibration([200, 100, 200]);
      }

      setLastAlertTimes(prev => ({ ...prev, [device.deviceId]: now }));
    }
  }, [activeAlerts, lastAlertTimes, settings.alertCooldown, playAlertSound, triggerVibration]);

  const generateAlert = useCallback((
    device: Device, 
    distance: number, 
    alertLevel: string, 
    customMessage?: string
  ) => {
    if (!onAlertGenerate) return;

    const alert: Alert = {
      id: `distance-${device.deviceId}-${Date.now()}`,
      type: 'gps_distance',
      message: customMessage || `${device.userName || device.name}が${distance.toFixed(1)}m離れています`,
      deviceId: device.devEUI || device.deviceId,
      deviceName: device.userName || device.name,
      timestamp: new Date().toISOString(),
      dismissed: false,
      severity: alertLevel === 'danger' ? 'critical' : 'high',
      mode: 'gps'
    };

    onAlertGenerate(alert);
  }, [onAlertGenerate]);

  // === アラート管理 ===
  const acknowledgeAlert = useCallback((deviceId: string) => {
    setActiveAlerts(prev => ({
      ...prev,
      [deviceId]: {
        ...prev[deviceId],
        acknowledged: true
      }
    }));
  }, []);

  const dismissAlert = useCallback((deviceId: string) => {
    setActiveAlerts(prev => {
      const newAlerts = { ...prev };
      delete newAlerts[deviceId];
      return newAlerts;
    });
  }, []);

  // === 監視開始/停止 ===
  const startMonitoring = useCallback(() => {
    if (monitoringIntervalRef.current) {
      clearInterval(monitoringIntervalRef.current);
    }

    setIsMonitoring(true);
    monitoringIntervalRef.current = setInterval(() => {
      updateDistanceStatuses();
    }, settings.trackingInterval * 1000);

    // 初回実行
    updateDistanceStatuses();
  }, [updateDistanceStatuses, settings.trackingInterval]);

  const stopMonitoring = useCallback(() => {
    if (monitoringIntervalRef.current) {
      clearInterval(monitoringIntervalRef.current);
      monitoringIntervalRef.current = undefined;
    }
    setIsMonitoring(false);
  }, []);

  // === 設定更新 ===
  const updateSettings = useCallback((newSettings: Partial<DistanceSettings>) => {
    const updatedSettings = { ...settings, ...newSettings };
    setSettings(updatedSettings);
    
    if (onSettingsChange) {
      onSettingsChange(updatedSettings);
    }

    // 監視中の場合は再起動
    if (isMonitoring) {
      stopMonitoring();
      setTimeout(() => startMonitoring(), 100);
    }
  }, [settings, onSettingsChange, isMonitoring, startMonitoring, stopMonitoring]);

  // === Effects ===
  useEffect(() => {
    if (settings.autoTracking && devices.length > 0) {
      startMonitoring();
    }

    return () => {
      stopMonitoring();
    };
  }, [settings.autoTracking, devices.length, startMonitoring, stopMonitoring]);

  // === レンダー関数 ===
  const renderDistanceGauge = (status: DistanceStatus) => {
    const maxRange = Math.max(settings.dangerDistance * 1.2, 150);
    const percentage = Math.min((status.currentDistance / maxRange) * 100, 100);
    
    const getGaugeColor = () => {
      switch (status.alertLevel) {
        case 'danger': return '#e74c3c';
        case 'warning': return '#f39c12';
        default: return '#27ae60';
      }
    };

    const getTrendIcon = () => {
      switch (status.trend) {
        case 'approaching': return '🔴 接近中';
        case 'distancing': return '🟢 離れ中';
        default: return '🟡 安定';
      }
    };

    return (
      <div style={{
        padding: '16px',
        backgroundColor: 'white',
        borderRadius: '12px',
        border: `2px solid ${getGaugeColor()}`,
        marginBottom: '12px'
      }}>
        {/* ヘッダー */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px'
        }}>
          <div>
            <h4 style={{ 
              margin: 0, 
              fontSize: '16px',
              color: status.deviceId === selectedDeviceId ? '#3498db' : '#333'
            }}>
              {status.deviceName}
            </h4>
            <div style={{ fontSize: '12px', color: '#666' }}>
              更新: {new Date(status.lastUpdate).toLocaleTimeString()}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ 
              fontSize: '24px', 
              fontWeight: 'bold', 
              color: getGaugeColor() 
            }}>
              {status.currentDistance.toFixed(1)}m
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              {getTrendIcon()}
            </div>
          </div>
        </div>

        {/* ゲージ */}
        <div style={{
          width: '100%',
          height: '8px',
          backgroundColor: '#f1f2f6',
          borderRadius: '4px',
          overflow: 'hidden',
          marginBottom: '8px'
        }}>
          <div style={{
            width: `${percentage}%`,
            height: '100%',
            backgroundColor: getGaugeColor(),
            transition: 'all 0.3s ease'
          }} />
        </div>

        {/* 詳細情報 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
          gap: '8px',
          fontSize: '11px',
          color: '#666'
        }}>
          <div>
            <div>速度</div>
            <div style={{ fontWeight: 'bold' }}>
              {status.speed.toFixed(1)} m/s
            </div>
          </div>
          <div>
            <div>精度</div>
            <div style={{ fontWeight: 'bold' }}>
              ±{status.accuracy.toFixed(1)}m
            </div>
          </div>
          <div>
            <div>状態継続</div>
            <div style={{ fontWeight: 'bold' }}>
              {Math.floor(status.duration / 60)}分
            </div>
          </div>
          <div>
            <div>レベル</div>
            <div style={{ 
              fontWeight: 'bold',
              color: getGaugeColor()
            }}>
              {status.alertLevel.toUpperCase()}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderActiveAlert = (alert: ActiveAlert) => {
    const status = distanceStatuses[alert.deviceId];
    const duration = Math.floor((Date.now() - new Date(alert.startTime).getTime()) / 1000);
    
    return (
      <div
        key={alert.id}
        style={{
          padding: '12px',
          backgroundColor: alert.alertLevel === 'danger' ? '#ffebee' : '#fff3e0',
          borderLeft: `4px solid ${alert.alertLevel === 'danger' ? '#e74c3c' : '#f39c12'}`,
          borderRadius: '6px',
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
            <div style={{ 
              fontSize: '14px', 
              fontWeight: 'bold',
              color: alert.alertLevel === 'danger' ? '#e74c3c' : '#f39c12'
            }}>
              {alert.alertLevel === 'danger' ? '🚨 危険アラート' : '⚠️ 警告アラート'}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              {status?.deviceName} - {alert.lastDistance.toFixed(1)}m
            </div>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {!alert.acknowledged && (
              <button
                onClick={() => acknowledgeAlert(alert.deviceId)}
                style={{
                  padding: '4px 8px',
                  backgroundColor: '#3498db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                確認
              </button>
            )}
            <button
              onClick={() => dismissAlert(alert.deviceId)}
              style={{
                padding: '4px 8px',
                backgroundColor: '#95a5a6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '10px',
                cursor: 'pointer'
              }}
            >
              解除
            </button>
          </div>
        </div>
        
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: '#666'
        }}>
          <span>
            継続時間: {Math.floor(duration / 60)}分{duration % 60}秒
          </span>
          <span>
            {alert.acknowledged ? '✅ 確認済み' : '⏰ 未確認'}
            {alert.escalated && ' | 🔺 エスカレート'}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className={`distance-monitor ${className || ''}`}>
      {/* ヘッダー */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px'
      }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>
          📏 距離監視ダッシュボード
        </h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              padding: '6px 12px',
              backgroundColor: '#f8f9fa',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            ⚙️ 設定
          </button>
          <button
            onClick={isMonitoring ? stopMonitoring : startMonitoring}
            style={{
              padding: '6px 12px',
              backgroundColor: isMonitoring ? '#e74c3c' : '#27ae60',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            {isMonitoring ? '⏹️ 停止' : '▶️ 開始'}
          </button>
        </div>
      </div>

      {/* 監視状況サマリー */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: '12px',
        marginBottom: '16px',
        padding: '12px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#3498db' }}>
            {Object.keys(distanceStatuses).length}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>監視中デバイス</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#e74c3c' }}>
            {Object.values(activeAlerts).length}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>アクティブアラート</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f39c12' }}>
            {Object.values(distanceStatuses).filter(s => s.alertLevel === 'warning').length}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>警告状態</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#27ae60' }}>
            {Object.values(distanceStatuses).filter(s => s.alertLevel === 'safe').length}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>安全状態</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>
            {isMonitoring ? '🟢 監視中' : '🔴 停止中'}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>
            {isMonitoring ? `${settings.trackingInterval}秒間隔` : '手動'}
          </div>
        </div>
      </div>

      {/* 設定パネル */}
      {showSettings && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>⚙️ 監視設定</h4>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px'
          }}>
            <div>
              <label style={{ fontSize: '12px', color: '#666' }}>警告距離 (m)</label>
              <input
                type="number"
                value={settings.warningDistance}
                onChange={(e) => updateSettings({ warningDistance: parseInt(e.target.value) })}
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
              <label style={{ fontSize: '12px', color: '#666' }}>危険距離 (m)</label>
              <input
                type="number"
                value={settings.dangerDistance}
                onChange={(e) => updateSettings({ dangerDistance: parseInt(e.target.value) })}
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
              <label style={{ fontSize: '12px', color: '#666' }}>アラート間隔 (秒)</label>
              <input
                type="number"
                value={settings.alertCooldown}
                onChange={(e) => updateSettings({ alertCooldown: parseInt(e.target.value) })}
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
                value={settings.trackingInterval}
                onChange={(e) => updateSettings({ trackingInterval: parseInt(e.target.value) })}
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
            gap: '12px',
            marginTop: '12px'
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <input
                type="checkbox"
                checked={settings.autoTracking}
                onChange={(e) => updateSettings({ autoTracking: e.target.checked })}
              />
              自動追跡
            </label>
            
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <input
                type="checkbox"
                checked={settings.soundAlerts}
                onChange={(e) => updateSettings({ soundAlerts: e.target.checked })}
              />
              音声アラート
            </label>
            
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <input
                type="checkbox"
                checked={settings.vibrationAlerts}
                onChange={(e) => updateSettings({ vibrationAlerts: e.target.checked })}
              />
              バイブレーション
            </label>
            
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <input
                type="checkbox"
                checked={settings.enableGeofencing}
                onChange={(e) => updateSettings({ enableGeofencing: e.target.checked })}
              />
              ジオフェンシング
            </label>
          </div>
        </div>
      )}

      {/* アクティブアラート */}
      {Object.keys(activeAlerts).length > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#e74c3c' }}>
            🚨 アクティブアラート ({Object.keys(activeAlerts).length})
          </h4>
          {Object.values(activeAlerts).map(renderActiveAlert)}
        </div>
      )}

      {/* 距離監視ゲージ */}
      <div className="card">
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>
          📊 リアルタイム距離状況
        </h4>
        {Object.keys(distanceStatuses).length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px',
            color: '#666',
            fontSize: '14px'
          }}>
            監視対象デバイスがありません
            <br />
            <small>監視を開始するとここに表示されます</small>
          </div>
        ) : (
          Object.values(distanceStatuses)
            .sort((a, b) => {
              // 選択中デバイスを最上位に
              if (a.deviceId === selectedDeviceId) return -1;
              if (b.deviceId === selectedDeviceId) return 1;
              // アラートレベル順
              const levelOrder = { danger: 0, warning: 1, safe: 2 };
              return levelOrder[a.alertLevel] - levelOrder[b.alertLevel];
            })
            .map(renderDistanceGauge)
        )}
      </div>
    </div>
  );
}
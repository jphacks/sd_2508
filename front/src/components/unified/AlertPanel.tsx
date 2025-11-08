
import { Alert, Mode } from '../../types';

interface Props {
  alerts: Alert[];
  onDismiss: (alertId: string) => void;
  currentMode: Mode;
}

export default function AlertPanel({ alerts, onDismiss, currentMode }: Props) {
  // アラートがない場合は何も表示しない
  if (alerts.length === 0) return null;

  // アラートタイプごとのスタイル設定
  const getAlertStyle = (alert: Alert) => {
    const severityStyles = {
      low: { 
        bg: '#E3F2FD', 
        border: '#2196F3', 
        text: '#1976D2',
        shadow: '0 2px 8px rgba(33, 150, 243, 0.2)'
      },
      medium: { 
        bg: '#FFF3E0', 
        border: '#FF9800', 
        text: '#F57C00',
        shadow: '0 2px 8px rgba(255, 152, 0, 0.2)'
      },
      high: { 
        bg: '#FFEBEE', 
        border: '#F44336', 
        text: '#D32F2F',
        shadow: '0 2px 8px rgba(244, 67, 54, 0.2)'
      },
      critical: { 
        bg: '#FCE4EC', 
        border: '#E91E63', 
        text: '#C2185B',
        shadow: '0 4px 16px rgba(233, 30, 99, 0.3)'
      }
    };

    // アラートタイプ別のデフォルト重要度
    const typeToSeverity = {
      shock: 'critical' as const,
      exit_room: 'high' as const,
      bus_alone: 'critical' as const,
      gps_distance: 'medium' as const
    };

    const severity = alert.severity || typeToSeverity[alert.type] || 'medium';
    return severityStyles[severity];
  };

  // アラートタイプごとのアイコン
  const getAlertIcon = (alert: Alert) => {
    const icons = {
      shock: '💥',
      exit_room: '🚪',
      bus_alone: '🚌',
      gps_distance: '📍'
    };
    return icons[alert.type] || '⚠️';
  };

  // アラートタイプごとのタイトル
  const getAlertTitle = (alert: Alert) => {
    const titles = {
      shock: 'ショック検知',
      exit_room: '退室検知',
      bus_alone: '置き去り警告',
      gps_distance: '距離警告'
    };
    return titles[alert.type] || '警告';
  };

  // モード別のバッジ表示
  const getModeInfo = (mode: Mode) => {
    const modeInfo = {
      indoor: { label: '室内', color: '#4A90E2' },
      bus: { label: 'バス', color: '#FF9800' },
      gps: { label: 'GPS', color: '#4CAF50' }
    };
    return modeInfo[mode];
  };

  // 時刻のフォーマット
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 1) {
      return 'たった今';
    } else if (diffMinutes < 60) {
      return `${diffMinutes}分前`;
    } else if (diffMinutes < 24 * 60) {
      const diffHours = Math.floor(diffMinutes / 60);
      return `${diffHours}時間前`;
    } else {
      return date.toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      {/* アラート件数の表示 */}
      <div style={{
        marginBottom: '16px',
        fontSize: '14px',
        color: '#666',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        {/* <span style={{ fontSize: '16px' }}>🚨</span> */}
        <span>
          アクティブなアラート: <strong>{alerts.length}件</strong>
          {currentMode && (
            <>
              {' '}({getModeInfo(currentMode).label}モード)
            </>
          )}
        </span>
      </div>

      {/* アラート一覧 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {alerts.map(alert => {
          const style = getAlertStyle(alert);
          const icon = getAlertIcon(alert);
          const title = getAlertTitle(alert);
          const modeInfo = getModeInfo(alert.mode);
          
          return (
            <div
              key={alert.id}
              style={{
                backgroundColor: style.bg,
                border: `2px solid ${style.border}`,
                borderRadius: '12px',
                padding: '16px',
                boxShadow: style.shadow,
                transition: 'all 0.3s ease',
                position: 'relative',
                overflow: 'hidden'
              }}
              // 重要度がcriticalの場合は軽いアニメーション
              className={alert.severity === 'critical' ? 'alert-pulse' : ''}
            >
              {/* 左側の重要度インジケーター */}
              <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '4px',
                backgroundColor: style.border
              }} />

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '12px'
              }}>
                <div style={{ flex: 1 }}>
                  {/* アラートヘッダー */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '8px',
                    flexWrap: 'wrap'
                  }}>
                    <span style={{ fontSize: '20px' }}>{icon}</span>
                    <strong style={{ 
                      fontSize: '16px', 
                      color: style.text,
                      lineHeight: '1.2'
                    }}>
                      {title}
                    </strong>
                    
                    {/* モードバッジ */}
                    <span style={{
                      fontSize: '10px',
                      padding: '3px 8px',
                      borderRadius: '12px',
                      backgroundColor: modeInfo.color,
                      color: 'white',
                      fontWeight: 'bold',
                      textTransform: 'uppercase'
                    }}>
                      {modeInfo.label}
                    </span>

                    {/* 重要度バッジ（criticalまたはhighの場合のみ表示） */}
                    {alert.severity && ['critical', 'high'].includes(alert.severity) && (
                      <span style={{
                        fontSize: '10px',
                        padding: '3px 8px',
                        borderRadius: '12px',
                        backgroundColor: alert.severity === 'critical' ? '#E91E63' : '#F44336',
                        color: 'white',
                        fontWeight: 'bold',
                        textTransform: 'uppercase',
                        animation: alert.severity === 'critical' ? 'pulse 2s infinite' : 'none'
                      }}>
                        {alert.severity === 'critical' ? '緊急' : '重要'}
                      </span>
                    )}
                  </div>
                  
                  {/* アラートメッセージ */}
                  <p style={{ 
                    margin: '0 0 8px 0', 
                    fontSize: '14px', 
                    color: style.text,
                    lineHeight: '1.5',
                    fontWeight: '500'
                  }}>
                    {alert.message}
                  </p>
                  
                  {/* デバイス情報と時刻 */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '12px',
                    color: '#666',
                    flexWrap: 'wrap',
                    gap: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>📱</span>
                      <span>{alert.deviceName || alert.deviceId}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>🕐</span>
                      <span>{formatTimestamp(alert.timestamp)}</span>
                    </div>
                  </div>
                </div>

                {/* 閉じるボタン */}
                <button
                  onClick={() => onDismiss(alert.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: style.text,
                    fontSize: '18px',
                    cursor: 'pointer',
                    padding: '4px',
                    borderRadius: '4px',
                    width: '28px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background-color 0.2s ease',
                    flexShrink: 0
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = `${style.border}20`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  title="アラートを閉じる"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* アラートが多い場合の要約表示 */}
      {alerts.length > 3 && (
        <div style={{
          marginTop: '12px',
          padding: '12px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          fontSize: '12px',
          color: '#666',
          textAlign: 'center'
        }}>
          📊 アラート要約: 
          ショック検知 {alerts.filter(a => a.type === 'shock').length}件、
          距離警告 {alerts.filter(a => a.type === 'gps_distance').length}件、
          その他 {alerts.filter(a => !['shock', 'gps_distance'].includes(a.type)).length}件
        </div>
      )}

      {/* CSSアニメーション用のスタイル */}
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.7; }
            100% { opacity: 1; }
          }
          
          .alert-pulse {
            animation: pulse 2s infinite;
          }
          
          .alert-pulse:hover {
            animation: none;
          }
        `}
      </style>
    </div>
  );
}
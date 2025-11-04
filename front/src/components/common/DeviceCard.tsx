// 汎用デバイスカードコンポーネント

import { useState, useCallback, useRef } from 'react';
import { Device } from '../../types';

interface DeviceStatus {
  isOnline: boolean;
  batteryLevel?: number;
  signalStrength?: number;
  lastSeen: string;
  distance?: number;
  accuracy?: number;
}

interface DeviceCardActions {
  onSelect?: (deviceId: string) => void;
  onSetAsParent?: (deviceId: string) => void;
  onEdit?: (deviceId: string) => void;
  onDelete?: (deviceId: string) => void;
  onShowDetails?: (deviceId: string) => void;
  onAddToGroup?: (deviceId: string) => void;
}

interface DeviceCardCustomization {
  showBattery?: boolean;
  showSignal?: boolean;
  showDistance?: boolean;
  showLastSeen?: boolean;
  showActions?: boolean;
  size?: 'small' | 'medium' | 'large';
  theme?: 'light' | 'dark' | 'colored';
  compact?: boolean;
}

interface DeviceCardProps {
  device: Device;
  isSelected?: boolean;
  isParentSelected?: boolean;
  showDetails?: boolean;
  role?: 'parent' | 'child' | 'unknown';
  status?: DeviceStatus;
  actions?: DeviceCardActions;
  customization?: DeviceCardCustomization;
  groupName?: string;
  alertLevel?: 'safe' | 'warning' | 'critical';
  className?: string;
  style?: React.CSSProperties;
}

export default function DeviceCard({
  device,
  isSelected = false,
  isParentSelected = false,
  showDetails = false,
  role = 'unknown',
  status,
  actions,
  customization = {},
  groupName,
  alertLevel = 'safe',
  className,
  style
}: DeviceCardProps) {

  // === State ===
  const [isExpanded, setIsExpanded] = useState(showDetails);
  const [isHovered, setIsHovered] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });

  // === Refs ===
  const cardRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // === Customization defaults ===
  const config = {
    showBattery: true,
    showSignal: true,
    showDistance: true,
    showLastSeen: true,
    showActions: true,
    size: 'medium',
    theme: 'light',
    compact: false,
    ...customization
  };

  // === ユーティリティ関数 ===
  const getDeviceName = useCallback(() => {
    return device.userName || device.name || device.deviceId;
  }, [device]);

  const getDeviceDisplayId = useCallback(() => {
    if (config.size === 'small') {
      return device.deviceId.slice(0, 8) + '...';
    }
    return device.deviceId;
  }, [device.deviceId, config.size]);

  const getRoleDisplay = useCallback(() => {
    switch (role) {
      case 'parent': return { icon: '👨‍👩‍👧‍👦', label: '保護者', color: '#4caf50' };
      case 'child': return { icon: '🧒', label: '子供', color: '#2196f3' };
      default: return { icon: '❓', label: '不明', color: '#95a5a6' };
    }
  }, [role]);

  const getBatteryColor = useCallback((level?: number) => {
    if (!level) return '#95a5a6';
    if (level > 50) return '#4caf50';
    if (level > 20) return '#ff9800';
    return '#f44336';
  }, []);

  const getSignalBars = useCallback((rssi?: number) => {
    if (!rssi) return 0;
    if (rssi > -50) return 4;
    if (rssi > -70) return 3;
    if (rssi > -85) return 2;
    if (rssi > -100) return 1;
    return 0;
  }, []);

  const getCardStyle = useCallback(() => {
    const baseStyle: React.CSSProperties = {
      padding: config.size === 'small' ? '12px' : config.size === 'large' ? '20px' : '16px',
      backgroundColor: config.theme === 'dark' ? '#2c3e50' : 'white',
      color: config.theme === 'dark' ? 'white' : '#333',
      border: `2px solid ${
        isSelected ? '#2196f3' : 
        isParentSelected ? '#4caf50' : 
        alertLevel === 'critical' ? '#f44336' :
        alertLevel === 'warning' ? '#ff9800' :
        config.theme === 'dark' ? '#34495e' : '#e1e8ed'
      }`,
      borderRadius: config.size === 'small' ? '8px' : '12px',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      position: 'relative',
      transform: isHovered ? 'translateY(-2px)' : 'none',
      boxShadow: isHovered ? '0 4px 12px rgba(0,0,0,0.15)' : '0 2px 4px rgba(0,0,0,0.1)',
      ...style
    };

    if (config.theme === 'colored') {
      baseStyle.background = `linear-gradient(135deg, ${getRoleDisplay().color}15, ${getRoleDisplay().color}05)`;
      baseStyle.borderColor = getRoleDisplay().color;
    }

    return baseStyle;
  }, [config, isSelected, isParentSelected, isHovered, alertLevel, getRoleDisplay, style]);

  // === イベントハンドラー ===
  const handleCardClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (actions?.onSelect) {
      actions.onSelect(device.deviceId);
    }
  }, [actions, device.deviceId]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleActionClick = useCallback((action: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    
    switch (action) {
      case 'setParent':
        actions?.onSetAsParent?.(device.deviceId);
        break;
      case 'edit':
        actions?.onEdit?.(device.deviceId);
        break;
      case 'delete':
        actions?.onDelete?.(device.deviceId);
        break;
      case 'details':
        setIsExpanded(!isExpanded);
        actions?.onShowDetails?.(device.deviceId);
        break;
      case 'addToGroup':
        actions?.onAddToGroup?.(device.deviceId);
        break;
    }
  }, [actions, device.deviceId, isExpanded]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick(e as any);
    }
    if (e.key === 'Escape') {
      setShowContextMenu(false);
    }
  }, [handleCardClick]);

  // === レンダー関数 ===
  const renderStatusIndicators = () => {
    if (config.compact && config.size === 'small') return null;

    return (
      <div style={{
        display: 'flex',
        gap: config.size === 'small' ? '6px' : '8px',
        alignItems: 'center',
        flexWrap: 'wrap'
      }}>
        {/* オンライン状態 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          <div style={{
            width: config.size === 'small' ? '6px' : '8px',
            height: config.size === 'small' ? '6px' : '8px',
            borderRadius: '50%',
            backgroundColor: status?.isOnline ? '#4caf50' : '#f44336'
          }} />
          <span style={{ 
            fontSize: config.size === 'small' ? '10px' : '11px',
            color: config.theme === 'dark' ? '#bdc3c7' : '#666'
          }}>
            {status?.isOnline ? 'オンライン' : 'オフライン'}
          </span>
        </div>

        {/* バッテリー */}
        {config.showBattery && status?.batteryLevel && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span style={{ fontSize: config.size === 'small' ? '10px' : '12px' }}>🔋</span>
            <span style={{ 
              fontSize: config.size === 'small' ? '10px' : '11px',
              fontWeight: 'bold',
              color: getBatteryColor(status.batteryLevel)
            }}>
              {status.batteryLevel}%
            </span>
          </div>
        )}

        {/* 信号強度 */}
        {config.showSignal && status?.signalStrength && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px'
          }}>
            {[1, 2, 3, 4].map(bar => (
              <div
                key={bar}
                style={{
                  width: config.size === 'small' ? '2px' : '3px',
                  height: `${bar * (config.size === 'small' ? 1.5 : 2) + 3}px`,
                  backgroundColor: bar <= getSignalBars(status.signalStrength) ? '#4caf50' : '#e0e0e0',
                  borderRadius: '1px'
                }}
              />
            ))}
          </div>
        )}

        {/* 距離 */}
        {config.showDistance && status?.distance !== undefined && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span style={{ fontSize: config.size === 'small' ? '10px' : '12px' }}>📏</span>
            <span style={{ 
              fontSize: config.size === 'small' ? '10px' : '11px',
              fontWeight: 'bold',
              color: status.distance > 100 ? '#f44336' : status.distance > 50 ? '#ff9800' : '#4caf50'
            }}>
              {status.distance.toFixed(1)}m
            </span>
          </div>
        )}
      </div>
    );
  };

  const renderMainContent = () => (
    <div>
      {/* ヘッダー */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: config.size === 'small' ? '8px' : '12px'
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* デバイス名とアラートレベル */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '4px'
          }}>
            <h4 style={{ 
              margin: 0, 
              fontSize: config.size === 'small' ? '14px' : config.size === 'large' ? '18px' : '16px',
              color: isSelected ? '#2196f3' : 'inherit',
              fontWeight: '600',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {getDeviceName()}
            </h4>
            
            {alertLevel !== 'safe' && (
              <span style={{
                fontSize: config.size === 'small' ? '14px' : '16px'
              }}>
                {alertLevel === 'critical' ? '🚨' : '⚠️'}
              </span>
            )}
          </div>
          
          {/* 役割バッジとグループ */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap'
          }}>
            <span style={{
              padding: '2px 8px',
              backgroundColor: getRoleDisplay().color,
              color: 'white',
              borderRadius: '12px',
              fontSize: config.size === 'small' ? '9px' : '10px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <span>{getRoleDisplay().icon}</span>
              {getRoleDisplay().label}
            </span>
            
            {groupName && (
              <span style={{
                padding: '2px 6px',
                backgroundColor: config.theme === 'dark' ? '#34495e' : '#f1f2f6',
                color: config.theme === 'dark' ? '#bdc3c7' : '#666',
                borderRadius: '8px',
                fontSize: config.size === 'small' ? '9px' : '10px'
              }}>
                📁 {groupName}
              </span>
            )}
          </div>
          
          {/* デバイスID */}
          <div style={{ 
            fontSize: config.size === 'small' ? '10px' : '12px', 
            color: config.theme === 'dark' ? '#95a5a6' : '#666',
            marginTop: '4px'
          }}>
            {getDeviceDisplayId()}
          </div>
        </div>

        {/* アクションボタン */}
        {config.showActions && !config.compact && (
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            {role === 'parent' && (
              <button
                onClick={(e) => handleActionClick('setParent', e)}
                style={{
                  padding: '4px 8px',
                  backgroundColor: isParentSelected ? '#4caf50' : '#e0e0e0',
                  color: isParentSelected ? 'white' : '#333',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '10px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                title={isParentSelected ? '選択中' : '保護者に設定'}
              >
                {isParentSelected ? '✓' : '👑'}
              </button>
            )}
            
            <button
              onClick={(e) => handleActionClick('details', e)}
              style={{
                padding: '4px 8px',
                backgroundColor: config.theme === 'dark' ? '#34495e' : '#f8f9fa',
                color: config.theme === 'dark' ? '#ecf0f1' : '#333',
                border: '1px solid ' + (config.theme === 'dark' ? '#5d6d7e' : '#ddd'),
                borderRadius: '4px',
                fontSize: '10px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              title="詳細表示"
            >
              {isExpanded ? '📊' : '👁️'}
            </button>
          </div>
        )}
      </div>

      {/* 状態インジケーター */}
      {renderStatusIndicators()}

      {/* 最終更新時刻 */}
      {config.showLastSeen && status?.lastSeen && (
        <div style={{
          marginTop: config.size === 'small' ? '6px' : '8px',
          fontSize: config.size === 'small' ? '10px' : '11px',
          color: config.theme === 'dark' ? '#95a5a6' : '#666'
        }}>
          最終更新: {new Date(status.lastSeen).toLocaleTimeString()}
        </div>
      )}
    </div>
  );

  const renderExpandedContent = () => {
    if (!isExpanded) return null;

    return (
      <div style={{
        marginTop: '12px',
        padding: '12px',
        backgroundColor: config.theme === 'dark' ? '#34495e' : '#f8f9fa',
        borderRadius: '8px',
        fontSize: '11px'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: '8px'
        }}>
          <div>
            <strong>DevEUI:</strong><br />
            <span style={{ fontFamily: 'monospace', fontSize: '10px' }}>
              {device.devEUI || 'N/A'}
            </span>
          </div>
          
          {status?.accuracy && (
            <div>
              <strong>位置精度:</strong><br />
              ±{status.accuracy}m
            </div>
          )}
          
          {status?.signalStrength && (
            <div>
              <strong>RSSI:</strong><br />
              {status.signalStrength} dBm
            </div>
          )}
          
          <div>
            <strong>接続状態:</strong><br />
            {status?.isOnline ? '🟢 接続中' : '🔴 切断中'}
          </div>
        </div>
      </div>
    );
  };

  const renderContextMenu = () => {
    if (!showContextMenu) return null;

    return (
      <>
        {/* オーバーレイ */}
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999
          }}
          onClick={() => setShowContextMenu(false)}
        />
        
        {/* コンテキストメニュー */}
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            top: contextMenuPosition.y,
            left: contextMenuPosition.x,
            backgroundColor: 'white',
            border: '1px solid #ddd',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: '4px 0',
            minWidth: '150px',
            zIndex: 1000
          }}
        >
          {role === 'parent' && (
            <button
              onClick={(e) => handleActionClick('setParent', e)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: 'none',
                backgroundColor: 'transparent',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              👑 保護者に設定
            </button>
          )}
          
          <button
            onClick={(e) => handleActionClick('addToGroup', e)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              backgroundColor: 'transparent',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            📁 グループに追加
          </button>
          
          <button
            onClick={(e) => handleActionClick('edit', e)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              backgroundColor: 'transparent',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            ✏️ 編集
          </button>
          
          <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid #eee' }} />
          
          <button
            onClick={(e) => handleActionClick('delete', e)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              backgroundColor: 'transparent',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '12px',
              color: '#f44336'
            }}
          >
            🗑️ 削除
          </button>
        </div>
      </>
    );
  };

  return (
    <div
      ref={cardRef}
      className={`device-card ${className || ''}`}
      style={getCardStyle()}
      onClick={handleCardClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`デバイス ${getDeviceName()}`}
      aria-selected={isSelected}
    >
      {renderMainContent()}
      {renderExpandedContent()}
      {renderContextMenu()}
    </div>
  );
}
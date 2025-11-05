import { Mode, ModeConfig } from '../../types';

interface Props {
  currentMode: Mode;
  onModeChange: (mode: Mode) => void;
  modeConfigs: Record<Mode, ModeConfig>;
  disabled?: boolean;
  compact?: boolean;
}

export default function ModeSelector({ 
  currentMode, 
  onModeChange, 
  modeConfigs, 
  disabled = false,
  compact = false 
}: Props) {
  
  // モード別の詳細情報
  const getModeDetails = (mode: Mode) => {
    const details = {
      indoor: {
        shortName: '室内',
        fullName: '室内追跡',
        features: ['BLEビーコン', '位置推定', '退室検知'],
        requirement: 'ビーコン設置が必要'
      },
      bus: {
        shortName: 'バス',
        fullName: 'バス検知',
        features: ['RSSI監視', '置き去り防止', 'リアルタイム警告'],
        requirement: 'バス内ビーコンが必要'
      },
      gps: {
        shortName: 'GPS',
        fullName: 'GPS追跡',
        features: ['屋外位置', '距離監視', '高精度測位'],
        requirement: 'GPS信号が必要'
      }
    };
    return details[mode];
  };

  // モードの有効性チェック
  const isModeAvailable = (mode: Mode) => {
    // 実際の実装では、デバイスの状態やビーコンの設定状況をチェック
    // 今回はすべて有効として扱う
    return true;
  };

  // モード切り替えのハンドラー
  const handleModeChange = (mode: Mode) => {
    if (disabled || !isModeAvailable(mode) || mode === currentMode) {
      return;
    }
    
    console.log(`🔄 モード切り替え: ${currentMode} → ${mode}`);
    onModeChange(mode);
  };

  // コンパクト表示の場合
  if (compact) {
    return (
      <div style={{
        display: 'flex',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        padding: '2px',
        gap: '2px',
        opacity: disabled ? 0.6 : 1
      }}>
        {(Object.keys(modeConfigs) as Mode[]).map(mode => {
          const config = modeConfigs[mode];
          const details = getModeDetails(mode);
          const isActive = currentMode === mode;
          const available = isModeAvailable(mode);
          
          return (
            <button
              key={mode}
              onClick={() => handleModeChange(mode)}
              disabled={disabled || !available}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: isActive ? config.color : 'transparent',
                color: isActive ? 'white' : available ? '#666' : '#ccc',
                fontSize: '12px',
                fontWeight: '600',
                cursor: (disabled || !available) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                minWidth: '80px',
                justifyContent: 'center'
              }}
              title={available ? details.fullName : `${details.fullName} (利用不可)`}
            >
              <span style={{ fontSize: '14px' }}>{config.icon}</span>
              <span>{details.shortName}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // 通常表示（詳細表示）
  return (
    <div style={{
      opacity: disabled ? 0.6 : 1,
      pointerEvents: disabled ? 'none' : 'auto'
    }}>
      {/* ヘッダー */}
      <div style={{
        marginBottom: '16px',
        textAlign: 'center'
      }}>
        <h3 style={{
          margin: '0 0 8px 0',
          fontSize: '18px',
          fontWeight: 'bold',
          color: '#333'
        }}>
          🎯 動作モード選択
        </h3>
        <p style={{
          margin: 0,
          fontSize: '14px',
          color: '#666'
        }}>
          利用したい機能に応じてモードを選択してください
        </p>
      </div>

      {/* モード選択カード */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '16px'
      }}>
        {(Object.keys(modeConfigs) as Mode[]).map(mode => {
          const config = modeConfigs[mode];
          const details = getModeDetails(mode);
          const isActive = currentMode === mode;
          const available = isModeAvailable(mode);
          
          return (
            <div
              key={mode}
              onClick={() => handleModeChange(mode)}
              style={{
                padding: '20px',
                borderRadius: '16px',
                border: isActive 
                  ? `3px solid ${config.color}` 
                  : available 
                    ? '2px solid #e1e8ed' 
                    : '2px solid #f0f0f0',
                backgroundColor: isActive 
                  ? `${config.color}08` 
                  : available 
                    ? 'white' 
                    : '#fafafa',
                cursor: (disabled || !available) ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: isActive 
                  ? `0 8px 24px ${config.color}30` 
                  : '0 2px 8px rgba(0,0,0,0.1)',
                transform: isActive ? 'translateY(-2px)' : 'translateY(0)',
                opacity: available ? 1 : 0.5,
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseEnter={(e) => {
                if (available && !disabled && !isActive) {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.15)';
                  e.currentTarget.style.borderColor = config.color;
                }
              }}
              onMouseLeave={(e) => {
                if (available && !disabled && !isActive) {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  e.currentTarget.style.borderColor = '#e1e8ed';
                }
              }}
            >
              {/* アクティブインジケーター */}
              {isActive && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '4px',
                  backgroundColor: config.color,
                  borderRadius: '16px 16px 0 0'
                }} />
              )}

              {/* 利用不可インジケーター */}
              {!available && (
                <div style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  padding: '4px 8px',
                  backgroundColor: '#F44336',
                  color: 'white',
                  fontSize: '10px',
                  borderRadius: '12px',
                  fontWeight: 'bold'
                }}>
                  利用不可
                </div>
              )}

              {/* メインコンテンツ */}
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '16px',
                marginBottom: '16px'
              }}>
                <div style={{
                  fontSize: '32px',
                  filter: available ? 'none' : 'grayscale(100%)'
                }}>
                  {config.icon}
                </div>
                
                <div style={{ flex: 1 }}>
                  <h4 style={{
                    margin: '0 0 8px 0',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    color: isActive ? config.color : available ? '#333' : '#999',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    {config.title}
                    {isActive && (
                      <span style={{
                        fontSize: '10px',
                        padding: '3px 8px',
                        backgroundColor: config.color,
                        color: 'white',
                        borderRadius: '12px',
                        fontWeight: 'bold'
                      }}>
                        選択中
                      </span>
                    )}
                  </h4>
                  
                  <p style={{
                    margin: '0 0 12px 0',
                    fontSize: '14px',
                    color: available ? '#666' : '#999',
                    lineHeight: '1.5'
                  }}>
                    {config.description}
                  </p>
                </div>
              </div>

              {/* 機能一覧 */}
              <div style={{
                marginBottom: '16px'
              }}>
              </div>

              {/* 選択ボタン（非アクティブ時のみ表示） */}
              {!isActive && available && (
                <div style={{
                  marginTop: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    backgroundColor: config.color,
                    color: 'white',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    opacity: 0.9,
                    transition: 'opacity 0.2s ease'
                  }}>
                    <span>👆</span>
                    <span>クリックで選択</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 現在の選択状態 */}
      <div style={{
        marginTop: '24px',
        padding: '16px',
        backgroundColor: `${modeConfigs[currentMode].color}10`,
        borderRadius: '12px',
        border: `2px solid ${modeConfigs[currentMode].color}30`,
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <div style={{ fontSize: '24px' }}>
          {modeConfigs[currentMode].icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: '14px',
            fontWeight: 'bold',
            color: modeConfigs[currentMode].color,
            marginBottom: '4px'
          }}>
            現在のモード: {modeConfigs[currentMode].title}
          </div>
          <div style={{
            fontSize: '12px',
            color: '#666'
          }}>
            {modeConfigs[currentMode].description}
          </div>
        </div>
        <div style={{
          padding: '6px 12px',
          backgroundColor: modeConfigs[currentMode].color,
          color: 'white',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: 'bold'
        }}>
          ✓ アクティブ
        </div>
      </div>
    </div>
  );
}
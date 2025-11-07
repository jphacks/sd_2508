import React, { useEffect } from 'react';

interface ShockAlert {
  id: string;
  deviceId: string;
  message: string;
  timestamp: number;
}

interface ShockAlertModalProps {
  alerts: ShockAlert[];
  onClose: (deviceId: string) => void;
}

export default function ShockAlertModal({
  alerts,
  onClose
}: ShockAlertModalProps) {

  if (alerts.length === 0) return null;

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
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          animation: 'fadeIn 0.3s ease-in-out'
        }}
      />

      {/* モーダルコンテナ */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: '#fff',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
          zIndex: 10000,
          maxWidth: '450px',
          width: '90%',
          maxHeight: '70vh',
          overflowY: 'auto',
          animation: 'popupScale 0.3s ease-out'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* タイトル */}
        <div style={{ textAlign: 'center', marginBottom: '15px' }}>
          <div
            style={{
              fontSize: '40px',
              marginBottom: '5px',
              animation: 'bounce 0.6s ease-in-out infinite'
            }}
          >
            💥
          </div>
          <h2
            style={{
              fontSize: '20px',
              fontWeight: 'bold',
              color: '#dc3545',
              margin: 0
            }}
          >
            衝撃検知アラート ({alerts.length}件)
          </h2>
        </div>

        {/* アラートリスト */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {alerts.map((alert) => (
            <div
              key={alert.id}
              style={{
                backgroundColor: '#fff5f5',
                border: '2px solid #dc3545',
                borderRadius: '8px',
                padding: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                animation: 'slideIn 0.3s ease-out'
              }}
            >
              {/* アイコンとメッセージ */}
              <span style={{ fontSize: '20px', flexShrink: 0 }}>⚠️</span>
              
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontSize: '14px',
                    fontWeight: 'bold',
                    color: '#333',
                    margin: '0 0 4px 0',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {alert.message}
                </p>
                <p
                  style={{
                    fontSize: '11px',
                    color: '#666',
                    margin: 0
                  }}
                >
                  {new Date(alert.timestamp).toLocaleTimeString('ja-JP')}
                </p>
              </div>

              {/* 確認ボタン */}
              <button
                onClick={() => onClose(alert.deviceId)}
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLButtonElement).style.backgroundColor = '#a71d2a';
                  (e.target as HTMLButtonElement).style.transform = 'scale(1.05)';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLButtonElement).style.backgroundColor = '#dc3545';
                  (e.target as HTMLButtonElement).style.transform = 'scale(1)';
                }}
              >
                確認済み
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* アニメーションスタイル */}
      <style>
        {`
          @keyframes fadeIn {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }

          @keyframes popupScale {
            from {
              opacity: 0;
              transform: translate(-50%, -50%) scale(0.8);
            }
            to {
              opacity: 1;
              transform: translate(-50%, -50%) scale(1);
            }
          }

          @keyframes bounce {
            0%, 100% {
              transform: scale(1);
            }
            50% {
              transform: scale(1.1);
            }
          }

          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateX(-20px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }
        `}
      </style>
    </>
  );
}

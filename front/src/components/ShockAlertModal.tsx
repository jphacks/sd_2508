import React, { useEffect } from 'react';

interface ShockAlertModalProps {
  isOpen: boolean;
  message: string;
  onClose: () => void;
}

export default function ShockAlertModal({
  isOpen,
  message,
  onClose
}: ShockAlertModalProps) {

  if (!isOpen) return null;

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
        onClick={onClose}
      />

      {/* モーダルポップアップ */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: '#fff',
          borderRadius: '16px',
          padding: '40px',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
          zIndex: 10000,
          maxWidth: '500px',
          width: '90%',
          textAlign: 'center',
          animation: 'popupScale 0.3s ease-out'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ショックアイコン */}
        <div
          style={{
            fontSize: '80px',
            marginBottom: '20px',
            animation: 'bounce 0.6s ease-in-out infinite'
          }}
        >
          💥
        </div>

        {/* タイトル */}
        <h2
          style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: '#dc3545',
            margin: '0 0 16px 0'
          }}
        >
          衝撃検知
        </h2>

        {/* メッセージ */}
        <p
          style={{
            fontSize: '18px',
            color: '#333',
            margin: '0 0 30px 0',
            lineHeight: '1.5'
          }}
        >
          {message}
        </p>

        {/* ボタン */}
        <button
          onClick={onClose}
          style={{
            padding: '12px 40px',
            fontSize: '16px',
            fontWeight: 'bold',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: '0 2px 8px rgba(220, 53, 69, 0.3)'
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
          確認
        </button>
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
        `}
      </style>
    </>
  );
}

import { useNavigate } from 'react-router-dom';
import { AppMode } from '../types';

interface DashboardProps {
  currentMode: AppMode;
  setCurrentMode: (mode: AppMode) => void;
}

export default function Dashboard({ currentMode, setCurrentMode }: DashboardProps) {
  const navigate = useNavigate();

  const handleModeChange = (mode: AppMode) => {
    setCurrentMode(mode);
    
    // TODO: キャリブレーション状態をFirestoreから確認
    // キャリブレーション未完了の場合は、キャリブレーション画面に遷移
    const calibrated = false; // 仮の値
    
    if (!calibrated && mode !== 'mode3') {
      navigate(`/calibration/${mode}`);
    } else {
      navigate(`/${mode}`);
    }
  };

  return (
    <div className="container">
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
        見守りシステム ダッシュボード
      </h1>

      <div className="mode-selector">
        <div
          className={`mode-btn ${currentMode === 'mode1' ? 'active' : ''}`}
          onClick={() => handleModeChange('mode1')}
        >
          <h3>機能1</h3>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>室内位置追跡</p>
          <p style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
            BLE×3で部屋内の位置を把握
          </p>
        </div>

        <div
          className={`mode-btn ${currentMode === 'mode2' ? 'active' : ''}`}
          onClick={() => handleModeChange('mode2')}
        >
          <h3>機能2</h3>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>バス置き去り検知</p>
          <p style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
            BLE×1で置き去りを検知
          </p>
        </div>

        <div
          className={`mode-btn ${currentMode === 'mode3' ? 'active' : ''}`}
          onClick={() => handleModeChange('mode3')}
        >
          <h3>機能3</h3>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>屋外GPS追跡</p>
          <p style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
            GPSで親子の距離を監視
          </p>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: '32px' }}>
        <div className="card">
          <h2 style={{ marginBottom: '16px' }}>現在の状態</h2>
          <div style={{ fontSize: '18px' }}>
            <p><strong>選択中のモード:</strong> 機能{currentMode.replace('mode', '')}</p>
            <p style={{ marginTop: '8px' }}><strong>登録デバイス数:</strong> 3台</p>
            <p style={{ marginTop: '8px' }}><strong>登録ビーコン数:</strong> 3台</p>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: '16px' }}>クイックアクション</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button 
              className="btn btn-primary"
              onClick={() => navigate('/management')}
            >
              デバイス管理
            </button>
            <button 
              className="btn btn-outline"
              onClick={() => navigate(`/calibration/${currentMode}`)}
            >
              キャリブレーション
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '32px' }}>
        <h2 style={{ marginBottom: '16px' }}>使い方</h2>
        <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>上部のモード選択から使用したい機能を選択してください</li>
          <li>初回使用時は自動的にキャリブレーション画面に遷移します</li>
          <li>管理画面でデバイスとビーコンを登録できます</li>
          <li>各モードで警告が発生すると、画面に通知が表示されます</li>
        </ol>
      </div>
    </div>
  );
}

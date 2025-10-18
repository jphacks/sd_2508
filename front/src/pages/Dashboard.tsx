import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { AppMode } from '../types';

interface DashboardProps {
  currentMode: AppMode;
  setCurrentMode: (mode: AppMode) => void;
}

export default function Dashboard({ currentMode, setCurrentMode }: DashboardProps) {
  const navigate = useNavigate();
  const [calibrationStatus, setCalibrationStatus] = useState<{ [key in AppMode]?: boolean }>({});

  useEffect(() => {
    checkCalibrationStatus();
  }, []);

  const checkCalibrationStatus = async () => {
    try {
      // TODO: 実際のユーザーIDを使用
      const userId = 'demo-user';
      
      // 機能1: ルームが存在するかチェック
      const roomsSnapshot = await getDocs(collection(db, 'rooms'));
      const hasRooms = roomsSnapshot.docs.length > 0;
      
      // 機能2: TODO: ビーコン設定をチェック（現在は常にtrue）
      const mode2Calibrated = true;
      
      // 機能3: キャリブレーション不要
      const mode3Calibrated = true;
      
      setCalibrationStatus({
        mode1: hasRooms,
        mode2: mode2Calibrated,
        mode3: mode3Calibrated
      });
    } catch (error) {
      console.error('キャリブレーション状態確認エラー:', error);
    }
  };

  const handleModeChange = (mode: AppMode) => {
    setCurrentMode(mode);
    
    // キャリブレーション状態を確認
    const calibrated = calibrationStatus[mode];
    
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
          <h3 style={{ fontSize: '24px' }}>機能1</h3>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>室内位置追跡</p>
          <p style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
            BLE×3で部屋内の位置を把握
          </p>
        </div>

        <div
          className={`mode-btn ${currentMode === 'mode2' ? 'active' : ''}`}
          onClick={() => handleModeChange('mode2')}
        >
          <h3 style={{ fontSize: '24px' }}>機能2</h3>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>バス置き去り検知</p>
          <p style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
            BLE×1で置き去りを検知
          </p>
        </div>

        <div
          className={`mode-btn ${currentMode === 'mode3' ? 'active' : ''}`}
          onClick={() => handleModeChange('mode3')}
        >
          <h3 style={{ fontSize: '24px' }}>機能3</h3>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>屋外GPS追跡</p>
          <p style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
            GPSで保護者からの距離を確認
          </p>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: '32px' }}>
        <div className="card">
          <h2 style={{ marginBottom: '16px' }}>現在の状態</h2>
          <div style={{ fontSize: '18px' }}>
            <p><strong>選択中のモード:</strong> 機能{currentMode.replace('mode', '')}</p>
            <p style={{ marginTop: '8px' }}><strong>登録トラッカー数:</strong> 3台</p>
            <p style={{ marginTop: '8px' }}><strong>登録ビーコン数:</strong> 3台</p>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: '16px' }}>使い方</h2>
          <ol style={{ paddingLeft: '20px', lineHeight: '1.8', fontSize: '14px' }}>
            <li>上部のモード選択から使用したい機能を選択してください</li>
            <li>初回使用時は自動的にキャリブレーション画面に遷移します</li>
            <li>管理画面でデバイスとビーコンを登録できます</li>
            <li>各モードで警告が発生すると、画面に通知が表示されます</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

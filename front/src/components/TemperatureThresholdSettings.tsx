import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { TemperatureThresholdSettings } from '../types';

export default function TemperatureThresholdSettingsComponent() {
  const [settings, setSettings] = useState<TemperatureThresholdSettings>({
    highTempThreshold: 28,
    lowTempThreshold: undefined,
    rssiSumThreshold: -200  // 🔥 新しいフィールド: RSSI合計の退室判定閾値
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const docRef = doc(db, 'settings', 'temperature-thresholds');
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        setSettings(docSnap.data() as TemperatureThresholdSettings);
      } else {
      }
    } catch (error: any) {
      console.error('温度閾値設定の読み込みエラー:', error);
      console.error('エラー詳細:', error.code, error.message);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      // undefinedのフィールドを除外
      const dataToSave: any = {
        highTempThreshold: settings.highTempThreshold,
        rssiSumThreshold: settings.rssiSumThreshold ?? -200  // 🔥 RSSI閾値を追加
      };
      
      // lowTempThresholdが設定されている場合のみ追加
      if (settings.lowTempThreshold !== undefined) {
        dataToSave.lowTempThreshold = settings.lowTempThreshold;
      }
      
      const docRef = doc(db, 'settings', 'temperature-thresholds');
      await setDoc(docRef, dataToSave);
      alert('設定を保存しました');
    } catch (error: any) {
      console.error('温度閾値設定の保存エラー:', error);
      console.error('エラーコード:', error.code);
      console.error('エラーメッセージ:', error.message);
      console.error('エラー詳細:', JSON.stringify(error, null, 2));
      alert(`設定の保存に失敗しました\nエラー: ${error.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '14px', color: '#666' }}>読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: '24px' }}>
      <h2 style={{ 
        fontSize: '20px', 
        fontWeight: '600', 
        marginBottom: '20px'
      }}>
        閾値設定
      </h2>

      <div style={{ marginBottom: '24px' }}>
        <label style={{ 
          display: 'block', 
          marginBottom: '8px',
          fontWeight: '500',
          fontSize: '14px'
        }}>
          高温警告の閾値
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <input
            type="number"
            min="0"
            max="50"
            step="0.5"
            value={settings.highTempThreshold}
            onChange={(e) => setSettings({
              ...settings,
              highTempThreshold: parseFloat(e.target.value) || 28
            })}
            style={{
              padding: '8px 12px',
              fontSize: '16px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              width: '100px',
              textAlign: 'center'
            }}
          />
          <span style={{ fontSize: '16px', fontWeight: '500' }}>°C</span>
        </div>
      </div>

      {/* 🔥 RSSI合計の退室判定閾値設定を追加 */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ 
          display: 'block', 
          marginBottom: '8px',
          fontWeight: '500',
          fontSize: '14px'
        }}>
          RSSI合計の退室判定閾値
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <input
            type="number"
            min="-300"
            max="-50"
            step="10"
            value={settings.rssiSumThreshold ?? -200}
            onChange={(e) => setSettings({
              ...settings,
              rssiSumThreshold: parseInt(e.target.value) || -200
            })}
            style={{
              padding: '8px 12px',
              fontSize: '16px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              width: '120px',
              textAlign: 'center'
            }}
          />
          <span style={{ fontSize: '14px', color: '#666' }}></span>
        </div>
      </div>

      <div style={{ 
        display: 'flex', 
        gap: '8px'
      }}>
        <button
          onClick={saveSettings}
          disabled={saving}
          className="btn btn-primary"
          style={{
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          {saving ? '保存中...' : '設定を保存'}
        </button>
      </div>
    </div>
  );
}

// 統合設定パネルコンポーネント

import { Mode, ModeConfig } from '../../types';

interface Props {
  currentMode: Mode;
  modeConfig: ModeConfig;
  settings: Record<string, any>;
  onSettingChange: (key: string, value: any) => void;
  devices?: any[]; // デバイス一覧（選択肢として使用）
  beacons?: any[]; // ビーコン一覧（選択肢として使用）
  onApplySettings?: () => void;
  onResetSettings?: () => void;
  isLoading?: boolean;
}

export default function SettingsPanel({ 
  currentMode, 
  modeConfig, 
  settings, 
  onSettingChange,
  devices = [],
  beacons = [],
  onApplySettings,
  onResetSettings,
  isLoading = false
}: Props) {

  // フォーム要素の共通スタイル
  const formStyles = {
    group: {
      marginBottom: '16px'
    },
    label: {
      display: 'block',
      fontSize: '13px',
      fontWeight: '600',
      color: '#333',
      marginBottom: '6px'
    },
    input: {
      width: '100%',
      padding: '8px 12px',
      borderRadius: '6px',
      border: '2px solid #e1e8ed',
      fontSize: '14px',
      transition: 'border-color 0.2s ease',
      backgroundColor: 'white'
    },
    select: {
      width: '100%',
      padding: '8px 12px',
      borderRadius: '6px',
      border: '2px solid #e1e8ed',
      fontSize: '14px',
      backgroundColor: 'white',
      cursor: 'pointer'
    },
    toggle: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 16px',
      borderRadius: '20px',
      border: 'none',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.2s ease'
    },
    helper: {
      fontSize: '11px',
      color: '#666',
      marginTop: '4px',
      lineHeight: '1.4'
    }
  };

  // トグルボタンのスタイル
  const getToggleStyle = (isActive: boolean) => ({
    ...formStyles.toggle,
    backgroundColor: isActive ? modeConfig.color : '#f0f0f0',
    color: isActive ? 'white' : '#666'
  });

  // 入力フィールドのフォーカススタイル
  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.target.style.borderColor = modeConfig.color;
    e.target.style.boxShadow = `0 0 0 3px ${modeConfig.color}20`;
  };

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.target.style.borderColor = '#e1e8ed';
    e.target.style.boxShadow = 'none';
  };

  return (
    <div className="card" style={{ opacity: isLoading ? 0.6 : 1 }}>
      {/* ヘッダー */}
      <h3 style={{ 
        marginBottom: '20px',
        color: modeConfig.color,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: '18px',
        fontWeight: 'bold'
      }}>
        <span style={{ fontSize: '22px' }}>{modeConfig.icon}</span>
        {modeConfig.title} 設定
      </h3>

      {isLoading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: '14px',
          color: '#666'
        }}>
          設定を読み込み中...
        </div>
      )}

      <div style={{ pointerEvents: isLoading ? 'none' : 'auto' }}>
        {/* Mode1 (Indoor) 設定 */}
        {currentMode === 'indoor' && (
          <IndoorSettings 
            settings={settings}
            onChange={onSettingChange}
            modeColor={modeConfig.color}
            formStyles={formStyles}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            getToggleStyle={getToggleStyle}
            beacons={beacons}
          />
        )}

        {/* Mode2 (Bus) 設定 */}
        {currentMode === 'bus' && (
          <BusSettings 
            settings={settings}
            onChange={onSettingChange}
            modeColor={modeConfig.color}
            formStyles={formStyles}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            getToggleStyle={getToggleStyle}
            beacons={beacons}
          />
        )}

        {/* Mode3 (GPS) 設定 */}
        {currentMode === 'gps' && (
          <GPSSettings 
            settings={settings}
            onChange={onSettingChange}
            modeColor={modeConfig.color}
            formStyles={formStyles}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            getToggleStyle={getToggleStyle}
            devices={devices}
          />
        )}

        {/* 共通設定 */}
        <CommonSettings 
          settings={settings}
          onChange={onSettingChange}
          modeColor={modeConfig.color}
          formStyles={formStyles}
          getToggleStyle={getToggleStyle}
        />

        {/* 設定操作ボタン */}
        {(onApplySettings || onResetSettings) && (
          <div style={{
            borderTop: '2px solid #f0f0f0',
            paddingTop: '20px',
            marginTop: '24px',
            display: 'flex',
            gap: '12px',
            flexWrap: 'wrap'
          }}>
            {onApplySettings && (
              <button
                onClick={onApplySettings}
                disabled={isLoading}
                style={{
                  flex: 1,
                  minWidth: '120px',
                  padding: '12px 24px',
                  backgroundColor: modeConfig.color,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => {
                  if (!isLoading) {
                    e.currentTarget.style.backgroundColor = `${modeConfig.color}dd`;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isLoading) {
                    e.currentTarget.style.backgroundColor = modeConfig.color;
                  }
                }}
              >
                <span>💾</span>
                設定を適用
              </button>
            )}
            
            {onResetSettings && (
              <button
                onClick={onResetSettings}
                disabled={isLoading}
                style={{
                  flex: 1,
                  minWidth: '120px',
                  padding: '12px 24px',
                  backgroundColor: 'transparent',
                  color: '#666',
                  border: '2px solid #e1e8ed',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => {
                  if (!isLoading) {
                    e.currentTarget.style.backgroundColor = '#f8f9fa';
                    e.currentTarget.style.borderColor = '#666';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isLoading) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.borderColor = '#e1e8ed';
                  }
                }}
              >
                <span>🔄</span>
                リセット
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// === Mode1 (Indoor) 設定コンポーネント ===
interface ModeSettingsProps {
  settings: any;
  onChange: (key: string, value: any) => void;
  modeColor: string;
  formStyles: any;
  onFocus?: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => void;
  getToggleStyle: (isActive: boolean) => any;
  beacons?: any[];
  devices?: any[];
}

// 🔥 追加: 共通設定用のプロップス型
interface CommonSettingsProps {
  settings: any;
  onChange: (key: string, value: any) => void;
  modeColor: string; // 🔥 modeColorを追加
  formStyles: any;
  getToggleStyle: (isActive: boolean) => any;
}

function IndoorSettings({ 
  settings, 
  onChange, 
  formStyles, 
  onFocus, 
  onBlur, 
  getToggleStyle,
  beacons = []
}: ModeSettingsProps) {
  return (
    <div>
      <h4 style={{ 
        marginBottom: '16px', 
        fontSize: '15px', 
        color: '#333',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        🏠 室内追跡設定
      </h4>

      {/* 部屋選択 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>対象の部屋</label>
        <select 
          style={formStyles.select}
          value={settings.selectedRoom || ''}
          onChange={(e) => onChange('selectedRoom', e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          <option value="">部屋を選択してください</option>
          <option value="living">リビングルーム</option>
          <option value="bedroom">寝室</option>
          <option value="kitchen">キッチン</option>
          <option value="study">書斎</option>
          <option value="playroom">子供部屋</option>
        </select>
        <div style={formStyles.helper}>
          BLEビーコンが設置されている部屋を選択してください
        </div>
      </div>

      {/* ビーコン選択 */}
      {beacons.length > 0 && (
        <div style={formStyles.group}>
          <label style={formStyles.label}>使用するビーコン</label>
          <select 
            style={formStyles.select}
            value={settings.selectedBeacon || ''}
            onChange={(e) => onChange('selectedBeacon', e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
          >
            <option value="">ビーコンを選択してください</option>
            {beacons.map(beacon => (
              <option key={beacon.id} value={beacon.id}>
                {beacon.name || beacon.beaconId} ({beacon.mac})
              </option>
            ))}
          </select>
          <div style={formStyles.helper}>
            位置推定に使用するメインビーコンを選択してください
          </div>
        </div>
      )}

      {/* 位置更新間隔 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>位置更新間隔</label>
        <select 
          style={formStyles.select}
          value={settings.updateInterval || 5}
          onChange={(e) => onChange('updateInterval', parseInt(e.target.value))}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          <option value={1}>1秒 (高頻度)</option>
          <option value={3}>3秒 (標準)</option>
          <option value={5}>5秒 (推奨)</option>
          <option value={10}>10秒 (省電力)</option>
          <option value={30}>30秒 (低頻度)</option>
        </select>
        <div style={formStyles.helper}>
          短い間隔ほど精度が向上しますが、バッテリー消費が増加します
        </div>
      </div>

      {/* RSSI閾値 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>信号強度閾値 (dBm)</label>
        <input 
          type="number" 
          style={formStyles.input}
          min={-100}
          max={-30}
          step={5}
          value={settings.rssiThreshold || -75}
          onChange={(e) => onChange('rssiThreshold', parseInt(e.target.value))}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <div style={formStyles.helper}>
          この値以下の信号は「圏外」と判定されます（推奨: -75dBm）
        </div>
      </div>

      {/* 退室アラート */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>退室検知アラート</label>
        <button 
          style={getToggleStyle(settings.exitAlertEnabled !== false)}
          onClick={() => onChange('exitAlertEnabled', !settings.exitAlertEnabled)}
        >
          <span>{settings.exitAlertEnabled !== false ? '✓' : '✗'}</span>
          {settings.exitAlertEnabled !== false ? '有効' : '無効'}
        </button>
        <div style={formStyles.helper}>
          部屋から退室した際にアラートを表示します
        </div>
      </div>
    </div>
  );
}

// === Mode2 (Bus) 設定コンポーネント ===
function BusSettings({ 
  settings, 
  onChange, 
  formStyles, 
  onFocus, 
  onBlur, 
  getToggleStyle,
  beacons = []
}: ModeSettingsProps) {
  return (
    <div>
      <h4 style={{ 
        marginBottom: '16px', 
        fontSize: '15px', 
        color: '#333',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        🚌 バス検知設定
      </h4>

      {/* バスビーコン選択 */}
      {beacons.length > 0 ? (
        <div style={formStyles.group}>
          <label style={formStyles.label}>バス内ビーコン</label>
          <select 
            style={formStyles.select}
            value={settings.selectedBusBeacon || ''}
            onChange={(e) => onChange('selectedBusBeacon', e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
          >
            <option value="">ビーコンを選択してください</option>
            {beacons.map(beacon => (
              <option key={beacon.id} value={beacon.id}>
                {beacon.name || beacon.beaconId} ({beacon.mac})
              </option>
            ))}
          </select>
          <div style={formStyles.helper}>
            バス内に設置されているビーコンを選択してください
          </div>
        </div>
      ) : (
        <div style={{
          ...formStyles.group,
          padding: '12px',
          backgroundColor: '#fff3cd',
          borderRadius: '8px',
          border: '1px solid #ffeaa7'
        }}>
          <div style={{ fontSize: '13px', color: '#856404' }}>
            ⚠️ バス用ビーコンが登録されていません
          </div>
        </div>
      )}

      {/* RSSI閾値 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>バス内判定閾値 (dBm)</label>
        <input 
          type="number" 
          style={formStyles.input}
          min={-100}
          max={-30}
          step={5}
          value={settings.busRssiThreshold || -70}
          onChange={(e) => onChange('busRssiThreshold', parseInt(e.target.value))}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <div style={formStyles.helper}>
          この値以上でバス内にいると判定されます（推奨: -70dBm）
        </div>
      </div>

      {/* 警告時間 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>置き去り警告時間 (分)</label>
        <select 
          style={formStyles.select}
          value={settings.warningTime || 3}
          onChange={(e) => onChange('warningTime', parseInt(e.target.value))}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          <option value={1}>1分 (厳格)</option>
          <option value={2}>2分 (標準)</option>
          <option value={3}>3分 (推奨)</option>
          <option value={5}>5分 (緩和)</option>
          <option value={10}>10分 (最緩和)</option>
        </select>
        <div style={formStyles.helper}>
          この時間信号が途絶えると置き去りアラートが発生します
        </div>
      </div>

      {/* 自動再接続 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>自動再接続</label>
        <button 
          style={getToggleStyle(settings.autoReconnect !== false)}
          onClick={() => onChange('autoReconnect', !settings.autoReconnect)}
        >
          <span>{settings.autoReconnect !== false ? '✓' : '✗'}</span>
          {settings.autoReconnect !== false ? '有効' : '無効'}
        </button>
        <div style={formStyles.helper}>
          信号が回復した際に自動的に再接続を試行します
        </div>
      </div>
    </div>
  );
}

// === Mode3 (GPS) 設定コンポーネント ===
function GPSSettings({ 
  settings, 
  onChange, 
  formStyles, 
  onFocus, 
  onBlur, 
  getToggleStyle,
  devices = []
}: ModeSettingsProps) {
  return (
    <div>
      <h4 style={{ 
        marginBottom: '16px', 
        fontSize: '15px', 
        color: '#333',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        🌍 GPS追跡設定
      </h4>

      {/* 親トラッカー選択 */}
      {devices.length > 0 && (
        <div style={formStyles.group}>
          <label style={formStyles.label}>親トラッカー</label>
          <select 
            style={formStyles.select}
            value={settings.parentTracker || ''}
            onChange={(e) => onChange('parentTracker', e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
          >
            <option value="">親トラッカーを選択してください</option>
            {devices.map(device => (
              <option key={device.id} value={device.id}>
                {device.userName || device.name || device.deviceId} 
                {device.devEUI && ` (${device.devEUI.substring(0, 8)}...)`}
              </option>
            ))}
          </select>
          <div style={formStyles.helper}>
            距離測定の基準となる親のトラッカーを選択してください
          </div>
        </div>
      )}

      {/* 最大距離 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>最大許可距離 (メートル)</label>
        <input 
          type="number" 
          style={formStyles.input}
          min={5}
          max={1000}
          step={5}
          value={settings.maxDistance || 30}
          onChange={(e) => onChange('maxDistance', parseInt(e.target.value))}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <div style={formStyles.helper}>
          この距離を超えるとアラートが発生します（推奨: 30m）
        </div>
      </div>

      {/* GPS更新間隔 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>GPS更新間隔</label>
        <select 
          style={formStyles.select}
          value={settings.gpsUpdateInterval || 30}
          onChange={(e) => onChange('gpsUpdateInterval', parseInt(e.target.value))}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          <option value={10}>10秒 (高精度)</option>
          <option value={30}>30秒 (推奨)</option>
          <option value={60}>1分 (標準)</option>
          <option value={120}>2分 (省電力)</option>
          <option value={300}>5分 (最省電力)</option>
        </select>
        <div style={formStyles.helper}>
          短い間隔ほど精度が向上しますが、バッテリー消費が増加します
        </div>
      </div>

      {/* GPS精度要求 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>GPS精度要求</label>
        <select 
          style={formStyles.select}
          value={settings.gpsAccuracy || 'medium'}
          onChange={(e) => onChange('gpsAccuracy', e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          <option value="low">低精度 (±50m)</option>
          <option value="medium">中精度 (±10m, 推奨)</option>
          <option value="high">高精度 (±3m)</option>
        </select>
        <div style={formStyles.helper}>
          高精度ほど測位時間とバッテリー消費が増加します
        </div>
      </div>

      {/* 屋内GPS無視 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>屋内GPS無視</label>
        <button 
          style={getToggleStyle(settings.ignoreIndoorGPS !== false)}
          onClick={() => onChange('ignoreIndoorGPS', !settings.ignoreIndoorGPS)}
        >
          <span>{settings.ignoreIndoorGPS !== false ? '✓' : '✗'}</span>
          {settings.ignoreIndoorGPS !== false ? '有効' : '無効'}
        </button>
        <div style={formStyles.helper}>
          屋内での不正確なGPS信号を自動的に無視します
        </div>
      </div>
    </div>
  );
}

// === 共通設定コンポーネント ===
function CommonSettings({ 
  settings, 
  onChange, 
  modeColor, // 🔥 修正: 正しく受け取る
  formStyles, 
  getToggleStyle 
}: CommonSettingsProps) { // 🔥 修正: 型定義を使用
  return (
    <div style={{ 
      borderTop: '2px solid #f0f0f0', 
      paddingTop: '20px', 
      marginTop: '24px' 
    }}>
      {/* 🔥 オプション: modeColorを活用したヘッダー */}
      <h4 style={{ 
        marginBottom: '16px', 
        fontSize: '15px', 
        color: modeColor, // 🔥 modeColorを使用
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        ⚙️ 共通設定
      </h4>

      {/* ショック検知 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>ショック検知</label>
        <button 
          style={getToggleStyle(settings.shockDetection !== false)}
          onClick={() => onChange('shockDetection', !settings.shockDetection)}
        >
          <span>{settings.shockDetection !== false ? '✓' : '✗'}</span>
          {settings.shockDetection !== false ? '有効' : '無効'}
        </button>
        <div style={formStyles.helper}>
          デバイスに強い衝撃が加わった際にアラートを表示します
        </div>
      </div>

      {/* 通知音 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>アラート通知音</label>
        <button 
          style={getToggleStyle(settings.alertSound !== false)}
          onClick={() => onChange('alertSound', !settings.alertSound)}
        >
          <span>{settings.alertSound !== false ? '🔊' : '🔇'}</span>
          {settings.alertSound !== false ? '有効' : '無効'}
        </button>
        <div style={formStyles.helper}>
          アラート発生時に音声で通知します
        </div>
      </div>

      {/* バイブレーション */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>バイブレーション</label>
        <button 
          style={getToggleStyle(settings.vibration !== false)}
          onClick={() => onChange('vibration', !settings.vibration)}
        >
          <span>{settings.vibration !== false ? '📳' : '📴'}</span>
          {settings.vibration !== false ? '有効' : '無効'}
        </button>
        <div style={formStyles.helper}>
          アラート発生時にデバイスを振動させます（対応デバイスのみ）
        </div>
      </div>

      {/* 自動保存 */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>設定の自動保存</label>
        <button 
          style={getToggleStyle(settings.autoSave !== false)}
          onClick={() => onChange('autoSave', !settings.autoSave)}
        >
          <span>{settings.autoSave !== false ? '💾' : '📝'}</span>
          {settings.autoSave !== false ? '有効' : '無効'}
        </button>
        <div style={formStyles.helper}>
          設定変更時に自動的に保存します
        </div>
      </div>

      {/* ダークモード */}
      <div style={formStyles.group}>
        <label style={formStyles.label}>ダークモード</label>
        <button 
          style={getToggleStyle(settings.darkMode === true)}
          onClick={() => onChange('darkMode', !settings.darkMode)}
        >
          <span>{settings.darkMode ? '🌙' : '☀️'}</span>
          {settings.darkMode ? '有効' : '無効'}
        </button>
        <div style={formStyles.helper}>
          画面表示をダークテーマに切り替えます
        </div>
      </div>
    </div>
  );
}
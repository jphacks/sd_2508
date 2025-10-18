import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, onValue, off } from 'firebase/database';
import { db, rtdb } from '../firebase';
import { Device, Beacon, CalibrationPoint, RoomProfile, FurnitureItem } from '../types';

const CALIBRATION_STEPS = [
  { id: 'corner1', label: '左上隅', position: { x: 0, y: 0 } },
  { id: 'corner2', label: '右上隅', position: { x: 10, y: 0 } },
  { id: 'corner3', label: '右下隅', position: { x: 10, y: 8 } },
  { id: 'corner4', label: '左下隅', position: { x: 0, y: 8 } },
  { id: 'center', label: '部屋の中央', position: { x: 5, y: 4 } },
  { id: 'door_inside', label: 'ドア内側', position: { x: 5, y: 0 } },
  { id: 'door_outside', label: 'ドア外側', position: { x: 5, y: -1 } }
];

export default function Calibration() {
  const { mode } = useParams<{ mode: string }>();
  const navigate = useNavigate();
  
  const [step, setStep] = useState(0);
  const [roomName, setRoomName] = useState('');
  const [selectedBeacons, setSelectedBeacons] = useState<string[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [devices, setDevices] = useState<Device[]>([]);
  const [beacons, setBeacons] = useState<(Beacon & { firestoreId: string })[]>([]);
  const [calibrationPoints, setCalibrationPoints] = useState<CalibrationPoint[]>([]);
  const [currentMeasurement, setCurrentMeasurement] = useState<any>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [showFurniture, setShowFurniture] = useState(false);
  const [furniture, setFurniture] = useState<FurnitureItem[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    loadDevices();
    loadBeacons();
  }, []);

  const loadDevices = async () => {
    const snapshot = await getDocs(collection(db, 'devices'));
    const data = snapshot.docs.map(doc => ({ 
      id: doc.id,
      ...doc.data()
    } as Device & { id: string }));
    setDevices(data);
  };

  const loadBeacons = async () => {
    const snapshot = await getDocs(collection(db, 'beacons'));
    const data = snapshot.docs.map(doc => {
      const raw = doc.data() as Beacon;
      return {
        ...raw,
        rssiAt1m: raw.rssiAt1m ?? -59,
        firestoreId: doc.id // Firestoreの自動生成IDを別プロパティとして保持
      } as Beacon & { firestoreId: string };
    });
    setBeacons(data);
  };

  const startMeasurement = () => {
    if (!selectedDevice) {
      alert('測定に使用するデバイスを選択してください');
      return;
    }

    setIsScanning(true);
    
    // RTDBから最新のBLEスキャンデータを取得
    const scansRef = ref(rtdb, `devices/${selectedDevice}/ble_scans`);
    
    const listener = onValue(scansRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const scans = Object.values(data) as any[];
        const latestScan = scans[scans.length - 1];
        
        if (latestScan && latestScan.beacons) {
          // RSSI値をマップに変換
          const rssiMap: { [mac: string]: number } = {};
          latestScan.beacons.forEach((beacon: any) => {
            rssiMap[beacon.mac] = beacon.rssi;
          });
          
          setCurrentMeasurement({
            deviceId: selectedDevice,
            timestamp: latestScan.ts,
            rssiValues: rssiMap
          });
          
          setIsScanning(false);
          off(scansRef);
        }
      }
    });

    // 10秒後にタイムアウト
    setTimeout(() => {
      if (isScanning) {
        setIsScanning(false);
        off(scansRef);
        alert('測定がタイムアウトしました。もう一度試してください。');
      }
    }, 10000);
  };

  const saveMeasurement = () => {
    if (!currentMeasurement) {
      alert('まず測定を行ってください');
      return;
    }

    const currentStep = CALIBRATION_STEPS[step];
    const point: CalibrationPoint = {
      id: currentStep.id,
      position: currentStep.position,
      label: currentStep.label,
      measurements: [currentMeasurement]
    };

    setCalibrationPoints([...calibrationPoints, point]);
    setCurrentMeasurement(null);
    
    if (step < CALIBRATION_STEPS.length - 1) {
      setStep(step + 1);
    } else {
      // キャリブレーション完了
      setShowFurniture(true);
    }
  };

  const saveCalibration = async () => {
    if (!roomName || selectedBeacons.length === 0) {
      alert('部屋名とビーコンを設定してください');
      return;
    }

    const roomProfile: Partial<RoomProfile> = {
      name: roomName,
      beacons: selectedBeacons,
      calibrationPoints: calibrationPoints,
      outline: { width: 10, height: 8 }, // TODO: 実際のサイズを入力できるようにする
      furniture: furniture,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await addDoc(collection(db, 'rooms'), roomProfile);
      alert('キャリブレーションが完了しました！');
      navigate('/mode1');
    } catch (error) {
      console.error('保存エラー:', error);
      alert('保存に失敗しました');
    }
  };

  const addFurniture = (type: FurnitureItem['type']) => {
    const newItem: FurnitureItem = {
      id: `furniture-${Date.now()}`,
      type,
      position: { x: 5, y: 4 },
      width: 1,
      height: 1
    };
    setFurniture([...furniture, newItem]);
  };

  const removeFurniture = (id: string) => {
    setFurniture(furniture.filter(f => f.id !== id));
  };

  if (mode === 'mode2') {
    return (
      <div className="container">
        <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
          機能2: キャリブレーション
        </h1>
        <div className="card">
          <h2 style={{ marginBottom: '16px' }}>ビーコン選択</h2>
          <p style={{ marginBottom: '16px' }}>
            バスに設置するビーコンを1台選択してください。
          </p>
          <div className="form-group">
            <label className="form-label">使用するビーコン</label>
            <select className="form-select">
              <option value="">選択してください</option>
              {beacons.map(beacon => (
                <option key={beacon.firestoreId} value={beacon.firestoreId}>
                  {beacon.beaconId || beacon.name || beacon.firestoreId}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/mode2')}>
            完了
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'mode3') {
    return (
      <div className="container">
        <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
          機能3: キャリブレーション
        </h1>
        <div className="card">
          <h2 style={{ marginBottom: '16px' }}>親トラッカー選択</h2>
          <p style={{ marginBottom: '16px' }}>
            機能3ではGPS機能を使用するため、ビーコンのキャリブレーションは不要です。<br />
            親トラッカーの選択は機能3の画面で行えます。
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/mode3')}>
            機能3へ移動
          </button>
        </div>
      </div>
    );
  }

  // 機能1のキャリブレーション
  if (!showFurniture) {
    return (
      <div className="container">
        <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
          機能1: 部屋のキャリブレーション
        </h1>

        {step === 0 && (
          <div className="card">
            <h2 style={{ marginBottom: '16px' }}>ステップ1: 部屋の設定</h2>
            <div className="form-group">
              <label className="form-label">部屋の名前 *</label>
              <input
                type="text"
                className="form-input"
                placeholder="例: 会議室A"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">使用するビーコン（3台選択） *</label>
              {beacons.map(beacon => (
                <label key={beacon.firestoreId} style={{ display: 'block', marginBottom: '8px' }}>
                  <input
                    type="checkbox"
                    checked={selectedBeacons.includes(beacon.firestoreId)}
                    onChange={(e) => {
                      if (e.target.checked && selectedBeacons.length < 3) {
                        setSelectedBeacons([...selectedBeacons, beacon.firestoreId]);
                      } else if (!e.target.checked) {
                        setSelectedBeacons(selectedBeacons.filter(id => id !== beacon.firestoreId));
                      }
                    }}
                    disabled={!selectedBeacons.includes(beacon.firestoreId) && selectedBeacons.length >= 3}
                  />
                  {' '}{beacon.beaconId || beacon.name || beacon.firestoreId}
                </label>
              ))}
            </div>
            <button
              className="btn btn-primary"
              onClick={() => setStep(1)}
              disabled={!roomName || selectedBeacons.length !== 3}
            >
              次へ
            </button>
          </div>
        )}

        {step > 0 && step <= CALIBRATION_STEPS.length && (
          <div className="card">
            <h2 style={{ marginBottom: '16px' }}>
              ステップ {step + 1}: {CALIBRATION_STEPS[step - 1].label}で測定
            </h2>
            <p style={{ marginBottom: '16px', fontSize: '18px' }}>
              <strong>{CALIBRATION_STEPS[step - 1].label}</strong>に移動して測定を行ってください。
            </p>

            <div className="form-group">
              <label className="form-label">測定に使用するトラッカー</label>
              <select
                className="form-select"
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
              >
                <option value="">選択してください</option>
                {devices.map(device => (
                  <option key={device.devEUI} value={device.devEUI}>
                    {device.userName || device.deviceId}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <button
                className="btn btn-primary"
                onClick={startMeasurement}
                disabled={isScanning || !selectedDevice}
              >
                {isScanning ? '測定中...' : 'ここで測定'}
              </button>
            </div>

            {currentMeasurement && (
              <div style={{ marginBottom: '16px', padding: '16px', backgroundColor: '#D4EDDA', borderRadius: '8px' }}>
                <p style={{ margin: 0, color: '#155724' }}>
                  ✓ 測定完了<br />
                  検出されたビーコン: {Object.keys(currentMeasurement.rssiValues).length}台
                </p>
                <div style={{ marginTop: '12px' }}>
                  <button className="btn btn-primary" onClick={saveMeasurement}>
                    この測定を保存して次へ
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: '24px' }}>
              <p style={{ fontSize: '14px', color: '#7f8c8d' }}>
                進捗: {step} / {CALIBRATION_STEPS.length}
              </p>
              <div style={{
                width: '100%',
                height: '8px',
                backgroundColor: '#e1e8ed',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${(step / CALIBRATION_STEPS.length) * 100}%`,
                  height: '100%',
                  backgroundColor: '#4A90E2',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 家具配置画面
  return (
    <div className="container">
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
        家具とビーコンの配置
      </h1>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>家具を配置</h2>
        <p style={{ marginBottom: '16px' }}>
          部屋のマップに家具やビーコンを配置してください（オプション）
        </p>
        
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <button className="btn btn-outline" onClick={() => addFurniture('desk')}>机を追加</button>
          <button className="btn btn-outline" onClick={() => addFurniture('tv')}>テレビを追加</button>
          <button className="btn btn-outline" onClick={() => addFurniture('piano')}>ピアノを追加</button>
          <button className="btn btn-outline" onClick={() => addFurniture('door')}>ドアを追加</button>
          <button className="btn btn-outline" onClick={() => addFurniture('chair')}>椅子を追加</button>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ marginBottom: '8px' }}>配置した家具</h3>
          {furniture.length === 0 ? (
            <p style={{ color: '#7f8c8d' }}>まだ家具が配置されていません</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {furniture.map(item => (
                <li key={item.id} style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{item.type}</span>
                  <button
                    className="btn btn-danger"
                    style={{ padding: '4px 12px', fontSize: '14px' }}
                    onClick={() => removeFurniture(item.id)}
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-primary" onClick={saveCalibration}>
            完了
          </button>
          <button className="btn btn-outline" onClick={() => navigate('/mode1')}>
            スキップ
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '16px' }}>使い方のヒント</h3>
        <ul style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>各測定ポイントで実際にトラッカーを持って移動してください</li>
          <li>測定は静止した状態で行うと精度が上がります</li>
          <li>追加のキャリブレーションポイントは後から追加できます</li>
          <li>家具の配置は見やすさのためで、位置推定には影響しません</li>
        </ul>
      </div>
    </div>
  );
}

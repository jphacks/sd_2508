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

// テスト用ダミーマップデータ
const TEST_ROOM = {
  width: 10,
  height: 8,
  name: 'テスト会議室',
  beacons: [
    { id: 'beacon1', position: { x: 1, y: 1 }, name: 'ビーコン1' },
    { id: 'beacon2', position: { x: 9, y: 1 }, name: 'ビーコン2' },
    { id: 'beacon3', position: { x: 5, y: 7 }, name: 'ビーコン3' }
  ]
};

// テスト用家具タイプ定義
const FURNITURE_TYPES = {
  desk: { label: '机', width: 2, height: 1, color: '#8B4513' },
  tv: { label: 'テレビ', width: 3, height: 0.5, color: '#2C3E50' },
  piano: { label: 'ピアノ', width: 2, height: 1.5, color: '#1A1A1A' },
  chair: { label: '椅子', width: 0.8, height: 0.8, color: '#CD853F' },
  door: { label: 'ドア', width: 1, height: 0.2, color: '#D2691E' }
} as const;

type FurnitureType = keyof typeof FURNITURE_TYPES;


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

  const [selectedFurniture, setSelectedFurniture] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<'se' | 'sw' | 'ne' | 'nw' | null>(null);
  const [originalSize, setOriginalSize] = useState<{width: number, height: number} | null>(null);
  
  // 部屋サイズの入力（オプショナル）
  const [roomWidth, setRoomWidth] = useState<string>('');
  const [roomHeight, setRoomHeight] = useState<string>('');


  useEffect(() => {
    loadDevices();
    loadBeacons();
    drawMap();//(追加)マップ描写関数
  }, [furniture, selectedFurniture]); // furnitureやselectedFurnitureが変わるたびに再描画

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

  //(追加)マップ描写関数
  const drawMap = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = 40; // 1メートル = 40ピクセル
    canvas.width = TEST_ROOM.width * scale;
    canvas.height = TEST_ROOM.height * scale;

    // 背景をクリア
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 部屋の輪郭を描画
    ctx.strokeStyle = '#2C3E50';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    // グリッドを描画
    ctx.strokeStyle = '#E1E8ED';
    ctx.lineWidth = 1;
    for (let x = 0; x <= TEST_ROOM.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * scale, 0);
      ctx.lineTo(x * scale, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= TEST_ROOM.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * scale);
      ctx.lineTo(canvas.width, y * scale);
      ctx.stroke();
    }

    // ビーコンを描画
    TEST_ROOM.beacons.forEach(beacon => {
      ctx.fillStyle = '#4A90E2';
      ctx.beginPath();
      ctx.arc(beacon.position.x * scale, beacon.position.y * scale, 8, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.fillStyle = '#2C3E50';
      ctx.font = '12px Arial';
      ctx.fillText(beacon.name, beacon.position.x * scale + 12, beacon.position.y * scale + 4);
    });
    // 家具を描画
    furniture.forEach(item => {
    const furnitureType = FURNITURE_TYPES[item.type as FurnitureType];
    if (!furnitureType) return;

    const x = item.position.x * scale;
    const y = item.position.y * scale;
    const width = item.width * scale;
    const height = item.height * scale;

    // 選択状態の表示
    if (selectedFurniture === item.id) {
      ctx.strokeStyle = '#E74C3C';
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 2, y - 2, width + 4, height + 4);

      // リサイズハンドルを描画
      const handleSize = 8;
      const handles = [
        { x: x + width - handleSize/2, y: y + height - handleSize/2, type: 'se' }, // 右下
        { x: x - handleSize/2, y: y + height - handleSize/2, type: 'sw' },         // 左下
        { x: x + width - handleSize/2, y: y - handleSize/2, type: 'ne' },         // 右上
        { x: x - handleSize/2, y: y - handleSize/2, type: 'nw' }                  // 左上
      ];

      ctx.fillStyle = '#E74C3C';
      handles.forEach(handle => {
        ctx.fillRect(handle.x, handle.y, handleSize, handleSize);
      });
    }

    // 家具本体
    ctx.fillStyle = furnitureType.color;
    ctx.fillRect(x, y, width, height);

    // ラベル
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(furnitureType.label, x + width / 2, y + height / 2 + 3);
  });

  ctx.textAlign = 'left';
};

  const addFurniture = (type: FurnitureType) => { // FurnitureItem['type'] から FurnitureType に変更
    const furnitureType = FURNITURE_TYPES[type];
    const newItem: FurnitureItem = {
      id: `furniture-${Date.now()}`,
      type,
      position: { x: 2, y: 2 }, // デフォルト位置
      width: furnitureType.width,
      height: furnitureType.height
    };
    setFurniture([...furniture, newItem]);
    setSelectedFurniture(newItem.id);
  };


  const removeFurniture = (id: string) => {
    setFurniture(furniture.filter(f => f.id !== id));
    if (selectedFurniture === id) {
      setSelectedFurniture(null);
    }
  };

  const saveCalibration = async () => {
    // データの検証
    if (!roomName) {
      alert('部屋名が設定されていません');
      return;
    }
    
    if (selectedBeacons.length === 0) {
      alert('ビーコンが選択されていません');
      return;
    }

    // 部屋サイズの処理：入力されていればメートル単位、なければundefined
    const parsedWidth = roomWidth ? parseFloat(roomWidth) : null;
    const parsedHeight = roomHeight ? parseFloat(roomHeight) : null;
    
    // 正規化された座標を計算（0~1の範囲）
    // 実際の部屋サイズが入力されていない場合でも、正規化座標で保存
    const normalizedFurniture = furniture.map(item => ({
      ...item,
      position: {
        x: item.position.x / TEST_ROOM.width,
        y: item.position.y / TEST_ROOM.height
      },
      width: item.width / TEST_ROOM.width,
      height: item.height / TEST_ROOM.height
    }));

    // ビーコン位置も正規化して保存（将来的にドラッグ配置可能にする）
    const normalizedBeacons = TEST_ROOM.beacons.map(beacon => ({
      id: beacon.id,
      name: beacon.name,
      position: {
        x: beacon.position.x / TEST_ROOM.width,
        y: beacon.position.y / TEST_ROOM.height
      }
    }));

    const roomProfile: Partial<RoomProfile> = {
      name: roomName,
      beacons: selectedBeacons,
      calibrationPoints: calibrationPoints,
      outline: parsedWidth && parsedHeight 
        ? { width: parsedWidth, height: parsedHeight }
        : undefined, // サイズ未入力の場合はundefined
      furniture: normalizedFurniture,
      beaconPositions: normalizedBeacons, // ビーコン位置を正規化して保存
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await addDoc(collection(db, 'rooms'), roomProfile);
      const sizeInfo = parsedWidth && parsedHeight 
        ? `（${parsedWidth}m × ${parsedHeight}m）` 
        : '（正規化座標で保存）';
      alert(`「${roomName}」の家具配置が保存されました！${sizeInfo}`);
      navigate('/mode1');
    } catch (error) {
      console.error('保存エラー:', error);
      alert('保存に失敗しました');
    }
  };


  const getResizeHandle = (e: React.MouseEvent<HTMLCanvasElement>, item: FurnitureItem) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scale = 40;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const x = item.position.x * scale;
    const y = item.position.y * scale;
    const width = item.width * scale;
    const height = item.height * scale;
    const handleSize = 8;

    const handles = [
      { x: x + width - handleSize/2, y: y + height - handleSize/2, type: 'se' as const },
      { x: x - handleSize/2, y: y + height - handleSize/2, type: 'sw' as const },
      { x: x + width - handleSize/2, y: y - handleSize/2, type: 'ne' as const },
      { x: x - handleSize/2, y: y - handleSize/2, type: 'nw' as const }
    ];

    for (const handle of handles) {
      if (mouseX >= handle.x && mouseX <= handle.x + handleSize &&
          mouseY >= handle.y && mouseY <= handle.y + handleSize) {
        return handle.type;
      }
    }
    return null;
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scale = 40;
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    // クリックされた家具を検索
    const clickedFurniture = furniture.find(item => {
      return x >= item.position.x && x <= item.position.x + item.width &&
            y >= item.position.y && y <= item.position.y + item.height;
    });

    if (clickedFurniture) {
      setSelectedFurniture(selectedFurniture === clickedFurniture.id ? null : clickedFurniture.id);
    } else {
      setSelectedFurniture(null);
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedFurniture) return;

    const selectedItem = furniture.find(f => f.id === selectedFurniture);
    if (!selectedItem) return;

    // リサイズハンドルをチェック
    const handle = getResizeHandle(e, selectedItem);
    if (handle) {
      setIsResizing(true);
      setResizeHandle(handle);
      setOriginalSize({ width: selectedItem.width, height: selectedItem.height });
    } else {
      setIsDragging(true);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedFurniture) return;

    const rect = canvas.getBoundingClientRect();
    const scale = 40;
    const mouseX = (e.clientX - rect.left) / scale;
    const mouseY = (e.clientY - rect.top) / scale;

    if (isResizing && resizeHandle && originalSize) {
      const selectedItem = furniture.find(f => f.id === selectedFurniture);
      if (!selectedItem) return;

      let newWidth = selectedItem.width;
      let newHeight = selectedItem.height;
      let newX = selectedItem.position.x;
      let newY = selectedItem.position.y;

      const minSize = 0.5; // 最小サイズ
      const maxSize = 5;   // 最大サイズ

      switch (resizeHandle) {
        case 'se': // 右下
          newWidth = Math.max(minSize, Math.min(maxSize, mouseX - selectedItem.position.x));
          newHeight = Math.max(minSize, Math.min(maxSize, mouseY - selectedItem.position.y));
          break;
        case 'sw': // 左下
          newWidth = Math.max(minSize, Math.min(maxSize, selectedItem.position.x + selectedItem.width - mouseX));
          newHeight = Math.max(minSize, Math.min(maxSize, mouseY - selectedItem.position.y));
          newX = selectedItem.position.x + selectedItem.width - newWidth;
          break;
        case 'ne': // 右上
          newWidth = Math.max(minSize, Math.min(maxSize, mouseX - selectedItem.position.x));
          newHeight = Math.max(minSize, Math.min(maxSize, selectedItem.position.y + selectedItem.height - mouseY));
          newY = selectedItem.position.y + selectedItem.height - newHeight;
          break;
        case 'nw': // 左上
          newWidth = Math.max(minSize, Math.min(maxSize, selectedItem.position.x + selectedItem.width - mouseX));
          newHeight = Math.max(minSize, Math.min(maxSize, selectedItem.position.y + selectedItem.height - mouseY));
          newX = selectedItem.position.x + selectedItem.width - newWidth;
          newY = selectedItem.position.y + selectedItem.height - newHeight;
          break;
      }

      setFurniture(furniture.map(item =>
        item.id === selectedFurniture
          ? { ...item, width: newWidth, height: newHeight, position: { x: newX, y: newY } }
          : item
      ));
    } else if (isDragging) {
      // 既存のドラッグ処理
      const x = Math.max(0, Math.min(TEST_ROOM.width - 1, mouseX));
      const y = Math.max(0, Math.min(TEST_ROOM.height - 1, mouseY));

      setFurniture(furniture.map(item =>
      item.id === selectedFurniture
        ? { ...item, position: { x, y } }
        : item
      ));
    }

    // カーソルの変更
    const selectedItem = furniture.find(f => f.id === selectedFurniture);
    if (selectedItem && !isDragging && !isResizing) {
      const handle = getResizeHandle(e, selectedItem);
      if (handle) {
        const cursors = { se: 'se-resize', sw: 'sw-resize', ne: 'ne-resize', nw: 'nw-resize' };
        canvas.style.cursor = cursors[handle];
      } else {
        canvas.style.cursor = 'move';
      }
    } else if (!selectedFurniture) {
      canvas.style.cursor = 'default';
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeHandle(null);
    setOriginalSize(null);
  };




  const startMeasurement = () => {
    if (!selectedDevice) {
      alert('測定に使用するデバイスを選択してください');
      return;
    }

    setIsScanning(true);
    
    // RTDBから該当トラッカーのデータを監視
    const trackerRef = ref(rtdb, `devices/${selectedDevice}`);
    
    // 測定開始時のタイムスタンプを記録
    let initialTimestamp: string | null = null;
    
    const listener = onValue(trackerRef, (snapshot) => {
      const data = snapshot.val();
      
      if (data && data.beacons) {
        const currentTimestamp = data.beaconsUpdatedAt;
        
        // 初回の呼び出しでタイムスタンプを記録
        if (initialTimestamp === null) {
          initialTimestamp = currentTimestamp;
          return;
        }
        
        // タイムスタンプが更新されたら新しいデータと判定
        if (currentTimestamp !== initialTimestamp) {
          // 各ビーコンからRSSI値を取得
          const rssiMap: { [beaconId: string]: number } = {};
          
          data.beacons.forEach((beacon: any) => {
            if (beacon.mac && beacon.rssi) {
              // MACアドレスを正規化（コロン区切りを大文字に統一）
              const normalizedMac = beacon.mac.toUpperCase().replace(/:/g, '');
              rssiMap[normalizedMac] = beacon.rssi;
            }
          });
          
          setCurrentMeasurement({
            deviceId: selectedDevice,
            timestamp: currentTimestamp,
            rssiValues: rssiMap
          });
          
          setIsScanning(false);
          off(trackerRef);
        }
      }
    });

    // 60秒後にタイムアウト（トラッカーは1分間隔で送信するため）
    setTimeout(() => {
      if (isScanning) {
        setIsScanning(false);
        off(trackerRef);
        alert('測定がタイムアウトしました。トラッカーがデータを送信するまで最大1分かかります。もう一度試してください。');
      }
    }, 65000);
  };

  const saveMeasurement = () => {
    if (!currentMeasurement) {
      alert('まず測定を行ってください');
      return;
    }

    const currentStep = CALIBRATION_STEPS[step - 1];
    const point: CalibrationPoint = {
      id: currentStep.id,
      position: currentStep.position,
      label: currentStep.label,
      measurements: [currentMeasurement]
    };

    setCalibrationPoints([...calibrationPoints, point]);
    setCurrentMeasurement(null);
    
    if (step < CALIBRATION_STEPS.length) {
      setStep(step + 1);
    } else {
      // キャリブレーション完了
      setShowFurniture(true);
    }
  };

  // const saveCalibration = async () => {
  //   if (!roomName || selectedBeacons.length === 0) {
  //     alert('部屋名とビーコンを設定してください');
  //     return;
  //   }

  //   const roomProfile: Partial<RoomProfile> = {
  //     name: roomName,
  //     beacons: selectedBeacons,
  //     calibrationPoints: calibrationPoints,
  //     outline: { width: 10, height: 8 }, // TODO: 実際のサイズを入力できるようにする
  //     furniture: furniture,
  //     createdAt: new Date().toISOString(),
  //     updatedAt: new Date().toISOString()
  //   };

  //   try {
  //     await addDoc(collection(db, 'rooms'), roomProfile);
  //     alert('キャリブレーションが完了しました！');
  //     navigate('/mode1');
  //   } catch (error) {
  //     console.error('保存エラー:', error);
  //     alert('保存に失敗しました');
  //   }
  // };

  // const addFurniture = (type: FurnitureItem['type']) => {
  //   const newItem: FurnitureItem = {
  //     id: `furniture-${Date.now()}`,
  //     type,
  //     position: { x: 5, y: 4 },
  //     width: 1,
  //     height: 1
  //   };
  //   setFurniture([...furniture, newItem]);
  // };

  // const removeFurniture = (id: string) => {
  //   setFurniture(furniture.filter(f => f.id !== id));
  // };

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
                    {device.deviceId || device.userName}
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
  // return (
  //   <div className="container">
  //     <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
  //       家具とビーコンの配置
  //     </h1>

  //     <div className="card" style={{ marginBottom: '24px' }}>
  //       <h2 style={{ marginBottom: '16px' }}>家具を配置</h2>
  //       <p style={{ marginBottom: '16px' }}>
  //         部屋のマップに家具やビーコンを配置してください（オプション）
  //       </p>
        
  //       <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
  //         <button className="btn btn-outline" onClick={() => addFurniture('desk')}>机を追加</button>
  //         <button className="btn btn-outline" onClick={() => addFurniture('tv')}>テレビを追加</button>
  //         <button className="btn btn-outline" onClick={() => addFurniture('piano')}>ピアノを追加</button>
  //         <button className="btn btn-outline" onClick={() => addFurniture('door')}>ドアを追加</button>
  //         <button className="btn btn-outline" onClick={() => addFurniture('chair')}>椅子を追加</button>
  //       </div>

  //       <div style={{ marginBottom: '16px' }}>
  //         <h3 style={{ marginBottom: '8px' }}>配置した家具</h3>
  //         {furniture.length === 0 ? (
  //           <p style={{ color: '#7f8c8d' }}>まだ家具が配置されていません</p>
  //         ) : (
  //           <ul style={{ listStyle: 'none', padding: 0 }}>
  //             {furniture.map(item => (
  //               <li key={item.id} style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
  //                 <span>{item.type}</span>
  //                 <button
  //                   className="btn btn-danger"
  //                   style={{ padding: '4px 12px', fontSize: '14px' }}
  //                   onClick={() => removeFurniture(item.id)}
  //                 >
  //                   削除
  //                 </button>
  //               </li>
  //             ))}
  //           </ul>
  //         )}
  //       </div>

  //       <div style={{ display: 'flex', gap: '12px' }}>
  //         <button className="btn btn-primary" onClick={saveCalibration}>
  //           完了
  //         </button>
  //         <button className="btn btn-outline" onClick={() => navigate('/mode1')}>
  //           スキップ
  //         </button>
  //       </div>
  //     </div>

  //     <div className="card">
  //       <h3 style={{ marginBottom: '16px' }}>使い方のヒント</h3>
  //       <ul style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
  //         <li>各測定ポイントで実際にトラッカーを持って移動してください</li>
  //         <li>測定は静止した状態で行うと精度が上がります</li>
  //         <li>追加のキャリブレーションポイントは後から追加できます</li>
  //         <li>家具の配置は見やすさのためで、位置推定には影響しません</li>
  //       </ul>
  //     </div>
  //   </div>
  // );

  if (showFurniture) {
    return (
      <div className="container">
        <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
          家具とオブジェクトの配置
        </h1>

        <div style={{ display: 'flex', gap: '24px' }}>
          {/* 左側: コントロールパネル */}
          <div style={{ width: '300px' }}>
            <div className="card" style={{ marginBottom: '16px' }}>
              <h3 style={{ marginBottom: '16px' }}>部屋サイズ（オプション）</h3>
              <p style={{ fontSize: '14px', color: '#7f8c8d', marginBottom: '12px' }}>
                実際の部屋サイズを入力すると、メートル単位で保存されます。<br />
                未入力の場合は、0~1の正規化座標で保存されます。
              </p>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px' }}>
                    幅（メートル）
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="例: 10"
                    value={roomWidth}
                    onChange={(e) => setRoomWidth(e.target.value)}
                    step="0.1"
                    min="0"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px' }}>
                    高さ（メートル）
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="例: 8"
                    value={roomHeight}
                    onChange={(e) => setRoomHeight(e.target.value)}
                    step="0.1"
                    min="0"
                  />
                </div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: '16px' }}>
              <h3 style={{ marginBottom: '16px' }}>家具を追加</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {Object.entries(FURNITURE_TYPES).map(([type, info]) => (
                  <button
                    key={type}
                    className="btn btn-outline"
                    onClick={() => addFurniture(type as FurnitureType)} // 型アサーションを修正
                  >
                      {info.label}を追加
                    </button>
                ))}
              </div>
            </div>

            <div className="card" style={{ marginBottom: '16px' }}>
              <h3 style={{ marginBottom: '16px' }}>配置済みオブジェクト</h3>
              {furniture.length === 0 ? (
                <p style={{ color: '#7f8c8d', fontSize: '14px' }}>まだ家具が配置されていません</p>
              ) : (
                <div>
                  {furniture.map(item => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px',
                        marginBottom: '4px',
                        backgroundColor: selectedFurniture === item.id ? '#E3F2FD' : '#F8F9FA',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                      onClick={() => setSelectedFurniture(selectedFurniture === item.id ? null : item.id)}
                    >
                      <span style={{ fontSize: '14px' }}>
                        {FURNITURE_TYPES[item.type].label}
                      </span>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '2px 8px', fontSize: '12px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFurniture(item.id);
                        }}
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginBottom: '12px' }}>操作方法</h3>
              <ul style={{ fontSize: '14px', lineHeight: '1.6', paddingLeft: '16px' }}>
                <li>家具をクリックして選択</li>
                <li>選択した家具をドラッグで移動</li>
                <li>選択した家具の角（赤い四角）をドラッグでサイズ変更</li>
                <li>青い点はビーコンの位置</li>
                <li>グリッド1マス = 1メートル</li>
              </ul>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button className="btn btn-primary" onClick={saveCalibration}>
                保存
              </button>
              <button className="btn btn-outline" onClick={() => navigate('/mode1')}>
                キャンセル
              </button>
            </div>
          </div>

          {/* 右側: マップ */}
          <div className="card" style={{ flex: 1 }}>
            <h3 style={{ marginBottom: '16px' }}>{TEST_ROOM.name} (10m × 8m)</h3>
            <canvas
              ref={canvasRef}
              style={{
                border: '2px solid #E1E8ED',
                borderRadius: '8px',
                cursor: isDragging ? 'grabbing' : 'pointer'
              }}
              onClick={handleCanvasClick}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            />
            {selectedFurniture && (
              <p style={{ marginTop: '12px', fontSize: '14px', color: '#4A90E2' }}>
                選択中: {FURNITURE_TYPES[furniture.find(f => f.id === selectedFurniture)?.type as FurnitureType || 'desk'].label}
                （ドラッグして移動できます）
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ...existing code for other steps...
  return <div>その他のステップ</div>;
}
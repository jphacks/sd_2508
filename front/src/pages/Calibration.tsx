import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs, addDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, onValue, off } from 'firebase/database';
import { db, rtdb } from '../firebase';
import { Device, Beacon, CalibrationPoint, RoomProfile, FurnitureItem } from '../types';


const CALIBRATION_STEPS = [
  { id: 'corner1', label: '左上隅', position: { x: 0, y: 0 } },
  { id: 'corner2', label: '右上隅', position: { x: 1.0, y: 0 } },
  { id: 'corner3', label: '右下隅', position: { x: 1.0, y: 1.0 } },
  { id: 'corner4', label: '左下隅', position: { x: 0, y: 1.0 } },
  { id: 'center', label: '部屋の中央', position: { x: 0.5, y: 0.5 } },
  { id: 'door_inside', label: 'ドア内側', position: { x: 0.5, y: 0 } },
  { id: 'door_outside', label: 'ドア外側', position: { x: 0.5, y: -0.125 } }
];

// テスト用ダミーマップデータ
// const TEST_ROOM = {
//   width: 10,
//   height: 8,
//   name: 'テスト会議室',
//   beacons: [
//     { id: 'beacon1', position: { x: 1, y: 1 }, name: 'ビーコン1' },
//     { id: 'beacon2', position: { x: 9, y: 1 }, name: 'ビーコン2' },
//     { id: 'beacon3', position: { x: 5, y: 7 }, name: 'ビーコン3' }
//   ]
// };
const TEST_ROOM = {
  width: 1,    // 10 から 1 に変更
  height: 1,   // 8 から 1 に変更
  name: 'テスト会議室',
  beacons: [
    { id: 'beacon1', position: { x: 0.1, y: 0.1 }, name: 'ビーコン1' },      // 正規化座標
    { id: 'beacon2', position: { x: 0.9, y: 0.1 }, name: 'ビーコン2' },      // 正規化座標
    { id: 'beacon3', position: { x: 0.5, y: 0.9 }, name: 'ビーコン3' }       // 正規化座標
  ]
};

// export const FURNITURE_TYPES = {
//   desk: { label: '机', width: 2, height: 1, color: '#8B4513' },
//   tv: { label: 'テレビ', width: 3, height: 0.5, color: '#2C3E50' },
//   piano: { label: 'ピアノ', width: 2, height: 1.5, color: '#1A1A1A' },
//   chair: { label: '椅子', width: 0.8, height: 0.8, color: '#CD853F' },
//   door: { label: 'ドア', width: 1, height: 0.2, color: '#D2691E' }
// } as const;

// export const FURNITURE_TYPES = {
//   desk: { label: '机', width: 0.2, height: 0.1, color: '#8B4513' },     // 2→0.2, 1→0.1
//   tv: { label: 'テレビ', width: 0.3, height: 0.05, color: '#2C3E50' },    // 3→0.3, 0.5→0.05
//   piano: { label: 'ピアノ', width: 0.2, height: 0.15, color: '#1A1A1A' }, // 2→0.2, 1.5→0.15
//   chair: { label: '椅子', width: 0.08, height: 0.08, color: '#CD853F' },  // 0.8→0.08
//   door: { label: 'ドア', width: 0.1, height: 0.02, color: '#D2691E' }     // 1→0.1, 0.2→0.02
// } as const;

// export type FurnitureType = keyof typeof FURNITURE_TYPES;

const getFurnitureTypes = (roomWidth: number, roomHeight: number) => {
  // 基準サイズ（メートル）
  const baseSizes = {
    desk: { width: 1, height: 0.5 },
    tv: { width: 1, height: 0.1 },
    piano: { width: 1, height: 0.5 },
    chair: { width: 0.3, height: 0.3 },
    door: { width: 0.5, height: 0.2 }
  };

  // 正規化座標に変換
  return {
    desk: { 
      label: '机', 
      width: baseSizes.desk.width / roomWidth, 
      height: baseSizes.desk.height / roomHeight, 
      color: '#8B4513' 
    },
    tv: { 
      label: 'テレビ', 
      width: baseSizes.tv.width / roomWidth, 
      height: baseSizes.tv.height / roomHeight, 
      color: '#2C3E50' 
    },
    piano: { 
      label: 'ピアノ', 
      width: baseSizes.piano.width / roomWidth, 
      height: baseSizes.piano.height / roomHeight, 
      color: '#1A1A1A' 
    },
    chair: { 
      label: '椅子', 
      width: baseSizes.chair.width / roomWidth, 
      height: baseSizes.chair.height / roomHeight, 
      color: '#CD853F' 
    },
    door: { 
      label: 'ドア', 
      width: baseSizes.door.width / roomWidth, 
      height: baseSizes.door.height / roomHeight, 
      color: '#D2691E' 
    }
  } as const;
};

export type FurnitureType = 'desk' | 'tv' | 'piano' | 'chair' | 'door';


export default function Calibration() {
  const { mode, roomId } = useParams<{ mode: string; roomId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
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

  const [selectedBeacon, setSelectedBeacon] = useState<string | null>(null);
  const [beaconPositions, setBeaconPositions] = useState<{ [id: string]: { x: number; y: number } }>({});
  
  
  // 部屋サイズの入力（オプショナル）
  const [roomWidth, setRoomWidth] = useState<string>('');
  const [roomHeight, setRoomHeight] = useState<string>('');

  // 家具編集モードかどうかを判定
  const isFurnitureEditMode = location.pathname.includes('/edit-furniture/');
  const [isEditMode, setIsEditMode] = useState(false); // 編集モードかどうか
  const [originalRoomData, setOriginalRoomData] = useState<RoomProfile | null>(null);

  
  // 測定キャンセル用
  const trackerRefRef = useRef<any>(null);
  const listenerRef = useRef<any>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);


  const [currentRoomSize, setCurrentRoomSize] = useState({ width: 1, height: 1 });


  // useEffectを修正

  useEffect(() => {
    console.log('useEffect triggered', {
      showFurniture,
      step,
      devicesLoaded: devices.length > 0,
      beaconsLoaded: beacons.length > 0,
      beaconPositionsInitialized: Object.keys(beaconPositions).length > 0,
      hasOriginalRoomData: !!originalRoomData
    });
    
    // データ読み込み処理（非同期）
    if (devices.length === 0) {
      console.log('Loading devices...');
      loadDevices();
    }
    if (beacons.length === 0) {
      console.log('Loading beacons...');
      loadBeacons();
    }

    // ビーコン位置初期化（非同期）
    if (Object.keys(beaconPositions).length === 0) {
      console.log('Initializing beacon positions...');
      const initialPositions: { [id: string]: { x: number; y: number } } = {};
      TEST_ROOM.beacons.forEach(beacon => {
        initialPositions[beacon.id] = { ...beacon.position };
      });
      setBeaconPositions(initialPositions);
    }

    // 編集モードのデータ読み込み（非同期）
    if ((mode === 'furniture' && roomId) || isFurnitureEditMode) {
      if (!originalRoomData) {
        console.log('Loading room data...');
        loadRoomData(roomId!);
      }
    }

    // 常にdrawMapを呼び出し（データが揃っていなくても基本的な描画は行う）
    console.log('Calling drawMap...');
    drawMap();
  }, [
    furniture.length,
    selectedFurniture, 
    selectedBeacon,
    Object.keys(beaconPositions).length,
    originalRoomData,
    currentRoomSize.width,
    currentRoomSize.height,
    showFurniture, // ←追加
    step, // ←追加
    calibrationPoints.length // ←追加
  ]);

  useEffect(() => {
    const width = roomWidth ? parseFloat(roomWidth) : 1;
    const height = roomHeight ? parseFloat(roomHeight) : 1;
    
    // 有効な数値の場合のみ更新
    if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
      setCurrentRoomSize({ width, height });
    }
  }, [roomWidth, roomHeight]);

  const loadDevices = async () => {
    const snapshot = await getDocs(collection(db, 'devices'));
    const data = snapshot.docs.map(doc => ({ 
      id: doc.id,
      ...doc.data()
    } as Device & { id: string }));
    setDevices(data);
  };

  // const [currentRoomSize, setCurrentRoomSize] = useState({ width: 1, height: 1 });

  const loadRoomData = async (roomId: string) => {
    try {
      const roomDoc = await getDoc(doc(db, 'rooms', roomId));
      if (roomDoc.exists()) {
        const roomData = roomDoc.data() as RoomProfile;
        setOriginalRoomData(roomData);
        setRoomName(roomData.name);
        setSelectedBeacons(roomData.beacons || []);
        setFurniture(roomData.furniture || []);
        setCalibrationPoints(roomData.calibrationPoints || []);
        setIsEditMode(true);
        setShowFurniture(true);
        
        // TEST_ROOMを変更する代わりに、状態として管理
        if (roomData.outline) {
          setCurrentRoomSize({
            width: roomData.outline.width,
            height: roomData.outline.height
          });
        }

        // beaconPositionsが配列形式で保存されている場合はオブジェクト形式に変換
        if (roomData.beaconPositions) {
          if (Array.isArray(roomData.beaconPositions)) {
            // 配列形式の場合
            const positionsObject: { [id: string]: { x: number; y: number } } = {};
            roomData.beaconPositions.forEach((beacon: any) => {
              positionsObject[beacon.id] = beacon.position;
            });
            setBeaconPositions(positionsObject);
          } else {
            // オブジェクト形式の場合（後方互換性）
            setBeaconPositions(roomData.beaconPositions as any);
          }
        }
      } else {
        alert('ルームが見つかりません');
        navigate('/management');
      }
    } catch (error) {
      console.error('ルーム読み込みエラー:', error);
      alert('ルームの読み込みに失敗しました');
      navigate('/management');
    }
  };

  const loadBeacons = async () => {
    const snapshot = await getDocs(collection(db, 'beacons'));
    const data = snapshot.docs.map(doc => {
      const raw = doc.data() as Beacon;
      return {
        ...raw,
        rssiAt1m: raw.rssiAt1m ?? -59, // 👈 ここで既にデフォルト値が設定されている
        firestoreId: doc.id
      } as Beacon & { firestoreId: string };
    });
    setBeacons(data);
    console.log('ロードされたビーコン:', data.map(b => ({ 
      id: b.beaconId, 
      rssiAt1m: b.rssiAt1m,
      hasRssiAt1m: b.rssiAt1m !== undefined 
    })));
  };

  // ドア位置推定関数を追加
  // estimateDoorPosition関数を修正
  const estimateDoorPosition = (calibrationPoints: CalibrationPoint[]) => {
    console.log('=== ドア位置推定開始 ===');
    console.log('キャリブレーションポイント:', calibrationPoints.map(p => ({ id: p.id, label: p.label, position: p.position })));
    
    const doorInsidePoint = calibrationPoints.find(p => p.id === 'door_inside');
    const doorOutsidePoint = calibrationPoints.find(p => p.id === 'door_outside');
    
    console.log('ドア内側ポイント:', doorInsidePoint);
    console.log('ドア外側ポイント:', doorOutsidePoint);
    
    if (!doorInsidePoint || !doorOutsidePoint) {
      console.log('❌ ドア測定ポイントが見つかりません');
      return null;
    }

    if (!doorInsidePoint.measurements.length || !doorOutsidePoint.measurements.length) {
      console.log('❌ ドア測定データが不足しています');
      return null;
    }

    const insideMeasurement = doorInsidePoint.measurements[0];
    const outsideMeasurement = doorOutsidePoint.measurements[0];
    
    console.log('内側測定データ:', insideMeasurement);
    console.log('外側測定データ:', outsideMeasurement);

    // 既に正規化座標なので、直接使用
    const insidePos = doorInsidePoint.position;  // { x: 0.5, y: 0.0 }
    const outsidePos = doorOutsidePoint.position; // { x: 0.5, y: -0.125 }
    
    console.log('正規化座標:', { inside: insidePos, outside: outsidePos });

    // 1. 内側と外側の中点を計算
    const midpointX = (insidePos.x + outsidePos.x) / 2;
    const midpointY = (insidePos.y + outsidePos.y) / 2;
    
    console.log('中点座標:', { x: midpointX, y: midpointY });

    // 2. 内側から外側への方向ベクトルを計算
    const directionVector = {
      x: outsidePos.x - insidePos.x,
      y: outsidePos.y - insidePos.y
    };
    
    console.log('方向ベクトル (内側→外側):', directionVector);

    // 3. ベクトルの長さを計算
    const vectorLength = Math.sqrt(directionVector.x ** 2 + directionVector.y ** 2);
    
    // 4. 単位ベクトルに正規化
    const unitVector = {
      x: vectorLength > 0 ? directionVector.x / vectorLength : 0,
      y: vectorLength > 0 ? directionVector.y / vectorLength : 1 // デフォルトは下向き
    };
    
    console.log('単位ベクトル:', unitVector);

    // 5. 垂直ベクトルを計算（時計回りに90度回転）
    const perpendicularVector = {
      x: unitVector.y,  // 90度回転: (x, y) → (y, -x)
      y: -unitVector.x
    };
    
    console.log('垂直ベクトル:', perpendicularVector);

    // 6. ドアの配置位置を決定
    // 中点から部屋の境界方向に少し移動してドアを配置
    const doorOffsetDistance = 0.05; // ドアを境界に近づける距離
    
    let doorPosition = {
      x: midpointX,
      y: midpointY
    };

    // 7. どの壁に近いかを判定して、適切な位置に調整
    const wallDistances = {
      top: Math.abs(midpointY - 0),      // 上の壁との距離
      bottom: Math.abs(midpointY - 1),   // 下の壁との距離
      left: Math.abs(midpointX - 0),     // 左の壁との距離
      right: Math.abs(midpointX - 1)     // 右の壁との距離
    };

    // 最も近い壁を特定
    const nearestWall = Object.entries(wallDistances).reduce((closest, [wall, distance]) => {
      return distance < closest.distance ? { wall, distance } : closest;
    }, { wall: 'top', distance: Infinity });

    console.log('最も近い壁:', nearestWall);

    // 8. 最も近い壁に向かってドアを移動
    switch (nearestWall.wall) {
      case 'top':
        doorPosition.y = 0.02; // 上の壁に配置
        break;
      case 'bottom':
        doorPosition.y = 0.98; // 下の壁に配置
        break;
      case 'left':
        doorPosition.x = 0.02; // 左の壁に配置
        break;
      case 'right':
        doorPosition.x = 0.98; // 右の壁に配置
        break;
    }

    console.log('壁調整後の位置:', doorPosition);

    // 9. 最終的な位置の検証と調整
    const finalPosition = {
      x: Math.max(0.01, Math.min(0.99, doorPosition.x)),
      y: Math.max(0.01, Math.min(0.99, doorPosition.y))
    };

    console.log('✅ 最終的なドア位置:', finalPosition);

    return {
      position: finalPosition,
      orientation: {
        direction: unitVector,          // 内側→外側の方向
        perpendicular: perpendicularVector, // ドアの向き（垂直方向）
        angle: Math.atan2(unitVector.y, unitVector.x) * 180 / Math.PI // 角度（度）
      }
    };
  };

  // drawMap関数を修正
  const drawMap = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // キャリブレーション時は部屋外も含めてマージンを追加
    const margin = showFurniture ? 0 : 0.15; // キャリブレーション時は15%のマージン（ドア外側対応）
    const maxSize = showFurniture ? 700 : 500; // キャリブレーション時は500px
    
    // マージンを考慮したアスペクト比計算
    const effectiveWidth = currentRoomSize.width + (margin * 2);
    const effectiveHeight = currentRoomSize.height + (margin * 2);
    const aspectRatio = effectiveWidth / effectiveHeight;
    
    let canvasWidth, canvasHeight;

    if (aspectRatio >= 1) {
      canvasWidth = maxSize;
      canvasHeight = maxSize / aspectRatio;
    } else {
      canvasWidth = maxSize * aspectRatio;
      canvasHeight = maxSize;
    }

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // 座標変換関数（正規化座標 → キャンバス座標）
    const normalizedToCanvas = (normalizedX: number, normalizedY: number) => {
      // マージンを考慮した座標変換
      const adjustedX = (normalizedX + margin / currentRoomSize.width) / (1 + 2 * margin / currentRoomSize.width);
      const adjustedY = (normalizedY + margin / currentRoomSize.height) / (1 + 2 * margin / currentRoomSize.height);
      
      return {
        x: adjustedX * canvas.width,
        y: adjustedY * canvas.height
      };
    };

    // 背景をクリア
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // キャリブレーション時は拡張エリアを表示
    if (!showFurniture) {
      // 拡張エリア（薄いグレー）
      ctx.fillStyle = '#FAFAFA';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // 実際の部屋エリア（白）
      const roomStart = normalizedToCanvas(0, 0);
      const roomEnd = normalizedToCanvas(1, 1);
      const roomWidth = roomEnd.x - roomStart.x;
      const roomHeight = roomEnd.y - roomStart.y;
      
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(roomStart.x, roomStart.y, roomWidth, roomHeight);
      
      // 部屋の境界を強調
      ctx.strokeStyle = '#2C3E50';
      ctx.lineWidth = 3;
      ctx.strokeRect(roomStart.x, roomStart.y, roomWidth, roomHeight);
      
      // 部屋外エリアのラベル
      ctx.fillStyle = '#7f8c8d';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('部屋外エリア', canvas.width / 2, 20);
    } else {
      // 家具配置時は通常の描画
      ctx.strokeStyle = '#2C3E50';
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, canvas.width, canvas.height);
    }

    // グリッドを描画（拡張範囲に対応）
    ctx.strokeStyle = '#E1E8ED';
    ctx.lineWidth = 1;
    
    // グリッド分割数を計算
    const gridStepsX = Math.max(10, Math.ceil(effectiveWidth * 10));
    const gridStepsY = Math.max(10, Math.ceil(effectiveHeight * 10));

    // 縦線
    for (let x = 0; x <= gridStepsX; x++) {
      const xPos = (x / gridStepsX) * canvas.width;
      ctx.beginPath();
      ctx.moveTo(xPos, 0);
      ctx.lineTo(xPos, canvas.height);
      ctx.stroke();
    }

    // 横線
    for (let y = 0; y <= gridStepsY; y++) {
      const yPos = (y / gridStepsY) * canvas.height;
      ctx.beginPath();
      ctx.moveTo(0, yPos);
      ctx.lineTo(canvas.width, yPos);
      ctx.stroke();
    }

    // 家具を描画（座標変換適用）
    const furnitureTypes = getFurnitureTypes(currentRoomSize.width, currentRoomSize.height);
    
    furniture.forEach(item => {
      const furnitureType = furnitureTypes[item.type as FurnitureType];
      if (!furnitureType) return;

      const startPos = showFurniture 
        ? { x: item.position.x * canvas.width, y: item.position.y * canvas.height }
        : normalizedToCanvas(item.position.x, item.position.y);
      
      const width = showFurniture 
        ? item.width * canvas.width 
        : (item.width / (1 + 2 * margin / currentRoomSize.width)) * canvas.width;
      
      const height = showFurniture 
        ? item.height * canvas.height 
        : (item.height / (1 + 2 * margin / currentRoomSize.height)) * canvas.height;

      // 選択状態の表示
      if (selectedFurniture === item.id) {
        ctx.strokeStyle = '#E74C3C';
        ctx.lineWidth = 3;
        ctx.strokeRect(startPos.x - 2, startPos.y - 2, width + 4, height + 4);

        // リサイズハンドルを描画
        const handleSize = 8;
        const handles = [
          { x: startPos.x + width - handleSize/2, y: startPos.y + height - handleSize/2, type: 'se' },
          { x: startPos.x - handleSize/2, y: startPos.y + height - handleSize/2, type: 'sw' },
          { x: startPos.x + width - handleSize/2, y: startPos.y - handleSize/2, type: 'ne' },
          { x: startPos.x - handleSize/2, y: startPos.y - handleSize/2, type: 'nw' }
        ];

        ctx.fillStyle = '#E74C3C';
        handles.forEach(handle => {
          ctx.fillRect(handle.x, handle.y, handleSize, handleSize);
        });
      }

      // 家具本体
      ctx.fillStyle = furnitureType.color;
      ctx.fillRect(startPos.x, startPos.y, width, height);

      // ラベル
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(furnitureType.label, startPos.x + width / 2, startPos.y + height / 2 + 3);
    });

    // ビーコンを描画（座標変換適用）
    TEST_ROOM.beacons.forEach(beacon => {
      const position = beaconPositions[beacon.id] || beacon.position;
      
      const beaconPos = showFurniture 
        ? { x: position.x * canvas.width, y: position.y * canvas.height }
        : normalizedToCanvas(position.x, position.y);

      // 選択状態の表示（ビーコン）
      if (selectedBeacon === beacon.id) {
        ctx.strokeStyle = '#E74C3C';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(beaconPos.x, beaconPos.y, 12, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // ビーコン本体（影付き）
      ctx.beginPath();
      ctx.arc(beaconPos.x + 2, beaconPos.y + 2, 8, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fill();

      ctx.fillStyle = '#4A90E2';
      ctx.beginPath();
      ctx.arc(beaconPos.x, beaconPos.y, 8, 0, 2 * Math.PI);
      ctx.fill();
      
      // ビーコン境界線
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(beaconPos.x, beaconPos.y, 8, 0, 2 * Math.PI);
      ctx.stroke();

      // ビーコン内部
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(beaconPos.x, beaconPos.y, 4, 0, 2 * Math.PI);
      ctx.fill();
      
      // ビーコン名（背景付き）
      ctx.font = '12px Arial';
      ctx.textAlign = 'left';
      
      const textMetrics = ctx.measureText(beacon.name);
      const textWidth = textMetrics.width + 8;
      const textHeight = 16;
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(beaconPos.x + 12, beaconPos.y - 8, textWidth, textHeight);

      ctx.strokeStyle = '#2C3E50';
      ctx.lineWidth = 1;
      ctx.strokeRect(beaconPos.x + 12, beaconPos.y - 8, textWidth, textHeight);

      ctx.fillStyle = '#2C3E50';
      ctx.fillText(beacon.name, beaconPos.x + 16, beaconPos.y + 4);
    });

    // キャリブレーションポイントを描画（座標変換適用）
    if (!showFurniture) {
      CALIBRATION_STEPS.forEach((calibrationStep, index) => {
        // 座標変換を使用
        const pointPos = normalizedToCanvas(calibrationStep.position.x, calibrationStep.position.y);
        
        // キャンバス範囲チェック
        const isOutside = calibrationStep.position.x < 0 || calibrationStep.position.x > 1 || 
                        calibrationStep.position.y < 0 || calibrationStep.position.y > 1;

        console.log(`キャリブレーションポイント ${index + 1} (${calibrationStep.label}):`, {
          original: calibrationStep.position,
          canvas: pointPos,
          isOutside
        });

        // 測定済みかどうかを判定
        const isCompleted = calibrationPoints.some(point => point.id === calibrationStep.id);
        const isCurrent = step === index + 1;
        
        // 部屋外のポイントは異なる表示スタイル
        const pointStyle = isOutside ? {
          backgroundColor: 'rgba(255, 152, 0, 0.3)',
          borderColor: '#FF9800',
          labelBg: 'rgba(255, 193, 7, 0.9)'
        } : {
          backgroundColor: isCompleted ? 'rgba(76, 175, 80, 0.2)' : isCurrent ? 'rgba(255, 193, 7, 0.3)' : 'rgba(158, 158, 158, 0.2)',
          borderColor: isCompleted ? '#4CAF50' : isCurrent ? '#FFC107' : '#9E9E9E',
          labelBg: 'rgba(255, 255, 255, 0.9)'
        };

        // ポイントの背景円（大きめ）
        ctx.beginPath();
        ctx.arc(pointPos.x, pointPos.y, 20, 0, 2 * Math.PI);
        ctx.fillStyle = pointStyle.backgroundColor;
        ctx.fill();

        // ポイントの境界線
        ctx.beginPath();
        ctx.arc(pointPos.x, pointPos.y, 20, 0, 2 * Math.PI);
        ctx.strokeStyle = pointStyle.borderColor;
        ctx.lineWidth = isCurrent ? 3 : 2;
        ctx.stroke();

        // 部屋外ポイントの特別な表示
        if (isOutside) {
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(pointPos.x, pointPos.y, 25, 0, 2 * Math.PI);
          ctx.strokeStyle = '#FF9800';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // ポイントの中心
        ctx.beginPath();
        ctx.arc(pointPos.x, pointPos.y, 8, 0, 2 * Math.PI);
        ctx.fillStyle = pointStyle.borderColor;
        ctx.fill();

        // 完了チェックマーク
        if (isCompleted) {
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(pointPos.x - 4, pointPos.y);
          ctx.lineTo(pointPos.x - 1, pointPos.y + 3);
          ctx.lineTo(pointPos.x + 4, pointPos.y - 2);
          ctx.stroke();
        }

        // 現在ステップの矢印
        if (isCurrent) {
          ctx.fillStyle = pointStyle.borderColor;
          ctx.beginPath();
          ctx.moveTo(pointPos.x, pointPos.y - 4);
          ctx.lineTo(pointPos.x - 3, pointPos.y + 2);
          ctx.lineTo(pointPos.x + 3, pointPos.y + 2);
          ctx.closePath();
          ctx.fill();
        }

        // ポイント番号
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText((index + 1).toString(), pointPos.x, pointPos.y + 4);

        // ラベル表示の位置調整
        const label = calibrationStep.label;
        const labelMetrics = ctx.measureText(label);
        const labelWidth = labelMetrics.width + 12;
        const labelHeight = 20;
        
        let labelX = pointPos.x - labelWidth / 2;
        let labelY = pointPos.y + 35;
        
        // 画面端でのラベル位置調整
        if (labelX < 0) labelX = 5;
        if (labelX + labelWidth > canvas.width) labelX = canvas.width - labelWidth - 5;
        if (labelY + labelHeight > canvas.height) labelY = pointPos.y - 25;
        if (labelY < 0) labelY = pointPos.y + 35;

        // ラベル背景
        ctx.fillStyle = pointStyle.labelBg;
        ctx.fillRect(labelX, labelY, labelWidth, labelHeight);

        // ラベル境界線
        ctx.strokeStyle = pointStyle.borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);

        // ラベルテキスト
        ctx.fillStyle = isOutside ? '#E65100' : '#2C3E50';
        ctx.font = isOutside ? 'bold 12px Arial' : '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(label, labelX + labelWidth / 2, labelY + 14);

        // 座標表示（デバッグ用）
        const coordText = `(${calibrationStep.position.x.toFixed(2)}, ${calibrationStep.position.y.toFixed(2)})`;
        ctx.fillStyle = '#7f8c8d';
        ctx.font = '10px Arial';
        ctx.fillText(coordText, labelX + labelWidth / 2, labelY + 30);

        // 部屋外ポイントの説明
        if (isOutside) {
          ctx.fillStyle = '#FF6F00';
          ctx.font = '9px Arial';
          ctx.fillText('(部屋外)', labelX + labelWidth / 2, labelY + 42);
        }
      });
    }

    ctx.textAlign = 'left';
  };

  const addFurniture = (type: FurnitureType) => {
    const furnitureTypes = getFurnitureTypes(currentRoomSize.width, currentRoomSize.height);
    const furnitureType = furnitureTypes[type];
    
    const newItem: FurnitureItem = {
      id: `furniture-${Date.now()}`,
      type,
      position: { x: 0.4, y: 0.4 }, // 中央付近に配置
      width: furnitureType.width,
      height: furnitureType.height
    };
    
    console.log('Adding furniture:', newItem, 'Room size:', currentRoomSize);
    setFurniture(prev => {
      const updated = [...prev, newItem];
      console.log('Updated furniture list:', updated);
      return updated;
    });
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

    // ビーコン位置を更新されたものに変更
    const updatedBeacons = TEST_ROOM.beacons.map(beacon => ({
      id: beacon.id,
      name: beacon.name,
      position: beaconPositions[beacon.id] || beacon.position
    }));

    const beaconPositionsArray = Object.entries(beaconPositions).map(([id, position]) => ({
      id,
      name: TEST_ROOM.beacons.find(b => b.id === id)?.name || `ビーコン${id}`,
      position
    }));

    const roomProfile: Partial<RoomProfile> = {
      name: roomName,
      beacons: selectedBeacons,
      calibrationPoints: calibrationPoints,
      outline: originalRoomData?.outline || { width: TEST_ROOM.width, height: TEST_ROOM.height },
      furniture: furniture,
      beaconPositions: beaconPositionsArray, // ビーコン位置を保存
      createdAt: originalRoomData?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      if (isEditMode && roomId) {
        // 編集モード：既存のドキュメントを更新
        await updateDoc(doc(db, 'rooms', roomId), roomProfile);
        alert(`「${roomName}」の家具配置が更新されました！`);
        
        // 家具編集モードの場合は EditRoom に戻る
        if (isFurnitureEditMode) {
          navigate(`/edit-room/${roomId}`);
        } else {
          navigate('/mode1');
        }
      } else {
        // 新規作成モード
        await addDoc(collection(db, 'rooms'), roomProfile);
        alert(`「${roomName}」の家具配置が保存されました！`);
        navigate('/mode1');
      }
    } catch (error) {
      console.error('保存エラー:', error);
      alert('保存に失敗しました');
    }
  };


  const getResizeHandle = (e: React.MouseEvent<HTMLCanvasElement>, item: FurnitureItem) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scale = 700;
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

  // handleCanvasClick関数を修正
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    let x = (e.clientX - rect.left) / canvas.width;
    let y = (e.clientY - rect.top) / canvas.height;

    // キャリブレーション時は座標変換を適用
    if (!showFurniture) {
      const margin = 0.15;
      const effectiveWidth = currentRoomSize.width + (margin * 2);
      const effectiveHeight = currentRoomSize.height + (margin * 2);
      
      // キャンバス座標から正規化座標に逆変換
      x = (x * (1 + 2 * margin / currentRoomSize.width)) - (margin / currentRoomSize.width);
      y = (y * (1 + 2 * margin / currentRoomSize.height)) - (margin / currentRoomSize.height);
    }

    // ビーコンのクリック判定（円形）
    const clickedBeacon = TEST_ROOM.beacons.find(beacon => {
      const position = beaconPositions[beacon.id] || beacon.position;
      const distance = Math.sqrt(
        Math.pow(x - position.x, 2) + Math.pow(y - position.y, 2)
      );
      const beaconRadius = 12 / Math.min(canvas.width, canvas.height);
      return distance <= beaconRadius;
    });

    // 家具のクリック判定（矩形）
    const clickedFurniture = furniture.find(item => {
      return x >= item.position.x && 
            x <= item.position.x + item.width &&
            y >= item.position.y && 
            y <= item.position.y + item.height;
    });

    if (clickedBeacon) {
      setSelectedBeacon(selectedBeacon === clickedBeacon.id ? null : clickedBeacon.id);
      setSelectedFurniture(null);
    } else if (clickedFurniture) {
      setSelectedFurniture(selectedFurniture === clickedFurniture.id ? null : clickedFurniture.id);
      setSelectedBeacon(null);
    } else {
      setSelectedFurniture(null);
      setSelectedBeacon(null);
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (selectedBeacon) {
      // ビーコンが選択されている場合はドラッグ開始
      console.log('Starting beacon drag mode');
      setIsDragging(true);
      e.preventDefault();
      return;
    }

    if (!selectedFurniture) return;

    const selectedItem = furniture.find(f => f.id === selectedFurniture);
    if (!selectedItem) return;

    // リサイズハンドルをチェック
    const handle = getResizeHandle(e, selectedItem);
    console.log('Resize handle:', handle);
    
    if (handle) {
      console.log('Starting resize mode');
      setIsResizing(true);
      setResizeHandle(handle);
      setOriginalSize({ width: selectedItem.width, height: selectedItem.height });
      e.preventDefault(); // デフォルトのドラッグ動作を防ぐ
    } else {
      console.log('Starting drag mode');
      setIsDragging(true);
      e.preventDefault(); // デフォルトのドラッグ動作を防ぐ
    }
  };

  // handleCanvasMouseMove関数を修正
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    let mouseX = (e.clientX - rect.left) / canvas.width;
    let mouseY = (e.clientY - rect.top) / canvas.height;

    // キャリブレーション時は座標変換を適用
    if (!showFurniture) {
      const margin = 0.15;
      const effectiveWidth = currentRoomSize.width + (margin * 2);
      const effectiveHeight = currentRoomSize.height + (margin * 2);
      
      // キャンバス座標から正規化座標に逆変換
      mouseX = (mouseX * (1 + 2 * margin / currentRoomSize.width)) - (margin / currentRoomSize.width);
      mouseY = (mouseY * (1 + 2 * margin / currentRoomSize.height)) - (margin / currentRoomSize.height);
    }

    // ビーコンのドラッグ処理
    if (selectedBeacon && isDragging) {
      const x = Math.max(0.01, Math.min(0.99, mouseX));
      const y = Math.max(0.01, Math.min(0.99, mouseY));

      setBeaconPositions(prev => ({
        ...prev,
        [selectedBeacon]: { x, y }
      }));
      return;
    }

    // 家具のドラッグ処理
    if (selectedFurniture && isDragging && !isResizing) {
      const selectedItem = furniture.find(f => f.id === selectedFurniture);
      if (selectedItem) {
        const x = Math.max(0, Math.min(1 - selectedItem.width, mouseX - selectedItem.width / 2));
        const y = Math.max(0, Math.min(1 - selectedItem.height, mouseY - selectedItem.height / 2));

        setFurniture(prev => prev.map(item =>
          item.id === selectedFurniture
            ? { ...item, position: { x, y } }
            : item
        ));
      }
      return;
    }

    // リサイズ処理（既存のコード）
    if (selectedFurniture && isResizing && resizeHandle && originalSize) {
      const selectedItem = furniture.find(f => f.id === selectedFurniture);
      if (!selectedItem) return;

      let newWidth = selectedItem.width;
      let newHeight = selectedItem.height;
      let newX = selectedItem.position.x;
      let newY = selectedItem.position.y;

      const minSize = 0.02;
      const maxSize = 0.5;

      switch (resizeHandle) {
        case 'se':
          newWidth = Math.max(minSize, Math.min(maxSize, mouseX - selectedItem.position.x));
          newHeight = Math.max(minSize, Math.min(maxSize, mouseY - selectedItem.position.y));
          break;
        case 'sw':
          newWidth = Math.max(minSize, Math.min(maxSize, selectedItem.position.x + selectedItem.width - mouseX));
          newHeight = Math.max(minSize, Math.min(maxSize, mouseY - selectedItem.position.y));
          newX = Math.max(0, selectedItem.position.x + selectedItem.width - newWidth);
          break;
        case 'ne':
          newWidth = Math.max(minSize, Math.min(maxSize, mouseX - selectedItem.position.x));
          newHeight = Math.max(minSize, Math.min(maxSize, selectedItem.position.y + selectedItem.height - mouseY));
          newY = Math.max(0, selectedItem.position.y + selectedItem.height - newHeight);
          break;
        case 'nw':
          newWidth = Math.max(minSize, Math.min(maxSize, selectedItem.position.x + selectedItem.width - mouseX));
          newHeight = Math.max(minSize, Math.min(maxSize, selectedItem.position.y + selectedItem.height - mouseY));
          newX = Math.max(0, selectedItem.position.x + selectedItem.width - newWidth);
          newY = Math.max(0, selectedItem.position.y + selectedItem.height - newHeight);
          break;
      }

      setFurniture(prev => prev.map(item =>
        item.id === selectedFurniture
          ? { ...item, width: newWidth, height: newHeight, position: { x: newX, y: newY } }
          : item
      ));
    }

    // カーソル変更処理（既存のコード）
    if (selectedBeacon) {
      canvas.style.cursor = isDragging ? 'grabbing' : 'move';
    } else if (selectedFurniture) {
      const selectedItem = furniture.find(f => f.id === selectedFurniture);
      if (selectedItem && !isDragging && !isResizing) {
        const handle = getResizeHandle(e, selectedItem);
        if (handle) {
          const cursors = { 
            se: 'se-resize', 
            sw: 'sw-resize', 
            ne: 'ne-resize', 
            nw: 'nw-resize' 
          };
          canvas.style.cursor = cursors[handle];
        } else {
          canvas.style.cursor = 'move';
        }
      } else if (isDragging) {
        canvas.style.cursor = 'grabbing';
      } else if (isResizing) {
        canvas.style.cursor = 'crosshair';
      }
    } else {
      canvas.style.cursor = 'default';
    }
  };

  const handleCanvasMouseUp = () => {
    console.log('Mouse up, ending drag/resize');
    setIsDragging(false);
    setIsResizing(false);
    setResizeHandle(null);
    setOriginalSize(null);

    const canvas = canvasRef.current;
    if (canvas) {
      if (selectedBeacon) {
        canvas.style.cursor = 'move';
      } else if (selectedFurniture) {
        canvas.style.cursor = 'move';
      } else {
        canvas.style.cursor = 'default';
      }
    }
  };


  const startMeasurement = () => {
    if (!selectedDevice) {
      alert('測定に使用するデバイスを選択してください');
      return;
    }

    setIsScanning(true);
    
    // RTDBから該当トラッカーのデータを監視
    // デバイスIDを小文字に正規化（RTDBと一致させる）
    const normalizedDeviceId = selectedDevice.toLowerCase();
    const trackerRef = ref(rtdb, `devices/${normalizedDeviceId}`);
    trackerRefRef.current = trackerRef;
    
    console.log('📍 測定開始:', { selectedDevice, normalizedDeviceId, path: `devices/${normalizedDeviceId}` });
    
    // 測定開始時のタイムスタンプを記録
    let initialTimestamp: string | null = null;
    
    const listener = onValue(trackerRef, (snapshot) => {
      const data = snapshot.val();
      console.log('📡 RTDB更新検知:', { data, timestamp: data?.beaconsUpdatedAt });
      
      if (data && data.beacons) {
        const currentTimestamp = data.beaconsUpdatedAt;
        console.log('⏰ タイムスタンプ比較:', { initialTimestamp, currentTimestamp, isNew: currentTimestamp !== initialTimestamp });
        
        // 初回の呼び出しでタイムスタンプを記録
        if (initialTimestamp === null) {
          initialTimestamp = currentTimestamp;
          console.log('✅ 初回タイムスタンプ記録:', initialTimestamp);
          return;
        }
        
        // タイムスタンプが更新されたら新しいデータと判定
        if (currentTimestamp !== initialTimestamp) {
          console.log('🎯 新しいデータ検知！測定完了');
          
          // 各ビーコンからRSSI値を取得
          const rssiMap: { [beaconId: string]: number } = {};
          
          data.beacons.forEach((beacon: any) => {
            if (beacon.mac && beacon.rssi) {
              // MACアドレスを正規化（コロン区切りを大文字に統一）
              const normalizedMac = beacon.mac.toUpperCase().replace(/:/g, '');
              rssiMap[normalizedMac] = beacon.rssi;
            }
          });
          
          console.log('📊 取得したRSSI値:', rssiMap);
          
          setCurrentMeasurement({
            deviceId: selectedDevice,
            timestamp: currentTimestamp,
            rssiValues: rssiMap
          });
          
          setIsScanning(false);
          off(trackerRef);
          trackerRefRef.current = null;
          listenerRef.current = null;
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        }
      } else {
        console.log('⚠️ beaconsデータが見つかりません', data);
      }
    }, (error) => {
      console.error('❌ RTDB読み込みエラー:', error);
      setIsScanning(false);
    });

    listenerRef.current = listener;

    // 60秒後にタイムアウト（トラッカーは1分間隔で送信するため）
    const timeout = setTimeout(() => {
      if (isScanning) {
        console.log('⏱️ 測定がタイムアウト');
        setIsScanning(false);
        off(trackerRef);
        trackerRefRef.current = null;
        listenerRef.current = null;
        alert('測定がタイムアウトしました。トラッカーがデータを送信するまで最大1分かかります。もう一度試してください。');
      }
    }, 65000);

    timeoutRef.current = timeout;
  };

  const cancelMeasurement = () => {
    console.log('❌ 測定をキャンセル');
    setIsScanning(false);
    
    if (trackerRefRef.current) {
      off(trackerRefRef.current);
      trackerRefRef.current = null;
    }
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    listenerRef.current = null;
    setCurrentMeasurement(null);
  };

  // saveMeasurement関数内のドア配置部分を修正
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

    const updatedCalibrationPoints = [...calibrationPoints, point];
    setCalibrationPoints(updatedCalibrationPoints);
    setCurrentMeasurement(null);
    
    if (step < CALIBRATION_STEPS.length) {
      setStep(step + 1);
    } else {
      // キャリブレーション完了 - ドア位置を自動推定
      console.log('🎉 キャリブレーション完了 - ドア位置推定中...');
      
      const doorEstimationResult = estimateDoorPosition(updatedCalibrationPoints);
      
      if (doorEstimationResult) {
        console.log('✅ ドア位置推定成功:', doorEstimationResult);
        
        // 自動でドアを配置
        const furnitureTypes = getFurnitureTypes(currentRoomSize.width, currentRoomSize.height);
        const doorType = furnitureTypes.door;
        
        // ドアの向きに応じてサイズを調整
        const orientation = doorEstimationResult.orientation;
        const isHorizontalDoor = Math.abs(orientation.direction.x) > Math.abs(orientation.direction.y);
        
        // ドアが水平方向（左右の壁）か垂直方向（上下の壁）かでサイズを調整
        const doorWidth = isHorizontalDoor ? doorType.height : doorType.width;   // 向きに応じて幅と高さを入れ替え
        const doorHeight = isHorizontalDoor ? doorType.width : doorType.height;

        const autoDoor: FurnitureItem = {
          id: `auto-door-${Date.now()}`,
          type: 'door',
          position: doorEstimationResult.position,
          width: doorWidth,
          height: doorHeight
        };
        
        console.log('🚪 ドア配置詳細:', {
          position: doorEstimationResult.position,
          orientation: orientation,
          isHorizontalDoor,
          originalSize: { width: doorType.width, height: doorType.height },
          adjustedSize: { width: doorWidth, height: doorHeight },
          angle: orientation.angle
        });
        
        setFurniture(prev => [...prev, autoDoor]);
        setSelectedFurniture(autoDoor.id); // 自動配置したドアを選択状態にする
        
        console.log('✅ ドアを自動配置しました:', autoDoor);
        
        // ユーザーに通知（詳細情報付き）
        setTimeout(() => {
          alert(`🎉 キャリブレーションが完了しました！

  📍 ドア配置詳細:
  • 位置: (${doorEstimationResult.position.x.toFixed(3)}, ${doorEstimationResult.position.y.toFixed(3)})
  • 向き: ${orientation.angle.toFixed(1)}度
  • サイズ: ${doorWidth.toFixed(3)} × ${doorHeight.toFixed(3)}
  • 配置方法: ${isHorizontalDoor ? '水平（左右の壁）' : '垂直（上下の壁）'}

  🔧 位置やサイズを手動で調整できます。`);
        }, 500);
      } else {
        console.log('❌ ドア位置の推定に失敗しました');
        alert('🎉 キャリブレーションが完了しました！\n\n⚠️ ドア位置の自動推定に失敗しました。\n🔧 手動でドアを配置してください。');
      }
      
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
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
                {beacons.map(beacon => (
                  <button
                    key={beacon.firestoreId}
                    className={selectedBeacons.includes(beacon.firestoreId) ? 'btn btn-primary' : 'btn btn-outline'}
                    onClick={() => {
                      if (selectedBeacons.includes(beacon.firestoreId)) {
                        setSelectedBeacons(selectedBeacons.filter(id => id !== beacon.firestoreId));
                      } else if (selectedBeacons.length < 3) {
                        setSelectedBeacons([...selectedBeacons, beacon.firestoreId]);
                      }
                    }}
                    disabled={!selectedBeacons.includes(beacon.firestoreId) && selectedBeacons.length >= 3}
                    style={{ 
                      cursor: 'pointer',
                      minWidth: '140px',
                      flex: '0 0 auto'
                    }}
                  >
                    {beacon.beaconId || beacon.name || beacon.firestoreId}
                  </button>
                ))}
              </div>
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

            {/* マップ表示を追加 */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ marginBottom: '12px', fontSize: '18px' }}>測定位置マップ</h3>
              <div style={{ border: '2px solid #E1E8ED', borderRadius: '8px', padding: '8px', backgroundColor: '#F8F9FA' }}>
                <canvas
                  ref={canvasRef}
                  style={{
                    border: '1px solid #E1E8ED',
                    borderRadius: '4px',
                    display: 'block',
                    margin: '0 auto'
                  }}
                />
              </div>

              {/* 凡例 */}
              <div style={{ marginTop: '12px', fontSize: '14px', display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '16px', height: '16px', backgroundColor: '#4CAF50', borderRadius: '50%' }}></div>
                  <span>完了済み</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '16px', height: '16px', backgroundColor: '#FFC107', borderRadius: '50%' }}></div>
                  <span>現在位置</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '16px', height: '16px', backgroundColor: '#9E9E9E', borderRadius: '50%' }}></div>
                  <span>未完了</span>
                </div>
              </div>
            </div>

            <p style={{ marginBottom: '16px', fontSize: '18px' }}>
              <strong>{CALIBRATION_STEPS[step - 1].label}</strong>に移動して測定を行ってください。
            </p>

            {/* 測定位置の座標表示 */}
            <div style={{ 
              marginBottom: '16px', 
              padding: '12px', 
              backgroundColor: '#E3F2FD', 
              borderRadius: '6px',
              border: '1px solid #BBDEFB'
            }}>
              <p style={{ margin: 0, fontSize: '14px', color: '#1976D2' }}>
                📍 <strong>測定位置:</strong> {CALIBRATION_STEPS[step - 1].label}<br />
                📐 <strong>座標:</strong> ({CALIBRATION_STEPS[step - 1].position.x}, {CALIBRATION_STEPS[step - 1].position.y})<br />
                {step === 6 && <span>🚪 部屋の入口内側で測定してください</span>}
                {step === 7 && <span>🚪 部屋の入口外側（廊下など）で測定してください</span>}
              </p>
            </div>

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
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  className="btn btn-primary"
                  onClick={startMeasurement}
                  disabled={isScanning || !selectedDevice}
                >
                  {isScanning ? '測定中...' : 'ここで測定'}
                </button>
                {isScanning && (
                  <button
                    className="btn btn-outline"
                    onClick={cancelMeasurement}
                  >
                    測定キャンセル
                  </button>
                )}
              </div>
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

        {/* 全ステップ完了後の表示 */}
        {step > CALIBRATION_STEPS.length && !showFurniture && (
          <div className="card">
            <h2 style={{ marginBottom: '16px', color: '#4CAF50' }}>
              ✅ キャリブレーション完了！
            </h2>
            
            {/* 完了マップ表示 */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ marginBottom: '12px' }}>測定完了マップ</h3>
              <canvas
                ref={canvasRef}
                style={{
                  border: '2px solid #4CAF50',
                  borderRadius: '8px',
                  display: 'block',
                  margin: '0 auto'
                }}
              />
            </div>

            {/* 測定結果サマリー */}
            <div style={{ 
              marginBottom: '20px',
              padding: '16px',
              backgroundColor: '#E8F5E8',
              borderRadius: '8px'
            }}>
              <h4 style={{ marginBottom: '12px', color: '#2E7D32' }}>📊 測定結果</h4>
              <ul style={{ margin: 0, paddingLeft: '20px' }}>
                {calibrationPoints.map((point, index) => (
                  <li key={point.id} style={{ marginBottom: '4px', color: '#2E7D32' }}>
                    <strong>{point.label}</strong>: 
                    ビーコン {Object.keys(point.measurements[0]?.rssiValues || {}).length}台検出
                  </li>
                ))}
              </ul>
            </div>

            <p style={{ marginBottom: '20px', fontSize: '16px' }}>
              全ての測定ポイントでデータを取得しました。<br />
              次に家具とビーコンの配置を行います。
            </p>

            <button 
              className="btn btn-primary btn-lg" 
              onClick={() => setShowFurniture(true)}
              style={{ padding: '12px 24px', fontSize: '18px' }}
            >
              家具配置画面へ進む
            </button>
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

  if (showFurniture || isFurnitureEditMode) {
    return (
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: '700' }}>
            {isFurnitureEditMode ? `家具配置の編集: ${roomName}` : isEditMode ? '家具配置の編集' : '家具とオブジェクトの配置'}
          </h1>
          {isFurnitureEditMode && (
            <button 
              className="btn btn-outline"
              onClick={() => navigate(`/edit-room/${roomId}`)}
            >
              ← ルーム編集に戻る
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '24px' }}>
          {/* 左側: コントロールパネル */}
          <div style={{ width: '300px' }}>
            {(isEditMode || isFurnitureEditMode) && (
              <div className="card" style={{ marginBottom: '16px', backgroundColor: '#FFF3CD', border: '1px solid #FFEAA7' }}>
                <h3 style={{ marginBottom: '12px', color: '#856404' }}>編集モード</h3>
                <p style={{ fontSize: '14px', color: '#856404', margin: 0 }}>
                  「{roomName}」の家具配置を編集しています
                </p>
              </div>
            )}



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
                {Object.entries(getFurnitureTypes(currentRoomSize.width, currentRoomSize.height)).map(([type, info]) => (
                  <button
                    key={type}
                    className="btn btn-outline"
                    onClick={() => addFurniture(type as FurnitureType)}
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
                  {/* // ドア自動配置情報の表示を詳細化 */}
                  {furniture.some(f => f.id.startsWith('auto-door-')) && (
                    <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#D1ECF1', border: '1px solid #BEE5EB', borderRadius: '4px' }}>
                      <h4 style={{ marginBottom: '8px', color: '#0C5460', fontSize: '16px' }}>🚪 ドア自動配置</h4>
                      <p style={{ fontSize: '14px', color: '#0C5460', marginBottom: '8px' }}>
                        キャリブレーション時の測定データを基に、ドア内側・外側の中点に、内外を結ぶ線に垂直な向きでドアを配置しました。
                      </p>
                      {/* ドアの詳細情報を表示 */}
                      {(() => {
                        const autoDoor = furniture.find(f => f.id.startsWith('auto-door-'));
                        if (autoDoor) {
                          // ドア内側・外側の座標を取得
                          const doorInside = calibrationPoints.find(p => p.id === 'door_inside');
                          const doorOutside = calibrationPoints.find(p => p.id === 'door_outside');
                          
                          if (doorInside && doorOutside) {
                            const midpointX = (doorInside.position.x + doorOutside.position.x) / 2;
                            const midpointY = (doorInside.position.y + doorOutside.position.y) / 2;
                            
                            const directionVector = {
                              x: doorOutside.position.x - doorInside.position.x,
                              y: doorOutside.position.y - doorInside.position.y
                            };
                            
                            const angle = Math.atan2(directionVector.y, directionVector.x) * 180 / Math.PI;
                            const isHorizontalDoor = Math.abs(directionVector.x) < Math.abs(directionVector.y);
                            
                            return (
                              <div style={{ fontSize: '12px', color: '#0C5460', backgroundColor: 'rgba(255,255,255,0.3)', padding: '8px', borderRadius: '4px' }}>
                                <div style={{ marginBottom: '6px' }}>
                                  <strong>📍 測定ポイント:</strong><br />
                                  内側: ({doorInside.position.x.toFixed(3)}, {doorInside.position.y.toFixed(3)})<br />
                                  外側: ({doorOutside.position.x.toFixed(3)}, {doorOutside.position.y.toFixed(3)})<br />
                                  中点: ({midpointX.toFixed(3)}, {midpointY.toFixed(3)})
                                </div>
                                <div style={{ marginBottom: '6px' }}>
                                  <strong>🧭 ドアの向き:</strong><br />
                                  角度: {angle.toFixed(1)}度<br />
                                  配置: {isHorizontalDoor ? '水平（上下の壁）' : '垂直（左右の壁）'}
                                </div>
                                <div>
                                  <strong>📐 最終配置:</strong><br />
                                  位置: ({autoDoor.position.x.toFixed(3)}, {autoDoor.position.y.toFixed(3)})<br />
                                  サイズ: {autoDoor.width.toFixed(3)} × {autoDoor.height.toFixed(3)}
                                </div>
                                <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '4px' }}>
                                  ※ 正規化座標 (0.0~1.0)
                                </div>
                              </div>
                            );
                          }
                          
                          // フォールバック表示
                          return (
                            <div style={{ fontSize: '12px', color: '#0C5460', backgroundColor: 'rgba(255,255,255,0.3)', padding: '8px', borderRadius: '4px' }}>
                              <strong>📍 配置座標:</strong><br />
                              位置: ({autoDoor.position.x.toFixed(3)}, {autoDoor.position.y.toFixed(3)})<br />
                              サイズ: {autoDoor.width.toFixed(3)} × {autoDoor.height.toFixed(3)}<br />
                              <span style={{ fontSize: '11px', opacity: 0.8 }}>
                                ※ 正規化座標 (0.0~1.0)
                              </span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                      <p style={{ fontSize: '13px', color: '#0C5460', margin: '8px 0 0 0', fontWeight: 'bold' }}>
                        🔧 位置やサイズを手動で調整してください
                      </p>
                    </div>
                  )}

                  {furniture.map(item => {
                    const furnitureTypes = getFurnitureTypes(currentRoomSize.width, currentRoomSize.height);
                    return (
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
                        {getFurnitureTypes(currentRoomSize.width, currentRoomSize.height)[item.type as FurnitureType].label}
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
                    );
                  })}
                </div>
              )}
            </div>

            {/* 既存の家具リストの後に追加 */}
            <div className="card" style={{ marginBottom: '16px' }}>
              <h3 style={{ marginBottom: '16px' }}>ビーコン位置</h3>
              {TEST_ROOM.beacons.length === 0 ? (
                <p style={{ color: '#7f8c8d', fontSize: '14px' }}>ビーコンが設定されていません</p>
              ) : (
                <div>
                  {TEST_ROOM.beacons.map(beacon => {
                    const position = beaconPositions[beacon.id] || beacon.position;
                    return (
                      <div
                        key={beacon.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px',
                          marginBottom: '4px',
                          backgroundColor: selectedBeacon === beacon.id ? '#E3F2FD' : '#F8F9FA',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          border: selectedBeacon === beacon.id ? '2px solid #4A90E2' : '1px solid #E1E8ED'
                        }}
                        onClick={() => setSelectedBeacon(selectedBeacon === beacon.id ? null : beacon.id)}
                      >
                        <div style={{ fontSize: '14px' }}>
                          <strong>{beacon.name}</strong><br />
                          <span style={{ color: '#7f8c8d', fontSize: '12px' }}>
                            ({position.x.toFixed(2)}, {position.y.toFixed(2)})
                          </span>
                        </div>
                        <div style={{ 
                          width: '16px', 
                          height: '16px', 
                          backgroundColor: '#4A90E2', 
                          borderRadius: '50%' 
                        }} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginBottom: '12px' }}>操作方法</h3>
              <ul style={{ fontSize: '14px', lineHeight: '1.6', paddingLeft: '16px' }}>
                <li>家具またはビーコン（青い円）をクリックして選択</li>
                <li>選択したオブジェクトをドラッグで移動</li>
                <li>選択した家具の角（赤い四角）をドラッグでサイズ変更</li>
                <li>ビーコンはドラッグ移動のみ可能</li>
                <li>グリッド1マス = 0.1単位（正規化座標）</li>
              </ul>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button className="btn btn-primary" onClick={saveCalibration}>
                {isEditMode || isFurnitureEditMode ? '更新' : '保存'}
              </button>
              <button 
                className="btn btn-outline" 
                onClick={() => {
                  if (isFurnitureEditMode) {
                    navigate(`/edit-room/${roomId}`);
                  } else if (isEditMode) {
                    navigate('/management');
                  } else {
                    navigate('/mode1');
                  }
                }}
              >
                キャンセル
              </button>
            </div>
          </div>

          {/* 右側: マップ */}
          <div className="card" style={{ flex: 1 }}>
            <h3 style={{ marginBottom: '16px' }}>
              {roomName || TEST_ROOM.name} ({currentRoomSize.width.toFixed(1)}m × {currentRoomSize.height.toFixed(1)}m)
            </h3>
            <canvas
              ref={canvasRef}
              style={{
                border: '2px solid #E1E8ED',
                borderRadius: '8px',
                cursor: isDragging ? 'grabbing' : selectedFurniture ? 'move' : 'pointer'
              }}
              onClick={handleCanvasClick}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            />
            {selectedFurniture && (
              <p style={{ marginTop: '12px', fontSize: '14px', color: '#4A90E2' }}>
                選択中: {(() => {
                  const selectedItem = furniture.find(f => f.id === selectedFurniture);
                  const furnitureTypes = getFurnitureTypes(currentRoomSize.width, currentRoomSize.height);
                  const furnitureType = selectedItem ? furnitureTypes[selectedItem.type as FurnitureType] : null;
                  return furnitureType ? furnitureType.label : '不明';
                })()}
                （ドラッグして移動、角をドラッグでサイズ変更）
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
import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs, addDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, onValue, off } from 'firebase/database';
import { db, rtdb } from '../firebase';
import { Device, Beacon, CalibrationPoint, RoomProfile, FurnitureItem } from '../types';


// 基本的なキャリブレーションステップ（ドア位置選択まで）
const BASE_CALIBRATION_STEPS = [
  { id: 'corner1', label: '左上隅', position: { x: 0, y: 0 } },
  { id: 'corner2', label: '右上隅', position: { x: 1.0, y: 0 } },
  { id: 'corner3', label: '右下隅', position: { x: 1.0, y: 1.0 } },
  { id: 'corner4', label: '左下隅', position: { x: 0, y: 1.0 } },
  { id: 'center', label: '部屋の中央', position: { x: 0.5, y: 0.5 } },
  { id: 'door_position_select', label: 'ドア位置選択', position: { x: 0.5, y: 0 } } // 仮の位置
];

// ドア位置に基づいて動的に生成される関数
const generateCalibrationSteps = (doorPosition: { x: number; y: number }) => {
  // ドアがどの辺にあるかを判定
  const edges = [
    { name: 'top', distance: Math.abs(doorPosition.y - 0) },
    { name: 'bottom', distance: Math.abs(doorPosition.y - 1.0) },
    { name: 'left', distance: Math.abs(doorPosition.x - 0) },
    { name: 'right', distance: Math.abs(doorPosition.x - 1.0) }
  ];
  
  const closestEdge = edges.reduce((min, edge) => 
    edge.distance < min.distance ? edge : min
  );

  // ドア内側・外側の位置を計算
  let doorInside = { x: doorPosition.x, y: doorPosition.y };
  let doorOutside = { x: doorPosition.x, y: doorPosition.y };
  
  const offset = 0.05; // オフセット距離
  
  switch (closestEdge.name) {
    case 'top':
      doorInside = { x: doorPosition.x, y: doorPosition.y + offset };
      doorOutside = { x: doorPosition.x, y: doorPosition.y - offset };
      break;
    case 'bottom':
      doorInside = { x: doorPosition.x, y: doorPosition.y - offset };
      doorOutside = { x: doorPosition.x, y: doorPosition.y + offset };
      break;
    case 'left':
      doorInside = { x: doorPosition.x + offset, y: doorPosition.y };
      doorOutside = { x: doorPosition.x - offset, y: doorPosition.y };
      break;
    case 'right':
      doorInside = { x: doorPosition.x - offset, y: doorPosition.y };
      doorOutside = { x: doorPosition.x + offset, y: doorPosition.y };
      break;
  }

  return [
    ...BASE_CALIBRATION_STEPS,
    { id: 'door_inside', label: 'ドア内側', position: doorInside },
    { id: 'door_outside', label: 'ドア外側', position: doorOutside }
  ];
};

const TEST_ROOM = {
  width: 1,
  height: 1,
  name: 'テスト会議室',
  beacons: [
    { id: 'beacon1', position: { x: 0.1, y: 0.1 }, name: 'ビーコン1' },
    { id: 'beacon2', position: { x: 0.9, y: 0.1 }, name: 'ビーコン2' },
    { id: 'beacon3', position: { x: 0.5, y: 0.9 }, name: 'ビーコン3' }
  ]
};

const getFurnitureTypes = (roomWidth: number, roomHeight: number) => {
  // 基準サイズ（メートル）
  const baseSizes = {
    desk: { width: 0.3, height: 0.2 },
    tv: { width: 0.3, height: 0.05 },
    piano: { width: 0.2, height: 0.15 },
    chair: { width: 0.05, height: 0.05 },
  };

  const BASE_ROOM = { width: 5, height: 5 };
  const MAX_RATIO = 0.8; // 部屋の 80% までを上限に拡大
  const MIN_RATIO = 0.1; // 最低でも部屋の 10% の大きさを確保

  const normalizeSize = (
    baseWidth: number,
    baseHeight: number
  ): { width: number; height: number } => {
    const safeRoomWidth = roomWidth > 0 ? roomWidth : 1;
    const safeRoomHeight = roomHeight > 0 ? roomHeight : 1;

    const widthScale = Math.max(1, safeRoomWidth / BASE_ROOM.width);
    const heightScale = Math.max(1, safeRoomHeight / BASE_ROOM.height);

    const scaledWidth = baseWidth * widthScale;
    const scaledHeight = baseHeight * heightScale;

    const actualWidth = Math.max(
      Math.min(scaledWidth, safeRoomWidth * MAX_RATIO),
      safeRoomWidth * MIN_RATIO
    );
    const actualHeight = Math.max(
      Math.min(scaledHeight, safeRoomHeight * MAX_RATIO),
      safeRoomHeight * MIN_RATIO
    );

    return {
      width: actualWidth / safeRoomWidth,
      height: actualHeight / safeRoomHeight,
    };
  };

  return {
    desk: {
      label: '机',
      ...normalizeSize(baseSizes.desk.width, baseSizes.desk.height),
      color: '#8B4513',
    },
    tv: {
      label: 'テレビ',
      ...normalizeSize(baseSizes.tv.width, baseSizes.tv.height),
      color: '#2C3E50',
    },
    piano: {
      label: 'ピアノ',
      ...normalizeSize(baseSizes.piano.width, baseSizes.piano.height),
      color: '#1A1A1A',
    },
    chair: {
      label: '椅子',
      ...normalizeSize(baseSizes.chair.width, baseSizes.chair.height),
      color: '#CD853F',
    },
  } as const;
};

export type FurnitureType = 'desk' | 'tv' | 'piano' | 'chair';


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
  
  // ドア位置選択用のステート
  const [doorPosition, setDoorPosition] = useState<{ x: number; y: number }>({ x: 0.5, y: 0 });
  const [isDraggingDoor, setIsDraggingDoor] = useState(false);
  
  // 動的に生成されるキャリブレーションステップ
  const CALIBRATION_STEPS = useMemo(() => {
    return generateCalibrationSteps(doorPosition);
  }, [doorPosition]);

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

  // 選択されたビーコンに基づいて動的なビーコンリストを生成
  const currentBeacons = useMemo(() => {
    return selectedBeacons.map((beaconId, index) => {
      const beaconData = beacons.find(b => b.firestoreId === beaconId);
      return {
        id: beaconId,
        name: beaconData?.name || beaconData?.beaconId || `ビーコン${index + 1}`,
        position: { x: 0.1 + index * 0.4, y: 0.1 } // デフォルト位置
      };
    });
  }, [selectedBeacons, beacons]);

  
  // 測定キャンセル用
  const trackerRefRef = useRef<any>(null);
  const listenerRef = useRef<any>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (trackerRefRef.current) {
        off(trackerRefRef.current);
        trackerRefRef.current = null;
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      listenerRef.current = null;
    };
  }, []);


  const [currentRoomSize, setCurrentRoomSize] = useState({ width: 1, height: 1 });


  useEffect(() => {
    // データ読み込み処理
    if (devices.length === 0) {
      loadDevices();
    }
    if (beacons.length === 0) {
      loadBeacons();
    }

    // 編集モードのデータ読み込み
    if ((mode === 'furniture' && roomId) || isFurnitureEditMode) {
      if (!originalRoomData) {
        loadRoomData(roomId!);
      }
    }

    // マップを描画
    drawMap();
  }, [
    furniture,
    selectedFurniture, 
    selectedBeacon,
    beaconPositions,
    originalRoomData,
    currentRoomSize.width,
    currentRoomSize.height,
    showFurniture,
    step,
    calibrationPoints.length,
    doorPosition.x,
    doorPosition.y,
    isDraggingDoor,
    currentBeacons
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
  };


  const getBeaconDisplayName = (firestoreId: string) => {
    const beacon = beacons.find(b => b.firestoreId === firestoreId);
    return beacon?.name || beacon?.beaconId || firestoreId;
  };

  // ドア位置を部屋の外枠上にスナップする関数
  const snapDoorToEdge = (x: number, y: number): { x: number; y: number } => {
    // 各辺までの距離を計算
    const distanceToTop = Math.abs(y - 0);
    const distanceToBottom = Math.abs(y - 1.0);
    const distanceToLeft = Math.abs(x - 0);
    const distanceToRight = Math.abs(x - 1.0);
    
    // 最も近い辺を見つける
    const minDistance = Math.min(distanceToTop, distanceToBottom, distanceToLeft, distanceToRight);
    
    // 最も近い辺にスナップ
    if (minDistance === distanceToTop) {
      // 上の辺
      return { x: Math.max(0, Math.min(1.0, x)), y: 0 };
    } else if (minDistance === distanceToBottom) {
      // 下の辺
      return { x: Math.max(0, Math.min(1.0, x)), y: 1.0 };
    } else if (minDistance === distanceToLeft) {
      // 左の辺
      return { x: 0, y: Math.max(0, Math.min(1.0, y)) };
    } else {
      // 右の辺
      return { x: 1.0, y: Math.max(0, Math.min(1.0, y)) };
    }
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
    currentBeacons.forEach(beacon => {
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

      ctx.fillStyle = '#FF9800';
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
      
      // ビーコン名（背景付き、下に表示）
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      
      const textMetrics = ctx.measureText(beacon.name);
      const textWidth = textMetrics.width + 8;
      const textHeight = 16;
      
      const labelX = beaconPos.x - textWidth / 2;
      const labelY = beaconPos.y + 18;
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(labelX, labelY, textWidth, textHeight);

      ctx.strokeStyle = '#2C3E50';
      ctx.lineWidth = 1;
      ctx.strokeRect(labelX, labelY, textWidth, textHeight);

      ctx.fillStyle = '#2C3E50';
      ctx.fillText(beacon.name, beaconPos.x, labelY + 12);
    });

    // キャリブレーションポイントを描画（座標変換適用）
    if (!showFurniture) {
      CALIBRATION_STEPS.forEach((calibrationStep, index) => {
        // 座標変換を使用
        const pointPos = normalizedToCanvas(calibrationStep.position.x, calibrationStep.position.y);
        
        // キャンバス範囲チェック
        const isOutside = calibrationStep.position.x < 0 || calibrationStep.position.x > 1 || 
                        calibrationStep.position.y < 0 || calibrationStep.position.y > 1;

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
      
      // ドア位置関連の表示
      const currentStep = CALIBRATION_STEPS[step - 1];
      
      // ドア位置選択ステップの場合、ドラッグ可能なドアマーカーを表示
      if (step > 0 && currentStep?.id === 'door_position_select') {
        const doorPos = normalizedToCanvas(doorPosition.x, doorPosition.y);
        
        // ドアマーカーの描画（大きめの目立つマーカー）
        // 外側の円（グロー効果）
        ctx.beginPath();
        ctx.arc(doorPos.x, doorPos.y, 30, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 152, 0, 0.2)';
        ctx.fill();
        
        // メインの円
        ctx.beginPath();
        ctx.arc(doorPos.x, doorPos.y, 20, 0, 2 * Math.PI);
        ctx.fillStyle = isDraggingDoor ? '#FF6F00' : '#FF9800';
        ctx.fill();
        
        // 境界線
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // ドアアイコン（🚪）
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🚪', doorPos.x, doorPos.y);
        
        // ラベル
        const labelText = 'ドアの位置';
        const labelMetrics = ctx.measureText(labelText);
        const labelWidth = labelMetrics.width + 16;
        const labelHeight = 24;
        const labelX = doorPos.x - labelWidth / 2;
        const labelY = doorPos.y + 40;
        
        // ラベル背景
        ctx.fillStyle = 'rgba(255, 152, 0, 0.95)';
        ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
        
        // ラベル境界線
        ctx.strokeStyle = '#FF6F00';
        ctx.lineWidth = 2;
        ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);
        
        // ラベルテキスト
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 14px Arial';
        ctx.textBaseline = 'top';
        ctx.fillText(labelText, doorPos.x, labelY + 5);
        
        // 座標表示
        const coordText = `(${doorPosition.x.toFixed(2)}, ${doorPosition.y.toFixed(2)})`;
        ctx.fillStyle = '#FF9800';
        ctx.font = '11px Arial';
        ctx.fillText(coordText, doorPos.x, labelY + labelHeight + 12);
        
        // ドラッグ中のヒント
        if (isDraggingDoor) {
          ctx.fillStyle = '#FF6F00';
          ctx.font = 'bold 12px Arial';
          ctx.fillText('外枠に沿って移動します', doorPos.x, labelY + labelHeight + 28);
        }
      }
      // ドア内側・外側測定ステップの場合、参照用にドア位置を表示（ドラッグ不可）
      else if (step > 0 && (currentStep?.id === 'door_inside' || currentStep?.id === 'door_outside')) {
        const doorPos = normalizedToCanvas(doorPosition.x, doorPosition.y);
        
        // 参照用のドアマーカー（グレーアウト）
        ctx.beginPath();
        ctx.arc(doorPos.x, doorPos.y, 15, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(158, 158, 158, 0.5)';
        ctx.fill();
        
        // 境界線
        ctx.strokeStyle = '#9E9E9E';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // ドアアイコン（小さめ）
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🚪', doorPos.x, doorPos.y);
        
        // ラベル（小さめ）
        const labelText = 'ドア位置（参照）';
        const labelMetrics = ctx.measureText(labelText);
        const labelWidth = labelMetrics.width + 12;
        const labelHeight = 20;
        const labelX = doorPos.x - labelWidth / 2;
        const labelY = doorPos.y + 30;
        
        // ラベル背景
        ctx.fillStyle = 'rgba(158, 158, 158, 0.8)';
        ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
        
        // ラベル境界線
        ctx.strokeStyle = '#9E9E9E';
        ctx.lineWidth = 1;
        ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);
        
        // ラベルテキスト
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '12px Arial';
        ctx.textBaseline = 'top';
        ctx.fillText(labelText, doorPos.x, labelY + 4);
      }
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
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
    
    setFurniture(prev => [...prev, newItem]);
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

    // ビーコン位置を保存用に整形
    const beaconPositionsArray = currentBeacons.map(beacon => ({
      id: beacon.id,
      name: beacon.name,
      position: beaconPositions[beacon.id] || beacon.position
    }));

    const roomProfile: Partial<RoomProfile> = {
      name: roomName,
      beacons: selectedBeacons,
      calibrationPoints: calibrationPoints,
      outline: originalRoomData?.outline || { width: TEST_ROOM.width, height: TEST_ROOM.height },
      exitMargin: originalRoomData?.exitMargin ?? 0.5,
      furniture: furniture,
      beaconPositions: beaconPositionsArray, // ビーコン位置を保存
      createdAt: originalRoomData?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      if (isEditMode && roomId) {
        // 編集モード：既存のドキュメントを更新
        await updateDoc(doc(db, 'rooms', roomId), roomProfile);
        // alert(`「${roomName}」の家具配置が更新されました！`);
        
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
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const handleSize = 8;

    const margin = showFurniture ? 0 : 0.15;
    const safeWidth = Math.max(currentRoomSize.width, 0.0001);
    const safeHeight = Math.max(currentRoomSize.height, 0.0001);
    const widthAdjustment = 1 + 2 * margin / safeWidth;
    const heightAdjustment = 1 + 2 * margin / safeHeight;

    // 重要: 実際の表示サイズ（rect.width/height）を使用
    const startX = showFurniture
      ? item.position.x * rect.width
      : ((item.position.x + margin / safeWidth) / widthAdjustment) * rect.width;
    const startY = showFurniture
      ? item.position.y * rect.height
      : ((item.position.y + margin / safeHeight) / heightAdjustment) * rect.height;

    const widthPx = showFurniture
      ? item.width * rect.width
      : (item.width / widthAdjustment) * rect.width;
    const heightPx = showFurniture
      ? item.height * rect.height
      : (item.height / heightAdjustment) * rect.height;

    const handles = [
      { x: startX + widthPx - handleSize / 2, y: startY + heightPx - handleSize / 2, type: 'se' as const },
      { x: startX - handleSize / 2, y: startY + heightPx - handleSize / 2, type: 'sw' as const },
      { x: startX + widthPx - handleSize / 2, y: startY - handleSize / 2, type: 'ne' as const },
      { x: startX - handleSize / 2, y: startY - handleSize / 2, type: 'nw' as const },
    ];

    for (const handle of handles) {
      if (
        mouseX >= handle.x &&
        mouseX <= handle.x + handleSize &&
        mouseY >= handle.y &&
        mouseY <= handle.y + handleSize
      ) {
        return handle.type;
      }
    }
    return null;
  };


  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // ドア位置選択ステップの場合
    const currentStep = CALIBRATION_STEPS[step - 1];
    
    if (step > 0 && currentStep?.id === 'door_position_select') {
      setIsDraggingDoor(true);
      e.preventDefault();
      return;
    }
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // 重要: 実際の表示サイズ（rect.width/height）で正規化する
    let x = (e.clientX - rect.left) / rect.width;
    let y = (e.clientY - rect.top) / rect.height;

    // キャリブレーション時は座標変換を適用
    if (!showFurniture) {
      const margin = 0.15;
      x = (x * (1 + 2 * margin / currentRoomSize.width)) - (margin / currentRoomSize.width);
      y = (y * (1 + 2 * margin / currentRoomSize.height)) - (margin / currentRoomSize.height);
    }

    // 既に選択されている家具のリサイズハンドルをチェック（選択状態の場合のみ）
    if (selectedFurniture) {
      const selectedItem = furniture.find(f => f.id === selectedFurniture);
      if (selectedItem) {
        const handle = getResizeHandle(e, selectedItem);
        if (handle) {
          setIsResizing(true);
          setResizeHandle(handle);
          setOriginalSize({ width: selectedItem.width, height: selectedItem.height });
          e.preventDefault();
          return;
        }
      }
    }

    // ビーコンのクリック判定（円形）
    const clickedBeacon = currentBeacons.find(beacon => {
      const position = beaconPositions[beacon.id] || beacon.position;
      const distance = Math.sqrt(
        Math.pow(x - position.x, 2) + Math.pow(y - position.y, 2)
      );
      // 正規化座標での半径を計算（クリックしやすいように少し大きめに設定）
      const beaconRadius = 0.03; // 正規化座標で約3%の範囲
      
      return distance <= beaconRadius;
    });

    // 家具のクリック判定（矩形）
    const clickedFurniture = furniture.find(item => {
      return x >= item.position.x && 
            x <= item.position.x + item.width &&
            y >= item.position.y && 
            y <= item.position.y + item.height;
    });

    // ビーコンがクリックされた場合
    if (clickedBeacon) {
      setSelectedBeacon(clickedBeacon.id);
      setSelectedFurniture(null);
      setIsDragging(true);
      e.preventDefault();
      return;
    }

    // 家具がクリックされた場合
    if (clickedFurniture) {
      setSelectedFurniture(clickedFurniture.id);
      setSelectedBeacon(null);
      setIsDragging(true);
      e.preventDefault();
      return;
    }

    // 何もクリックされなかった場合は選択解除
    setSelectedFurniture(null);
    setSelectedBeacon(null);
  };

  // handleCanvasMouseMove関数を修正
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // 重要: 実際の表示サイズ（rect.width/height）で正規化する
    let mouseX = (e.clientX - rect.left) / rect.width;
    let mouseY = (e.clientY - rect.top) / rect.height;

    // キャリブレーション時は座標変換を適用
    if (!showFurniture) {
      const margin = 0.15;
      const effectiveWidth = currentRoomSize.width + (margin * 2);
      const effectiveHeight = currentRoomSize.height + (margin * 2);
      
      // キャンバス座標から正規化座標に逆変換
      mouseX = (mouseX * (1 + 2 * margin / currentRoomSize.width)) - (margin / currentRoomSize.width);
      mouseY = (mouseY * (1 + 2 * margin / currentRoomSize.height)) - (margin / currentRoomSize.height);
    }

    // ドア位置ドラッグ処理
    if (isDraggingDoor) {
      const snappedPosition = snapDoorToEdge(mouseX, mouseY);
      setDoorPosition(snappedPosition);
      return;
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

        setFurniture(prev =>
          prev.map(item =>
            item.id === selectedFurniture
              ? { ...item, position: { x, y } }
              : item
          )
        );
      }
      return;
    }

    // リサイズ処理
    if (selectedFurniture && isResizing && resizeHandle && originalSize) {
      const selectedItem = furniture.find(f => f.id === selectedFurniture);
      if (!selectedItem) return;

      let newWidth = selectedItem.width;
      let newHeight = selectedItem.height;
      let newX = selectedItem.position.x;
      let newY = selectedItem.position.y;

      const minSize = 0.05;
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

    // カーソル変更処理（自動配置されたドアにはリサイズハンドルを表示しない）
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
    setIsDragging(false);
    setIsDraggingDoor(false);
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
          trackerRefRef.current = null;
          listenerRef.current = null;
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        }
      } else {
        console.warn('⚠️ beaconsデータが見つかりません', data);
      }
    }, (error) => {
      console.error('❌ RTDB読み込みエラー:', error);
      setIsScanning(false);
    });

    listenerRef.current = listener;

    // 5分後にタイムアウト
    const timeout = setTimeout(() => {
      console.warn('⏱️ 測定がタイムアウト');
      setIsScanning(false);
      if (trackerRefRef.current) {
        off(trackerRefRef.current);
        trackerRefRef.current = null;
      }
      listenerRef.current = null;
      alert('測定がタイムアウトしました。\n5分以内にトラッカーからデータが送信されませんでした。\n測定を中断します。');
    }, 300000);

    timeoutRef.current = timeout;
  };

  const cancelMeasurement = () => {
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
    const currentStep = CALIBRATION_STEPS[step - 1];
    
    // ドア位置選択ステップは測定不要なのでスキップ
    if (currentStep.id === 'door_position_select') {
      setStep(step + 1);
      return;
    }
    
    if (!currentMeasurement) {
      alert('まず測定を行ってください');
      return;
    }

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
      // キャリブレーション完了
      alert('🎉 キャリブレーションが完了しました！\n\n次のステップで家具を配置してください。');
      setShowFurniture(true);
    }
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
              <p style={{ marginTop: '8px', fontSize: '12px', color: '#7f8c8d' }}>
                💡 <strong>推奨:</strong> 3つのビーコンのうち、1つはドア付近に設置することをお勧めします。これにより退室判定の精度が向上します。
              </p>
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
                    margin: '0 auto',
                    cursor: (step > 0 && CALIBRATION_STEPS[step - 1]?.id === 'door_position_select') 
                      ? (isDraggingDoor ? 'grabbing' : 'grab') 
                      : 'default'
                  }}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseUp}
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

            {/* ドア位置選択ステップの場合は特別な表示 */}
            {CALIBRATION_STEPS[step - 1]?.id === 'door_position_select' ? (
              <>
                <p style={{ marginBottom: '16px', fontSize: '18px' }}>
                  🚪 <strong>ドアの位置を指定してください</strong>
                </p>

                {/* ドア位置選択の説明 */}
                <div style={{ 
                  marginBottom: '16px', 
                  padding: '16px', 
                  backgroundColor: '#FFF3CD', 
                  borderRadius: '6px',
                  border: '2px solid #FF9800'
                }}>
                  <h4 style={{ marginTop: 0, marginBottom: '12px', color: '#FF6F00' }}>
                    📍 操作方法
                  </h4>
                  <ol style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.8', color: '#856404' }}>
                    <li>マップ上のオレンジ色の🚪マーカーをドラッグしてください</li>
                    <li>ドアの位置が<strong>部屋の外枠（上下左右の辺）</strong>に自動的にスナップします</li>
                    <li>実際のドアがある位置にマーカーを移動させてください</li>
                    <li>位置が決まったら「次へ」ボタンをクリックしてください</li>
                  </ol>
                </div>

                {/* 現在のドア位置表示 */}
                <div style={{ 
                  marginBottom: '16px', 
                  padding: '12px', 
                  backgroundColor: '#E3F2FD', 
                  borderRadius: '6px',
                  border: '1px solid #BBDEFB'
                }}>
                  <p style={{ margin: 0, fontSize: '14px', color: '#1976D2' }}>
                    📍 <strong>現在のドア位置:</strong> ({doorPosition.x.toFixed(3)}, {doorPosition.y.toFixed(3)})<br />
                    🧭 <strong>位置:</strong> {
                      doorPosition.y === 0 ? '上の辺' :
                      doorPosition.y === 1.0 ? '下の辺' :
                      doorPosition.x === 0 ? '左の辺' :
                      doorPosition.x === 1.0 ? '右の辺' : '外枠上'
                    }
                  </p>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <button
                    className="btn btn-primary"
                    onClick={saveMeasurement}
                  >
                    次へ（ドアの測定へ）
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ marginBottom: '16px', fontSize: '18px' }}>
                  <strong>{CALIBRATION_STEPS[step - 1].label}</strong>に移動して測定を行ってください。
                </p>

                {/* ドア内側・外側測定時の注意書き */}
                {(CALIBRATION_STEPS[step - 1].id === 'door_inside' || CALIBRATION_STEPS[step - 1].id === 'door_outside') && (
                  <div style={{ 
                    marginBottom: '16px', 
                    padding: '12px', 
                    backgroundColor: '#FFF3CD', 
                    borderRadius: '6px',
                    border: '1px solid #FF9800'
                  }}>
                    <p style={{ margin: 0, fontSize: '14px', color: '#856404' }}>
                      ℹ️ <strong>注意:</strong> マップ上のグレーの🚪アイコンは参照用です。<br />
                      ドアの位置を変更したい場合は、
                      <button
                        onClick={() => setStep(step - 1)}
                        style={{
                          marginLeft: '4px',
                          padding: '2px 8px',
                          fontSize: '13px',
                          backgroundColor: '#FF9800',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontWeight: 'bold'
                        }}
                      >
                        前のステップに戻る
                      </button>
                      してください。
                    </p>
                  </div>
                )}

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
                    📐 <strong>正規化座標:</strong> ({CALIBRATION_STEPS[step - 1].position.x.toFixed(3)}, {CALIBRATION_STEPS[step - 1].position.y.toFixed(3)})<br />
                    {CALIBRATION_STEPS[step - 1].id === 'door_inside' && <span>🚪 ドア位置から部屋内側（{doorPosition.x.toFixed(3)}, {doorPosition.y.toFixed(3)}から内側）で測定してください</span>}
                    {CALIBRATION_STEPS[step - 1].id === 'door_outside' && <span>🚪 ドア位置から部屋外側（{doorPosition.x.toFixed(3)}, {doorPosition.y.toFixed(3)}から外側）で測定してください</span>}
                  </p>
                </div>

                {/* 測定姿勢の指示 */}
                <div style={{ 
                  marginBottom: '16px', 
                  padding: '12px', 
                  backgroundColor: '#E8F5E9', 
                  borderRadius: '6px',
                  border: '1px solid #4CAF50'
                }}>
                  <p style={{ margin: 0, fontSize: '14px', color: '#2E7D32' }}>
                    <strong>測定時の姿勢:</strong><br />
                    • トラッカーを胸の高さで持ってください<br />
                    • <strong>🚪 出口の方を向いて</strong>測定してください<br />
                    • 測定中は動かないでください
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
              </>
            )}

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
  if (showFurniture || isFurnitureEditMode) {
    return (
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: '700', margin: 0 }}>
            {isFurnitureEditMode ? `家具配置の編集: ${roomName}` : isEditMode ? '家具配置の編集' : '家具とオブジェクトの配置'}
          </h1>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
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

        <div style={{ display: 'flex', gap: '24px', flexDirection: window.innerWidth <= 768 ? 'column' : 'row' }}>
          {/* 左側: コントロールパネル */}
          <div style={{ width: window.innerWidth <= 768 ? '100%' : '300px' }}>
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
                {Object.entries(getFurnitureTypes(currentRoomSize.width, currentRoomSize.height))
                  .map(([type, info]) => (
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
                  {furniture.map(item => {
                    const furnitureTypes = getFurnitureTypes(currentRoomSize.width, currentRoomSize.height);
                    // doorタイプの家具は表示しない（廃止された機能）
                    if (item.type === 'door' as any) return null;
                    const furnitureType = furnitureTypes[item.type];
                    if (!furnitureType) return null;
                    
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
                        {furnitureType.label}
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
              {currentBeacons.length === 0 ? (
                <p style={{ color: '#7f8c8d', fontSize: '14px' }}>ビーコンが設定されていません</p>
              ) : (
                <div>
                  {currentBeacons.map(beacon => {
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
                          backgroundColor: '#FF9800', 
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
                <li>家具またはビーコン（オレンジの円）をドラッグで移動</li>
                <li>家具を一度クリックして選択すると角に赤い四角が表示されます</li>
                <li>赤い四角をドラッグすると家具のサイズ変更ができます</li>
                <li>ビーコンはサイズ変更できません</li>
                <li>グリッド1マス = 0.1単位（正規化座標）</li>
              </ul>
            </div>
          </div>

          {/* 右側: マップ */}
          <div className="card" style={{ flex: 1 }}>
            <h3 style={{ marginBottom: '16px' }}>
              {roomName || TEST_ROOM.name} (
              {roomWidth && roomHeight 
                ? `${currentRoomSize.width.toFixed(1)}m × ${currentRoomSize.height.toFixed(1)}m`
                : `${currentRoomSize.width.toFixed(1)} × ${currentRoomSize.height.toFixed(1)}`
              })
            </h3>
            <canvas
              ref={canvasRef}
              style={{
                border: '2px solid #E1E8ED',
                borderRadius: '8px',
                cursor: isDragging ? 'grabbing' : selectedFurniture ? 'move' : 'pointer'
              }}
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
                  const furnitureType = selectedItem ? furnitureTypes[selectedItem.type] : null;
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

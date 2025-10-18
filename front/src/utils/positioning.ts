import { CalibrationPoint } from '../types';

/**
 * RSSI値から距離を推定（対数距離減衰モデル）
 * @param rssi 受信信号強度
 * @param txPower 送信電力（通常-59dBm）
 * @param n 環境係数（2-4、室内は通常3程度）
 */
export function rssiToDistance(rssi: number, txPower: number = -59, n: number = 3): number {
  if (rssi === 0) {
    return -1; // 無効な値
  }
  const ratio = (txPower - rssi) / (10 * n);
  return Math.pow(10, ratio);
}

/**
 * Fingerprinting法による位置推定
 * キャリブレーションデータとの類似度から位置を推定
 */
export function estimatePositionByFingerprinting(
  currentRssi: { [beaconMac: string]: number },
  calibrationPoints: CalibrationPoint[]
): { x: number; y: number; confidence: number } | null {
  if (calibrationPoints.length === 0) {
    return null;
  }

  // 各キャリブレーションポイントとの類似度を計算（ユークリッド距離の逆数）
  const similarities = calibrationPoints.map(point => {
    // 最新の測定値を使用
    if (point.measurements.length === 0) {
      return { point, similarity: 0 };
    }
    
    const latestMeasurement = point.measurements[point.measurements.length - 1];
    const rssiValues = latestMeasurement.rssiValues;
    
    // ユークリッド距離を計算
    let sumSquaredDiff = 0;
    let count = 0;
    
    for (const [mac, currentValue] of Object.entries(currentRssi)) {
      if (rssiValues[mac] !== undefined) {
        sumSquaredDiff += Math.pow(currentValue - rssiValues[mac], 2);
        count++;
      }
    }
    
    if (count === 0) {
      return { point, similarity: 0 };
    }
    
    const euclideanDistance = Math.sqrt(sumSquaredDiff / count);
    const similarity = 1 / (1 + euclideanDistance);
    
    return { point, similarity };
  });

  // 類似度でソート
  similarities.sort((a, b) => b.similarity - a.similarity);

  // 上位3つの点で重み付け平均（k-NN法、k=3）
  const k = Math.min(3, similarities.length);
  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let i = 0; i < k; i++) {
    const { point, similarity } = similarities[i];
    weightedX += point.position.x * similarity;
    weightedY += point.position.y * similarity;
    totalWeight += similarity;
  }

  if (totalWeight === 0) {
    return null;
  }

  return {
    x: weightedX / totalWeight,
    y: weightedY / totalWeight,
    confidence: similarities[0].similarity // 最も類似したポイントの類似度を信頼度とする
  };
}

/**
 * 三辺測量による位置推定
 * 3つのビーコンからの距離を使って位置を推定
 */
export function estimatePositionByTrilateration(
  beaconPositions: Array<{ x: number; y: number; mac: string }>,
  rssiValues: { [beaconMac: string]: number },
  txPower: number = -59
): { x: number; y: number } | null {
  // 3つ以上のビーコンが必要
  const validBeacons = beaconPositions.filter(b => rssiValues[b.mac] !== undefined);
  
  if (validBeacons.length < 3) {
    return null;
  }

  // 距離を計算
  const distances = validBeacons.map(beacon => ({
    ...beacon,
    distance: rssiToDistance(rssiValues[beacon.mac], txPower)
  }));

  // 最初の3つのビーコンを使用
  const [b1, b2, b3] = distances.slice(0, 3);

  // TODO: 実際の三辺測量のアルゴリズムを実装
  // 現在は簡易的な重み付け平均を使用
  const totalWeight = 1/b1.distance + 1/b2.distance + 1/b3.distance;
  
  const x = (b1.x / b1.distance + b2.x / b2.distance + b3.x / b3.distance) / totalWeight;
  const y = (b1.y / b1.distance + b2.y / b2.distance + b3.y / b3.distance) / totalWeight;

  return { x, y };
}

/**
 * 2点間の距離を計算（メートル）
 */
export function calculateDistance(
  point1: { x: number; y: number },
  point2: { x: number; y: number }
): number {
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * GPS座標間の距離を計算（メートル）- Haversine formula
 */
export function calculateGPSDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // 地球の半径（メートル）
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // メートル単位の距離
}

/**
 * 部屋の境界内にいるかチェック
 */
export function isInsideRoom(
  position: { x: number; y: number },
  roomBounds: { width: number; height: number },
  margin: number = 0.5 // メートル
): boolean {
  return (
    position.x >= -margin &&
    position.x <= roomBounds.width + margin &&
    position.y >= -margin &&
    position.y <= roomBounds.height + margin
  );
}

/**
 * RSSIの値を正規化してスムージング
 */
export function smoothRSSI(values: number[], windowSize: number = 3): number {
  if (values.length === 0) return 0;
  if (values.length < windowSize) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  
  const recentValues = values.slice(-windowSize);
  return recentValues.reduce((a, b) => a + b, 0) / windowSize;
}

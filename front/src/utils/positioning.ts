import { CalibrationPoint } from '../types';

//テスト用家具データ
export const FURNITURE_TYPES = {
  desk: { label: '机', width: 2, height: 1, color: '#8B4513' },
  tv: { label: 'テレビ', width: 3, height: 0.5, color: '#2C3E50' },
  piano: { label: 'ピアノ', width: 2, height: 1.5, color: '#1A1A1A' },
  chair: { label: '椅子', width: 0.8, height: 0.8, color: '#CD853F' },
  door: { label: 'ドア', width: 1, height: 0.2, color: '#D2691E' }
} as const;

export type FurnitureType = keyof typeof FURNITURE_TYPES;

/**
 * RSSI値から距離を推定（対数距離減衰モデル）
 * @param rssi 受信信号強度
 * @param referenceRssi RSSI@1mの参照値（通常-59dBm）
 * @param n 環境係数（2-4、室内は通常3程度）
 */
export function rssiToDistance(rssi: number, referenceRssi: number = -59, n: number = 3): number {
  if (rssi === 0) {
    return -1; // 無効な値
  }
  const ratio = (referenceRssi - rssi) / (10 * n);
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
 * 三辺測量による位置推定（非線形最小二乗法）
 * 3つのビーコンからの距離を使って位置を推定
 */
export function estimatePositionByTrilateration(
  beaconPositions: Array<{ x: number; y: number; mac: string }>,
  rssiValues: { [beaconMac: string]: number },
  referenceRssi: number = -59
): { x: number; y: number; confidence: number } | null {
  // 3つ以上のビーコンが必要
  const validBeacons = beaconPositions.filter(b => rssiValues[b.mac] !== undefined);
  
  if (validBeacons.length < 3) {
    return null;
  }

  // 距離を計算
  const distances = validBeacons.map(beacon => ({
    ...beacon,
    distance: rssiToDistance(rssiValues[beacon.mac], referenceRssi)
  }));

  // 最初の3つのビーコンを使用して初期位置を推定（重心）
  const [b1, b2, b3] = distances.slice(0, 3);
  let x = (b1.x + b2.x + b3.x) / 3;
  let y = (b1.y + b2.y + b3.y) / 3;

  // 反復計算による位置の最適化（Gauss-Newton法の簡易版）
  const maxIterations = 10;
  const convergenceThreshold = 0.01; // 1cm

  for (let iter = 0; iter < maxIterations; iter++) {
    let sumDx = 0;
    let sumDy = 0;
    let sumWeight = 0;

    for (const beacon of distances) {
      // 現在の推定位置からビーコンまでの距離
      const dx = x - beacon.x;
      const dy = y - beacon.y;
      const estimatedDistance = Math.sqrt(dx * dx + dy * dy);

      if (estimatedDistance === 0) continue;

      // 推定距離と実測距離の差
      const error = estimatedDistance - beacon.distance;
      
      // 重み（距離が近いほど信頼性が高い）
      const weight = 1 / (beacon.distance + 1);

      // 勾配を計算
      const gradX = (dx / estimatedDistance) * error * weight;
      const gradY = (dy / estimatedDistance) * error * weight;

      sumDx += gradX;
      sumDy += gradY;
      sumWeight += weight;
    }

    if (sumWeight === 0) break;

    // 位置を更新（学習率0.5）
    const learningRate = 0.5;
    const deltaX = -(sumDx / sumWeight) * learningRate;
    const deltaY = -(sumDy / sumWeight) * learningRate;

    x += deltaX;
    y += deltaY;

    // 収束判定
    const movement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (movement < convergenceThreshold) {
      break;
    }
  }

  // 信頼度を計算
  const confidence = calculateTrilaterationConfidence(
    { x, y },
    rssiValues,
    distances
  );

  return { x, y, confidence };
}

/**
 * 三辺測量の信頼度を計算
 */
function calculateTrilaterationConfidence(
  position: { x: number; y: number },
  rssiValues: { [beaconMac: string]: number },
  beaconDistances: Array<{ x: number; y: number; distance: number; mac: string }>
): number {
  // 平均RSSI値（信号強度）
  const rssiList = Object.values(rssiValues);
  const avgRssi = rssiList.reduce((a, b) => a + b, 0) / rssiList.length;
  
  // RSSI値が強いほど信頼度が高い（-40dBm～-100dBm）
  const rssiConfidence = Math.max(0, Math.min(1, (-40 - avgRssi) / 60));
  
  // ビーコン数が多いほど信頼度が高い
  const beaconCountConfidence = Math.min(1, rssiList.length / 3);
  
  // 推定位置と実測距離の一貫性をチェック
  let consistencyError = 0;
  for (const beacon of beaconDistances) {
    const dx = position.x - beacon.x;
    const dy = position.y - beacon.y;
    const estimatedDistance = Math.sqrt(dx * dx + dy * dy);
    const error = Math.abs(estimatedDistance - beacon.distance);
    consistencyError += error;
  }
  const avgError = consistencyError / beaconDistances.length;
  const consistencyConfidence = Math.max(0, 1 - avgError / 5); // 5m以上のエラーで0
  
  // 総合的な信頼度（重み付け平均）
  return (
    rssiConfidence * 0.3 +
    beaconCountConfidence * 0.3 +
    consistencyConfidence * 0.4
  );
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

/**
 * ハイブリッド位置推定（Fingerprinting法のみ使用）
 * 指紋法によるキャリブレーションデータベースの位置推定
 */
export function estimatePositionHybrid(
  currentRssi: { [beaconId: string]: number },
  calibrationPoints: CalibrationPoint[],
  beaconPositions?: Array<{ x: number; y: number; mac: string; beaconId: string }>,
  referenceRssi: number = -59
): { x: number; y: number; confidence: number; method: string } | null {
  
  // Fingerprinting法で推定
  const fingerprintResult = estimatePositionByFingerprinting(
    currentRssi, 
    calibrationPoints
  );
  
  // Fingerprintingの結果を返す
  if (fingerprintResult) {
    return { 
      ...fingerprintResult, 
      method: 'Fingerprinting' 
    };
  }
  
  return null;
}

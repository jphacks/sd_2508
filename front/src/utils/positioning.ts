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
 */
export function rssiToDistance(rssi: number, referenceRssi: number = -59, n: number = 3): number {
  if (rssi === 0) {
    return -1;
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

  const normalizeMac = (mac: string) => mac.toUpperCase().replace(/:/g, '');
<<<<<<< HEAD
  const MISSING_SIGNAL_LEVEL = -100; // 未検出ビーコンの補完値
  const SIMILARITY_DECAY = 0.15; // 類似度計算時の距離スケール調整係数
=======
  const MISSING_SIGNAL_LEVEL = -100;
  const SIMILARITY_DECAY = 0.15;

  console.log('Fingerprinting開始:', {
    currentRssiKeys: Object.keys(currentRssi),
    calibrationPointsCount: calibrationPoints.length
  });
>>>>>>> taichi

  // 現在のRSSIを正規化済みのキーへ揃える
  const normalizedCurrent: { [beaconMac: string]: number } = {};
  Object.entries(currentRssi).forEach(([mac, value]) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return;
    }
    normalizedCurrent[normalizeMac(mac)] = value;
  });

<<<<<<< HEAD
=======
  console.log('🔍 正規化された現在RSSI:', normalizedCurrent);

>>>>>>> taichi
  const beaconSet = new Set<string>();
  Object.keys(normalizedCurrent).forEach(mac => beaconSet.add(mac));

  // キャリブレーション点ごとに測定値を平均化
  const processedPoints = calibrationPoints
    .map(point => {
      const aggregates = new Map<string, { sum: number; count: number }>();

<<<<<<< HEAD
      point.measurements.forEach(measurement => {
        if (!measurement?.rssiValues) {
          return;
        }

        Object.entries(measurement.rssiValues).forEach(([mac, value]) => {
          if (typeof value !== 'number' || Number.isNaN(value)) {
            return;
          }
          const normalizedMac = normalizeMac(mac);
          const stats = aggregates.get(normalizedMac) || { sum: 0, count: 0 };
          stats.sum += value;
          stats.count += 1;
          aggregates.set(normalizedMac, stats);
        });
      });

      if (aggregates.size === 0) {
        return null;
      }

      const averagedRssi: { [mac: string]: number } = {};
      aggregates.forEach((stats, mac) => {
        averagedRssi[mac] = stats.sum / Math.max(stats.count, 1);
        beaconSet.add(mac);
      });

=======
      console.log(`🔍 CalibrationPoint処理: ${point.label}`, {
        measurementsCount: point.measurements?.length || 0,
        position: point.position
      });

      if (!point.measurements || point.measurements.length === 0) {
        console.warn(`⚠️ ${point.label}: 測定データがありません`);
        return null;
      }

      point.measurements.forEach(measurement => {
        if (!measurement?.rssiValues) {
          return;
        }

        Object.entries(measurement.rssiValues).forEach(([mac, value]) => {
          if (typeof value !== 'number' || Number.isNaN(value)) {
            return;
          }
          const normalizedMac = normalizeMac(mac);
          const stats = aggregates.get(normalizedMac) || { sum: 0, count: 0 };
          stats.sum += value;
          stats.count += 1;
          aggregates.set(normalizedMac, stats);
          beaconSet.add(normalizedMac);
        });
      });

      if (aggregates.size === 0) {
        console.warn(`⚠️ ${point.label}: 有効なRSSIデータがありません`);
        return null;
      }

      const averagedRssi: { [mac: string]: number } = {};
      aggregates.forEach((stats, mac) => {
        averagedRssi[mac] = stats.sum / Math.max(stats.count, 1);
      });

      console.log(`✅ ${point.label}: 平均RSSI`, averagedRssi);
>>>>>>> taichi
      return { point, averagedRssi };
    })
    .filter((item): item is { point: CalibrationPoint; averagedRssi: { [mac: string]: number } } => item !== null);

  if (processedPoints.length === 0) {
<<<<<<< HEAD
=======
    console.warn('⚠️ 有効なCalibrationPointsがありません');
>>>>>>> taichi
    return null;
  }

  const beaconKeys = Array.from(beaconSet);
  if (beaconKeys.length === 0) {
<<<<<<< HEAD
    return null;
  }

  // 類似度の計算
  // 各キャリブレーションポイントとの類似度を計算（ユークリッド距離の逆数）
=======
    console.warn('⚠️ 共通ビーコンがありません');
    return null;
  }

  console.log('🔍 使用可能ビーコン:', beaconKeys);

  // 類似度の計算
>>>>>>> taichi
  const similarities = processedPoints.map(({ point, averagedRssi }) => {
    let sumSquaredDiff = 0;
    const featureCount = beaconKeys.length;

    beaconKeys.forEach(mac => {
      const currentValue = normalizedCurrent[mac] ?? MISSING_SIGNAL_LEVEL;
      const calibrationValue = averagedRssi[mac] ?? MISSING_SIGNAL_LEVEL;
      const diff = currentValue - calibrationValue;
      sumSquaredDiff += diff * diff;
    });

    if (featureCount === 0) {
      return { point, similarity: 0 };
    }

<<<<<<< HEAD
    // 平均二乗誤差 (RMS) を距離とする
    const euclideanDistance = Math.sqrt(sumSquaredDiff / featureCount);

    // 距離を指数関数で類似度に変換（スケール調整済み）
    const similarity = Math.exp(-SIMILARITY_DECAY * euclideanDistance);

=======
    const euclideanDistance = Math.sqrt(sumSquaredDiff / featureCount);
    const similarity = Math.exp(-SIMILARITY_DECAY * euclideanDistance);

    console.log(`🔍 ${point.label}: 類似度計算`, {
      euclideanDistance: euclideanDistance.toFixed(2),
      similarity: similarity.toFixed(4)
    });

>>>>>>> taichi
    return { point, similarity };
  });

  // 類似度でソート
  similarities.sort((a, b) => b.similarity - a.similarity);

  console.log('🔍 類似度順位:', similarities.map(s => ({
    label: s.point.label,
    similarity: s.similarity.toFixed(4),
    position: s.point.position
  })));

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
    console.warn('⚠️ 総重みが0です');
    return null;
  }

  const result = {
    x: weightedX / totalWeight,
    y: weightedY / totalWeight,
    confidence: similarities[0].similarity
  };

  console.log('✅ Fingerprinting結果:', result);
  return result;
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
 */
export function estimatePositionHybrid(
  currentRssi: { [beaconId: string]: number },
  calibrationPoints: CalibrationPoint[],
  beaconPositions?: Array<{ x: number; y: number; mac: string; beaconId: string }>,
  referenceRssi: number = -59
): { x: number; y: number; confidence: number; method: string } | null {
  
  console.log('🧮 ハイブリッド位置推定開始:', {
    currentRssiKeys: Object.keys(currentRssi),
    calibrationPointsCount: calibrationPoints.length
  });

  // 🔥 重要: beaconIdをMACアドレスに変換
  const macBasedRssi: { [mac: string]: number } = {};
  
  Object.entries(currentRssi).forEach(([beaconId, rssi]) => {
    // beaconIdからMACアドレスを取得する必要がある
    // これはMode1Indoorで適切に変換されているか確認が必要
    console.log(`🔍 RSSI変換: ${beaconId} -> RSSI: ${rssi}`);
    macBasedRssi[beaconId] = rssi; // 一時的にbeaconIdをそのまま使用
  });

  const fingerprintResult = estimatePositionByFingerprinting(
    macBasedRssi, 
    calibrationPoints
  );
  
  if (fingerprintResult) {
    return { 
      ...fingerprintResult, 
      method: 'Fingerprinting' 
    };
  }
  
  console.warn('⚠️ Fingerprinting推定失敗');
  return null;
}

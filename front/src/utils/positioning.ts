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
  const MISSING_SIGNAL_LEVEL = -100; // 未検出ビーコンの補完値
  const SIMILARITY_DECAY = 0.15; // 類似度計算時の距離スケール調整係数

  // 現在のRSSIを正規化済みのキーへ揃える
  const normalizedCurrent: { [beaconMac: string]: number } = {};
  Object.entries(currentRssi).forEach(([mac, value]) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return;
    }
    normalizedCurrent[normalizeMac(mac)] = value;
  });

  const beaconSet = new Set<string>();
  Object.keys(normalizedCurrent).forEach(mac => beaconSet.add(mac));

  // キャリブレーション点ごとに測定値を平均化
  const processedPoints = calibrationPoints
    .map(point => {
      const aggregates = new Map<string, { sum: number; count: number }>();

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

      return { point, averagedRssi };
    })
    .filter((item): item is { point: CalibrationPoint; averagedRssi: { [mac: string]: number } } => item !== null);

  if (processedPoints.length === 0) {
    return null;
  }

  const beaconKeys = Array.from(beaconSet);
  if (beaconKeys.length === 0) {
    return null;
  }

  // 類似度の計算
  // 各キャリブレーションポイントとの類似度を計算（ユークリッド距離の逆数）
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

    // 平均二乗誤差 (RMS) を距離とする
    const euclideanDistance = Math.sqrt(sumSquaredDiff / featureCount);

    // 距離を指数関数で類似度に変換（スケール調整済み）
    const similarity = Math.exp(-SIMILARITY_DECAY * euclideanDistance);

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
    console.warn('⚠️ 総重みが0です');
    return null;
  }

  const result = {
    x: weightedX / totalWeight,
    y: weightedY / totalWeight,
    confidence: similarities[0].similarity
  };

  return result;
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
 * ハイブリッド位置推定（指紋法のみ使用）
 */
export function estimatePositionHybrid(
  currentRssi: { [beaconId: string]: number },
  calibrationPoints: CalibrationPoint[]
): { x: number; y: number; confidence: number; method: string } | null {
  
  // 🔥 重要: beaconIdをMACアドレスに変換
  const macBasedRssi: { [mac: string]: number } = {};
  
  Object.entries(currentRssi).forEach(([beaconId, rssi]) => {
    // beaconIdからMACアドレスを取得する必要がある
    // これはMode1Indoorで適切に変換されているか確認が必要
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

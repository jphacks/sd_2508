import { useEffect, useState, useRef, useMemo } from "react";
import { ref, onValue } from "firebase/database";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { useLocation } from "react-router-dom";
import { rtdb, db } from "../firebase";
import { Device, BLEScan, RoomProfile, Alert, Beacon } from "../types";
import { estimatePositionHybrid } from "../utils/positioning";

// ビーコン受信ログの型定義
interface BeaconLog {
  id: string;
  timestamp: string;
  deviceId: string;
  deviceName: string;
  missingBeacons: Array<{
    beaconId: string;
    beaconName: string;
    mac: string;
  }>;
  receivedBeacons: Array<{
    beaconId: string;
    beaconName: string;
    mac: string;
    rssi: number;
  }>;
}

const FURNITURE_TYPES = {
  desk: { label: "机", width: 2, height: 1, color: "#8B4513" },
  tv: { label: "テレビ", width: 3, height: 0.5, color: "#2C3E50" },
  piano: { label: "ピアノ", width: 2, height: 1.5, color: "#1A1A1A" },
  chair: { label: "椅子", width: 0.8, height: 0.8, color: "#CD853F" },
  door: { label: "ドア", width: 1, height: 0.2, color: "#D2691E" },
} as const;

export default function Mode1Indoor() {
  const location = useLocation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [beacons, setBeacons] = useState<(Beacon & { firestoreId: string })[]>([]);
  const [roomProfile, setRoomProfile] = useState<RoomProfile | null>(null);
  const [devicePositions, setDevicePositions] = useState<
    Map<string, { x: number; y: number }>
  >(new Map());
  const [deviceTimestamps, setDeviceTimestamps] = useState<Map<string, string>>(
    new Map()
  );
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [beaconLogs, setBeaconLogs] = useState<BeaconLog[]>([]);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [showRssiOverlay, setShowRssiOverlay] = useState(false);
  const beaconNameMap = useMemo(() => {
    const map = new Map<string, { name: string; firestoreId: string }>();
    beacons.forEach((beacon) => {
      if (!beacon.mac) {
        return;
      }
      const normalizedMac = beacon.mac.toUpperCase().replace(/:/g, "");
      map.set(normalizedMac, {
        name: beacon.name || beacon.beaconId || normalizedMac,
        firestoreId: beacon.firestoreId,
      });
    });
    return map;
  }, [beacons]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setShowRssiOverlay(params.has("rssi"));
  }, [location.search]);

  const loadData = async () => {
    try {
      // TODO: 実際のユーザーIDを使用
      const userId = "demo-user";

      // デバイス一覧を取得
      const devicesSnapshot = await getDocs(collection(db, "devices"));
      const devicesData = devicesSnapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
          } as Device & { id: string })
      );
      setDevices(devicesData);

      // アクティブな部屋プロファイルを取得
      const configSnapshot = await getDocs(collection(db, "appConfig"));
      const userConfig = configSnapshot.docs.find(
        (d) => d.data().userId === userId
      );

      let activeRoomId: string | null = null;
      if (userConfig && userConfig.data().mode1?.roomId) {
        activeRoomId = userConfig.data().mode1.roomId;
      }

      if (!activeRoomId) {
        // アクティブなルームが設定されていない場合、最新のルームを使用
        const roomsSnapshot = await getDocs(collection(db, "rooms"));
        if (roomsSnapshot.docs.length > 0) {
          const latestRoom = roomsSnapshot.docs.sort((a, b) => {
            const aTime = new Date(a.data().createdAt).getTime();
            const bTime = new Date(b.data().createdAt).getTime();
            return bTime - aTime;
          })[0];
          activeRoomId = latestRoom.id;
        }
      }

      if (activeRoomId) {
        const roomDoc = await getDoc(doc(db, "rooms", activeRoomId));
        if (roomDoc.exists()) {
          const roomData = {
            roomId: roomDoc.id,
            ...roomDoc.data(),
          } as RoomProfile;
          setRoomProfile(roomData);

          // ビーコン情報を取得（三辺測量用）
          const beaconsSnapshot = await getDocs(collection(db, "beacons"));
          const beaconsData = beaconsSnapshot.docs.map(
            (doc) =>
              ({
                firestoreId: doc.id,
                ...doc.data(),
              } as Beacon & { firestoreId: string })
          );
          setBeacons(beaconsData);

          // ルームで使用するビーコンの位置情報を構築
          const beaconPositions = roomData.beacons
            .map((beaconId) => {
              const beacon = beaconsData.find(
                (b) => b.firestoreId === beaconId
              );
              if (beacon && beacon.place) {
                return {
                  x: beacon.place.x,
                  y: beacon.place.y,
                  mac: beacon.mac,
                  beaconId: beaconId,
                };
              }
              return null;
            })
            .filter((b) => b !== null) as Array<{
            x: number;
            y: number;
            mac: string;
            beaconId: string;
          }>;

          // 各デバイスのBLEスキャンデータを監視
          devicesData.forEach((device) => {
            // デバイスIDを小文字に正規化（RTDBと一致させる）
            const normalizedDeviceId = device.devEUI.toLowerCase();
            if (!normalizedDeviceId) return;

            // ★ 転倒/ショック状態を最小購読: active === true ならアラートを追加、falseなら削除
            const shockRef = ref(
              rtdb,
              `devices/${normalizedDeviceId}/status/shock`
            );
            console.log("shockRef:", shockRef.toString());
            onValue(shockRef, (snap) => {
              const shock = snap.val(); // boolean expected: true / false
              const active = Boolean(shock);
              const alertId = `shock-${normalizedDeviceId}`;

              console.log("shock debug:", {
                devEUI: normalizedDeviceId,
                raw: shock,
                type: typeof shock,
              });

              if (shock) {
                const alert: Alert = {
                  id: alertId,
                  type: "shock",
                  message: `${
                    device.userName || device.deviceId
                  } に衝撃を検知！`,
                  deviceId: device.devEUI,
                  deviceName: device.userName,
                  timestamp: new Date().toISOString(),
                  dismissed: false,
                };
                // 同じIDがなければ追加
                setAlerts((prev) =>
                  prev.some((a) => a.id === alertId) ? prev : [...prev, alert]
                );
                // 音を鳴らす（任意）
                audioRef.current?.play().catch(() => {});
              } else {
                // false or データ無しなら消す
                setAlerts((prev) => prev.filter((a) => a.id !== alertId));
              }
            });

            const trackerRef = ref(rtdb, `devices/${normalizedDeviceId}`);

            console.log(`📍 Mode1: ${device.deviceId}の監視開始`, {
              devEUI: device.devEUI,
              normalized: normalizedDeviceId,
            });

            onValue(trackerRef, (snapshot) => {
              const data = snapshot.val();
              if (data && data.beacons && roomData) {
                console.log(`📡 ${device.deviceId}のRTDB更新:`, {
                  timestamp: data.beaconsUpdatedAt,
                  beaconsCount: data.beacons.length,
                });

                // タイムスタンプを保存
                if (data.beaconsUpdatedAt) {
                  setDeviceTimestamps((prev) => {
                    const newMap = new Map(prev);
                    newMap.set(device.devEUI, data.beaconsUpdatedAt);
                    return newMap;
                  });
                }

                // 各ビーコンからRSSI値を取得（無効な信号をフィルタリング）
                const rssiMap: { [beaconId: string]: number } = {};
                const receivedBeacons: Array<{
                  beaconId: string;
                  beaconName: string;
                  mac: string;
                  rssi: number;
                }> = [];
                const missingBeacons: Array<{
                  beaconId: string;
                  beaconName: string;
                  mac: string;
                }> = [];

                // ルームで使用するビーコンのリストを取得
                const expectedBeacons = roomData.beacons
                  .map((beaconId) => {
                    const beacon = beacons.find(
                      (b) => b.firestoreId === beaconId
                    );
                    if (beacon) {
                      return {
                        beaconId: beacon.firestoreId,
                        beaconName: beacon.name || beacon.beaconId,
                        mac: beacon.mac.toUpperCase().replace(/:/g, ""),
                      };
                    }
                    return null;
                  })
                  .filter((b) => b !== null) as Array<{
                  beaconId: string;
                  beaconName: string;
                  mac: string;
                }>;

                data.beacons.forEach((beacon: any) => {
                  if (beacon.mac && beacon.rssi) {
                    // MACアドレスを正規化（コロン区切りを大文字に統一）
                    const normalizedMac = beacon.mac
                      .toUpperCase()
                      .replace(/:/g, "");

                    // 無効な信号をフィルタリング（MAC: ff:ff:ff:ff:ff:ff, RSSI: -1）
                    const isInvalidSignal =
                      normalizedMac === "FFFFFFFFFFFF" || beacon.rssi === -1;

                    if (!isInvalidSignal) {
                      rssiMap[normalizedMac] = beacon.rssi;

                      // 受信したビーコンをログに記録
                      const beaconInfo = expectedBeacons.find(
                        (b) => b.mac === normalizedMac
                      );
                      if (beaconInfo) {
                        receivedBeacons.push({
                          ...beaconInfo,
                          rssi: beacon.rssi,
                        });
                      }
                    }
                  }
                });

                // 受信できなかったビーコンを特定
                expectedBeacons.forEach((expectedBeacon) => {
                  if (!rssiMap[expectedBeacon.mac]) {
                    missingBeacons.push(expectedBeacon);
                  }
                });

                // ログを記録（受信できなかったビーコンがある場合のみ）
                if (missingBeacons.length > 0) {
                  const logEntry: BeaconLog = {
                    id: `${device.devEUI}-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    deviceId: device.devEUI,
                    deviceName: device.userName || device.deviceId,
                    missingBeacons,
                    receivedBeacons,
                  };

                  setBeaconLogs((prev) => {
                    // 最新100件まで保持
                    const newLogs = [logEntry, ...prev].slice(0, 100);
                    return newLogs;
                  });

                  console.log(
                    `⚠️ ${device.deviceId} ビーコン受信状況:`,
                    {
                      received: receivedBeacons.length,
                      missing: missingBeacons.length,
                      missingBeacons: missingBeacons.map((b) => b.beaconName),
                    }
                  );
                }

                console.log(`📊 ${device.deviceId}のRSSI値:`, rssiMap);

                const doorBeaconIds: string[] = [];
                if (
                  Array.isArray((roomData as any).doorBeaconIds) &&
                  (roomData as any).doorBeaconIds.length > 0
                ) {
                  doorBeaconIds.push(...(roomData as any).doorBeaconIds);
                } else if (roomData.doorBeaconId) {
                  doorBeaconIds.push(roomData.doorBeaconId);
                }

                const doorBeaconEntries = doorBeaconIds
                  .map((id) => {
                    const beacon = beacons.find((b) => b.firestoreId === id);
                    if (!beacon?.mac) {
                      return null;
                    }
                    return {
                      id,
                      name: beacon.name || beacon.beaconId || id,
                      mac: beacon.mac.toUpperCase().replace(/:/g, ""),
                    };
                  })
                  .filter(
                    (
                      entry
                    ): entry is { id: string; name?: string; mac: string } =>
                      entry !== null
                  );

                let shouldForceOutside = false;
                let exitReason: "door_beacon" | "fallback_rssi" | null = null;
                let doorCheckDebug: any = null;
                let fallbackCheckDebug: any = null;

                if (doorBeaconEntries.length > 0) {
                  const doorIdsSet = new Set(
                    doorBeaconEntries.map((entry) => entry.id)
                  );
                  const doorRssiDetails = doorBeaconEntries.map((entry) => ({
                    ...entry,
                    rssi: rssiMap[entry.mac],
                  }));
                  const availableDoorRssi = doorRssiDetails.filter(
                    (
                      detail
                    ): detail is typeof detail & {
                      rssi: number;
                    } => typeof detail.rssi === "number"
                  );
                  const DOOR_RSSI_THRESHOLD = -80;
                  const averageDoorRssi =
                    availableDoorRssi.length > 0
                      ? availableDoorRssi.reduce(
                          (sum, detail) => sum + detail.rssi,
                          0
                        ) / availableDoorRssi.length
                      : null;
                  const hasOtherBeaconSignal = receivedBeacons.some(
                    (b) => !doorIdsSet.has(b.beaconId)
                  );
                  const allDoorBeaconsMissing = availableDoorRssi.length === 0;

                  const forcedByWeakSignal =
                    averageDoorRssi !== null &&
                    averageDoorRssi < DOOR_RSSI_THRESHOLD;
                  const forcedByMissingDoor =
                    allDoorBeaconsMissing && hasOtherBeaconSignal;

                  shouldForceOutside = forcedByWeakSignal || forcedByMissingDoor;
                  if (shouldForceOutside) {
                    exitReason = "door_beacon";
                  }

                  doorCheckDebug = {
                    doorBeacons: doorRssiDetails.map((detail) => ({
                      id: detail.id,
                      mac: detail.mac,
                      rssi: detail.rssi ?? null,
                    })),
                    averageDoorRssi,
                    threshold: DOOR_RSSI_THRESHOLD,
                    forcedByWeakSignal,
                    forcedByMissingDoor,
                    hasOtherBeaconSignal,
                  };

                  console.log(
                    `🚪 ${device.deviceId} ドアビーコンRSSIチェック:`,
                    doorCheckDebug
                  );
                } else {
                  const fallbackBeaconMacs = expectedBeacons
                    .slice(0, 2)
                    .map((beacon) => beacon.mac);

                  if (fallbackBeaconMacs.length > 0) {
                    const RSSI_THRESHOLD_PER_BEACON = -80;
                    const fallbackRssiSum = fallbackBeaconMacs.reduce(
                      (sum, mac) => sum + (rssiMap[mac] ?? 0),
                      0
                    );
                    const fallbackThreshold =
                      RSSI_THRESHOLD_PER_BEACON * fallbackBeaconMacs.length;

                    fallbackCheckDebug = {
                      beaconMacs: fallbackBeaconMacs,
                      rssiSum: fallbackRssiSum,
                      threshold: fallbackThreshold,
                    };

                    console.log(
                      `📡 ${device.deviceId} RSSI閾値チェック（フォールバック）:`,
                      fallbackCheckDebug
                    );

                    if (fallbackRssiSum < fallbackThreshold) {
                      shouldForceOutside = true;
                      exitReason = "fallback_rssi";
                    }
                  }
                }

                // RSSIによる退室判定が成立した場合に退室処理を実行
                if (shouldForceOutside) {
                  // ドアの外側位置を取得
                  const doorOutside = roomData.calibrationPoints.find(
                    (p) => p.id === "door_outside"
                  );
                  const doorInside = roomData.calibrationPoints.find(
                    (p) => p.id === "door_inside"
                  );

                  if (doorOutside && doorInside) {
                    // ドアの中心位置を計算（描画時と同じ）
                    const doorCenterX = (doorInside.position.x + doorOutside.position.x) / 2;
                    const doorCenterY = (doorInside.position.y + doorOutside.position.y) / 2;
                    
                    // ドアの向きベクトルを計算（内側→外側）
                    const doorVectorX = doorOutside.position.x - doorInside.position.x;
                    const doorVectorY = doorOutside.position.y - doorInside.position.y;
                    const doorVectorLength = Math.sqrt(doorVectorX * doorVectorX + doorVectorY * doorVectorY);
                    
                    // 正規化したベクトル
                    const normalizedVectorX = doorVectorX / doorVectorLength;
                    const normalizedVectorY = doorVectorY / doorVectorLength;
                    
                    // ドアの中心からメートル単位に変換
                    const outlineWidth = roomData.outline?.width ?? 1;
                    const outlineHeight = roomData.outline?.height ?? 1;
                    const doorCenterMeterX = doorCenterX * outlineWidth;
                    const doorCenterMeterY = doorCenterY * outlineHeight;
                    
                    // 退室スペースの距離（ドア中心から1.5m外側）
                    const exitSpaceDistance = 1.5;
                    
                    // 複数のデバイスが退室した場合の分散配置
                    const exitDevices = Array.from(devicePositions.entries()).filter(([devEUI, pos]) => {
                      const margin = 0.5;
                      return !(
                        pos.x >= -margin &&
                        pos.x <= outlineWidth + margin &&
                        pos.y >= -margin &&
                        pos.y <= outlineHeight + margin
                      );
                    });
                    
                    // 現在のデバイスのインデックスを取得
                    const deviceIndex = exitDevices.findIndex(([devEUI]) => devEUI === device.devEUI);
                    const actualIndex = deviceIndex >= 0 ? deviceIndex : exitDevices.length;
                    
                    // 横方向のオフセット（-0.5m から 0.5m の範囲で分散）
                    const lateralOffset = (actualIndex % 5 - 2) * 0.3; // 最大5人まで横に並べる
                    const depthOffset = Math.floor(actualIndex / 5) * 0.3; // 5人を超えたら奥行き方向にも配置
                    
                    // 退室スペースの位置を計算（ドア中心を基準に）
                    const outsidePosition = {
                      x: doorCenterMeterX + normalizedVectorX * (exitSpaceDistance + depthOffset) - normalizedVectorY * lateralOffset,
                      y: doorCenterMeterY + normalizedVectorY * (exitSpaceDistance + depthOffset) + normalizedVectorX * lateralOffset
                    };

                    console.log(`🚪 ${device.deviceId} 部屋外判定（RSSI閾値）:`, {
                      reason: exitReason,
                      doorCheck: doorCheckDebug,
                      fallbackCheck: fallbackCheckDebug,
                      doorCenterPosition: { x: doorCenterMeterX, y: doorCenterMeterY },
                      exitPosition: outsidePosition,
                      exitDevicesCount: exitDevices.length
                    });

                    // 退室スペースの位置に配置
                    setDevicePositions((prev) => {
                      const newMap = new Map(prev);
                      newMap.set(device.devEUI, outsidePosition);
                      return newMap;
                    });

                    // 部屋外アラートを発報
                    checkRoomExit(device, outsidePosition, roomData, true);
                  }
                } else {
                  // RSSI閾値を上回っている場合、通常の位置推定を実行
                  const position = estimatePositionHybrid(
                    rssiMap,
                    roomData.calibrationPoints,
                    beaconPositions.length >= 3 ? beaconPositions : undefined
                  );

                  if (position) {
                    console.log(`📍 ${device.deviceId} 位置推定結果:`, {
                      normalizedPosition: { x: position.x.toFixed(3), y: position.y.toFixed(3) },
                      method: position.method,
                      confidence: `${(position.confidence * 100).toFixed(1)}%`,
                      rssiCount: Object.keys(rssiMap).length
                    });

                    const outlineWidth = roomData.outline?.width ?? 1;
                    const outlineHeight = roomData.outline?.height ?? 1;
                    const actualPosition = {
                      x: position.x * outlineWidth,
                      y: position.y * outlineHeight
                    };
                    console.log(`📍 ${device.deviceId} 実座標換算:`, {
                      position: { x: actualPosition.x.toFixed(2), y: actualPosition.y.toFixed(2) },
                      roomSize: { width: outlineWidth, height: outlineHeight }
                    });

                    setDevicePositions((prev) => {
                      const newMap = new Map(prev);
                      newMap.set(device.devEUI, actualPosition);
                      return newMap;
                    });

                    // 部屋の外に出たかチェック（通常判定）
                    checkRoomExit(device, actualPosition, roomData, false);

                    // デバッグ用にメソッド情報を表示（オプション）
                    console.log(
                      `${device.deviceId}: ${position.method} (信頼度: ${(
                        position.confidence * 100
                      ).toFixed(1)}%)`
                    );
                  }
                }
              }
            });
          });
        }
      }

      setLoading(false);
    } catch (error) {
      console.error("データ読み込みエラー:", error);
      setLoading(false);
    }
  };

  const checkRoomExit = (
    device: Device,
    position: { x: number; y: number },
    room: RoomProfile,
    forceOutside: boolean = false
  ) => {
    const margin = 0.5;
    const outlineWidth = room.outline?.width ?? 1;
    const outlineHeight = room.outline?.height ?? 1;
    const isInside = forceOutside ? false : (
      position.x >= -margin &&
      position.x <= outlineWidth + margin &&
      position.y >= -margin &&
      position.y <= outlineHeight + margin
    );

    console.log(`🔍 ${device.deviceId} 部屋チェック:`, {
      position: { x: position.x.toFixed(2), y: position.y.toFixed(2) },
      roomBounds: { 
        width: outlineWidth, 
        height: outlineHeight 
      },
      margin,
      isInside,
      forceOutside,
      checks: {
        xMin: position.x >= -margin,
        xMax: position.x <= outlineWidth + margin,
        yMin: position.y >= -margin,
        yMax: position.y <= outlineHeight + margin
      }
    });

    if (!isInside) {
      const alertId = `exit_room-${device.devEUI}`;
      const alert: Alert = {
        id: alertId,
        type: "exit_room",
        message: `${device.userName || device.deviceId} が部屋から出たようです！`,
        deviceId: device.devEUI,
        deviceName: device.userName,
        timestamp: new Date().toISOString(),
        dismissed: false,
      };

      let shouldScheduleCleanup = false;
      setAlerts((prev) => {
        if (prev.some((a) => a.id === alertId)) {
          return prev;
        }
        shouldScheduleCleanup = true;
        return [...prev, alert];
      });

      if (shouldScheduleCleanup) {
        if (audioRef.current) {
          audioRef.current.play();
        }

        // 5秒後に自動で消す
        setTimeout(() => {
          setAlerts((prev) => prev.filter((a) => a.id !== alertId));
        }, 5000);
      }
    }
  };

  const dismissAlert = (alertId: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffSecs = Math.floor((diffMs % 60000) / 1000);

      if (diffMins === 0) {
        return `${diffSecs}秒前`;
      } else if (diffMins < 60) {
        return `${diffMins}分前`;
      } else {
        const hours = Math.floor(diffMins / 60);
        if (hours < 24) {
          return `${hours}時間前`;
        } else {
          return date.toLocaleString("ja-JP", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
        }
      }
    } catch {
      return "不明";
    }
  };

  useEffect(() => {
    if (roomProfile && canvasRef.current) {
      drawRoom();
    }
  }, [roomProfile, devicePositions, showRssiOverlay]);

  const drawRoom = () => {
    const canvas = canvasRef.current;
    if (!canvas || !roomProfile) {
      console.log("Canvas or roomProfile not ready");
      return;
    }

    console.log("Drawing room...", {
      furniture: roomProfile.furniture?.length || 0,
      devices: devicePositions.size,
    });

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const roomWidth = roomProfile.outline?.width ?? 1;
    const roomHeight = roomProfile.outline?.height ?? 1;
    const exitSpaceDepth = 1.0; // 奥行き1m
    const exitSpaceWidth = 1.0; // 横幅1m

    // 退室スペースを含めた描画範囲を計算
    const exitSpaceMargin = exitSpaceDepth;
    const padding = 40;
    
    // ドアの位置から退室スペースの方向を計算
    const doorOutside = roomProfile.calibrationPoints?.find(p => p.id === "door_outside");
    const doorInside = roomProfile.calibrationPoints?.find(p => p.id === "door_inside");
    let totalWidth = roomWidth;
    let totalHeight = roomHeight;
    let offsetX = 0;
    let offsetY = 0;
    let doorInsideActual: { x: number; y: number } | null = null;
    let doorOutsideActual: { x: number; y: number } | null = null;
    let doorNormal: { x: number; y: number } | null = null;
    
    if (doorOutside && doorInside) {
      doorInsideActual = {
        x: doorInside.position.x * roomWidth,
        y: doorInside.position.y * roomHeight
      };
      doorOutsideActual = {
        x: doorOutside.position.x * roomWidth,
        y: doorOutside.position.y * roomHeight
      };

      // ドアの向きベクトル（実寸）
      const doorVectorX = doorOutsideActual.x - doorInsideActual.x;
      const doorVectorY = doorOutsideActual.y - doorInsideActual.y;
      const doorVectorLength = Math.hypot(doorVectorX, doorVectorY) || 1;
      doorNormal = {
        x: doorVectorX / doorVectorLength,
        y: doorVectorY / doorVectorLength
      };
      
      // 退室スペースの最大範囲を計算（実寸）
      const maxExitX = doorOutsideActual.x + doorNormal.x * exitSpaceMargin;
      const maxExitY = doorOutsideActual.y + doorNormal.y * exitSpaceMargin;
      const minExitX = doorOutsideActual.x - doorNormal.x * exitSpaceMargin;
      const minExitY = doorOutsideActual.y - doorNormal.y * exitSpaceMargin;
      
      // 全体の描画範囲を計算（実寸）
      const minX = Math.min(0, doorInsideActual.x, doorOutsideActual.x, minExitX, maxExitX);
      const minY = Math.min(0, doorInsideActual.y, doorOutsideActual.y, minExitY, maxExitY);
      const maxX = Math.max(roomWidth, doorInsideActual.x, doorOutsideActual.x, minExitX, maxExitX);
      const maxY = Math.max(roomHeight, doorInsideActual.y, doorOutsideActual.y, minExitY, maxExitY);
      
      totalWidth = maxX - minX;
      totalHeight = maxY - minY;
      offsetX = -minX;
      offsetY = -minY;
    }
    
    const width = canvas.width - padding * 2;
    const height = canvas.height - padding * 2;

    const scaleX = width / totalWidth;
    const scaleY = height / totalHeight;
    const scale = Math.min(scaleX, scaleY);
    
    // 実際に使用される描画領域の高さを計算
    const actualDrawHeight = totalHeight * scale + padding * 2;
    
    // キャンバスの親要素の高さを調整
    if (canvas.parentElement) {
      canvas.parentElement.style.height = `${actualDrawHeight}px`;
    }

    // クリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 背景
    ctx.fillStyle = "#f5f7fa";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 退室スペースの背景を描画（薄い赤色）
    if (doorInsideActual && doorOutsideActual && doorNormal) {
      ctx.fillStyle = "rgba(255, 107, 53, 0.1)";
      
      // ドアの中心位置を計算（ドアの描画と同じ位置）
      const doorCenterX = (doorInsideActual.x + doorOutsideActual.x) / 2;
      const doorCenterY = (doorInsideActual.y + doorOutsideActual.y) / 2;
      const doorThickness = 0.05;

      const exitX = (doorCenterX + offsetX) * scale + padding;
      const exitY = (doorCenterY + offsetY) * scale + padding;
      
      ctx.save();
      ctx.translate(exitX, exitY);
      const angle = Math.atan2(doorNormal.y, doorNormal.x);
      ctx.rotate(angle);
      
      ctx.fillRect(
        doorThickness * scale / 2,
        -exitSpaceWidth * scale / 2,
        exitSpaceDepth * scale,
        exitSpaceWidth * scale
      );
      ctx.restore();
      
      // 「退室スペース」ラベル
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#ff6b35";
      ctx.textAlign = "center";
      const labelDistance = (exitSpaceDepth / 2 + doorThickness / 2) * scale;
      ctx.fillText(
        "退室スペース",
        exitX + doorNormal.x * labelDistance,
        exitY + doorNormal.y * labelDistance
      );
    }

    // 部屋の輪郭
    ctx.strokeStyle = "#2c3e50";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      padding + offsetX * scale,
      padding + offsetY * scale,
      roomWidth * scale,
      roomHeight * scale
    );

    // グリッド線（最背面）
    ctx.strokeStyle = "#e1e8ed";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    for (let i = 1; i < roomWidth; i++) {
      const x = padding + (i + offsetX) * scale;
      ctx.beginPath();
      ctx.moveTo(x, padding + offsetY * scale);
      ctx.lineTo(x, padding + (roomHeight + offsetY) * scale);
      ctx.stroke();
    }
    for (let i = 1; i < roomHeight; i++) {
      const y = padding + (i + offsetY) * scale;
      ctx.beginPath();
      ctx.moveTo(padding + offsetX * scale, y);
      ctx.lineTo(padding + (roomWidth + offsetX) * scale, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 家具を描画（中間層）
    if (roomProfile.furniture && roomProfile.furniture.length > 0) {
      console.log('Drawing furniture:', roomProfile.furniture.length);
      roomProfile.furniture.forEach(furniture => {
        // ドアはキャリブレーション点から描画するため、家具の旧データはスキップ
        if (furniture.type === 'door' as any) {
          return;
        }
        const furnitureType = FURNITURE_TYPES[furniture.type as keyof typeof FURNITURE_TYPES];
        const furnitureColor = furnitureType?.color || '#95a5a6';
        
        ctx.fillStyle = furnitureColor;
        // 正規化座標（0-1）× ルームサイズ = 実際のメートル位置
        const furnitureX = furniture.position.x * roomWidth;
        const furnitureY = furniture.position.y * roomHeight;
        const furnitureW = furniture.width * roomWidth;
        const furnitureH = furniture.height * roomHeight;

        const x = padding + (furnitureX + offsetX) * scale;
        const y = padding + (furnitureY + offsetY) * scale;
        const w = furnitureW * scale;
        const h = furnitureH * scale;

        ctx.fillRect(x, y, w, h);

        // 家具の境界線
        ctx.strokeStyle = "#2c3e50";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        // ラベル
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.strokeStyle = "#2c3e50";
        ctx.lineWidth = 2;

        ctx.strokeText(
          furnitureType?.label || furniture.type,
          x + w / 2,
          y + h / 2 + 4
        );
        ctx.fillText(
          furnitureType?.label || furniture.type,
          x + w / 2,
          y + h / 2 + 4
        );
      });
    }

    // ドアを描画（キャリブレーションポイントから取得）
    if (roomProfile.calibrationPoints) {
      const doorInside = roomProfile.calibrationPoints.find(
        (p) => p.id === "door_inside"
      );
      const doorOutside = roomProfile.calibrationPoints.find(
        (p) => p.id === "door_outside"
      );

      if (doorInside && doorOutside) {
        const doorInsideActual = {
          x: doorInside.position.x * roomWidth,
          y: doorInside.position.y * roomHeight
        };
        const doorOutsideActual = {
          x: doorOutside.position.x * roomWidth,
          y: doorOutside.position.y * roomHeight
        };

        // ドアの中心位置を計算
        const doorCenterX =
          (doorInsideActual.x + doorOutsideActual.x) / 2;
        const doorCenterY =
          (doorInsideActual.y + doorOutsideActual.y) / 2;

        // ドアの向きを計算（内側→外側のベクトル）
        const x = padding + (doorCenterX + offsetX) * scale;
        const y = padding + (doorCenterY + offsetY) * scale;

        // ドアアイコンとラベル
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#8B4513";
        ctx.fillText("🚪", x, y);

        // ラベル「ドア」
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#8B4513";
        ctx.lineWidth = 3;
        ctx.strokeText("ドア", x, y + 20);
        ctx.fillText("ドア", x, y + 20);
      }
    }

    if (
      showRssiOverlay &&
      roomProfile.calibrationPoints &&
      roomProfile.calibrationPoints.length > 0
    ) {
      const previousTextAlign = ctx.textAlign;
      const previousTextBaseline = ctx.textBaseline;
      const previousFont = ctx.font;

      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "11px sans-serif";

      roomProfile.calibrationPoints.forEach((point) => {
        if (!point.measurements || point.measurements.length === 0) {
          return;
        }

        const stats = new Map<
          string,
          {
            sum: number;
            count: number;
          }
        >();

        point.measurements.forEach((measurement) => {
          if (!measurement.rssiValues) {
            return;
          }

          Object.entries(measurement.rssiValues).forEach(([mac, rssi]) => {
            if (typeof rssi !== "number" || Number.isNaN(rssi)) {
              return;
            }

            const normalizedMac = mac.toUpperCase().replace(/:/g, "");
            const current = stats.get(normalizedMac) || { sum: 0, count: 0 };
            current.sum += rssi;
            current.count += 1;
            stats.set(normalizedMac, current);
          });
        });

        if (stats.size === 0) {
          return;
        }

        const entries = Array.from(stats.entries())
          .map(([mac, { sum, count }]) => {
            const average = sum / Math.max(count, 1);
            const beaconInfo = beaconNameMap.get(mac);
            return {
              mac,
              name: beaconInfo?.name || mac,
              average: Math.round(average),
              count,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, "ja"));

        const lines = [
          `${point.label}`,
          ...entries.map(
            (entry) =>
              `${entry.name}: ${entry.average}dBm${
                entry.count > 1 ? ` (${entry.count})` : ""
              }`
          ),
        ];

        const lineHeight = 14;
        const textWidths = lines.map((line) => ctx.measureText(line).width);
        const boxWidth = Math.max(...textWidths, 0) + 12;
        const boxHeight = lines.length * lineHeight + 8;

        const normalizedX = point.position.x;
        const normalizedY = point.position.y;

        const pointX =
          padding + (normalizedX * roomWidth + offsetX) * scale;
        const pointY =
          padding + (normalizedY * roomHeight + offsetY) * scale;

        // マーカー
        ctx.beginPath();
        ctx.arc(pointX, pointY, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#1abc9c";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();

        let boxX = pointX + 12;
        if (boxX + boxWidth > canvas.width - padding) {
          boxX = pointX - boxWidth - 12;
        }
        boxX = Math.max(boxX, padding);

        let boxY = pointY - boxHeight / 2;
        if (boxY < padding) {
          boxY = padding;
        }
        if (boxY + boxHeight > canvas.height - padding) {
          boxY = canvas.height - padding - boxHeight;
        }

        ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        ctx.strokeStyle = "#1abc9c";
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

        ctx.fillStyle = "#34495e";
        lines.forEach((line, index) => {
          ctx.fillText(line, boxX + 6, boxY + 4 + lineHeight * index);
        });
      });

      ctx.textAlign = previousTextAlign;
      ctx.textBaseline = previousTextBaseline;
      ctx.font = previousFont;
    }

    // デバイスの位置を描画（最前面）
    if (devicePositions.size > 0) {
      console.log("Drawing devices:", devicePositions.size);
      devicePositions.forEach((position, deviceId) => {
        const device = devices.find((d) => d.devEUI === deviceId);

        // 位置座標を変換：position.x/yは既に実際のメートル位置
        const displayX = position.x;
        const displayY = position.y;

        const x = padding + (displayX + offsetX) * scale;
        const y = padding + (displayY + offsetY) * scale;

        // デバイスの影
        ctx.beginPath();
        ctx.arc(x + 2, y + 2, 14, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
        ctx.fill();

        // デバイスの円（メイン）
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fillStyle = "#4A90E2";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.stroke();

        // 内側の小さな円
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        // 名前（背景付き）
        const deviceName = device?.userName || device?.deviceId || deviceId;
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";

        const textMetrics = ctx.measureText(deviceName);
        const textWidth = textMetrics.width + 8;
        const textHeight = 16;

        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fillRect(
          x - textWidth / 2,
          y - 35 - textHeight / 2,
          textWidth,
          textHeight
        );

        ctx.fillStyle = "#2c3e50";
        ctx.fillText(deviceName, x, y - 30);
      });
    }

    console.log("Room drawing completed");
  };

  useEffect(() => {
    console.log(
      "Drawing trigger - roomProfile:",
      !!roomProfile,
      "devices:",
      devicePositions.size
    );
    if (roomProfile) {
      // 少し遅延させて確実に描画
      const timer = setTimeout(() => {
        drawRoom();
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [roomProfile, devicePositions, devices, showRssiOverlay]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="container">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <h1 style={{ fontSize: "32px", fontWeight: "700", margin: 0 }}>
          機能1 : 室内位置追跡
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <h2
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: "#2c3e50",
              margin: 0,
            }}
          >
            部屋: {roomProfile?.name || "未設定"}
          </h2>
          <button
            onClick={() => setShowLogPanel(!showLogPanel)}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "2px solid #4A90E2",
              backgroundColor: showLogPanel ? "#4A90E2" : "white",
              color: showLogPanel ? "white" : "#4A90E2",
              fontSize: "14px",
              fontWeight: "600",
              cursor: "pointer",
              transition: "all 0.3s ease",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            ビーコンログ
            {beaconLogs.length > 0 && (
              <span
                style={{
                  backgroundColor: "#ff6b35",
                  color: "white",
                  borderRadius: "10px",
                  padding: "2px 6px",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
              >
                {beaconLogs.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="alert-stack">
          {alerts.map((alert) => {
            // アラートタイプに応じて背景色とアイコンを変更
            const isShock = alert.type === "shock";
            const alertStyle = {
              backgroundColor: isShock ? "#dc3545" : "#ff6b35", // 衝撃: 濃い赤、退室: オレンジ
              border: isShock ? "3px solid #a71d2a" : "3px solid #cc5529",
              animation: isShock ? "pulse 0.5s ease-in-out infinite" : "none",
            };
            const alertIcon = isShock ? "💥 衝撃検知" : "🚪 部屋退室";
            
            return (
              <div
                key={alert.id}
                className="alert alert-danger"
                style={alertStyle}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <strong style={{ fontSize: "18px" }}>{alertIcon}</strong>
                    <p style={{ marginTop: "8px", fontSize: "16px" }}>
                      {alert.message}
                    </p>
                  </div>
                  <button
                    onClick={() => dismissAlert(alert.id)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "white",
                      fontSize: "24px",
                      cursor: "pointer",
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ビーコンログパネル */}
      {showLogPanel && (
        <div
          className="card"
          style={{
            marginBottom: "24px",
            maxHeight: "400px",
            overflow: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <h3 style={{ margin: 0 }}>ビーコン受信ログ</h3>
            <button
              onClick={() => setBeaconLogs([])}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #95a5a6",
                backgroundColor: "white",
                color: "#95a5a6",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              ログをクリア
            </button>
          </div>
          {beaconLogs.length === 0 ? (
            <p style={{ color: "#95a5a6", textAlign: "center", padding: "20px" }}>
              ログはありません
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {beaconLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    padding: "12px",
                    border: "1px solid #e1e8ed",
                    borderRadius: "8px",
                    backgroundColor: "#f8f9fa",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "8px",
                    }}
                  >
                    <strong style={{ color: "#2c3e50" }}>
                      {log.deviceName}
                    </strong>
                    <span style={{ fontSize: "12px", color: "#95a5a6" }}>
                      {formatTimestamp(log.timestamp)}
                    </span>
                  </div>
                  {log.missingBeacons.length > 0 && (
                    <div
                      style={{
                        backgroundColor: "#fff3cd",
                        border: "1px solid #ffc107",
                        borderRadius: "6px",
                        padding: "8px",
                        marginBottom: "8px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: "600",
                          color: "#856404",
                          marginBottom: "4px",
                        }}
                      >
                        ⚠️ 受信できなかったビーコン:
                      </div>
                      <div style={{ fontSize: "12px", color: "#856404" }}>
                        {log.missingBeacons
                          .map((b) => `${b.beaconName} (${b.mac})`)
                          .join(", ")}
                      </div>
                    </div>
                  )}
                  {log.receivedBeacons.length > 0 && (
                    <div
                      style={{
                        backgroundColor: "#d4edda",
                        border: "1px solid #28a745",
                        borderRadius: "6px",
                        padding: "8px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: "600",
                          color: "#155724",
                          marginBottom: "4px",
                        }}
                      >
                        ✅ 受信したビーコン:
                      </div>
                      <div style={{ fontSize: "11px", color: "#155724" }}>
                        {log.receivedBeacons
                          .map(
                            (b) => `${b.beaconName} (RSSI: ${b.rssi}dBm)`
                          )
                          .join(", ")}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: "24px",
          flexDirection: window.innerWidth <= 768 ? "column" : "row",
        }}
      >
        {/* 左側: ユーザー名と設定 */}
        <div
          style={{
            width: window.innerWidth <= 768 ? "100%" : "300px",
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          <div className="card">
            <h3 style={{ marginBottom: "12px" }}>ユーザー名</h3>
            {devices.map((device) => {
              const position = devicePositions.get(device.devEUI);
              const timestamp = deviceTimestamps.get(device.devEUI);
              return (
                <div
                  key={device.devEUI}
                  style={{
                    padding: "12px",
                    borderBottom: "1px solid #e1e8ed",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "baseline",
                      }}
                    >
                      <strong>{device.userName || device.deviceId}</strong>
                      <span style={{ fontSize: "12px", color: "#95a5a6" }}>
                        ({device.deviceId})
                      </span>
                    </div>

                    {timestamp && (
                      <p
                        style={{
                          fontSize: "12px",
                          marginTop: "2px",
                          color: "#95a5a6",
                        }}
                      >
                        更新: {formatTimestamp(timestamp)}
                      </p>
                    )}
                  </div>
                  <div
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      backgroundColor: position ? "#50C878" : "#95a5a6",
                      marginTop: "4px",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* 右側: 部屋表示パネル */}
        <div className="card" style={{ flex: 1 }}>
          <div
            style={{
              position: "relative",
              width: "100%",
            }}
          >
            <canvas
              ref={canvasRef}
              width={800}
              height={600}
              style={{
                width: "100%",
                height: "auto",
                border: "1px solid #e1e8ed",
                borderRadius: "8px",
              }}
            />
          </div>
        </div>
      </div>

      {/* アラート音 */}
      <audio
        ref={audioRef}
        src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGmi78OScTgwOUKXh8bllHAU2jdXxxn0pBSl+zPLaizsKFFux6OyrWBgLTKXh8bxpIgU1gtDy04k3CBtmue7mnlENDlCn4fG2Yx0FNo3V8cV9KwUqfsvy2os6CxJbrefrqVYZCkyk4PG8aScGOILN8tiIOAgZZ7jt5Z9PDw5Rrerlsl0dBTiO1/HGfSwHKn3L8tuKOwsTWbHn66hWGQpNpOHxvGknBjiCzfLYiDgIGWe47eWfTw8OUq3q5bJdHQU4jtfxxn0sByp9y/LbizsLE1mw5+uoVhkKTKTh8bxpJwY4gs3y2Ig4CBlnuO3ln08PDlKs6eWyXRwGOI7X8cZ9LAcqfcvy24s7CxNZsOfrqFYZCkyk4fG8aScGOILN8tiIOAgZZ7jt5Z9PDw5SrOrlsl0cBjiO1/HGfSwHKn3L8tuKOwsTWbDn66hWGQpMo+HxvGknBjiCzfLYiDgIGWe47eWfTw8OUqvq5bJdHQU4jtfxxn0sByp9y/LbijsLE1mw5+uoVRkKTKPh8bxpJwY4gs3y2Ig4CBlnuO3ln08PDlKr6uWyXRwGOI7X8cZ9KwcqfMvy24o6CxNZr+frqFYZCkyi4PG8aScGOILN8tiIOQgZZ7jt5Z9PDw5Sq+rlsl0cBjiO1/HGfSsHKnzL8tuKOgsTWa/n66hWGQpMouDxvGknBjiCzfLYiDkIGWe47eWfTw8OUqvq5bJdHAY4jtfxxnwrByp8y/LbijsLE1mw5+uoVhkKTKLg8bxpJwY4gs3y2Ig5CBlnuO3ln08PDlKr6uWyXRwGOI7X8cZ8KwcqfMvy24o6CxNZsOfrqFYZCkyi4PG8aScGOILN8tiIOQgZZ7jt5Z9PDw5Sq+rlsl0cBjiO1/HGfCsHKnzL8tuKOgsTWbDn66hWGQpMouDxvGknBjiCzfLYiDkIGWe47eWfTw8OUqvq5bJdHAY4jtfxxnwrByp8y/LbijsLE1mw5+uoVhkKTKLg8bxpJwY4gs3y2Ig5CBlnuO3ln08PDlKr6uWyXRwGOI7X8cZ8KwcqfMvy24o6CxNZsOfrqFYZCkyi4PG8aScGOILN8tiIOQgZZ7jt5Z9PDw5Sq+rlsl0cBjiO1/HGfCsHKnzL8tuKOgsTWbDn66hWGQpMouDxvGknBjiCzfLYiDkIGWe47eWfTw8OU="
      />
    </div>
  );
}

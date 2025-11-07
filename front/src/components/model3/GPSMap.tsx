// GPS追跡用マップコンポーネント

import { useState, useEffect, useRef, useCallback } from 'react';
import { Device, Alert } from '../../types';

interface GPSPosition {
  lat: number;
  lng: number;
  timestamp: string;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
}

interface MapConfig {
  center: GPSPosition;
  zoom: number;
  mapType: 'roadmap' | 'satellite' | 'hybrid' | 'terrain';
  showTrails: boolean;
  showAccuracyCircle: boolean;
  maxTrailPoints: number;
  autoCenter: boolean;
  updateInterval: number;
}

interface GeofenceArea {
  id: string;
  name: string;
  center: { lat: number; lng: number };
  radius: number;
  type: 'safe' | 'warning' | 'danger';
  isActive: boolean;
}

declare global {
  interface Window {
    google: any;
  }
}

interface ExtendedMarker {
  setMap: (map: any) => void;
  addListener: (event: string, callback: () => void) => void;
  infoWindow?: any;
  [key: string]: any;
}

interface Props {
  devices: Device[];
  selectedDeviceId?: string;
  parentDeviceId?: string;
  maxDistance?: number;
  onDeviceSelect?: (deviceId: string) => void;
  onAlertGenerate?: (alert: Alert) => void;
  onPositionUpdate?: (deviceId: string, position: GPSPosition) => void;
  geofences?: GeofenceArea[];
  showDistanceWarning?: boolean;
  realTimeTracking?: boolean;
  className?: string;
}

export default function GPSMap({
  devices,
  selectedDeviceId,
  parentDeviceId,
  maxDistance = 50,
  onDeviceSelect,
  onAlertGenerate,
  onPositionUpdate,
  geofences = [],
  showDistanceWarning = true,
  realTimeTracking = true,
  className
}: Props) {
  
  const [mapConfig, setMapConfig] = useState<MapConfig>({
    center: { lat: 35.6812, lng: 139.7671, timestamp: new Date().toISOString() },
    zoom: 16,
    mapType: 'roadmap',
    showTrails: true,
    showAccuracyCircle: true,
    maxTrailPoints: 50,
    autoCenter: true,
    updateInterval: 5000
  });
  
  const [deviceTrails, setDeviceTrails] = useState<Record<string, GPSPosition[]>>({});
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [userLocation, setUserLocation] = useState<GPSPosition | null>(null);
  const [distanceAlerts, setDistanceAlerts] = useState<Record<string, number>>({});
  const [mapStats, setMapStats] = useState({
    totalDevices: 0,
    activeDevices: 0,
    averageAccuracy: 0,
    lastUpdate: '',
    geofenceViolations: 0
  });

  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<any>(null);
  const markersRef = useRef<Record<string, ExtendedMarker>>({});
  const trailsRef = useRef<Record<string, any>>({});
  const circlesRef = useRef<Record<string, any>>({});
  const geofenceMarkersRef = useRef<Record<string, any>>({});
  const updateIntervalRef = useRef<NodeJS.Timeout>();

  // === ユーティリティ関数群（useCallbackで最適化） ===
  const convertDevicePositionToGPS = useCallback((devicePosition: any): GPSPosition | null => {
    if (!devicePosition) return null;

    const lat = devicePosition.lat || devicePosition.latitude;
    if (typeof lat !== 'number') return null;

    const lng = devicePosition.lng || devicePosition.lon || devicePosition.longitude;
    if (typeof lng !== 'number') return null;

    const timestamp = devicePosition.timestamp || devicePosition.time || new Date().toISOString();

    return {
      lat,
      lng,
      timestamp,
      accuracy: devicePosition.accuracy,
      altitude: devicePosition.altitude,
      speed: devicePosition.speed,
      heading: devicePosition.heading
    };
  }, []);

  const calculateDistance = useCallback((pos1: GPSPosition | { lat: number; lng: number }, pos2: GPSPosition | { lat: number; lng: number }) => {
    const R = 6371e3;
    const φ1 = pos1.lat * Math.PI / 180;
    const φ2 = pos2.lat * Math.PI / 180;
    const Δφ = (pos2.lat - pos1.lat) * Math.PI / 180;
    const Δλ = (pos2.lng - pos1.lng) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }, []);

  const getDeviceColor = useCallback((device: Device, isParent: boolean) => {
    return isParent ? '#3498db' : '#4CAF50';
  }, []);

  const getDeviceIcon = useCallback((device: Device, isParent: boolean, isSelected: boolean) => {
    const iconType = isParent ? 'parent' : 'child';
    const icons = {
      parent: { normal: '👨‍👩‍👧‍👦', selected: '👨‍👩‍👧‍👦' },
      child: { normal: '🧒', selected: '🧒' }
    };

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r="12" fill="${isSelected ? '#3498db' : '#4CAF50'}" stroke="white" stroke-width="2"/>
        <text x="15" y="20" text-anchor="middle" fill="white" font-size="14">
          ${icons[iconType].normal}
        </text>
      </svg>
    `)}`;
  }, []);

  const getMapStyles = useCallback(() => {
    return [];
  }, []);

  // 🔥 修正: 未定義関数を追加
  const createInfoWindowContentFromGPS = useCallback((device: Device, position: GPSPosition) => {
    const distance = parentDeviceId ? 
      (() => {
        const parent = devices.find(d => d.deviceId === parentDeviceId);
        const parentPos = convertDevicePositionToGPS(parent?.position);
        return parentPos ? 
          calculateDistance(position, parentPos).toFixed(1) : 'N/A';
      })() : 'N/A';

    return `
      <div style="padding: 8px; min-width: 200px;">
        <h4 style="margin: 0 0 8px 0;">${device.userName || device.name}</h4>
        <div style="font-size: 12px; color: #666;">
          <div>緯度: ${position.lat.toFixed(6)}</div>
          <div>経度: ${position.lng.toFixed(6)}</div>
          ${position.accuracy ? `<div>精度: ${position.accuracy.toFixed(1)}m</div>` : ''}
          ${distance !== 'N/A' ? `<div>保護者からの距離: ${distance}m</div>` : ''}
          <div>更新: ${new Date(position.timestamp).toLocaleTimeString()}</div>
        </div>
      </div>
    `;
  }, [parentDeviceId, devices, convertDevicePositionToGPS, calculateDistance]);

  const drawAccuracyCircleFromGPS = useCallback((device: Device, position: GPSPosition) => {
    if (!googleMapRef.current || !position.accuracy) return;

    try {
      const circle = new window.google.maps.Circle({
        strokeColor: getDeviceColor(device, device.deviceId === parentDeviceId),
        strokeOpacity: 0.3,
        strokeWeight: 1,
        fillColor: getDeviceColor(device, device.deviceId === parentDeviceId),
        fillOpacity: 0.1,
        map: googleMapRef.current,
        center: { lat: position.lat, lng: position.lng },
        radius: position.accuracy
      });

      circlesRef.current[device.deviceId] = circle;
    } catch (error) {
      console.error('精度サークル作成エラー:', error);
    }
  }, [parentDeviceId, getDeviceColor]);

  const drawGeofences = useCallback(() => {
    if (!googleMapRef.current) return;

    geofences.forEach(geofence => {
      try {
        const color = {
          'safe': '#4CAF50',
          'warning': '#FF9800',
          'danger': '#e74c3c'
        }[geofence.type];

        const circle = new window.google.maps.Circle({
          strokeColor: color,
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 0.2,
          map: googleMapRef.current,
          center: geofence.center,
          radius: geofence.radius
        });

        const marker = new window.google.maps.Marker({
          position: geofence.center,
          map: googleMapRef.current,
          title: geofence.name,
          icon: {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/>
                <text x="12" y="16" text-anchor="middle" fill="white" font-size="12" font-weight="bold">
                  ${geofence.type.charAt(0).toUpperCase()}
                </text>
              </svg>
            `)}`,
            scaledSize: new window.google.maps.Size(24, 24)
          }
        });

        geofenceMarkersRef.current[geofence.id] = circle;
      } catch (error) {
        console.error('ジオフェンス作成エラー:', error);
      }
    });
  }, [geofences]);

  // === マップ初期化 ===
  const initializeMap = useCallback(() => {
    if (!mapRef.current || typeof window === 'undefined' || !window.google?.maps) {
      setTimeout(initializeMap, 1000);
      return;
    }

    try {
      const map = new window.google.maps.Map(mapRef.current, {
        center: { lat: mapConfig.center.lat, lng: mapConfig.center.lng },
        zoom: mapConfig.zoom,
        mapTypeId: mapConfig.mapType,
        styles: getMapStyles(),
        disableDefaultUI: false,
        zoomControl: true,
        streetViewControl: false,
        fullscreenControl: true
      });

      googleMapRef.current = map;
      setIsMapLoaded(true);
      drawGeofences();

    } catch (error) {
      console.error('マップ初期化エラー:', error);
      setTimeout(initializeMap, 2000);
    }
  }, [mapConfig.center.lat, mapConfig.center.lng, mapConfig.zoom, mapConfig.mapType, getMapStyles, drawGeofences]);

  const getUserLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      console.warn('Geolocation not supported');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userPos: GPSPosition = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: new Date().toISOString(),
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude || undefined,
          speed: position.coords.speed || undefined,
          heading: position.coords.heading || undefined
        };

        setUserLocation(userPos);
        
        if (mapConfig.autoCenter && googleMapRef.current) {
          googleMapRef.current.setCenter({ lat: userPos.lat, lng: userPos.lng });
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  }, [mapConfig.autoCenter]);

  const updateDevicePositions = useCallback(() => {
    devices.forEach(device => {
      const position = convertDevicePositionToGPS(device.position);
      if (position) {
        if (onPositionUpdate) {
          onPositionUpdate(device.deviceId, position);
        }

        setDeviceTrails(prev => {
          const trails = prev[device.deviceId] || [];
          const newTrails = [...trails, position].slice(-mapConfig.maxTrailPoints);
          return {
            ...prev,
            [device.deviceId]: newTrails
          };
        });
      }
    });
  }, [devices, convertDevicePositionToGPS, onPositionUpdate, mapConfig.maxTrailPoints]);

  const startRealTimeTracking = useCallback(() => {
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
    }
    updateIntervalRef.current = setInterval(() => {
      updateDevicePositions();
    }, mapConfig.updateInterval);
  }, [updateDevicePositions, mapConfig.updateInterval]);

  // === 主要な更新関数群 ===
  const updateDeviceMarkers = useCallback(() => {
    if (!googleMapRef.current) return;

    Object.values(markersRef.current).forEach(marker => marker.setMap(null));
    markersRef.current = {};

    devices.forEach(device => {
      const position = convertDevicePositionToGPS(device.position);
      if (!position) return;

      const isParent = device.deviceId === parentDeviceId;
      const isSelected = device.deviceId === selectedDeviceId;

      try {
        const icon = {
          url: getDeviceIcon(device, isParent, isSelected),
          scaledSize: new window.google.maps.Size(isSelected ? 40 : 30, isSelected ? 40 : 30),
          anchor: new window.google.maps.Point(isSelected ? 20 : 15, isSelected ? 40 : 30)
        };

        const marker = new window.google.maps.Marker({
          position: { lat: position.lat, lng: position.lng },
          map: googleMapRef.current,
          title: device.userName || device.name || device.deviceId,
          icon: icon,
          zIndex: isSelected ? 1000 : isParent ? 900 : 800
        }) as ExtendedMarker;

        marker.addListener('click', () => {
          if (onDeviceSelect) {
            onDeviceSelect(device.deviceId);
          }
        });

        const infoWindow = new window.google.maps.InfoWindow({
          content: createInfoWindowContentFromGPS(device, position)
        });

        marker.addListener('click', () => {
          Object.values(markersRef.current).forEach(m => {
            if (m.infoWindow) {
              m.infoWindow.close();
            }
          });
          
          infoWindow.open(googleMapRef.current, marker);
        });

        marker.infoWindow = infoWindow;
        markersRef.current[device.deviceId] = marker;

        if (mapConfig.showAccuracyCircle && position.accuracy) {
          drawAccuracyCircleFromGPS(device, position);
        }
      } catch (error) {
        console.error('マーカー作成エラー:', error);
      }
    });
  }, [devices, parentDeviceId, selectedDeviceId, mapConfig.showAccuracyCircle, convertDevicePositionToGPS, getDeviceIcon, onDeviceSelect, createInfoWindowContentFromGPS, drawAccuracyCircleFromGPS]);

  const updateDeviceTrails = useCallback(() => {
    if (!googleMapRef.current || !mapConfig.showTrails) return;

    Object.values(trailsRef.current).forEach(trail => trail.setMap(null));
    trailsRef.current = {};

    Object.entries(deviceTrails).forEach(([deviceId, trail]) => {
      if (trail.length < 2) return;

      const device = devices.find(d => d.deviceId === deviceId);
      if (!device) return;

      try {
        const path = trail.map(pos => ({ lat: pos.lat, lng: pos.lng }));
        const isSelected = deviceId === selectedDeviceId;

        const polyline = new window.google.maps.Polyline({
          path: path,
          geodesic: true,
          strokeColor: getDeviceColor(device, deviceId === parentDeviceId),
          strokeOpacity: isSelected ? 1.0 : 0.6,
          strokeWeight: isSelected ? 4 : 2,
          map: googleMapRef.current
        });

        trailsRef.current[deviceId] = polyline;
      } catch (error) {
        console.error('トレイル作成エラー:', error);
      }
    });
  }, [deviceTrails, devices, selectedDeviceId, parentDeviceId, mapConfig.showTrails, getDeviceColor]);

  const checkDistanceAlerts = useCallback(() => {
    if (!showDistanceWarning || !parentDeviceId) return;

    const parentDevice = devices.find(d => d.deviceId === parentDeviceId);
    const parentPos = convertDevicePositionToGPS(parentDevice?.position);
    if (!parentPos) return;

    devices.forEach(device => {
      if (device.deviceId === parentDeviceId) return;
      
      const devicePos = convertDevicePositionToGPS(device.position);
      if (!devicePos) return;

      const distance = calculateDistance(parentPos, devicePos);

      setDistanceAlerts(prev => {
        const previousDistance = prev[device.deviceId] || 0;
        
        if (distance > maxDistance && previousDistance <= maxDistance && onAlertGenerate) {
          const alert: Alert = {
            id: `distance-${device.deviceId}-${Date.now()}`,
            type: 'gps_distance',
            message: `${device.userName || device.name}が保護者から${distance.toFixed(1)}m離れています`,
            deviceId: device.devEUI || device.deviceId,
            deviceName: device.userName || device.name,
            timestamp: new Date().toISOString(),
            dismissed: false,
            severity: distance > maxDistance * 2 ? 'critical' : 'high',
            mode: 'gps'
          };
          onAlertGenerate(alert);
        }

        return {
          ...prev,
          [device.deviceId]: distance
        };
      });
    });
  }, [devices, parentDeviceId, showDistanceWarning, maxDistance, convertDevicePositionToGPS, calculateDistance, onAlertGenerate]);

  const checkGeofenceViolations = useCallback(() => {
    devices.forEach(device => {
      const devicePos = convertDevicePositionToGPS(device.position);
      if (!devicePos) return;

      geofences.forEach(geofence => {
        if (!geofence.isActive) return;

        const distance = calculateDistance(devicePos, geofence.center);
        const isInside = distance <= geofence.radius;
        const shouldAlert = (geofence.type === 'danger' && isInside) ||
                          (geofence.type === 'safe' && !isInside);

        if (shouldAlert && onAlertGenerate) {
          const message = geofence.type === 'danger' ?
            `${device.userName || device.name}が危険エリア「${geofence.name}」に入りました` :
            `${device.userName || device.name}が安全エリア「${geofence.name}」から出ました`;

          const alert: Alert = {
            id: `geofence-${device.deviceId}-${geofence.id}-${Date.now()}`,
            type: 'gps_distance',
            message,
            deviceId: device.devEUI || device.deviceId,
            deviceName: device.userName || device.name,
            timestamp: new Date().toISOString(),
            dismissed: false,
            severity: geofence.type === 'danger' ? 'critical' : 'high',
            mode: 'gps'
          };
          onAlertGenerate(alert);
        }
      });
    });
  }, [devices, geofences, convertDevicePositionToGPS, calculateDistance, onAlertGenerate]);

  const updateMapStats = useCallback(() => {
    const activeDevices = devices.filter(d => convertDevicePositionToGPS(d.position)).length;
    const accuracies = devices
      .map(d => convertDevicePositionToGPS(d.position))
      .filter(pos => pos?.accuracy)
      .map(pos => pos!.accuracy!);
    
    const violations = devices.reduce((count, device) => {
      const devicePos = convertDevicePositionToGPS(device.position);
      if (!devicePos) return count;
      
      return count + geofences.filter(geofence => {
        const distance = calculateDistance(devicePos, geofence.center);
        const isInside = distance <= geofence.radius;
        return (geofence.type === 'danger' && isInside) ||
               (geofence.type === 'safe' && !isInside);
      }).length;
    }, 0);

    setMapStats({
      totalDevices: devices.length,
      activeDevices,
      averageAccuracy: accuracies.length > 0 ? 
        accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length : 0,
      lastUpdate: new Date().toLocaleTimeString(),
      geofenceViolations: violations
    });
  }, [devices, geofences, convertDevicePositionToGPS, calculateDistance]);

  // === イベントハンドラー ===
  const handleCenterToUser = useCallback(() => {
    if (userLocation && googleMapRef.current) {
      googleMapRef.current.setCenter({ lat: userLocation.lat, lng: userLocation.lng });
    }
  }, [userLocation]);

  const handleCenterToDevices = useCallback(() => {
    if (!googleMapRef.current || typeof window === 'undefined' || !window.google?.maps) return;

    try {
      const bounds = new window.google.maps.LatLngBounds();
      devices.forEach(device => {
        const position = convertDevicePositionToGPS(device.position);
        if (position) {
          bounds.extend({ lat: position.lat, lng: position.lng });
        }
      });

      if (!bounds.isEmpty()) {
        googleMapRef.current.fitBounds(bounds);
      }
    } catch (error) {
      console.error('バウンド設定エラー:', error);
    }
  }, [devices, convertDevicePositionToGPS]);

  const handleMapTypeChange = useCallback((mapType: MapConfig['mapType']) => {
    setMapConfig(prev => ({ ...prev, mapType }));
  }, []);

  // === Effect群 ===
  useEffect(() => {
    initializeMap();
    getUserLocation();
    
    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, []); // 🔥 修正: 初期化のみ

  useEffect(() => {
    if (isMapLoaded && realTimeTracking) {
      startRealTimeTracking();
    }
    
    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, [isMapLoaded, realTimeTracking, startRealTimeTracking]);

  // 🔥 修正: デバイス更新は個別のEffect
  useEffect(() => {
    if (isMapLoaded) {
      updateDeviceMarkers();
    }
  }, [isMapLoaded, devices, selectedDeviceId, parentDeviceId, updateDeviceMarkers]);

  useEffect(() => {
    if (isMapLoaded) {
      updateDeviceTrails();
    }
  }, [isMapLoaded, deviceTrails, updateDeviceTrails]);

  useEffect(() => {
    if (isMapLoaded) {
      checkDistanceAlerts();
      checkGeofenceViolations();
      updateMapStats();
    }
  }, [isMapLoaded, devices, checkDistanceAlerts, checkGeofenceViolations, updateMapStats]);

  useEffect(() => {
    if (googleMapRef.current) {
      googleMapRef.current.setMapTypeId(mapConfig.mapType);
    }
  }, [mapConfig.mapType]);

  return (
    <div className={`gps-map ${className || ''}`}>
      {/* ヘッダー - 統計情報 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: '12px',
        marginBottom: '16px',
        padding: '12px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        border: '1px solid #e1e8ed'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#3498db' }}>
            {mapStats.activeDevices}/{mapStats.totalDevices}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>アクティブデバイス</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#4CAF50' }}>
            {mapStats.averageAccuracy.toFixed(1)}m
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>平均精度</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#FF9800' }}>
            {Object.keys(distanceAlerts).length}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>距離警告</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#e74c3c' }}>
            {mapStats.geofenceViolations}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>エリア違反</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>
            {mapStats.lastUpdate}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>最終更新</div>
        </div>
      </div>

      {/* 制御パネル */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        padding: '8px 12px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px'
      }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['roadmap', 'satellite', 'hybrid', 'terrain'] as const).map(type => (
            <button
              key={type}
              onClick={() => handleMapTypeChange(type)}
              style={{
                padding: '4px 8px',
                backgroundColor: mapConfig.mapType === type ? '#3498db' : 'white',
                color: mapConfig.mapType === type ? 'white' : '#666',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '10px',
                cursor: 'pointer'
              }}
            >
              {{
                roadmap: '🗺️ 地図',
                satellite: '🛰️ 衛星',
                hybrid: '🌍 混合',
                terrain: '🏔️ 地形'
              }[type]}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleCenterToUser}
            disabled={!userLocation}
            style={{
              padding: '6px 12px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              cursor: userLocation ? 'pointer' : 'not-allowed',
              opacity: userLocation ? 1 : 0.5
            }}
          >
            📍 現在地
          </button>
          
          <button
            onClick={handleCenterToDevices}
            disabled={mapStats.activeDevices === 0}
            style={{
              padding: '6px 12px',
              backgroundColor: '#3498db',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              cursor: mapStats.activeDevices > 0 ? 'pointer' : 'not-allowed',
              opacity: mapStats.activeDevices > 0 ? 1 : 0.5
            }}
          >
            🎯 全体表示
          </button>
        </div>
      </div>

      {/* マップ本体 */}
      <div className="card" style={{ padding: 0, position: 'relative' }}>
        <div
          ref={mapRef}
          style={{
            width: '100%',
            height: '500px',
            borderRadius: '8px'
          }}
        />
        
        {!isMapLoaded && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            padding: '20px',
            borderRadius: '8px',
            zIndex: 1000
          }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>🗺️</div>
            <div>マップを読み込み中...</div>
          </div>
        )}
      </div>

      {/* 距離アラート一覧 */}
      {showDistanceWarning && Object.keys(distanceAlerts).length > 0 && (
        <div className="card" style={{ marginTop: '16px' }}>
          <h4 style={{ marginBottom: '12px', fontSize: '14px', fontWeight: 'bold' }}>
            📏 距離状況
          </h4>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '8px'
          }}>
            {Object.entries(distanceAlerts).map(([deviceId, distance]) => {
              const device = devices.find(d => d.deviceId === deviceId);
              if (!device) return null;

              const isWarning = distance > maxDistance;
              
              return (
                <div
                  key={deviceId}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: isWarning ? '#ffebee' : '#e8f5e8',
                    borderLeft: `4px solid ${isWarning ? '#e74c3c' : '#4CAF50'}`
                  }}
                >
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 'bold',
                    marginBottom: '4px'
                  }}>
                    {device.userName || device.name}
                  </div>
                  <div style={{
                    fontSize: '10px',
                    color: '#666'
                  }}>
                    距離: {distance.toFixed(1)}m {isWarning && '⚠️'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 設定パネル */}
      <details style={{ marginTop: '16px' }}>
        <summary style={{
          cursor: 'pointer',
          padding: '8px',
          backgroundColor: '#f8f9fa',
          borderRadius: '4px'
        }}>
          ⚙️ マップ設定
        </summary>
        <div style={{
          marginTop: '12px',
          padding: '16px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px'
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={mapConfig.showTrails}
              onChange={(e) => setMapConfig(prev => ({ ...prev, showTrails: e.target.checked }))}
            />
            <span style={{ fontSize: '12px' }}>移動軌跡を表示</span>
          </label>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={mapConfig.showAccuracyCircle}
              onChange={(e) => setMapConfig(prev => ({ ...prev, showAccuracyCircle: e.target.checked }))}
            />
            <span style={{ fontSize: '12px' }}>精度サークルを表示</span>
          </label>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={mapConfig.autoCenter}
              onChange={(e) => setMapConfig(prev => ({ ...prev, autoCenter: e.target.checked }))}
            />
            <span style={{ fontSize: '12px' }}>自動センタリング</span>
          </label>
          
          <div>
            <label style={{ fontSize: '12px', color: '#666' }}>軌跡保持数</label>
            <input
              type="range"
              min="10"
              max="100"
              value={mapConfig.maxTrailPoints}
              onChange={(e) => setMapConfig(prev => ({ ...prev, maxTrailPoints: parseInt(e.target.value) }))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px' }}>{mapConfig.maxTrailPoints}点</span>
          </div>
        </div>
      </details>
    </div>
  );
}

export const sampleGeofences: GeofenceArea[] = [
  {
    id: 'school',
    name: '学校',
    center: { lat: 35.6815, lng: 139.7671 },
    radius: 100,
    type: 'safe',
    isActive: true
  },
  {
    id: 'park',
    name: '公園',
    center: { lat: 35.6820, lng: 139.7680 },
    radius: 50,
    type: 'safe',
    isActive: true
  },
  {
    id: 'construction',
    name: '工事現場',
    center: { lat: 35.6800, lng: 139.7650 },
    radius: 30,
    type: 'danger',
    isActive: true
  }
];

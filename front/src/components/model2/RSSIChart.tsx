import { useState, useEffect, useRef } from 'react';
import { Device, BeaconDevice } from '../../types';

interface RSSIDataPoint {
  timestamp: number;
  rssi: number;
  deviceId: string;
  deviceName: string;
  beaconId: string;
  beaconName: string;
  mac: string;
}

interface ChartConfig {
  timeWindow: number; // 表示時間範囲（秒）
  updateInterval: number; // 更新間隔（ミリ秒）
  maxDataPoints: number; // 最大データポイント数
  rssiMin: number; // RSSI最小値
  rssiMax: number; // RSSI最大値
}

interface Props {
  devices: Device[];
  beacons: BeaconDevice[];
  selectedDeviceId?: string;
  selectedBeaconId?: string;
  onDeviceSelect?: (deviceId: string) => void;
  onBeaconSelect?: (beaconId: string) => void;
  chartType?: 'line' | 'scatter' | 'heatmap';
  showGrid?: boolean;
  showLegend?: boolean;
  showTooltips?: boolean;
  autoScale?: boolean;
  className?: string;
}

export default function RSSIChart({
  devices,
  beacons,
  selectedDeviceId,
  selectedBeaconId,
  onDeviceSelect,
  onBeaconSelect,
  chartType = 'line',
  showGrid = true,
  showLegend = true,
  showTooltips = true,
  autoScale = false,
  className
}: Props) {
  
  const [rssiData, setRssiData] = useState<RSSIDataPoint[]>([]);
  const [chartConfig, setChartConfig] = useState<ChartConfig>({
    timeWindow: 60, // 60秒
    updateInterval: 1000, // 1秒
    maxDataPoints: 300,
    rssiMin: -100,
    rssiMax: -30
  });
  const [hoveredPoint, setHoveredPoint] = useState<RSSIDataPoint | null>(null);
  const [isRealtime, setIsRealtime] = useState(true);
  // 🔥 追加: autoScaleの状態管理
  const [localAutoScale, setLocalAutoScale] = useState(autoScale);
  const [chartStats, setChartStats] = useState({
    averageRSSI: 0,
    minRSSI: 0,
    maxRSSI: 0,
    signalCount: 0,
    activeDevices: 0,
    activeBeacons: 0
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const updateIntervalRef = useRef<NodeJS.Timeout>();

  // === 初期化とデータ更新 ===
  useEffect(() => {
    if (isRealtime) {
      startRealTimeUpdate();
    }
    
    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [devices, beacons, isRealtime, chartConfig.updateInterval]);

  // === チャート描画 ===
  useEffect(() => {
    drawChart();
  }, [rssiData, selectedDeviceId, selectedBeaconId, chartType, chartConfig, hoveredPoint]);

  // === リアルタイム更新開始 ===
  const startRealTimeUpdate = () => {
    updateIntervalRef.current = setInterval(() => {
      updateRSSIData();
    }, chartConfig.updateInterval);
  };

  // === RSSIデータの更新 ===
  const updateRSSIData = () => {
    const now = Date.now();
    const newDataPoints: RSSIDataPoint[] = [];

    // 各デバイスのBLEデータからRSSIを抽出
    devices.forEach(device => {
      if (!device.bleData) return;

      device.bleData.forEach(bleSignal => {
        const beacon = beacons.find(b => b.mac === bleSignal.mac);
        if (!beacon) return;

        const dataPoint: RSSIDataPoint = {
          timestamp: new Date(bleSignal.timestamp).getTime(),
          rssi: bleSignal.rssi,
          deviceId: device.deviceId,
          deviceName: device.userName || device.name || device.deviceId,
          beaconId: beacon.id,
          beaconName: beacon.name,
          mac: beacon.mac
        };

        newDataPoints.push(dataPoint);
      });
    });

    // 既存データと新データをマージ
    setRssiData(prevData => {
      const mergedData = [...prevData, ...newDataPoints];
      
      // 時間窓でフィルタリング
      const cutoffTime = now - (chartConfig.timeWindow * 1000);
      const filteredData = mergedData.filter(point => point.timestamp >= cutoffTime);
      
      // 最大ポイント数で制限
      const limitedData = filteredData.slice(-chartConfig.maxDataPoints);
      
      return limitedData;
    });

    // 統計情報の更新
    updateChartStats(newDataPoints);
  };

  // === 統計情報の更新 ===
  const updateChartStats = (newDataPoints: RSSIDataPoint[]) => {
    if (rssiData.length === 0 && newDataPoints.length === 0) return;

    const allData = [...rssiData, ...newDataPoints];
    const rssiValues = allData.map(d => d.rssi);
    const uniqueDevices = new Set(allData.map(d => d.deviceId));
    const uniqueBeacons = new Set(allData.map(d => d.beaconId));

    setChartStats({
      averageRSSI: rssiValues.length > 0 ? rssiValues.reduce((sum, rssi) => sum + rssi, 0) / rssiValues.length : 0,
      minRSSI: rssiValues.length > 0 ? Math.min(...rssiValues) : 0,
      maxRSSI: rssiValues.length > 0 ? Math.max(...rssiValues) : 0,
      signalCount: allData.length,
      activeDevices: uniqueDevices.size,
      activeBeacons: uniqueBeacons.size
    });
  };

  // === チャート描画 ===
  const drawChart = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const padding = { top: 20, right: 80, bottom: 40, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // キャンバスクリア
    ctx.clearRect(0, 0, width, height);

    if (rssiData.length === 0) {
      drawEmptyState(ctx, width, height);
      return;
    }

    // フィルタリングされたデータ
    const filteredData = getFilteredData();
    
    if (filteredData.length === 0) {
      drawEmptyState(ctx, width, height);
      return;
    }

    // 時間とRSSIの範囲を計算
    const timeRange = getTimeRange(filteredData);
    const rssiRange = getRSSIRange(filteredData);

    // グリッド描画
    if (showGrid) {
      drawGrid(ctx, padding, chartWidth, chartHeight, timeRange, rssiRange);
    }

    // チャートタイプに応じて描画
    switch (chartType) {
      case 'line':
        drawLineChart(ctx, filteredData, padding, chartWidth, chartHeight, timeRange, rssiRange);
        break;
      case 'scatter':
        drawScatterChart(ctx, filteredData, padding, chartWidth, chartHeight, timeRange, rssiRange);
        break;
      case 'heatmap':
        drawHeatmapChart(ctx, filteredData, padding, chartWidth, chartHeight, timeRange, rssiRange);
        break;
    }

    // 軸ラベル描画
    drawAxes(ctx, padding, chartWidth, chartHeight, timeRange, rssiRange);

    // ツールチップ描画
    if (showTooltips && hoveredPoint) {
      drawTooltip(ctx, hoveredPoint, padding, chartWidth, chartHeight, timeRange, rssiRange);
    }

    // 凡例描画
    if (showLegend) {
      drawLegend(ctx, filteredData, width, height, padding);
    }
  };

  // === フィルタリングされたデータを取得 ===
  const getFilteredData = () => {
    let filtered = rssiData;

    if (selectedDeviceId) {
      filtered = filtered.filter(d => d.deviceId === selectedDeviceId);
    }

    if (selectedBeaconId) {
      filtered = filtered.filter(d => d.beaconId === selectedBeaconId);
    }

    return filtered;
  };

  // === 時間範囲を取得 ===
  const getTimeRange = (data: RSSIDataPoint[]) => {
    const timestamps = data.map(d => d.timestamp);
    return {
      min: Math.min(...timestamps),
      max: Math.max(...timestamps)
    };
  };

  // === RSSI範囲を取得 ===
  const getRSSIRange = (data: RSSIDataPoint[]) => {
    // 🔥 修正: localAutoScaleを使用
    if (localAutoScale) {
      const rssiValues = data.map(d => d.rssi);
      return {
        min: Math.min(...rssiValues) - 5,
        max: Math.max(...rssiValues) + 5
      };
    }
    return {
      min: chartConfig.rssiMin,
      max: chartConfig.rssiMax
    };
  };

  // === 空の状態を描画 ===
  const drawEmptyState = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.fillStyle = '#666';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('データがありません', width / 2, height / 2);
    
    ctx.font = '12px Arial';
    ctx.fillText('デバイスとビーコンの接続を確認してください', width / 2, height / 2 + 25);
  };

  // === グリッド描画 ===
  const drawGrid = (
    ctx: CanvasRenderingContext2D,
    padding: any,
    chartWidth: number,
    chartHeight: number,
    timeRange: any,
    rssiRange: any
  ) => {
    ctx.strokeStyle = '#e1e8ed';
    ctx.lineWidth = 1;

    // 縦線（時間軸）
    const timeStep = (timeRange.max - timeRange.min) / 6;
    for (let i = 0; i <= 6; i++) {
      const x = padding.left + (i / 6) * chartWidth;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.stroke();
    }

    // 横線（RSSI軸）
    const rssiStep = (rssiRange.max - rssiRange.min) / 5;
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (i / 5) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartWidth, y);
      ctx.stroke();
    }
  };

  // === 線グラフ描画 ===
  const drawLineChart = (
    ctx: CanvasRenderingContext2D,
    data: RSSIDataPoint[],
    padding: any,
    chartWidth: number,
    chartHeight: number,
    timeRange: any,
    rssiRange: any
  ) => {
    // デバイス/ビーコンごとにグループ化
    const groupedData = groupDataByDevice(data);

    Object.entries(groupedData).forEach(([key, points], index) => {
      const color = getDeviceColor(key, index);
      
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      let firstPoint = true;
      points.forEach(point => {
        const x = padding.left + ((point.timestamp - timeRange.min) / (timeRange.max - timeRange.min)) * chartWidth;
        const y = padding.top + ((rssiRange.max - point.rssi) / (rssiRange.max - rssiRange.min)) * chartHeight;

        if (firstPoint) {
          ctx.moveTo(x, y);
          firstPoint = false;
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      // 点を描画
      ctx.fillStyle = color;
      points.forEach(point => {
        const x = padding.left + ((point.timestamp - timeRange.min) / (timeRange.max - timeRange.min)) * chartWidth;
        const y = padding.top + ((rssiRange.max - point.rssi) / (rssiRange.max - rssiRange.min)) * chartHeight;
        
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
      });
    });
  };

  // === 散布図描画 ===
  const drawScatterChart = (
    ctx: CanvasRenderingContext2D,
    data: RSSIDataPoint[],
    padding: any,
    chartWidth: number,
    chartHeight: number,
    timeRange: any,
    rssiRange: any
  ) => {
    data.forEach((point, index) => {
      const x = padding.left + ((point.timestamp - timeRange.min) / (timeRange.max - timeRange.min)) * chartWidth;
      const y = padding.top + ((rssiRange.max - point.rssi) / (rssiRange.max - rssiRange.min)) * chartHeight;
      
      const color = getDeviceColor(`${point.deviceId}-${point.beaconId}`, index);
      const isSelected = point.deviceId === selectedDeviceId || point.beaconId === selectedBeaconId;
      
      ctx.fillStyle = color;
      ctx.globalAlpha = isSelected ? 1.0 : 0.6;
      
      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 5 : 3, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.globalAlpha = 1.0;
    });
  };

  // === ヒートマップ描画 ===
  const drawHeatmapChart = (
    ctx: CanvasRenderingContext2D,
    data: RSSIDataPoint[],
    padding: any,
    chartWidth: number,
    chartHeight: number,
    timeRange: any,
    rssiRange: any
  ) => {
    // ヒートマップのグリッドサイズ
    const gridSize = 20;
    const gridWidth = Math.ceil(chartWidth / gridSize);
    const gridHeight = Math.ceil(chartHeight / gridSize);
    
    // 各グリッドセルのデータ密度を計算
    const heatmapData: number[][] = Array(gridHeight).fill(null).map(() => Array(gridWidth).fill(0));
    
    data.forEach(point => {
      const x = ((point.timestamp - timeRange.min) / (timeRange.max - timeRange.min)) * chartWidth;
      const y = ((rssiRange.max - point.rssi) / (rssiRange.max - rssiRange.min)) * chartHeight;
      
      const gridX = Math.floor(x / gridSize);
      const gridY = Math.floor(y / gridSize);
      
      if (gridX >= 0 && gridX < gridWidth && gridY >= 0 && gridY < gridHeight) {
        heatmapData[gridY][gridX]++;
      }
    });
    
    // ヒートマップ描画
    const maxDensity = Math.max(...heatmapData.flat());
    
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        const density = heatmapData[y][x];
        if (density > 0) {
          const intensity = density / maxDensity;
          const color = getHeatmapColor(intensity);
          
          ctx.fillStyle = color;
          ctx.fillRect(
            padding.left + x * gridSize,
            padding.top + y * gridSize,
            gridSize,
            gridSize
          );
        }
      }
    }
  };

  // === データをデバイスごとにグループ化 ===
  const groupDataByDevice = (data: RSSIDataPoint[]) => {
    const grouped: Record<string, RSSIDataPoint[]> = {};
    
    data.forEach(point => {
      const key = `${point.deviceId}-${point.beaconId}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(point);
    });
    
    // 時間順にソート
    Object.values(grouped).forEach(points => {
      points.sort((a, b) => a.timestamp - b.timestamp);
    });
    
    return grouped;
  };

  // === デバイス色を取得 ===
  const getDeviceColor = (key: string, index: number) => {
    const colors = [
      '#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6',
      '#1abc9c', '#34495e', '#e67e22', '#95a5a6', '#d35400'
    ];
    return colors[index % colors.length];
  };

  // === ヒートマップ色を取得 ===
  const getHeatmapColor = (intensity: number) => {
    const r = Math.floor(255 * intensity);
    const g = Math.floor(255 * (1 - intensity));
    const b = 100;
    return `rgba(${r}, ${g}, ${b}, ${0.3 + intensity * 0.7})`;
  };

  // === 軸描画 ===
  const drawAxes = (
    ctx: CanvasRenderingContext2D,
    padding: any,
    chartWidth: number,
    chartHeight: number,
    timeRange: any,
    rssiRange: any
  ) => {
    ctx.fillStyle = '#666';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';

    // X軸（時間）
    for (let i = 0; i <= 6; i++) {
      const x = padding.left + (i / 6) * chartWidth;
      const time = timeRange.min + (i / 6) * (timeRange.max - timeRange.min);
      const timeLabel = new Date(time).toLocaleTimeString();
      ctx.fillText(timeLabel, x, padding.top + chartHeight + 20);
    }

    // Y軸（RSSI）
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (i / 5) * chartHeight;
      const rssi = rssiRange.max - (i / 5) * (rssiRange.max - rssiRange.min);
      ctx.fillText(`${Math.round(rssi)}dBm`, padding.left - 10, y + 3);
    }

    // 軸ラベル
    ctx.textAlign = 'center';
    ctx.font = '12px Arial';
    ctx.fillText('時間', padding.left + chartWidth / 2, padding.top + chartHeight + 35);
    
    ctx.save();
    ctx.translate(15, padding.top + chartHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('RSSI (dBm)', 0, 0);
    ctx.restore();
  };

  // === ツールチップ描画 ===
  const drawTooltip = (
    ctx: CanvasRenderingContext2D,
    point: RSSIDataPoint,
    padding: any,
    chartWidth: number,
    chartHeight: number,
    timeRange: any,
    rssiRange: any
  ) => {
    const x = padding.left + ((point.timestamp - timeRange.min) / (timeRange.max - timeRange.min)) * chartWidth;
    const y = padding.top + ((rssiRange.max - point.rssi) / (rssiRange.max - rssiRange.min)) * chartHeight;

    // ツールチップ背景
    const tooltipText = [
      `${point.deviceName}`,
      `${point.beaconName}`,
      `RSSI: ${point.rssi}dBm`,
      `${new Date(point.timestamp).toLocaleTimeString()}`
    ];

    const maxWidth = Math.max(...tooltipText.map(text => ctx.measureText(text).width)) + 20;
    const tooltipHeight = tooltipText.length * 16 + 10;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(x + 10, y - tooltipHeight, maxWidth, tooltipHeight);

    // ツールチップテキスト
    ctx.fillStyle = 'white';
    ctx.font = '11px Arial';
    ctx.textAlign = 'left';
    
    tooltipText.forEach((text, index) => {
      ctx.fillText(text, x + 15, y - tooltipHeight + 15 + index * 16);
    });
  };

  // === 凡例描画 ===
  const drawLegend = (
    ctx: CanvasRenderingContext2D,
    data: RSSIDataPoint[],
    width: number,
    height: number,
    padding: any
  ) => {
    const uniqueKeys = [...new Set(data.map(d => `${d.deviceName} - ${d.beaconName}`))];
    
    ctx.font = '10px Arial';
    ctx.textAlign = 'left';
    
    uniqueKeys.slice(0, 5).forEach((key, index) => {
      const color = getDeviceColor(key, index);
      const y = padding.top + index * 20;
      
      // 色サンプル
      ctx.fillStyle = color;
      ctx.fillRect(width - 70, y, 10, 10);
      
      // ラベル
      ctx.fillStyle = '#666';
      ctx.fillText(key.length > 15 ? key.substring(0, 15) + '...' : key, width - 55, y + 8);
    });
  };

  // === マウスイベントハンドラー ===
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // クリックされた点を検索
    const filteredData = getFilteredData();
    const timeRange = getTimeRange(filteredData);
    const rssiRange = getRSSIRange(filteredData);
    const padding = { top: 20, right: 80, bottom: 40, left: 60 };
    const chartWidth = canvas.width - padding.left - padding.right;
    const chartHeight = canvas.height - padding.top - padding.bottom;

    for (const point of filteredData) {
      const pointX = padding.left + ((point.timestamp - timeRange.min) / (timeRange.max - timeRange.min)) * chartWidth;
      const pointY = padding.top + ((rssiRange.max - point.rssi) / (rssiRange.max - rssiRange.min)) * chartHeight;

      if (Math.sqrt((x - pointX) ** 2 + (y - pointY) ** 2) < 10) {
        if (onDeviceSelect) onDeviceSelect(point.deviceId);
        if (onBeaconSelect) onBeaconSelect(point.beaconId);
        break;
      }
    }
  };

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // ホバーされた点を検索
    const filteredData = getFilteredData();
    const timeRange = getTimeRange(filteredData);
    const rssiRange = getRSSIRange(filteredData);
    const padding = { top: 20, right: 80, bottom: 40, left: 60 };
    const chartWidth = canvas.width - padding.left - padding.right;
    const chartHeight = canvas.height - padding.top - padding.bottom;

    let foundPoint: RSSIDataPoint | null = null;

    for (const point of filteredData) {
      const pointX = padding.left + ((point.timestamp - timeRange.min) / (timeRange.max - timeRange.min)) * chartWidth;
      const pointY = padding.top + ((rssiRange.max - point.rssi) / (rssiRange.max - rssiRange.min)) * chartHeight;

      if (Math.sqrt((x - pointX) ** 2 + (y - pointY) ** 2) < 10) {
        foundPoint = point;
        break;
      }
    }

    setHoveredPoint(foundPoint);
  };

  return (
    <div className={`rssi-chart ${className || ''}`}>
      {/* ヘッダー */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        padding: '12px 16px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        border: '1px solid #e1e8ed'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '16px',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          📈 RSSI チャート
          <span style={{
            fontSize: '12px',
            padding: '2px 8px',
            backgroundColor: isRealtime ? '#4CAF50' : '#9E9E9E',
            color: 'white',
            borderRadius: '8px',
            fontWeight: 'normal'
          }}>
            {isRealtime ? 'リアルタイム' : '停止中'}
          </span>
        </h3>

        {/* 制御ボタン */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['line', 'scatter', 'heatmap'] as const).map(type => (
            <button
              key={type}
              onClick={() => setChartConfig(prev => ({ ...prev, chartType: type }))}
              style={{
                padding: '4px 8px',
                backgroundColor: chartType === type ? '#3498db' : '#f8f9fa',
                color: chartType === type ? 'white' : '#666',
                border: 'none',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              {{
                line: '📈 線',
                scatter: '⚫ 散布',
                heatmap: '🔥 熱'
              }[type]}
            </button>
          ))}
          
          <button
            onClick={() => setIsRealtime(prev => !prev)}
            style={{
              padding: '4px 8px',
              backgroundColor: isRealtime ? '#e74c3c' : '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            {isRealtime ? '⏸️ 停止' : '▶️ 開始'}
          </button>
        </div>
      </div>

      {/* 統計情報 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
        gap: '12px',
        marginBottom: '16px',
        padding: '12px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#3498db' }}>
            {chartStats.averageRSSI.toFixed(1)}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>平均RSSI</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#4CAF50' }}>
            {chartStats.maxRSSI}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>最大RSSI</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#e74c3c' }}>
            {chartStats.minRSSI}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>最小RSSI</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#FF9800' }}>
            {chartStats.signalCount}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>信号数</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#9b59b6' }}>
            {chartStats.activeDevices}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>デバイス</div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1abc9c' }}>
            {chartStats.activeBeacons}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>ビーコン</div>
        </div>
      </div>

      {/* チャートキャンバス */}
      <div className="card">
        <canvas
          ref={canvasRef}
          width={800}
          height={400}
          style={{
            width: '100%',
            height: 'auto',
            cursor: 'crosshair'
          }}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={() => setHoveredPoint(null)}
        />
      </div>

      {/* 設定パネル */}
      <details style={{ marginTop: '16px' }}>
        <summary style={{
          cursor: 'pointer',
          padding: '8px',
          backgroundColor: '#f8f9fa',
          borderRadius: '4px'
        }}>
          ⚙️ チャート設定
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
          <div>
            <label style={{ fontSize: '12px', color: '#666' }}>時間窓 (秒)</label>
            <input
              type="range"
              min="10"
              max="300"
              value={chartConfig.timeWindow}
              onChange={(e) => setChartConfig(prev => ({ ...prev, timeWindow: parseInt(e.target.value) }))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px' }}>{chartConfig.timeWindow}秒</span>
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: '#666' }}>更新間隔 (ミリ秒)</label>
            <input
              type="range"
              min="500"
              max="5000"
              step="500"
              value={chartConfig.updateInterval}
              onChange={(e) => setChartConfig(prev => ({ ...prev, updateInterval: parseInt(e.target.value) }))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px' }}>{chartConfig.updateInterval}ms</span>
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: '#666' }}>RSSI範囲</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="number"
                value={chartConfig.rssiMin}
                onChange={(e) => setChartConfig(prev => ({ ...prev, rssiMin: parseInt(e.target.value) }))}
                style={{ width: '60px', fontSize: '10px' }}
                disabled={localAutoScale} // 🔥 修正: localAutoScaleを使用
              />
              <span style={{ fontSize: '10px' }}>〜</span>
              <input
                type="number"
                value={chartConfig.rssiMax}
                onChange={(e) => setChartConfig(prev => ({ ...prev, rssiMax: parseInt(e.target.value) }))}
                style={{ width: '60px', fontSize: '10px' }}
                disabled={localAutoScale} // 🔥 修正: localAutoScaleを使用
              />
            </div>
            <label style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
              <input
                type="checkbox"
                checked={localAutoScale} // 🔥 修正: localAutoScaleを使用
                onChange={(e) => setLocalAutoScale(e.target.checked)} // 🔥 修正: setLocalAutoScaleを使用
              />
              自動スケール
            </label>
          </div>
        </div>
      </details>
    </div>
  );
}
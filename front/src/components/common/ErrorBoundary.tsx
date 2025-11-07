// React エラーバウンダリーコンポーネント

import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string;
  retryCount: number;
  lastErrorTime: number;
  isRetrying: boolean;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, retry: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo, errorId: string) => void;
  enableRetry?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  showErrorDetails?: boolean;
  reportErrors?: boolean;
  context?: 'device' | 'map' | 'auth' | 'data' | 'ui' | 'chirpstack' | 'general';
  className?: string;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryTimeoutId: NodeJS.Timeout | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: '',
      retryCount: 0,
      lastErrorTime: 0,
      isRetrying: false
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      hasError: true,
      error,
      errorId,
      lastErrorTime: Date.now()
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { onError, reportErrors = true, context = 'general' } = this.props;
    const { errorId } = this.state;
    
    // エラー情報を状態に保存
    this.setState({ errorInfo });
    
    // エラーコールバック実行
    if (onError) {
      onError(error, errorInfo, errorId);
    }
    
    // エラーレポート
    if (reportErrors) {
      this.reportError(error, errorInfo, errorId, context);
    }
    
    // コンソールログ
    console.group(`🚨 ErrorBoundary Caught Error [${context}]`);
    console.error('Error:', error);
    console.error('Error Info:', errorInfo);
    console.error('Error ID:', errorId);
    console.groupEnd();
  }

  private reportError = async (
    error: Error, 
    errorInfo: ErrorInfo, 
    errorId: string, 
    context: string
  ) => {
    try {
      // Firebase Analytics にエラーレポート
      const errorData = {
        errorId,
        context,
        errorType: error.constructor.name,
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
        // デバイス情報があれば追加
        ...(this.getDeviceContext())
      };
      
      // Firebase Analyticsまたはログサービスに送信
    } catch (reportError) {
      console.error('Failed to report error:', reportError);
    }
  };

  private getDeviceContext = () => {
    // 現在のデバイス情報を取得（可能であれば）
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      online: navigator.onLine,
      cookieEnabled: navigator.cookieEnabled
    };
  };

  private getErrorType = (error: Error): string => {
    if (error.name === 'ChunkLoadError') return 'chunk_load';
    if (error.message.includes('Network')) return 'network';
    if (error.message.includes('Firebase')) return 'firebase';
    if (error.message.includes('ChirpStack')) return 'chirpstack';
    if (error.message.includes('Geolocation')) return 'geolocation';
    return 'unknown';
  };

  private getErrorMessage = (error: Error, context: string): string => {
    const errorType = this.getErrorType(error);
    
    const messages = {
      chunk_load: 'アプリケーションの読み込みに失敗しました。ページを再読み込みしてください。',
      network: 'ネットワーク接続に問題があります。接続を確認してください。',
      firebase: 'データベース接続に問題があります。しばらく待ってから再試行してください。',
      chirpstack: 'LoRaWANサーバーとの通信に失敗しました。デバイスの接続を確認してください。',
      geolocation: '位置情報の取得に失敗しました。位置情報の許可を確認してください。',
      unknown: '予期しないエラーが発生しました。ページを再読み込みしてください。'
    };
    
    return messages[errorType as keyof typeof messages] || messages.unknown;
  };

  private getSuggestions = (error: Error, context: string): string[] => {
    const errorType = this.getErrorType(error);
    
    const suggestions = {
      chunk_load: [
        'ページを再読み込みしてください',
        'ブラウザのキャッシュをクリアしてください',
        'ネットワーク接続を確認してください'
      ],
      network: [
        'インターネット接続を確認してください',
        'Wi-Fi または モバイルデータを確認してください',
        'しばらく待ってから再試行してください'
      ],
      firebase: [
        'しばらく待ってから再試行してください',
        'ログアウトして再ログインしてください',
        'ブラウザを再起動してください'
      ],
      chirpstack: [
        'デバイスの電源を確認してください',
        'LoRaWANゲートウェイの接続を確認してください',
        '管理者に連絡してください'
      ],
      geolocation: [
        'ブラウザの位置情報許可を確認してください',
        'GPS機能を有効にしてください',
        '屋外で再試行してください'
      ],
      unknown: [
        'ページを再読み込みしてください',
        'ブラウザを再起動してください',
        '問題が続く場合はサポートに連絡してください'
      ]
    };
    
    return suggestions[errorType as keyof typeof suggestions] || suggestions.unknown;
  };

  private handleRetry = () => {
    const { maxRetries = 3, retryDelay = 1000 } = this.props;
    const { retryCount } = this.state;
    
    if (retryCount >= maxRetries) {
      console.warn(`Max retries (${maxRetries}) reached`);
      return;
    }
    
    this.setState({ isRetrying: true });
    
    // 指数バックオフでリトライ
    const delay = retryDelay * Math.pow(2, retryCount);
    
    this.retryTimeoutId = setTimeout(() => {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        errorId: '',
        retryCount: retryCount + 1,
        isRetrying: false
      });
    }, delay);
  };

  private handleReset = () => {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
    
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: '',
      retryCount: 0,
      lastErrorTime: 0,
      isRetrying: false
    });
  };

  private handleReload = () => {
    window.location.reload();
  };

  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  render() {
    const { hasError, error, errorInfo, retryCount, isRetrying } = this.state;
    const { 
      children, 
      fallback, 
      enableRetry = true, 
      maxRetries = 3,
      showErrorDetails = false,
      context = 'general',
      className 
    } = this.props;
    
    if (hasError && error) {
      // カスタムフォールバックが関数の場合
      if (typeof fallback === 'function') {
        return fallback(error, this.handleRetry);
      }
      
      // カスタムフォールバックがReactNodeの場合
      if (fallback) {
        return fallback;
      }
      
      // デフォルトエラー表示
      const errorMessage = this.getErrorMessage(error, context);
      const suggestions = this.getSuggestions(error, context);
      const canRetry = enableRetry && retryCount < maxRetries;
      
      return (
        <div 
          className={`error-boundary ${className || ''}`}
          style={{
            padding: '24px',
            backgroundColor: '#fff5f5',
            border: '1px solid #fed7d7',
            borderRadius: '8px',
            margin: '16px',
            textAlign: 'center'
          }}
        >
          {/* エラーアイコン */}
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>
            {context === 'device' && '📱'}
            {context === 'map' && '🗺️'}
            {context === 'auth' && '🔐'}
            {context === 'data' && '💾'}
            {context === 'chirpstack' && '📡'}
            {!['device', 'map', 'auth', 'data', 'chirpstack'].includes(context) && '⚠️'}
          </div>
          
          {/* エラーメッセージ */}
          <h3 style={{ color: '#c53030', marginBottom: '16px' }}>
            問題が発生しました
          </h3>
          
          <p style={{ color: '#2d3748', marginBottom: '20px', lineHeight: '1.5' }}>
            {errorMessage}
          </p>
          
          {/* 解決策の提案 */}
          <div style={{ marginBottom: '24px', textAlign: 'left', maxWidth: '400px', margin: '0 auto 24px' }}>
            <h4 style={{ color: '#2d3748', marginBottom: '8px', fontSize: '14px' }}>
              解決方法:
            </h4>
            <ul style={{ color: '#4a5568', fontSize: '13px', paddingLeft: '20px' }}>
              {suggestions.map((suggestion, index) => (
                <li key={index} style={{ marginBottom: '4px' }}>
                  {suggestion}
                </li>
              ))}
            </ul>
          </div>
          
          {/* アクションボタン */}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {canRetry && (
              <button
                onClick={this.handleRetry}
                disabled={isRetrying}
                style={{
                  padding: '8px 16px',
                  backgroundColor: isRetrying ? '#a0aec0' : '#3182ce',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: isRetrying ? 'not-allowed' : 'pointer',
                  fontSize: '14px'
                }}
              >
                {isRetrying ? '再試行中...' : `再試行 (${maxRetries - retryCount}回残り)`}
              </button>
            )}
            
            <button
              onClick={this.handleReset}
              style={{
                padding: '8px 16px',
                backgroundColor: '#38a169',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              リセット
            </button>
            
            <button
              onClick={this.handleReload}
              style={{
                padding: '8px 16px',
                backgroundColor: '#d69e2e',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              ページ再読み込み
            </button>
          </div>
          
          {/* エラー詳細（開発モードまたは明示的に有効な場合） */}
          {(showErrorDetails || process.env.NODE_ENV === 'development') && (
            <details style={{ marginTop: '24px', textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', color: '#4a5568', fontSize: '12px' }}>
                技術詳細 (開発者向け)
              </summary>
              <div style={{
                marginTop: '8px',
                padding: '12px',
                backgroundColor: '#f7fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '4px',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#2d3748',
                whiteSpace: 'pre-wrap',
                maxHeight: '200px',
                overflow: 'auto'
              }}>
                <div><strong>Error:</strong> {error.name}: {error.message}</div>
                <div><strong>Stack:</strong></div>
                <div>{error.stack}</div>
                {errorInfo && (
                  <>
                    <div><strong>Component Stack:</strong></div>
                    <div>{errorInfo.componentStack}</div>
                  </>
                )}
              </div>
            </details>
          )}
        </div>
      );
    }
    
    return children;
  }
}

// HOC版のエラーバウンダリー
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) {
  return function WrappedComponent(props: P) {
    return (
      <ErrorBoundary {...errorBoundaryProps}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}

// フック版（エラーバウンダリー内で使用）
export function useErrorHandler() {
  return (error: Error, errorInfo?: { [key: string]: any }) => {
    console.error('Error caught by error handler:', error, errorInfo);
    throw error; // ErrorBoundaryにキャッチさせる
  };
}

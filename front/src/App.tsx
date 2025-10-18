import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import './styles.css';
import 'leaflet/dist/leaflet.css';
import { auth } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';

// Pages
import Dashboard from './pages/Dashboard';
import Mode1Indoor from './pages/Mode1Indoor';
import Mode2Bus from './pages/Mode2Bus';
import Mode3GPS from './pages/Mode3GPS';
import Management from './pages/Management';
import Calibration from './pages/Calibration';
import AddCalibrationPoint from './pages/AddCalibrationPoint';
import Login from './pages/Login';
import { AppMode } from './types';

function App() {
  const [currentMode, setCurrentMode] = useState<AppMode>('mode1');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 認証状態の監視
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('ログアウトエラー:', error);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  // ログインしていない場合はログインページを表示
  if (!user) {
    return (
      <Router>
        <Routes>
          <Route path="*" element={<Login />} />
        </Routes>
      </Router>
    );
  }

  return (
    <Router>
      <div className="app">
        <header className="header">
          <div className="header-content">
            <Link to="/" className="logo">
              見守りカード
            </Link>
            <nav className="nav">
              <Link to="/" className="nav-link">ホーム</Link>
              <Link to="/management" className="nav-link">管理</Link>
              <Link to="/calibration" className="nav-link">キャリブレーション</Link>
              <button onClick={handleLogout} className="nav-link logout-button">
                ログアウト
              </button>
            </nav>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Dashboard currentMode={currentMode} setCurrentMode={setCurrentMode} />} />
          <Route path="/mode1" element={<Mode1Indoor />} />
          <Route path="/mode2" element={<Mode2Bus />} />
          <Route path="/mode3" element={<Mode3GPS />} />
          <Route path="/management" element={<Management />} />
          <Route path="/calibration/:mode" element={<Calibration />} />
          <Route path="/add-calibration-point/:roomId" element={<AddCalibrationPoint />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;

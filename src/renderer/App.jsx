import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Gangsheet from './pages/Gangsheet';
import Reprint from './pages/Reprint';
import Reasons from './pages/Reasons';
import { DialogHost } from './components/Dialog';

function ProtectedRoute({ children }) {
  const { user, loading, logout } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f5f0eb]">
        <div className="text-neutral-500">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;
  // Partner app: only the 'partner' role (admin allowed for support/testing).
  const slug = user.role?.slug;
  if (slug !== 'partner' && slug !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#f5f0eb] p-6 text-center">
        <h1 className="text-xl font-bold text-neutral-800 mb-2">Chỉ partner mới được truy cập</h1>
        <p className="text-sm text-neutral-600 mb-4">
          Tài khoản <b>{user.email}</b> đang ở role <b>{user.role?.name || '—'}</b>.
        </p>
        <p className="text-xs text-neutral-500 max-w-md mb-6">
          App BullStart Partner chỉ dành cho tài khoản partner. Liên hệ admin để được cấp quyền.
        </p>
        <button
          onClick={() => logout().then(() => { window.location.hash = '#/login'; })}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg"
        >
          Logout + đăng nhập tài khoản khác
        </button>
      </div>
    );
  }
  return children;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="gangsheet" element={<Gangsheet />} />
          <Route path="reprint" element={<Reprint />} />
          <Route path="reasons" element={<Reasons />} />
        </Route>
      </Routes>
      <DialogHost />
    </>
  );
}

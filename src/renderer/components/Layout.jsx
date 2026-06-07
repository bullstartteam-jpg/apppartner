import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import logo from '../assets/logo.png';

// Partner sidebar — Dashboard + the gangsheets assigned to this partner.
const navItems = [
  { path: '/',          label: 'Dashboard', icon: '◉' },
  { path: '/gangsheet', label: 'Gangsheet', icon: '▦' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-[#f5f0eb]">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-neutral-200 flex flex-col shadow-sm">
        <div className="p-4 border-b border-neutral-200 titlebar-drag flex items-center gap-2">
          <img src={logo} alt="BullStart Partner" className="h-8" />
          <div className="leading-tight">
            <h1 className="text-sm font-bold text-neutral-800 tracking-wide">BULLSTART</h1>
            <p className="text-[10px] font-semibold text-orange-600 tracking-widest">PARTNER</p>
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-orange-500 text-white'
                    : 'text-neutral-600 hover:bg-orange-50 hover:text-orange-600'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-neutral-200">
          <div className="text-xs text-neutral-700 font-medium px-2">{user?.name}</div>
          <div className="text-xs text-neutral-400 px-2">{user?.email}</div>
          <div className="text-[10px] text-neutral-400 px-2 mt-0.5">{user?.role?.name}</div>
          <button
            onClick={handleLogout}
            className="w-full text-xs text-neutral-400 hover:text-red-500 py-1 px-2 text-left transition-colors mt-2"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

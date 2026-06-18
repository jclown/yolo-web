import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Crosshair,
  Tags,
  Dumbbell,
  Database,
  Sparkles,
  Settings,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '仪表盘' },
  { to: '/detect', icon: Crosshair, label: '目标检测' },
  { to: '/annotate', icon: Tags, label: '标注编辑器' },
  { to: '/train', icon: Dumbbell, label: '模型训练' },
  { to: '/datasets', icon: Database, label: '数据集管理' },
  { to: '/augment', icon: Sparkles, label: '数据扩增' },
];

export default function Layout() {
  return (
    <div className="flex h-screen bg-[#1a1f36] text-white">
      <aside className="w-64 bg-[#12162a] border-r border-white/10 flex flex-col">
        <div className="p-6 border-b border-white/10">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            YOLO 平台
          </h1>
          <p className="text-xs text-gray-400 mt-1">检测与训练</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border-l-4 border-blue-500'
                    : 'text-gray-300 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <Icon size={20} />
              <span className="font-medium">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-gray-300 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <Settings size={20} />
            <span className="font-medium">系统设置</span>
          </NavLink>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

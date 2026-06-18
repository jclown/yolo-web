import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Crosshair,
  Tags,
  Dumbbell,
  Database,
  Sparkles,
  Settings,
  Image,
  FileText,
  CheckCircle,
  TrendingUp,
} from 'lucide-react';
import { datasetsApi } from '@/api';

const features = [
  { to: '/detect', icon: Crosshair, label: '目标检测', desc: '在图像上运行 YOLO 检测', color: 'from-blue-500 to-cyan-500' },
  { to: '/annotate', icon: Tags, label: '标注编辑器', desc: '使用边界框标注图像', color: 'from-purple-500 to-pink-500' },
  { to: '/train', icon: Dumbbell, label: '模型训练', desc: '训练自定义 YOLO 模型', color: 'from-green-500 to-emerald-500' },
  { to: '/datasets', icon: Database, label: '数据集管理', desc: '管理您的图像数据集', color: 'from-orange-500 to-yellow-500' },
  { to: '/augment', icon: Sparkles, label: '数据扩增', desc: '应用数据扩增策略', color: 'from-indigo-500 to-violet-500' },
  { to: '/settings', icon: Settings, label: '系统设置', desc: '配置平台偏好设置', color: 'from-gray-500 to-slate-500' },
];

interface DashboardData {
  datasetCount: number;
  imageCount: number;
  annotatedImageCount: number;
  modelCount: number;
  datasets: { id: string; name: string; imageCount: number; annotatedCount: number }[];
}

export default function Home() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  useEffect(() => {
    datasetsApi.getDashboardStats().then((res) => {
      setDashboard(res.data);
    }).catch((err) => {
      console.error('Failed to load dashboard stats:', err);
    });
  }, []);

  const stats = dashboard
    ? [
        { label: '数据集', value: dashboard.datasetCount, icon: Database, color: 'text-blue-400' },
        { label: '总图像数', value: dashboard.imageCount, icon: Image, color: 'text-green-400' },
        { label: '已标注', value: dashboard.annotatedImageCount, icon: CheckCircle, color: 'text-purple-400' },
        { label: '已训练模型', value: dashboard.modelCount, icon: FileText, color: 'text-orange-400' },
      ]
    : [
        { label: '数据集', value: 0, icon: Database, color: 'text-blue-400' },
        { label: '总图像数', value: 0, icon: Image, color: 'text-green-400' },
        { label: '已标注', value: 0, icon: CheckCircle, color: 'text-purple-400' },
        { label: '已训练模型', value: 0, icon: FileText, color: 'text-orange-400' },
      ];

  const progressDatasets = dashboard?.datasets.slice(0, 5) || [];

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">YOLO 检测训练平台</h1>
        <p className="text-gray-400 mt-2">管理您的检测、标注和训练工作流程</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-[#12162a] rounded-lg shadow p-6 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">{label}</p>
                <p className="text-3xl font-bold mt-1">{value.toLocaleString()}</p>
              </div>
              <Icon size={32} className={color} />
            </div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">快速操作</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(({ to, icon: Icon, label, desc, color }) => (
            <Link
              key={label}
              to={to}
              className="bg-[#12162a] rounded-lg shadow p-6 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group"
            >
              <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                <Icon size={24} className="text-white" />
              </div>
              <h3 className="text-lg font-semibold">{label}</h3>
              <p className="text-sm text-gray-400 mt-1">{desc}</p>
            </Link>
          ))}
        </div>
      </div>

      {progressDatasets.length > 0 && (
        <div className="bg-[#12162a] rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">标注进度</h2>
          <div className="space-y-4">
            {progressDatasets.map((ds) => {
              const pct = ds.imageCount > 0 ? (ds.annotatedCount / ds.imageCount) * 100 : 0;
              return (
                <div key={ds.id} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{ds.name}</span>
                    <span className="text-gray-400">{ds.annotatedCount}/{ds.imageCount}</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

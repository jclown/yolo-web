import { useState, useEffect, useRef } from 'react';
import {
  RotateCw,
  FlipHorizontal,
  Crop,
  Palette,
  Grid3x3,
  Layers,
  Droplets,
  Sparkle,
  Play,
  Trash2,
  CheckCircle,
  Clock,
  Loader2,
  Square,
} from 'lucide-react';
import { augmentApi } from '@/api';
import { useAppStore, type AugmentationTask } from '@/store/appStore';

const strategies = [
  { id: 'rotation', icon: RotateCw, label: '旋转', desc: '随机角度旋转图像', color: 'from-blue-500 to-cyan-500', params: [{ name: '角度', min: -45, max: 45, default: 15, unit: '度' }] },
  { id: 'flip', icon: FlipHorizontal, label: '翻转', desc: '水平和垂直翻转', color: 'from-green-500 to-emerald-500', params: [{ name: '水平', min: 0, max: 1, default: 1, unit: '' }, { name: '垂直', min: 0, max: 1, default: 0, unit: '' }] },
  { id: 'crop', icon: Crop, label: '随机裁剪', desc: '从图像中裁剪随机区域', color: 'from-purple-500 to-pink-500', params: [{ name: '最小比例', min: 0.5, max: 0.9, default: 0.7, unit: '' }] },
  { id: 'color', icon: Palette, label: '颜色抖动', desc: '调整亮度、对比度、饱和度', color: 'from-orange-500 to-yellow-500', params: [{ name: '亮度', min: 0, max: 0.5, default: 0.2, unit: '' }, { name: '对比度', min: 0, max: 0.5, default: 0.2, unit: '' }] },
  { id: 'mosaic', icon: Grid3x3, label: '马赛克', desc: '将 4 张图像组合成一张马赛克图像', color: 'from-indigo-500 to-violet-500', params: [{ name: '缩放', min: 0.3, max: 0.7, default: 0.5, unit: '' }] },
  { id: 'mixup', icon: Layers, label: '混合', desc: '混合两张图像及其标签', color: 'from-red-500 to-orange-500', params: [{ name: '阿尔法', min: 0.1, max: 1, default: 0.3, unit: '' }] },
  { id: 'blur', icon: Droplets, label: '高斯模糊', desc: '应用高斯模糊效果', color: 'from-teal-500 to-cyan-500', params: [{ name: '西格玛', min: 0.5, max: 5, default: 1.5, unit: '' }] },
  { id: 'noise', icon: Sparkle, label: '噪声', desc: '向图像添加随机噪声', color: 'from-gray-500 to-slate-500', params: [{ name: '强度', min: 0, max: 0.1, default: 0.02, unit: '' }] },
];

export default function Augment() {
  const { datasets, loadDatasets } = useAppStore();
  const [selectedStrategies, setSelectedStrategies] = useState<Record<string, Record<string, number>>>({});
  const [taskName, setTaskName] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [multiplier, setMultiplier] = useState(5);
  const [tasks, setTasks] = useState<AugmentationTask[]>([]);
  const [previewStrategy, setPreviewStrategy] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadDatasets();
    loadTasks();
  }, []);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      const hasRunning = tasks.some((t) => t.status === 'running');
      if (hasRunning) loadTasks();
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [tasks]);

  const loadTasks = async () => {
    try {
      const res = await augmentApi.list();
      const list = (res.data || []).map((t: any) => ({
        id: t.id,
        name: t.name || `augment-${t.id.slice(0, 8)}`,
        dataset_id: t.dataset_id,
        strategies: typeof t.strategies === 'string' ? JSON.parse(t.strategies) : (t.strategies || []),
        multiplier: t.multiplier || 5,
        imageCount: t.image_count ?? 0,
        status: t.status,
        progress: t.progress ?? 0,
        createdAt: t.created_at ?? '',
      }));
      setTasks(list);
    } catch (err) {
      console.error('Failed to load tasks:', err);
    }
  };

  const toggleStrategy = (id: string) => {
    setSelectedStrategies((prev) => {
      if (prev[id]) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      const strategy = strategies.find((s) => s.id === id);
      const params: Record<string, number> = {};
      strategy?.params.forEach((p) => { params[p.name] = p.default; });
      return { ...prev, [id]: params };
    });
  };

  const updateParam = (strategyId: string, paramName: string, value: number) => {
    setSelectedStrategies((prev) => ({
      ...prev,
      [strategyId]: { ...prev[strategyId], [paramName]: value },
    }));
  };

  const createTask = async () => {
    if (!taskName.trim() || Object.keys(selectedStrategies).length === 0 || !selectedDatasetId) return;
    try {
      const strategyList = Object.entries(selectedStrategies).map(([type, params]) => ({ type, params }));
      await augmentApi.createTask({
        name: taskName,
        dataset_id: selectedDatasetId,
        strategies: strategyList,
        multiplier,
      });
      setTaskName('');
      setSelectedStrategies({});
      setMultiplier(5);
      loadTasks();
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  };

  const stopTask = async (id: string) => {
    try {
      await augmentApi.stop(id);
      loadTasks();
    } catch (err) {
      console.error('Failed to stop task:', err);
    }
  };

  const deleteTask = async (id: string) => {
    try {
      await augmentApi.delete(id);
      loadTasks();
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  const selectedDataset = datasets.find((d) => d.id === selectedDatasetId);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">数据扩增</h1>
        <p className="text-gray-400 mt-2">应用扩增策略来扩展您的数据集</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-[#12162a] rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">扩增策略</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {strategies.map(({ id, icon: Icon, label, desc, color, params }) => {
                const isSelected = !!selectedStrategies[id];
                return (
                  <div
                    key={id}
                    className={`rounded-lg border transition-all duration-200 ${
                      isSelected ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center`}>
                            <Icon size={20} className="text-white" />
                          </div>
                          <div>
                            <h4 className="font-medium">{label}</h4>
                            <p className="text-xs text-gray-400">{desc}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => toggleStrategy(id)}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-500'
                          }`}
                        >
                          {isSelected && <CheckCircle size={14} className="text-white" />}
                        </button>
                      </div>

                      {isSelected && (
                        <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                          {params.map((p) => (
                            <div key={p.name}>
                              <label className="block text-xs text-gray-400 mb-1">
                                {p.name}: {selectedStrategies[id]?.[p.name]}{p.unit}
                              </label>
                              <input
                                type="range"
                                min={p.min}
                                max={p.max}
                                step={(p.max - p.min) / 100}
                                value={selectedStrategies[id]?.[p.name] || p.default}
                                onChange={(e) => updateParam(id, p.name, parseFloat(e.target.value))}
                                className="w-full accent-blue-500"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {previewStrategy && (
            <div className="bg-[#12162a] rounded-lg shadow p-6 mt-6">
              <h3 className="text-lg font-semibold mb-4">Preview: {strategies.find((s) => s.id === previewStrategy)?.label}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="aspect-video bg-gray-800 rounded-lg flex items-center justify-center">
                  <span className="text-gray-400">原始图像</span>
                </div>
                <div className="aspect-video bg-gray-800 rounded-lg flex items-center justify-center">
                  <span className="text-gray-400">扩增图像</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-[#12162a] rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">创建任务</h3>
            <div className="space-y-4">
              <input
                type="text"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                placeholder="任务名称"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={selectedDatasetId}
                onChange={(e) => setSelectedDatasetId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="" className="bg-gray-900 text-white">选择数据集</option>
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.id} className="bg-gray-900 text-white">
                    {ds.name} ({ds.imageCount} 张图片)
                  </option>
                ))}
              </select>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  扩增倍数: {multiplier}x
                </label>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={multiplier}
                  onChange={(e) => setMultiplier(parseInt(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </div>
              <div className="text-sm text-gray-400">
                已选择: {Object.keys(selectedStrategies).length} 个策略
                {selectedDataset && ` · ${selectedDataset.imageCount} 张图片 → 约 ${selectedDataset.imageCount * multiplier} 张输出`}
              </div>
              <button
                onClick={createTask}
                disabled={!taskName.trim() || Object.keys(selectedStrategies).length === 0 || !selectedDatasetId}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg px-4 py-2 flex items-center justify-center gap-2 transition-colors"
              >
                <Play size={18} />
                创建任务
              </button>
            </div>
          </div>

          <div className="bg-[#12162a] rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">任务列表</h3>
            <div className="space-y-3">
              {tasks.map((task) => (
                <div key={task.id} className="bg-white/5 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium">{task.name}</h4>
                    <div className="flex items-center gap-2">
                      {task.status === 'running' && (
                        <button onClick={() => stopTask(task.id)} className="text-gray-500 hover:text-yellow-400" title="停止">
                          <Square size={14} />
                        </button>
                      )}
                      <button onClick={() => deleteTask(task.id)} className="text-gray-500 hover:text-red-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {task.strategies.map((s: any) => {
                      const stratId = typeof s === 'string' ? s : s.type;
                      const strat = strategies.find((st) => st.id === stratId);
                      return (
                        <span key={stratId} className="text-xs bg-white/10 px-2 py-1 rounded">
                          {strat?.label || stratId}
                        </span>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-gray-400">{task.multiplier}x 扩增</span>
                    <div className="flex items-center gap-2">
                      {task.status === 'completed' && <CheckCircle size={14} className="text-green-400" />}
                      {task.status === 'running' && <Loader2 size={14} className="text-blue-400 animate-spin" />}
                      {task.status === 'pending' && <Clock size={14} className="text-yellow-400" />}
                      {task.status === 'failed' && <span className="text-xs text-red-400">失败</span>}
                      {task.status === 'stopped' && <span className="text-xs text-gray-400">已停止</span>}
                      <span className={`text-xs ${
                        task.status === 'completed' ? 'text-green-400' :
                        task.status === 'running' ? 'text-blue-400' :
                        task.status === 'failed' ? 'text-red-400' :
                        task.status === 'stopped' ? 'text-gray-400' :
                        'text-yellow-400'
                      }`}>
                        {task.status === 'completed' ? '已完成' :
                         task.status === 'running' ? '运行中' :
                         task.status === 'failed' ? '失败' :
                         task.status === 'stopped' ? '已停止' :
                         '等待中'}
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        task.status === 'completed' ? 'bg-green-500' :
                        task.status === 'running' ? 'bg-blue-500' :
                        task.status === 'failed' ? 'bg-red-500' :
                        task.status === 'stopped' ? 'bg-gray-500' :
                        'bg-yellow-500'
                      }`}
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                </div>
              ))}
              {tasks.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">暂无任务</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

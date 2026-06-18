import { useState, useEffect, useRef } from 'react';
import { Play, Square, Loader2, Trophy, Clock, Zap, FolderOpen, Scissors } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { trainApi } from '@/api';
import { useAppStore } from '@/store/appStore';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af' } },
  },
  scales: {
    x: { ticks: { color: '#6b7280' }, grid: { color: '#374151' } },
    y: { ticks: { color: '#6b7280' }, grid: { color: '#374151' } },
  },
};

export default function Train() {
  const [epochs, setEpochs] = useState(100);
  const [batchSize, setBatchSize] = useState(16);
  const [learningRate, setLearningRate] = useState(0.01);
  const [modelPath, setModelPath] = useState('yolov8n.pt');
  const [datasetId, setDatasetId] = useState('');
  const [training, setTraining] = useState(false);
  const [autoSlice, setAutoSlice] = useState(true);
  const [imageSize, setImageSize] = useState(640);
  const [overlapRatio, setOverlapRatio] = useState(0.2);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [currentEpoch, setCurrentEpoch] = useState(0);
  const [totalEpochs, setTotalEpochs] = useState(0);
  const [metrics, setMetrics] = useState<{ epoch: number; trainLoss: number; valLoss: number; mAP50: number; mAP5095: number }[]>([]);
  const [trainedModels, setTrainedModels] = useState<any[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const datasets = useAppStore((s) => s.datasets);
  const loadDatasets = useAppStore((s) => s.loadDatasets);

  useEffect(() => {
    loadDatasets();
    loadTrainedModels();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const loadTrainedModels = async () => {
    try {
      const res = await trainApi.list();
      setTrainedModels(res.data || []);
    } catch {
      setTrainedModels([]);
    }
  };

  const pollTrainingStatus = (taskId: string, total: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await trainApi.getStatus(taskId);
        const task = res.data?.task;
        const taskMetrics = res.data?.metrics || [];
        if (task) {
          setCurrentEpoch(task.current_epoch || 0);
          setMetrics(taskMetrics.map((m: any) => ({
            epoch: m.epoch,
            trainLoss: m.train_loss,
            valLoss: m.val_loss,
            mAP50: m.mAP50,
            mAP5095: m.mAP50_95,
          })));
          if (task.status === 'completed' || task.status === 'failed' || task.status === 'stopped') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setTraining(false);
            loadTrainedModels();
          }
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 3000);
  };

  const startTraining = async () => {
    if (!datasetId || !modelPath.trim()) return;
    setTraining(true);
    setCurrentEpoch(0);
    setMetrics([]);
    try {
      const res = await trainApi.start({
        name: `train-${Date.now()}`,
        model_path: modelPath,
        dataset_id: datasetId,
        epochs,
        batch_size: batchSize,
        learning_rate: learningRate,
        auto_slice: autoSlice,
        overlap_ratio: overlapRatio,
        image_size: imageSize,
      });
      const taskId = res.data?.id;
      if (taskId) {
        setCurrentTaskId(taskId);
        setTotalEpochs(epochs);
        pollTrainingStatus(taskId, epochs);
      }
    } catch (err) {
      console.error('Training failed:', err);
      setTraining(false);
    }
  };

  const stopTraining = async () => {
    if (!currentTaskId) return;
    try {
      await trainApi.stop(currentTaskId);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      setTraining(false);
      loadTrainedModels();
    } catch (err) {
      console.error('Stop failed:', err);
    }
  };

  const lossData = {
    labels: metrics.map((m) => m.epoch),
    datasets: [
      { label: 'Train Loss', data: metrics.map((m) => m.trainLoss), borderColor: '#3b82f6', backgroundColor: '#3b82f620', tension: 0.3 },
      { label: 'Val Loss', data: metrics.map((m) => m.valLoss), borderColor: '#f59e0b', backgroundColor: '#f59e0b20', tension: 0.3 },
    ],
  };

  const mapData = {
    labels: metrics.map((m) => m.epoch),
    datasets: [
      { label: 'mAP@50', data: metrics.map((m) => m.mAP50), borderColor: '#10b981', backgroundColor: '#10b98120', tension: 0.3 },
      { label: 'mAP@50-95', data: metrics.map((m) => m.mAP5095), borderColor: '#8b5cf6', backgroundColor: '#8b5cf620', tension: 0.3 },
    ],
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">模型训练</h1>
        <p className="text-gray-400 mt-2">配置并训练自定义 YOLO 模型</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-[#12162a] rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">训练配置</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">模型路径</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={modelPath}
                  onChange={(e) => setModelPath(e.target.value)}
                  placeholder="例如: yolov8n.pt 或 /path/to/best.pt"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">支持 YOLOv8 预训练模型路径或自定义模型路径</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">数据集</label>
              <select
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="" className="bg-gray-900 text-white">选择数据集...</option>
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.id} className="bg-gray-900 text-white">
                    {ds.name} ({ds.imageCount} 张图片)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Epochs: {epochs}</label>
              <input
                type="range"
                min="10"
                max="500"
                step="10"
                value={epochs}
                onChange={(e) => setEpochs(parseInt(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>10</span>
                <span>500</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Batch Size: {batchSize}</label>
              <input
                type="range"
                min="1"
                max="64"
                step="1"
                value={batchSize}
                onChange={(e) => setBatchSize(parseInt(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>1</span>
                <span>64</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Learning Rate: {learningRate}</label>
              <input
                type="range"
                min="0.0001"
                max="0.1"
                step="0.0001"
                value={learningRate}
                onChange={(e) => setLearningRate(parseFloat(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>

            <div className="border-t border-white/10 pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scissors size={16} className="text-green-400" />
                  <label className="text-sm font-medium">自动切片</label>
                </div>
                <button
                  onClick={() => setAutoSlice(!autoSlice)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${autoSlice ? 'bg-green-500' : 'bg-gray-600'}`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${autoSlice ? 'translate-x-5' : ''}`} />
                </button>
              </div>
              {autoSlice && (
                <>
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                    <p className="text-xs text-green-300">
                      当图片分辨率超过模型输入尺寸1.5倍时，自动将大图切片为小图训练。
                      小图保持原样直接使用，无需手动操作。
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">图片尺寸: {imageSize}px</label>
                    <input
                      type="range"
                      min="320"
                      max="1280"
                      step="32"
                      value={imageSize}
                      onChange={(e) => setImageSize(parseInt(e.target.value))}
                      className="w-full accent-green-500"
                    />
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                      <span>320</span>
                      <span>640</span>
                      <span>1280</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">切片重叠率: {(overlapRatio * 100).toFixed(0)}%</label>
                    <input
                      type="range"
                      min="0"
                      max="0.5"
                      step="0.05"
                      value={overlapRatio}
                      onChange={(e) => setOverlapRatio(parseFloat(e.target.value))}
                      className="w-full accent-green-500"
                    />
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                      <span>0%</span>
                      <span>25%</span>
                      <span>50%</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={startTraining}
                disabled={training || !datasetId || !modelPath.trim()}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg px-4 py-3 font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {training ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    训练中...
                  </>
                ) : (
                  <>
                    <Play size={20} />
                    开始训练
                  </>
                )}
              </button>
              {training && (
                <button
                  onClick={stopTraining}
                  className="bg-red-600 hover:bg-red-700 rounded-lg px-4 py-3 font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <Square size={20} />
                  停止
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          {training && (
            <div className="bg-[#12162a] rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">训练进度</h3>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-sm text-green-400">运行中</span>
                </div>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-3 mb-4">
                <div
                  className="bg-gradient-to-r from-green-500 to-emerald-500 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${totalEpochs > 0 ? (currentEpoch / totalEpochs) * 100 : 0}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white/5 rounded-lg p-4 text-center">
                  <Clock size={20} className="mx-auto text-blue-400 mb-2" />
                  <p className="text-sm text-gray-400">轮次</p>
                  <p className="text-xl font-bold">{currentEpoch}/{totalEpochs}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4 text-center">
                  <Zap size={20} className="mx-auto text-yellow-400 mb-2" />
                  <p className="text-sm text-gray-400">批次大小</p>
                  <p className="text-xl font-bold">{batchSize}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4 text-center">
                  <Trophy size={20} className="mx-auto text-green-400 mb-2" />
                  <p className="text-sm text-gray-400">最佳 mAP</p>
                  <p className="text-xl font-bold">
                    {metrics.length > 0 ? (Math.max(...metrics.map((m) => m.mAP50)) * 100).toFixed(1) : 0}%
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#12162a] rounded-lg shadow p-4">
              <h3 className="text-sm font-semibold mb-4">损失曲线</h3>
              <div className="h-64">
                {metrics.length > 0 ? <Line options={chartOptions} data={lossData} /> : <div className="h-full flex items-center justify-center text-gray-500">暂无数据</div>}
              </div>
            </div>
            <div className="bg-[#12162a] rounded-lg shadow p-4">
              <h3 className="text-sm font-semibold mb-4">mAP 指标</h3>
              <div className="h-64">
                {metrics.length > 0 ? <Line options={chartOptions} data={mapData} /> : <div className="h-full flex items-center justify-center text-gray-500">暂无数据</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#12162a] rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">已训练模型</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">名称</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">模型路径</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">mAP@50</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">状态</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {trainedModels.length > 0 ? trainedModels.map((model: any) => (
                <tr key={model.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-3 px-4 font-medium">{model.name}</td>
                  <td className="py-3 px-4 text-gray-400 text-sm">{model.path || model.type}</td>
                  <td className="py-3 px-4 text-green-400">{model.mAP50 ? (model.mAP50 * 100).toFixed(1) + '%' : '-'}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      model.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                      model.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                      model.status === 'stopped' ? 'bg-yellow-500/20 text-yellow-400' :
                      model.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {model.status === 'completed' ? '已完成' :
                       model.status === 'running' ? '训练中' :
                       model.status === 'stopped' ? '已停止' :
                       model.status === 'failed' ? '失败' :
                       model.status || '未知'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-sm">{model.created_at ? new Date(model.created_at).toLocaleString() : '-'}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">暂无已训练模型</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Play, Loader2, X, ZoomIn, Download, Scissors } from 'lucide-react';
import { detectApi } from '@/api';
import { useAppStore, type AnnotationClass } from '@/store/appStore';

interface Detection {
  class: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const classColors = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

// Max pixels on longest side before compression kicks in
const MAX_IMAGE_PIXELS = 1920;
const MAX_FILE_SIZE_MB = 3;

function getClassColor(className: string): string {
  let hash = 0;
  for (let i = 0; i < className.length; i++) {
    hash = className.charCodeAt(i) + ((hash << 5) - hash);
  }
  return classColors[Math.abs(hash) % classColors.length];
}

async function compressImage(file: File): Promise<File> {
  // Check if compression is needed
  const fileSizeMB = file.size / 1024 / 1024;
  const img = await createImageBitmap(file);
  const { width, height } = img;
  img.close();
  const longest = Math.max(width, height);

  if (fileSizeMB <= MAX_FILE_SIZE_MB && longest <= MAX_IMAGE_PIXELS) {
    return file; // no compression needed
  }

  // Calculate new dimensions
  const scale = Math.min(1, MAX_IMAGE_PIXELS / longest);
  const newWidth = Math.round(width * scale);
  const newHeight = Math.round(height * scale);

  // Draw to canvas at reduced size
  const canvas = document.createElement('canvas');
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(await createImageBitmap(file), 0, 0, newWidth, newHeight);

  // Export as JPEG with quality adjustment
  const quality = longest > MAX_IMAGE_PIXELS * 2 ? 0.7 : 0.85;
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/jpeg', quality)
  );

  const ext = file.name.split('.').pop()?.toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const newName = ext === 'jfif' || ext === 'png' ? `${baseName}_compressed.jpg` : file.name;

  return new File([blob], newName, { type: 'image/jpeg' });
}

export default function Detect() {
  const [image, setImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [modelPath, setModelPath] = useState('yolov8n.pt');
  const [confidence, setConfidence] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [compressing, setCompressing] = useState(false);
  const [autoSlice, setAutoSlice] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectRan, setDetectRan] = useState(false);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const modalCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const classes = useAppStore((s) => s.classes);

  const drawOnCanvas = useCallback((canvas: HTMLCanvasElement, imgSrc: string, dets: Detection[]) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      dets.forEach((det) => {
        const color = getClassColor(det.class);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, Math.round(img.naturalWidth / 400));
        ctx.strokeRect(det.x, det.y, det.width, det.height);

        const label = `${det.class} ${(det.confidence * 100).toFixed(1)}%`;
        const fontSize = Math.max(12, Math.round(img.naturalWidth / 60));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const textMetrics = ctx.measureText(label);
        const textHeight = fontSize + 6;
        const padding = 6;

        ctx.fillStyle = color;
        ctx.fillRect(det.x, det.y - textHeight, textMetrics.width + padding * 2, textHeight);

        ctx.fillStyle = '#fff';
        ctx.fillText(label, det.x + padding, det.y - 5);
      });
    };
    img.src = imgSrc;
  }, []);

  useEffect(() => {
    if (detections.length > 0 && image && resultCanvasRef.current) {
      drawOnCanvas(resultCanvasRef.current, image, detections);
    }
  }, [detections, image, drawOnCanvas]);

  useEffect(() => {
    if (showModal && detections.length > 0 && image && modalCanvasRef.current) {
      drawOnCanvas(modalCanvasRef.current, image, detections);
    }
  }, [showModal, detections, image, drawOnCanvas]);

  const handleFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const isJfif = ext === 'jfif';
    if (!file.type.startsWith('image/') && !isJfif) return;
    setImageFile(file);
    setError(null);
    setDetectRan(false);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImage(e.target?.result as string);
      setDetections([]);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDetect = async () => {
    if (!imageFile) return;
    setLoading(true);
    setError(null);
    setDetections([]);
    setElapsedSec(0);

    // elapsed timer
    const elapsedTimer = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);

    const stopLoading = () => {
      clearInterval(elapsedTimer);
      setLoading(false);
      setDetectRan(true);
    };

    try {
      // Compress large images before sending
      setCompressing(true);
      const compressedFile = await compressImage(imageFile);
      setCompressing(false);

      console.log(
        `[Detect] Original: ${(imageFile.size / 1024 / 1024).toFixed(1)}MB, Compressed: ${(compressedFile.size / 1024 / 1024).toFixed(1)}MB`
      );

      const formData = new FormData();
      formData.append('image', compressedFile);
      formData.append('model_path', modelPath);
      formData.append('confidence', confidence.toString());
      formData.append('auto_slice', autoSlice.toString());

      // 1. Start detection task
      const startRes = await detectApi.detect(formData);
      console.log('[Detect] start response:', startRes);
      if (!startRes.success || !startRes.data?.taskId) {
        setError(startRes.error || '启动检测任务失败');
        stopLoading();
        return;
      }

      const taskId = startRes.data.taskId;
      const POLL_INTERVAL = 2000;
      const MAX_WAIT_MS = 180_000;
      const startTime = Date.now();

      // 2. Poll until done / error / timeout
      const poll = async (): Promise<void> => {
        // Client-side timeout guard
        if (Date.now() - startTime > MAX_WAIT_MS) {
          setError('检测超时（超过 3 分钟），请重试');
          stopLoading();
          return;
        }

        try {
          const statusRes = await detectApi.getTaskStatus(taskId);
          console.log('[Detect] poll status:', statusRes);

          if (!statusRes.success) {
            setError(statusRes.error || '查询任务状态失败');
            stopLoading();
            return;
          }

          const { status, detections: rawDetections, error: taskError } = statusRes.data;

          if (status === 'done') {
            const dets: Detection[] = (rawDetections || []).map((d: any) => ({
              class: d.class_name || d.class,
              confidence: d.confidence,
              x: d.bbox?.[0] ?? d.x ?? 0,
              y: d.bbox?.[1] ?? d.y ?? 0,
              width: (d.bbox?.[2] ?? d.x + d.width ?? 0) - (d.bbox?.[0] ?? d.x ?? 0),
              height: (d.bbox?.[3] ?? d.y + d.height ?? 0) - (d.bbox?.[1] ?? d.y ?? 0),
            }));
            console.log('[Detect] done, detections:', dets.length);
            setDetections(dets);
            stopLoading();
            return;
          }

          if (status === 'error') {
            setError(taskError || '检测失败');
            stopLoading();
            return;
          }

          // still pending / running — poll again
          setTimeout(poll, POLL_INTERVAL);
        } catch (err: any) {
          console.error('[Detect] poll error:', err);
          setError(err?.message || '查询状态失败');
          stopLoading();
        }
      };

      // kick off first poll after a short delay
      setTimeout(poll, POLL_INTERVAL);
    } catch (err: any) {
      console.error('Detection failed:', err);
      setError(err?.message || '网络请求失败，请确认后端服务是否运行');
      setCompressing(false);
      stopLoading();
    }
  };

  const handleDownload = () => {
    const canvas = modalCanvasRef.current || resultCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `detection_result_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const uniqueClasses = Object.entries(
    detections.reduce<Record<string, number>>((acc, d) => {
      acc[d.class] = (acc[d.class] || 0) + 1;
      return acc;
    }, {})
  );

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">目标检测</h1>
        <p className="text-gray-400 mt-2">上传图片并运行 YOLO 检测</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600'
            } ${!image ? 'cursor-pointer' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => !image && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/bmp,.jfif"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            {image ? (
              <div className="relative inline-block">
                <img
                  src={image}
                  alt="Uploaded"
                  className="max-h-[400px] mx-auto rounded-lg"
                />
                <button
                  onClick={(e) => { e.stopPropagation(); setImage(null); setImageFile(null); setDetections([]); }}
                  className="absolute top-2 right-2 p-2 bg-red-500/80 rounded-full hover:bg-red-500"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="py-12">
                <Upload size={48} className="mx-auto text-gray-400 mb-4" />
                <p className="text-lg font-medium">拖拽图片到此处</p>
                <p className="text-sm text-gray-400 mt-2">或点击浏览文件</p>
              </div>
            )}
          </div>

          {detectRan && detections.length === 0 && !error && (
            <div className="bg-[#12162a] rounded-lg shadow p-6">
              <p className="text-gray-400 text-center py-4">未检测到任何目标</p>
            </div>
          )}

          {detections.length > 0 && (
            <div className="bg-[#12162a] rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">检测结果 ({detections.length} 个目标)</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowModal(true)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-colors"
                  >
                    <ZoomIn size={16} />
                    放大查看
                  </button>
                </div>
              </div>

              <div
                className="relative cursor-pointer group rounded-lg overflow-hidden"
                onClick={() => setShowModal(true)}
              >
                <canvas
                  ref={resultCanvasRef}
                  className="w-full h-auto rounded-lg"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <ZoomIn size={40} className="text-white opacity-0 group-hover:opacity-80 transition-opacity" />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {uniqueClasses.map(([cls, count]) => (
                  <div key={cls} className="bg-white/5 rounded-lg p-3 text-center">
                    <div
                      className="w-3 h-3 rounded-full mx-auto mb-2"
                      style={{ backgroundColor: getClassColor(cls) }}
                    />
                    <p className="font-medium text-sm capitalize">{cls}</p>
                    <p className="text-xl font-bold text-blue-400">{count}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-[#12162a] rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">配置参数</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">模型路径</label>
                <input
                  type="text"
                  value={modelPath}
                  onChange={(e) => setModelPath(e.target.value)}
                  placeholder="yolov8n.pt 或 /path/to/model.pt"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  置信度阈值: {(confidence * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="0.95"
                  step="0.05"
                  value={confidence}
                  onChange={(e) => setConfidence(parseFloat(e.target.value))}
                  className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>10%</span>
                  <span>95%</span>
                </div>
              </div>

              <div className="border-t border-white/10 pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Scissors size={16} className="text-green-400" />
                    <label className="text-sm font-medium">自动切片推理</label>
                  </div>
                  <button
                    onClick={() => setAutoSlice(!autoSlice)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${autoSlice ? 'bg-green-500' : 'bg-gray-600'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${autoSlice ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
                {autoSlice && (
                  <p className="text-xs text-green-300 mt-2">
                    大图自动切片推理，提升小目标检测效果
                  </p>
                )}
              </div>

              <button
                onClick={handleDetect}
                disabled={!imageFile || loading || compressing}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg px-4 py-3 font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {compressing ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    正在压缩...
                  </>
                ) : loading ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    检测中... ({elapsedSec}s)
                  </>
                ) : (
                  <>
                    <Play size={20} />
                    执行检测
                  </>
                )}
              </button>

              {error && (
                <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}
            </div>
          </div>

          {detections.length > 0 && (
            <div className="bg-[#12162a] rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">检测详情</h3>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {detections.map((det, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-2 rounded bg-white/5">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: getClassColor(det.class) }}
                    />
                    <span className="text-sm capitalize flex-1">{det.class}</span>
                    <span className="text-sm text-blue-400 font-mono">
                      {(det.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[#12162a] rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">类别</h3>
            <div className="space-y-2">
              {classes.map((cls: AnnotationClass) => (
                <div key={cls.id} className="flex items-center gap-3 p-2 rounded hover:bg-white/5">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cls.color }} />
                  <span className="capitalize">{cls.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="relative max-w-[95vw] max-h-[95vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white text-lg font-semibold">
                检测结果 ({detections.length} 个目标)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg text-sm transition-colors"
                >
                  <Download size={16} />
                  下载
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X size={20} className="text-white" />
                </button>
              </div>
            </div>
            <div className="overflow-auto rounded-lg bg-gray-900">
              <canvas
                ref={modalCanvasRef}
                className="max-w-full max-h-[80vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

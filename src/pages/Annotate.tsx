import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Square,
  MousePointer2,
  ZoomIn,
  ZoomOut,
  Move,
  Trash2,
  Save,
  Plus,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Database,
  Image,
  Download,
  CheckCircle,
} from 'lucide-react';
import { useAppStore, type AnnotationClass } from '@/store/appStore';
import { datasetsApi } from '@/api';

const API_BASE = '/api';

interface BBox {
  id: string;
  dbId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  classId: number;
}

type Tool = 'select' | 'bbox' | 'zoom' | 'pan';

interface DatasetImage {
  id: string;
  filename: string;
  path: string;
  width: number;
  height: number;
}

export default function Annotate() {
  const [image, setImage] = useState<string | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [bboxes, setBboxes] = useState<BBox[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('bbox');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 });
  const [drawCurrent, setDrawCurrent] = useState({ x: 0, y: 0 });
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [selectedClassIndex, setSelectedClassIndex] = useState(0);
  const [showDatasetSelector, setShowDatasetSelector] = useState(false);
  const [datasetImages, setDatasetImages] = useState<DatasetImage[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle');
  const [uploading, setUploading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { currentDataset, classes, addClass, removeClass, setCurrentDataset, datasets, loadDatasets, loadClasses } = useAppStore();

  useEffect(() => {
    loadDatasets();
  }, []);

  const loadDatasetImages = async (datasetId: string) => {
    try {
      console.log('Loading dataset images for dataset:', datasetId);
      const res = await datasetsApi.getImages(datasetId);
      console.log('Dataset images response:', res);
      setDatasetImages(res.data || []);
      
      if (res.data && res.data.length > 0) {
        console.log(`Found ${res.data.length} images, selecting first one`);
        selectImage(res.data[0], 0);
      } else {
        console.log('No images found in dataset');
      }
    } catch (error) {
      console.error('Failed to load dataset images:', error);
    }
  };

  const selectImage = (img: DatasetImage, index: number) => {
    const imageUrl = `/${img.path.replace(/\\/g, '/')}`;
    console.log('Loading image:', { path: img.path, imageUrl });

    setImage(imageUrl);
    setImageId(img.id);
    setImageName(img.filename);
    setCurrentImageIndex(index);
    setBboxes([]);
    
    const imgElement = new window.Image();
    imgElement.onload = () => {
      const naturalWidth = imgElement.naturalWidth;
      const naturalHeight = imgElement.naturalHeight;
      console.log('Image natural dimensions:', naturalWidth, 'x', naturalHeight);

      const dims = { width: naturalWidth, height: naturalHeight };
      setImageDimensions(dims);
      setDisplaySize({ width: naturalWidth, height: naturalHeight });

      loadAnnotations(img.id, dims);
    };
    imgElement.onerror = () => {
      console.error('Failed to load image');
      const fallbackDims = {
        width: img.width > 0 ? img.width : 1920,
        height: img.height > 0 ? img.height : 1080
      };
      setImageDimensions(fallbackDims);
      setDisplaySize(fallbackDims);
      loadAnnotations(img.id, fallbackDims);
    };
    imgElement.src = imageUrl;
  };

  const loadAnnotations = async (imgId: string, dims: { width: number; height: number }) => {
    try {
      const res = await datasetsApi.getImageAnnotations(imgId);
      const loadedBboxes: BBox[] = (res.data || []).map((ann: any) => ({
        id: ann.id,
        dbId: ann.id,
        x: ann.x * dims.width,
        y: ann.y * dims.height,
        width: ann.width * dims.width,
        height: ann.height * dims.height,
        classId: parseInt(ann.class_id) || 0,
      }));
      setBboxes(loadedBboxes);
    } catch (error) {
      console.error('Failed to load annotations:', error);
    }
  };

  const handleSelectDataset = async (dataset: any) => {
    console.log('Selecting dataset:', dataset);
    setCurrentDataset(dataset);
    setShowDatasetSelector(false);
    await loadDatasetImages(dataset.id);
    await loadClasses(dataset.id);
    setSelectedClassIndex(0);
  };

  const saveAnnotations = async () => {
    if (!image) {
      alert('请先加载图片');
      return;
    }

    if (bboxes.length === 0) {
      alert('没有标注可以保存');
      return;
    }

    if (!imageId) {
      alert('请先选择数据集并加载图片，才能保存到数据库');
      return;
    }

    setSaveStatus('saving');

    try {
      console.log('Saving annotations:', {
        imageId,
        datasetId: currentDataset.id,
        bboxCount: bboxes.length,
        imageDimensions,
      });

      for (let i = 0; i < bboxes.length; i++) {
        const box = bboxes[i];
        
        if (imageDimensions.width === 0 || imageDimensions.height === 0) {
          console.error('Image dimensions are 0:', imageDimensions);
          alert('图片尺寸无效，请重新加载图片');
          setSaveStatus('idle');
          return;
        }
        
        const normalizedX = box.x / imageDimensions.width;
        const normalizedY = box.y / imageDimensions.height;
        const normalizedWidth = box.width / imageDimensions.width;
        const normalizedHeight = box.height / imageDimensions.height;

        const cls = classes.find((c) => c.id === box.classId);
        if (!cls) {
          console.error('Class not found for classId:', box.classId);
          console.log('Available classes:', classes);
          alert(`标注类别无效，请重新设置类别`);
          setSaveStatus('idle');
          return;
        }

        const classIndex = classes.indexOf(cls);

        console.log(`Saving bbox ${i + 1}/${bboxes.length}:`, {
          dbId: box.dbId,
          classId: box.classId,
          classIndex,
          className: cls.name,
          normalized: [normalizedX, normalizedY, normalizedWidth, normalizedHeight],
        });

        if (box.dbId) {
          await datasetsApi.updateAnnotation(box.dbId, {
            class_id: String(box.classId),
            x: normalizedX,
            y: normalizedY,
            width: normalizedWidth,
            height: normalizedHeight,
          });
        } else {
          const res = await datasetsApi.createAnnotation(imageId, {
            class_id: String(box.classId),
            x: normalizedX,
            y: normalizedY,
            width: normalizedWidth,
            height: normalizedHeight,
          });
          box.dbId = res.data?.id;
          console.log('Created annotation with id:', res.data?.id);
        }
      }

      await exportYOLOFormat();

      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error: any) {
      console.error('Failed to save annotations:', error);
      alert(`保存失败: ${error.message || '未知错误'}`);
      setSaveStatus('idle');
    }
  };

  const exportYOLOFormat = async () => {
    if (!imageId || !currentDataset) {
      console.warn('Cannot export YOLO format: missing imageId or currentDataset');
      return;
    }

    const yoloLines = bboxes.map((box) => {
      const cls = classes.find((c) => c.id === box.classId);
      const classIndex = cls ? classes.indexOf(cls) : 0;
      const centerX = (box.x + box.width / 2) / imageDimensions.width;
      const centerY = (box.y + box.height / 2) / imageDimensions.height;
      const width = box.width / imageDimensions.width;
      const height = box.height / imageDimensions.height;
      return `${classIndex} ${centerX.toFixed(6)} ${centerY.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`;
    });

    console.log('Exporting YOLO format:', {
      imageId,
      datasetId: currentDataset.id,
      lineCount: yoloLines.length,
    });

    try {
      const res = await datasetsApi.exportYOLO(currentDataset.id, imageId, yoloLines.join('\n'));
      console.log('YOLO export result:', res);
    } catch (error: any) {
      console.error('Failed to export YOLO format:', error);
      throw error;
    }
  };

  const getResizeHandles = (box: BBox, scaleX = 1, scaleY = 1) => {
    const handles = [];
    const positions = [
      { name: 'tl', x: box.x, y: box.y },
      { name: 'tr', x: box.x + box.width, y: box.y },
      { name: 'bl', x: box.x, y: box.y + box.height },
      { name: 'br', x: box.x + box.width, y: box.y + box.height },
    ];

    positions.forEach((pos) => {
      handles.push({
        ...pos,
        x: pos.x * scaleX,
        y: pos.y * scaleY,
      });
    });

    return handles;
  };

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgElement = new window.Image();
    imgElement.onload = () => {
      canvas.width = displaySize.width;
      canvas.height = displaySize.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgElement, 0, 0, displaySize.width, displaySize.height);

      // 计算缩放比例
      const scaleX = displaySize.width / imageDimensions.width;
      const scaleY = displaySize.height / imageDimensions.height;

      bboxes.forEach((box) => {
        const cls = classes.find((c) => c.id === box.classId);
        const color = cls?.color || '#3b82f6';
        const isSelected = box.id === selectedId;

        // 转换坐标
        const displayX = box.x * scaleX;
        const displayY = box.y * scaleY;
        const displayWidth = box.width * scaleX;
        const displayHeight = box.height * scaleY;

        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 4 : 2;
        ctx.strokeRect(displayX, displayY, displayWidth, displayHeight);

        if (cls) {
          ctx.fillStyle = color;
          const label = cls.name;
          ctx.font = 'bold 14px sans-serif';
          const textWidth = ctx.measureText(label).width;
          ctx.fillRect(displayX, displayY - 20, textWidth + 10, 20);
          ctx.fillStyle = '#fff';
          ctx.fillText(label, displayX + 5, displayY - 5);
        }
      });

      if (drawing) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        const x = Math.min(drawStart.x, drawCurrent.x) * scaleX;
        const y = Math.min(drawStart.y, drawCurrent.y) * scaleY;
        const w = Math.abs(drawCurrent.x - drawStart.x) * scaleX;
        const h = Math.abs(drawCurrent.y - drawStart.y) * scaleY;
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }
    };
    imgElement.src = image;
  }, [image, bboxes, selectedId, drawing, drawStart, drawCurrent, classes, displaySize, imageDimensions]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // 获取canvas上的显示坐标
    const displayX = (e.clientX - rect.left) / zoom;
    const displayY = (e.clientY - rect.top) / zoom;
    
    // 转换为原始图片坐标
    const scaleX = imageDimensions.width / displaySize.width;
    const scaleY = imageDimensions.height / displaySize.height;
    
    return {
      x: displayX * scaleX,
      y: displayY * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!image) return;
    const coords = getCanvasCoords(e);

    if (tool === 'bbox') {
      setDrawing(true);
      setDrawStart(coords);
      setDrawCurrent(coords);
    } else if (tool === 'select') {
      const clicked = bboxes.find((box) =>
        coords.x >= box.x && coords.x <= box.x + box.width &&
        coords.y >= box.y && coords.y <= box.y + box.height
      );
      setSelectedId(clicked?.id || null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawing) {
      setDrawCurrent(getCanvasCoords(e));
    }
  };

  const handleMouseUp = () => {
    if (drawing) {
      const x = Math.min(drawStart.x, drawCurrent.x);
      const y = Math.min(drawStart.y, drawCurrent.y);
      const width = Math.abs(drawCurrent.x - drawStart.x);
      const height = Math.abs(drawCurrent.y - drawStart.y);

      if (width > 10 && height > 10) {
        setBboxes((prev) => [
          ...prev,
          { id: Date.now().toString(), x, y, width, height, classId: classes[selectedClassIndex]?.id || 0 },
        ]);
      }
      setDrawing(false);
    }
  };

  const handleFile = async (file: File) => {
    console.log('handleFile called with:', file);
    if (!file.type.startsWith('image/')) {
      console.error('Not an image file:', file.type);
      return;
    }
    
    if (!currentDataset) {
      console.error('No dataset selected');
      alert('请先选择数据集');
      return;
    }

    console.log('Uploading to dataset:', currentDataset.id);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('images', file);
      
      console.log('Sending request to:', `${API_BASE}/datasets/${currentDataset.id}/images`);
      const response = await fetch(`${API_BASE}/datasets/${currentDataset.id}/images`, {
        method: 'POST',
        body: formData,
      });
      
      console.log('Response status:', response.status);
      const res = await response.json();
      console.log('Upload response:', res);
      
      if (res.success && res.data && res.data.length > 0) {
        const uploadedImage = res.data[0];
        console.log('Uploaded image:', uploadedImage);
        
        // 重新加载数据集图片列表
        const imagesRes = await datasetsApi.getImages(currentDataset.id);
        console.log('Dataset images after upload:', imagesRes);
        setDatasetImages(imagesRes.data || []);
        
        // 找到刚上传的图片并选中
        const imgIndex = imagesRes.data.findIndex((img: any) => img.id === uploadedImage.id);
        console.log('Found image index:', imgIndex);
        
        if (imgIndex >= 0) {
          console.log('Selecting image:', imagesRes.data[imgIndex]);
          selectImage(imagesRes.data[imgIndex], imgIndex);
        } else {
          console.error('Could not find uploaded image in dataset images list');
        }
      } else {
        console.error('Upload failed:', res);
        alert(`上传失败: ${res.error || '未知错误'}`);
      }
    } catch (error) {
      console.error('Failed to upload image:', error);
      alert(`上传图片失败: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const navigateImage = (direction: 'prev' | 'next') => {
    if (datasetImages.length === 0) return;
    const newIndex = direction === 'prev'
      ? (currentImageIndex - 1 + datasetImages.length) % datasetImages.length
      : (currentImageIndex + 1) % datasetImages.length;
    selectImage(datasetImages[newIndex], newIndex);
  };

  const deleteBBox = (id: string) => {
    setBboxes((prev) => prev.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const addClassHandler = async () => {
    if (!newClassName.trim()) return;
    if (!currentDataset) {
      alert('请先选择数据集');
      return;
    }
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
    const newClass = {
      id: Date.now(),
      name: newClassName.trim(),
      color: colors[classes.length % colors.length],
    };
    await addClass(newClass, currentDataset.id);
    setSelectedClassIndex(classes.length);
    setNewClassName('');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case 'b': setTool('bbox'); break;
        case 'v': setTool('select'); break;
        case 'z': if (e.ctrlKey) setZoom((z) => Math.max(0.5, z - 0.25)); break;
        case 'Delete': if (selectedId) deleteBBox(selectedId); break;
        case 'ArrowLeft': break;
        case 'ArrowRight': break;
        case 's': if (e.ctrlKey) { e.preventDefault(); /* save */ } break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId]);

  return (
    <div className="h-[calc(100vh-0px)] flex flex-col">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">标注编辑器</h1>
            <p className="text-sm text-gray-400">
              {currentDataset ? `数据集: ${currentDataset.name}` : '使用边界框标注图像'}
            </p>
          </div>
          {imageName && (
            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-1">
              <Image size={14} className="text-gray-400" />
              <span className="text-sm text-gray-300">{imageName}</span>
              {datasetImages.length > 0 && (
                <span className="text-xs text-gray-500">
                  ({currentImageIndex + 1}/{datasetImages.length})
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDatasetSelector(!showDatasetSelector)}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 rounded-lg px-3 py-2"
          >
            <Database size={18} />
            {currentDataset ? '切换数据集' : '选择数据集'}
          </button>
          {datasetImages.length > 0 && (
            <>
              <button
                onClick={() => navigateImage('prev')}
                className="p-2 bg-white/5 hover:bg-white/10 rounded-lg"
                disabled={datasetImages.length === 0}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => navigateImage('next')}
                className="p-2 bg-white/5 hover:bg-white/10 rounded-lg"
                disabled={datasetImages.length === 0}
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10"
          >
            <Keyboard size={20} />
          </button>
          <button
            onClick={saveAnnotations}
            disabled={saveStatus === 'saving' || (!imageId && !image)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-all ${
              saveStatus === 'success'
                ? 'bg-green-600'
                : saveStatus === 'saving'
                ? 'bg-yellow-600 cursor-not-allowed'
                : !imageId && !image
                ? 'bg-gray-600 cursor-not-allowed opacity-50'
                : 'bg-green-600 hover:bg-green-700'
            }`}
            title={!imageId && !image ? '请先加载图片' : '保存标注并生成YOLO格式文件'}
          >
            {saveStatus === 'saving' ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                保存中...
              </>
            ) : saveStatus === 'success' ? (
              <>
                <CheckCircle size={18} />
                已保存
              </>
            ) : (
              <>
                <Save size={18} />
                保存并生成YOLO
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {showDatasetSelector && (
          <div className="w-80 bg-[#1a1f36] border-r border-white/10 p-4 overflow-y-auto">
            <h3 className="font-semibold mb-4">选择数据集</h3>
            <div className="space-y-2">
              {datasets.map((dataset) => (
                <button
                  key={dataset.id}
                  onClick={() => handleSelectDataset(dataset)}
                  className={`w-full text-left p-3 rounded-lg transition-all ${
                    currentDataset?.id === dataset.id
                      ? 'bg-blue-600'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="font-medium">{dataset.name}</div>
                  <div className="text-xs text-gray-400">
                    {dataset.imageCount || 0} 张图片
                  </div>
                </button>
              ))}
              {datasets.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  暂无数据集
                  <br />
                  <span className="text-xs">请先在数据集管理页面创建</span>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="w-16 bg-[#12162a] border-r border-white/10 flex flex-col items-center py-4 gap-2">
          {[
            { id: 'bbox' as Tool, icon: Square, label: '边界框 (B)' },
            { id: 'select' as Tool, icon: MousePointer2, label: '选择 (V)' },
            { id: 'zoom' as Tool, icon: ZoomIn, label: '缩放' },
            { id: 'pan' as Tool, icon: Move, label: '平移' },
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setTool(id)}
              title={label}
              className={`p-3 rounded-lg transition-colors ${
                tool === id ? 'bg-blue-600/20 text-blue-400' : 'text-gray-400 hover:bg-white/5'
              }`}
            >
              <Icon size={20} />
            </button>
          ))}
          <div className="border-t border-white/10 w-8 my-2" />
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))} className="p-3 text-gray-400 hover:bg-white/5 rounded-lg">
            <ZoomIn size={20} />
          </button>
          <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="p-3 text-gray-400 hover:bg-white/5 rounded-lg">
            <ZoomOut size={20} />
          </button>
          <span className="text-xs text-gray-400">{(zoom * 100).toFixed(0)}%</span>
        </div>

        <div className="flex-1 relative overflow-auto bg-[#0a0e1a]" ref={containerRef}>
          {!image ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div
                  className="border-2 border-dashed border-white/20 rounded-lg p-12 cursor-pointer hover:border-blue-500 transition-colors"
                  onClick={() => {
                    if (!currentDataset) {
                      alert('请先选择数据集');
                      setShowDatasetSelector(true);
                    } else {
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  {uploading ? (
                    <>
                      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                      <div className="text-gray-400 mb-2">上传中...</div>
                    </>
                  ) : (
                    <>
                      <div className="text-gray-400 mb-2">
                        {currentDataset ? '点击上传图片到数据集' : '请先选择数据集'}
                      </div>
                      <div className="text-sm text-gray-500">支持 JPG、PNG、WebP 格式</div>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/bmp,.jfif"
                  className="hidden"
                  onChange={(e) => {
                    console.log('File input onChange triggered');
                    console.log('Files:', e.target.files);
                    const file = e.target.files?.[0];
                    console.log('Selected file:', file);
                    if (file) {
                      console.log('Calling handleFile with:', file);
                      handleFile(file);
                    }
                  }}
                />
              </div>
            </div>
          ) : (
            <>
              <canvas
                ref={canvasRef}
                width={displaySize.width}
                height={displaySize.height}
                className="absolute"
                style={{
                  top: '50%',
                  left: '50%',
                  transform: `translate(-50%, -50%) scale(${zoom})`,
                  transformOrigin: 'center center',
                  cursor:
                    tool === 'select'
                      ? selectedId
                        ? 'move'
                        : 'default'
                      : 'crosshair',
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => setDrawing(false)}
              />
              {datasetImages.length > 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-4 py-2">
                  <button
                    onClick={() => navigateImage('prev')}
                    className="p-1 hover:bg-white/10 rounded-full"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-sm">
                    {currentImageIndex + 1} / {datasetImages.length}
                  </span>
                  <button
                    onClick={() => navigateImage('next')}
                    className="p-1 hover:bg-white/10 rounded-full"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="w-72 bg-[#12162a] border-l border-white/10 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-white/10">
            <h3 className="font-semibold mb-3">类别</h3>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder="新类别名称"
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={addClassHandler} className="p-2 bg-blue-600 rounded-lg hover:bg-blue-700">
                <Plus size={16} />
              </button>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {classes.map((cls: AnnotationClass, index: number) => (
                <div
                  key={cls.id}
                  onClick={() => setSelectedClassIndex(index)}
                  className={`flex items-center justify-between p-2 rounded cursor-pointer ${
                    selectedClassIndex === index ? 'bg-blue-600/20' : 'hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cls.color }} />
                    <span className="text-sm capitalize">{cls.name}</span>
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await datasetsApi.deleteClass(cls.id);
                      removeClass(cls.id);
                    }}
                    className="text-gray-500 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <h3 className="font-semibold mb-3">标注 ({bboxes.length})</h3>
            <div className="space-y-2">
              {bboxes.map((box) => {
                const cls = classes.find((c) => c.id === box.classId);
                return (
                  <div
                    key={box.id}
                    onClick={() => setSelectedId(box.id)}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedId === box.id ? 'bg-blue-600/20 border border-blue-500/50' : 'bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cls?.color || '#3b82f6' }} />
                      <span className="text-sm capitalize">{cls?.name || '未知'}</span>
                    </div>
                    <button onClick={() => deleteBBox(box.id)} className="text-gray-500 hover:text-red-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
              {bboxes.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">暂无标注</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {showShortcuts && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowShortcuts(false)}>
          <div className="bg-[#12162a] rounded-lg shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">快捷键</h3>
            <div className="space-y-3">
              {[
                ['B', '边界框工具'],
                ['V', '选择工具'],
                ['Ctrl+Z', '缩小'],
                ['Delete', '删除选中'],
                ['Ctrl+S', '保存标注'],
              ].map(([key, desc]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-gray-400">{desc}</span>
                  <kbd className="bg-white/10 px-2 py-1 rounded text-sm font-mono">{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

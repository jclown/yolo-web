import { useState, useEffect, useRef } from 'react';
import {
  Database,
  Plus,
  Image,
  Tags,
  Trash2,
  FolderOpen,
  X,
  BarChart3,
  AlertTriangle,
  Upload,
  Scissors,
  FileInput,
  CheckCircle,
  FileJson,
} from 'lucide-react';
import { datasetsApi } from '@/api';
import { useAppStore, type Dataset } from '@/store/appStore';

export default function Datasets() {
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDatasetName, setNewDatasetName] = useState('');
  const [datasetImages, setDatasetImages] = useState<any[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showDeleteImageConfirm, setShowDeleteImageConfirm] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showSliceModal, setShowSliceModal] = useState(false);
  const [sliceParams, setSliceParams] = useState({
    sliceHeight: 640,
    sliceWidth: 640,
    overlapRatio: 0.2,
  });
  const [slicing, setSlicing] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importName, setImportName] = useState('');
  const [importFolderFiles, setImportFolderFiles] = useState<File[]>([]);
  const [importJsonFile, setImportJsonFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{ classes: { id: number; name: string }[]; imageCount: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ importedImages: number; importedAnnotations: number } | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { datasets, loadDatasets, setCurrentDataset } = useAppStore();

  useEffect(() => {
    loadDatasets();
  }, []);

  useEffect(() => {
    if (selectedDataset) {
      loadDatasetImages(selectedDataset.id);
    }
  }, [selectedDataset]);

  const loadDatasetImages = async (datasetId: string) => {
    try {
      const res = await datasetsApi.getImages(datasetId);
      setDatasetImages(res.data || []);
    } catch (error) {
      console.error('Failed to load images:', error);
    }
  };

  const handleCreateDataset = async () => {
    if (!newDatasetName.trim()) return;
    try {
      await datasetsApi.create({ name: newDatasetName });
      await loadDatasets();
      setNewDatasetName('');
      setShowCreateModal(false);
    } catch (error) {
      console.error('Failed to create dataset:', error);
      alert('创建数据集失败');
    }
  };

  const handleDeleteDataset = async (id: string) => {
    try {
      await datasetsApi.delete(id);
      await loadDatasets();
      if (selectedDataset?.id === id) {
        setSelectedDataset(null);
        setDatasetImages([]);
      }
    } catch (error) {
      console.error('Failed to delete dataset:', error);
    }
    setShowDeleteConfirm(null);
  };

  const handleSelectDataset = (ds: Dataset) => {
    setSelectedDataset(ds);
    setCurrentDataset(ds);
  };

  const handleDeleteImage = async (imageId: string) => {
    try {
      await datasetsApi.deleteImage(imageId);
      await loadDatasetImages(selectedDataset!.id);
      await loadDatasets();
    } catch (error) {
      console.error('Failed to delete image:', error);
      alert('删除图片失败');
    }
    setShowDeleteImageConfirm(null);
  };

  const handleUploadImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedDataset) return;

    setUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('images', files[i]);
      }
      
      await datasetsApi.uploadImages(selectedDataset.id, formData);
      await loadDatasetImages(selectedDataset.id);
      await loadDatasets();
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Failed to upload images:', error);
      alert('上传图片失败');
    } finally {
      setUploading(false);
    }
  };

  const handleSliceDataset = async () => {
    if (!selectedDataset) return;

    setSlicing(true);
    try {
      const result = await datasetsApi.sliceDataset(selectedDataset.id, sliceParams);
      
      if (result.success) {
        alert(
          `切片成功！\n\n` +
          `原始图片: ${result.originalImages} 张\n` +
          `生成切片: ${result.totalSlices} 张\n` +
          `新数据集: ${result.datasetName}`
        );
        setShowSliceModal(false);
        await loadDatasets();
      }
    } catch (error) {
      console.error('Failed to slice dataset:', error);
      alert('切片失败，请检查Python环境是否已安装sahi库');
    } finally {
      setSlicing(false);
    }
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const allFiles = Array.from(files);
    const imageFiles = allFiles.filter(f => /\.(jpe?g|png|webp|bmp|jfif)$/i.test(f.name));
    const jsonFiles = allFiles.filter(f => /\.json$/i.test(f.name));

    setImportFolderFiles(imageFiles);
    console.log(`[Import] Folder selected: ${imageFiles.length} images, ${jsonFiles.length} JSON files`);
    console.log('[Import] Sample filenames:', imageFiles.slice(0, 3).map(f => ({ name: f.name, path: f.webkitRelativePath })));

    if (jsonFiles.length > 0) {
      const jsonFile = jsonFiles[0];
      setImportJsonFile(jsonFile);
      try {
        const text = await jsonFile.text();
        const parsed = JSON.parse(text);
        setImportPreview({
          classes: parsed.classes || [],
          imageCount: (parsed.images || []).length,
        });
      } catch {
        setImportPreview(null);
        alert('JSON文件解析失败，请检查格式');
      }
    } else {
      setImportJsonFile(null);
      setImportPreview(null);
    }

    if (!importName && allFiles.length > 0) {
      const folderPath = allFiles[0].webkitRelativePath;
      const folderName = folderPath.split('/')[0];
      setImportName(folderName);
    }

    if (folderInputRef.current) {
      folderInputRef.current.value = '';
    }
  };

  const handleJsonFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportJsonFile(file);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setImportPreview({
        classes: parsed.classes || [],
        imageCount: (parsed.images || []).length,
      });
    } catch {
      setImportPreview(null);
      alert('JSON文件解析失败，请检查格式');
    }

    if (jsonInputRef.current) {
      jsonInputRef.current.value = '';
    }
  };

  const handleImportDataset = async () => {
    if (!importName.trim() || !importJsonFile || importFolderFiles.length === 0) return;

    setImporting(true);
    try {
      const jsonText = await importJsonFile.text();
      console.log(`[Import] Sending: ${importFolderFiles.length} image files, JSON file: ${importJsonFile.name}, JSON size: ${(jsonText.length / 1024).toFixed(1)}KB`);
      const formData = new FormData();
      formData.append('name', importName);
      formData.append('annotationsJson', jsonText);
      for (const file of importFolderFiles) {
        formData.append('images', file);
      }

      const result = await datasetsApi.importYoloJson(formData);
      console.log('[Import] Result:', result);
      if (result.success) {
        setImportResult({
          importedImages: result.data.importedImages,
          importedAnnotations: result.data.importedAnnotations,
        });
        await loadDatasets();
      } else {
        alert(result.error || '导入失败');
      }
    } catch (error) {
      console.error('Failed to import dataset:', error);
      alert('导入数据集失败');
    } finally {
      setImporting(false);
    }
  };

  const resetImportState = () => {
    setShowImportModal(false);
    setImportName('');
    setImportFolderFiles([]);
    setImportJsonFile(null);
    setImportPreview(null);
    setImporting(false);
    setImportResult(null);
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">数据集管理</h1>
          <p className="text-gray-400 mt-2">查看、创建和管理您的图像数据集</p>
        </div>
      </div>

      {!selectedDataset ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {datasets.map((ds) => (
              <div
                key={ds.id}
                className="bg-[#12162a] rounded-lg shadow hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 overflow-hidden"
              >
                <div className="h-32 bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
                  <Database size={48} className="text-blue-400" />
                </div>
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">{ds.name}</h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowDeleteConfirm(ds.id)}
                        className="text-gray-500 hover:text-red-400"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 flex items-center gap-2">
                        <Image size={14} /> 图像
                      </span>
                      <span>{ds.imageCount?.toLocaleString() || 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 flex items-center gap-2">
                        <Tags size={14} /> 已标注
                      </span>
                      <span>{ds.annotatedCount?.toLocaleString() || 0}</span>
                    </div>
                  </div>
                  <div className="mt-4 w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full"
                      style={{ width: `${ds.imageCount > 0 ? ((ds.annotatedCount / ds.imageCount) * 100) : 0}%` }}
                    />
                  </div>
                  <button
                    onClick={() => handleSelectDataset(ds)}
                    className="w-full mt-4 bg-white/5 hover:bg-white/10 rounded-lg px-4 py-2 flex items-center justify-center gap-2 transition-colors"
                  >
                    <FolderOpen size={16} />
                    打开数据集
                  </button>
                </div>
              </div>
            ))}

            <div
              className="bg-[#12162a] rounded-lg shadow border-2 border-dashed border-gray-600 hover:border-blue-500 flex flex-col items-center justify-center p-8 cursor-pointer transition-colors min-h-[280px]"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={48} className="text-gray-400 mb-4" />
              <p className="text-lg font-medium text-gray-400">创建新数据集</p>
            </div>

            <div
              className="bg-[#12162a] rounded-lg shadow border-2 border-dashed border-gray-600 hover:border-green-500 flex flex-col items-center justify-center p-8 cursor-pointer transition-colors min-h-[280px]"
              onClick={() => setShowImportModal(true)}
            >
              <FileInput size={48} className="text-gray-400 mb-4" />
              <p className="text-lg font-medium text-gray-400">导入YOLO-JSON</p>
              <p className="text-sm text-gray-500 mt-2">从文件夹导入标注数据</p>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setSelectedDataset(null);
                setDatasetImages([]);
              }}
              className="text-gray-400 hover:text-white"
            >
              返回
            </button>
            <h2 className="text-2xl font-bold">{selectedDataset.name}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { label: '总图像数', value: selectedDataset.imageCount || 0, icon: Image, color: 'text-blue-400' },
              { label: '已标注', value: selectedDataset.annotatedCount || 0, icon: Tags, color: 'text-green-400' },
              { label: '未标注', value: (selectedDataset.imageCount || 0) - (selectedDataset.annotatedCount || 0), icon: BarChart3, color: 'text-yellow-400' },
              { label: '进度', value: `${selectedDataset.imageCount > 0 ? (((selectedDataset.annotatedCount || 0) / selectedDataset.imageCount) * 100).toFixed(1) : 0}%`, icon: Database, color: 'text-purple-400' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-[#12162a] rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">{label}</p>
                    <p className="text-2xl font-bold mt-1">{value}</p>
                  </div>
                  <Icon size={28} className={color} />
                </div>
              </div>
            ))}
          </div>

          <div className="bg-[#12162a] rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">图像浏览器</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSliceModal(true)}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 rounded-lg px-4 py-2 transition-colors"
                >
                  <Scissors size={16} />
                  SAHI切片
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg px-4 py-2 transition-colors"
                >
                  {uploading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      上传中...
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      上传图片
                    </>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/bmp,.jfif"
                  multiple
                  className="hidden"
                  onChange={handleUploadImages}
                />
              </div>
            </div>
            {datasetImages.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {datasetImages.map((img) => (
                  <div key={img.id} className="relative group">
                    <img
                      src={`/${img.path}`}
                      alt={img.filename}
                      className="w-full aspect-video object-cover rounded-lg"
                    />
                    <div className="absolute top-2 right-2 flex gap-1 z-10">
                      <div className="w-3 h-3 bg-green-500 rounded-full" title="已标注" />
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowDeleteImageConfirm(img.id); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity bg-red-500/80 hover:bg-red-500 rounded p-1"
                        title="删除图片"
                      >
                        <Trash2 size={14} className="text-white" />
                      </button>
                    </div>
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center pointer-events-none">
                      <span className="text-xs text-center px-2">{img.filename}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <Image size={48} className="mx-auto mb-4 opacity-50" />
                <p>暂无图片</p>
                <p className="text-sm mt-2">点击上方"上传图片"按钮添加图片</p>
              </div>
            )}
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setShowDeleteConfirm(null)}
        >
          <div
            className="bg-[#12162a] rounded-lg shadow-xl p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle size={24} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">确认删除数据集</h3>
                <p className="text-sm text-gray-400">此操作不可撤销</p>
              </div>
            </div>
            <p className="text-gray-300 mb-6">
              删除数据集将同时删除所有图片和标注数据。确定要继续吗？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="flex-1 bg-white/5 hover:bg-white/10 rounded-lg px-4 py-2"
              >
                取消
              </button>
              <button
                onClick={() => handleDeleteDataset(showDeleteConfirm)}
                className="flex-1 bg-red-600 hover:bg-red-700 rounded-lg px-4 py-2"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteImageConfirm && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setShowDeleteImageConfirm(null)}
        >
          <div
            className="bg-[#12162a] rounded-lg shadow-xl p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle size={24} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">确认删除图片</h3>
                <p className="text-sm text-gray-400">此操作不可撤销</p>
              </div>
            </div>
            <p className="text-gray-300 mb-6">
              删除图片将同时删除该图片的所有标注数据。确定要继续吗？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteImageConfirm(null)}
                className="flex-1 bg-white/5 hover:bg-white/10 rounded-lg px-4 py-2"
              >
                取消
              </button>
              <button
                onClick={() => handleDeleteImage(showDeleteImageConfirm)}
                className="flex-1 bg-red-600 hover:bg-red-700 rounded-lg px-4 py-2"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {showSliceModal && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => !slicing && setShowSliceModal(false)}
        >
          <div
            className="bg-[#12162a] rounded-lg shadow-xl p-6 max-w-lg w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <Scissors size={24} className="text-purple-500" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">SAHI 切片处理</h3>
                  <p className="text-sm text-gray-400">将大图切分为小图用于YOLO训练</p>
                </div>
              </div>
              {!slicing && (
                <button
                  onClick={() => setShowSliceModal(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X size={20} />
                </button>
              )}
            </div>

            <div className="space-y-4 mb-6">
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <p className="text-sm text-blue-300">
                  <strong>说明：</strong>SAHI切片会将大图切分成多个重叠的小图块，适合无人机超高清图片的小目标检测。
                  切片后会自动生成新数据集，包含所有切片图片和转换后的标注文件。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  切片宽度: {sliceParams.sliceWidth}px
                </label>
                <input
                  type="range"
                  min="320"
                  max="1280"
                  step="64"
                  value={sliceParams.sliceWidth}
                  onChange={(e) =>
                    setSliceParams({ ...sliceParams, sliceWidth: parseInt(e.target.value) })
                  }
                  className="w-full"
                  disabled={slicing}
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>320</span>
                  <span>1280</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  切片高度: {sliceParams.sliceHeight}px
                </label>
                <input
                  type="range"
                  min="320"
                  max="1280"
                  step="64"
                  value={sliceParams.sliceHeight}
                  onChange={(e) =>
                    setSliceParams({ ...sliceParams, sliceHeight: parseInt(e.target.value) })
                  }
                  className="w-full"
                  disabled={slicing}
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>320</span>
                  <span>1280</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  重叠率: {(sliceParams.overlapRatio * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="0.5"
                  step="0.05"
                  value={sliceParams.overlapRatio}
                  onChange={(e) =>
                    setSliceParams({ ...sliceParams, overlapRatio: parseFloat(e.target.value) })
                  }
                  className="w-full"
                  disabled={slicing}
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>0%</span>
                  <span>50%</span>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  重叠率越高，切片数量越多，目标检测效果越好（但训练时间越长）
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowSliceModal(false)}
                disabled={slicing}
                className="flex-1 bg-white/5 hover:bg-white/10 disabled:bg-gray-600 rounded-lg px-4 py-2"
              >
                取消
              </button>
              <button
                onClick={handleSliceDataset}
                disabled={slicing}
                className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg px-4 py-2 flex items-center justify-center gap-2"
              >
                {slicing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    切片中...
                  </>
                ) : (
                  <>
                    <Scissors size={16} />
                    开始切片
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="bg-[#12162a] rounded-lg shadow-xl p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">创建新数据集</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">数据集名称</label>
                <input
                  type="text"
                  value={newDatasetName}
                  onChange={(e) => setNewDatasetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateDataset();
                  }}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例如：drone-samples-001"
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewDatasetName('');
                  }}
                  className="flex-1 bg-white/5 hover:bg-white/10 rounded-lg px-4 py-2"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateDataset}
                  disabled={!newDatasetName.trim()}
                  className={`flex-1 rounded-lg px-4 py-2 ${
                    newDatasetName.trim()
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : 'bg-gray-600 cursor-not-allowed opacity-50'
                  }`}
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => !importing && resetImportState()}
        >
          <div
            className="bg-[#12162a] rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                  <FileInput size={24} className="text-green-500" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">导入 YOLO-JSON 数据集</h3>
                  <p className="text-sm text-gray-400">从文件夹导入带标注的图像数据</p>
                </div>
              </div>
              {!importing && (
                <button
                  onClick={resetImportState}
                  className="text-gray-400 hover:text-white"
                >
                  <X size={20} />
                </button>
              )}
            </div>

            {importResult ? (
              <div className="space-y-4">
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-6 text-center">
                  <CheckCircle size={48} className="text-green-500 mx-auto mb-3" />
                  <h4 className="text-lg font-semibold text-green-400 mb-2">导入成功</h4>
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-2xl font-bold">{importResult.importedImages}</p>
                      <p className="text-sm text-gray-400">图片导入</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-2xl font-bold">{importResult.importedAnnotations}</p>
                      <p className="text-sm text-gray-400">标注导入</p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={resetImportState}
                  className="w-full bg-blue-600 hover:bg-blue-700 rounded-lg px-4 py-2 transition-colors"
                >
                  完成
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                  <p className="text-sm text-green-300">
                    <strong>说明：</strong>选择包含图片和JSON标注文件的文件夹，系统将自动解析JSON中的标注信息并创建新数据集。
                    支持的JSON格式为 yolo-json-v1，包含 classes 和 images 字段。
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">数据集名称</label>
                  <input
                    type="text"
                    value={importName}
                    onChange={(e) => setImportName(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="例如：bird-nest-dataset"
                    disabled={importing}
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">选择文件夹（包含图片和JSON文件）</label>
                  <input
                    ref={folderInputRef}
                    type="file"
                    {...({ webkitdirectory: 'true', directory: 'true' } as any)}
                    className="hidden"
                    onChange={handleFolderSelect}
                  />
                  <button
                    onClick={() => folderInputRef.current?.click()}
                    disabled={importing}
                    className="w-full bg-white/5 border border-white/10 hover:border-green-500/50 rounded-lg px-4 py-3 flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <FolderOpen size={18} />
                    {importFolderFiles.length > 0 ? `已选择 ${importFolderFiles.length} 个图片文件` : '选择文件夹'}
                  </button>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">单独选择JSON标注文件（可选，若文件夹中已包含则自动识别）</label>
                  <input
                    ref={jsonInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleJsonFileSelect}
                  />
                  <button
                    onClick={() => jsonInputRef.current?.click()}
                    disabled={importing}
                    className="w-full bg-white/5 border border-white/10 hover:border-green-500/50 rounded-lg px-4 py-3 flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <FileJson size={18} />
                    {importJsonFile ? importJsonFile.name : '选择JSON文件'}
                  </button>
                </div>

                {importPreview && (
                  <div className="bg-white/5 rounded-lg p-4 space-y-3">
                    <h4 className="text-sm font-medium text-gray-300">预览信息</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white/5 rounded-lg p-3 text-center">
                        <p className="text-xl font-bold text-blue-400">{importPreview.imageCount}</p>
                        <p className="text-xs text-gray-400">JSON中图片条目</p>
                      </div>
                      <div className="bg-white/5 rounded-lg p-3 text-center">
                        <p className="text-xl font-bold text-green-400">{importFolderFiles.length}</p>
                        <p className="text-xs text-gray-400">文件夹中图片</p>
                      </div>
                    </div>
                    {importPreview.classes.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-400 mb-2">类别列表：</p>
                        <div className="flex flex-wrap gap-2">
                          {importPreview.classes.map((cls) => (
                            <span
                              key={cls.id}
                              className="bg-blue-500/20 text-blue-300 px-2 py-1 rounded text-xs"
                            >
                              {cls.name} (id: {cls.id})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={resetImportState}
                    disabled={importing}
                    className="flex-1 bg-white/5 hover:bg-white/10 disabled:bg-gray-600 rounded-lg px-4 py-2"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleImportDataset}
                    disabled={importing || !importName.trim() || !importJsonFile || importFolderFiles.length === 0}
                    className={`flex-1 rounded-lg px-4 py-2 flex items-center justify-center gap-2 transition-colors ${
                      importing || !importName.trim() || !importJsonFile || importFolderFiles.length === 0
                        ? 'bg-gray-600 cursor-not-allowed opacity-50'
                        : 'bg-green-600 hover:bg-green-700'
                    }`}
                  >
                    {importing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        导入中...
                      </>
                    ) : (
                      <>
                        <Upload size={16} />
                        开始导入
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

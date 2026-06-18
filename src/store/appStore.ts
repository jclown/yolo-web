import { create } from 'zustand';
import { datasetsApi } from '@/api';

export interface AnnotationClass {
  id: number;
  name: string;
  color: string;
}

export interface Dataset {
  id: string;
  name: string;
  imageCount: number;
  annotatedCount: number;
  createdAt: string;
}

export interface Model {
  id: string;
  name: string;
  type: string;
  path: string;
  mAP50: number;
  status: 'training' | 'completed' | 'failed' | 'stopped';
  createdAt: string;
}

export interface DetectionResult {
  class: string;
  confidence: number;
  bbox: [number, number, number, number];
}

export interface TrainingMetrics {
  epoch: number;
  trainLoss: number;
  valLoss: number;
  mAP50: number;
  mAP5095: number;
}

export interface AugmentationTask {
  id: string;
  name: string;
  dataset_id: string;
  strategies: string[];
  multiplier: number;
  imageCount: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  progress: number;
  createdAt: string;
}

interface AppState {
  currentDataset: Dataset | null;
  datasets: Dataset[];
  classes: AnnotationClass[];
  models: Model[];
  augmentationTasks: AugmentationTask[];
  setCurrentDataset: (dataset: Dataset | null) => void;
  setDatasets: (datasets: Dataset[]) => void;
  loadDatasets: () => Promise<void>;
  setClasses: (classes: AnnotationClass[]) => void;
  loadClasses: (datasetId: string) => Promise<void>;
  addClass: (cls: AnnotationClass, datasetId: string) => Promise<void>;
  removeClass: (id: number) => void;
  setModels: (models: Model[]) => void;
  setAugmentationTasks: (tasks: AugmentationTask[]) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentDataset: null,
  datasets: [],
  classes: [],
  models: [],
  augmentationTasks: [],
  setCurrentDataset: (dataset) => set({ currentDataset: dataset }),
  setDatasets: (datasets) => set({ datasets }),
  loadDatasets: async () => {
    try {
      const res = await datasetsApi.getAll();
      const datasets = (res.data || []).map((ds: any) => ({
        ...ds,
        imageCount: ds.image_count ?? ds.imageCount ?? 0,
        annotatedCount: ds.annotated_count ?? ds.annotatedCount ?? 0,
        createdAt: ds.created_at ?? ds.createdAt ?? '',
      }));
      set({ datasets });
    } catch (error) {
      console.error('Failed to load datasets:', error);
    }
  },
  setClasses: (classes) => set({ classes }),
  loadClasses: async (datasetId: string) => {
    try {
      const res = await datasetsApi.getClasses(datasetId);
      const classes = (res.data || []).map((cls: any, index: number) => ({
        id: cls.id ?? index,
        name: cls.name,
        color: cls.color,
      }));
      set({ classes });
    } catch (error) {
      console.error('Failed to load classes:', error);
    }
  },
  addClass: async (cls: AnnotationClass, datasetId: string) => {
    try {
      await datasetsApi.createClass(datasetId, { name: cls.name, color: cls.color });
      set((state) => ({ classes: [...state.classes, cls] }));
    } catch (error) {
      console.error('Failed to add class:', error);
    }
  },
  removeClass: (id) => set((state) => ({ classes: state.classes.filter((c) => c.id !== id) })),
  setModels: (models) => set({ models }),
  setAugmentationTasks: (tasks) => set({ augmentationTasks: tasks }),
}));

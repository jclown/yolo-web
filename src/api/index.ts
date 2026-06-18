
async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const isFormData = options?.body instanceof FormData;

  let fetchOptions: RequestInit = { ...options };

  if (!isFormData) {
    fetchOptions.headers = {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    };
  }

  const res = await fetch(`/api${endpoint}`, fetchOptions);
  if (!res.ok) throw new Error(`API Error: ${res.status} ${res.statusText}`);
  return res.json();
}

export const detectApi = {
  detect: (formData: FormData) =>
    fetch('/api/detect', { method: 'POST', body: formData }).then((r) => r.json()),
  getTaskStatus: (taskId: string) =>
    fetch(`/api/detect/status/${taskId}`).then((r) => r.json()),
  batchDetect: (formData: FormData) =>
    fetch('/api/detect/batch', { method: 'POST', body: formData }).then((r) => r.json()),
};

export const datasetsApi = {
  list: () => request<{ datasets: any[] }>('/datasets'),
  getAll: () => request<{ data: any[] }>('/datasets'),
  get: (id: string) => request<{ dataset: any }>(`/datasets/${id}`),
  create: (data: { name: string }) => request<{ dataset: any }>('/datasets', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: string) => request<{ success: boolean }>(`/datasets/${id}`, { method: 'DELETE' }),
  uploadImages: (datasetId: string, formData: FormData) =>
    fetch(`/api/datasets/${datasetId}/images`, { method: 'POST', body: formData }).then((r) => r.json()),
  getImages: (datasetId: string) => request<{ data: any[] }>(`/datasets/${datasetId}/images`),
  deleteImage: (imageId: string) => request<{ success: boolean }>(`/datasets/images/${imageId}`, { method: 'DELETE' }),
  getImageAnnotations: (imageId: string) => request<{ data: any[] }>(`/datasets/images/${imageId}/annotations`),
  createAnnotation: (imageId: string, annotation: any) =>
    request<{ data: any }>(`/datasets/images/${imageId}/annotations`, {
      method: 'POST',
      body: JSON.stringify(annotation),
    }),
  updateAnnotation: (annotationId: string, annotation: any) =>
    request<{ data: any }>(`/datasets/annotations/${annotationId}`, {
      method: 'PUT',
      body: JSON.stringify(annotation),
    }),
  getStats: (datasetId: string) => request<{ stats: any }>(`/datasets/${datasetId}/stats`),
  getDashboardStats: () =>
    request<{
      data: {
        datasetCount: number;
        imageCount: number;
        annotatedImageCount: number;
        modelCount: number;
        datasets: { id: string; name: string; imageCount: number; annotatedCount: number }[];
      };
    }>('/datasets/stats/dashboard'),
  getClasses: (datasetId: string) =>
    request<{ data: any[] }>(`/datasets/${datasetId}/classes`),
  createClass: (datasetId: string, data: { name: string; color: string }) =>
    request<{ data: any }>(`/datasets/${datasetId}/classes`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteClass: (classId: number) =>
    request<{ success: boolean }>(`/datasets/classes/${classId}`, { method: 'DELETE' }),
  sliceDataset: (datasetId: string, params: { sliceHeight: number; sliceWidth: number; overlapRatio: number }) =>
    request<{ success: boolean; datasetId: string; datasetName: string; totalSlices: number; originalImages: number }>(
      `/datasets/${datasetId}/slice`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      },
    ),

  exportYOLO: (datasetId: string, imageId: string, yoloContent: string) =>
    fetch(`/api/datasets/${datasetId}/export-yolo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId, yoloContent }),
    }).then((r) => r.json()),

  importYoloJson: (formData: FormData) =>
    fetch('/api/datasets/import-yolo-json', {
      method: 'POST',
      body: formData,
    }).then((r) => r.json()),
};

export const trainApi = {
  start: (config: any) => request<{ success: boolean; data: any }>('/train', { method: 'POST', body: JSON.stringify(config) }),
  stop: (taskId: string) => request<{ success: boolean }>(`/train/${taskId}/stop`, { method: 'POST' }),
  getStatus: (taskId: string) => request<{ success: boolean; data: { task: any; metrics: any[] } }>(`/train/${taskId}`),
  getMetrics: (taskId: string) => request<{ metrics: any[] }>(`/train/${taskId}/metrics`),
  list: () => request<{ success: boolean; data: any[] }>('/train/models'),
};

export const augmentApi = {
  createTask: (data: any) => request<{ success: boolean; data: any }>('/augment', { method: 'POST', body: JSON.stringify(data) }),
  list: () => request<{ success: boolean; data: any[] }>('/augment'),
  get: (id: string) => request<{ success: boolean; data: any }>(`/augment/${id}`),
  stop: (id: string) => request<{ success: boolean }>(`/augment/${id}/stop`, { method: 'POST' }),
  delete: (id: string) => request<{ success: boolean }>(`/augment/${id}`, { method: 'DELETE' }),
};

export const authApi = {
  login: (data: { username: string; password: string }) =>
    request<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  register: (data: { username: string; password: string }) =>
    request<{ token: string }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
};

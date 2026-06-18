import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { spawn } from 'child_process'

const router = Router()

const uploadDir = path.join(process.cwd(), 'data', 'uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir)
  },
  filename: (_req, file, cb) => {
    let ext = path.extname(file.originalname).toLowerCase()
    // YOLO/ultralytics does not support .jfif — rename to .jpg
    if (ext === '.jfif') ext = '.jpg'
    const uniqueName = `${uuidv4()}${ext}`
    cb(null, uniqueName)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
})

const pythonCmd = process.env.PYTHON_PATH || 'python'
const pythonService = path.join(process.cwd(), 'python', 'yolo_service.py')

// ---- Async task store ----
interface DetectTask {
  id: string
  status: 'pending' | 'running' | 'done' | 'error'
  createdAt: number
  detections: any[]
  error: string | null
  inferenceTime: number
  resultImage: string | null
  processedAt: number
}

const tasks = new Map<string, DetectTask>()
const TASK_TTL_MS = 10 * 60 * 1000 // 10 minutes

// Cleanup old tasks every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [id, task] of tasks) {
    if (now - task.processedAt > TASK_TTL_MS) {
      tasks.delete(id)
    }
  }
}, 5 * 60 * 1000)

// ---- POST /api/detect — start async detection ----
router.post('/', upload.single('image'), (req: Request, res: Response): void => {
  try {
    const file = req.file
    if (!file) {
      console.error('[Detect] No file received. req.body keys:', Object.keys(req.body))
      res.status(400).json({ success: false, error: 'No image uploaded' })
      return
    }
    console.log(`[Detect] Received file: ${file.originalname}, saved: ${file.path}`)

    const modelPath = req.body.model_path || req.body.model || 'yolov8n.pt'
    const confThreshold = parseFloat(req.body.conf_threshold || req.body.confidence || '0.25')
    const iouThreshold = parseFloat(req.body.iou_threshold || '0.45')
    const autoSlice = req.body.auto_slice !== 'false' && req.body.auto_slice !== false
    const device = req.body.device || 'auto'

    const taskId = uuidv4()
    const task: DetectTask = {
      id: taskId,
      status: 'pending',
      createdAt: Date.now(),
      detections: [],
      error: null,
      inferenceTime: 0,
      resultImage: null,
      processedAt: 0,
    }
    tasks.set(taskId, task)

    const config = JSON.stringify({
      image_path: file.path,
      model_path: modelPath,
      conf_threshold: confThreshold,
      iou_threshold: iouThreshold,
      image_size: 640,
      auto_slice: autoSlice,
      device,
    })

    // Return immediately with taskId
    res.json({
      success: true,
      data: { taskId },
    })

    // Start Python in background
    task.status = 'running'
    const proc = spawn(pythonCmd, [pythonService, 'detect', config])
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('error', (err) => {
      console.error(`[Detect] task=${taskId} Python process error:`, err)
      const hint = err.message.includes('ENOENT')
        ? `Python 未找到，请安装 Python 并确保在 PATH 中，或设置 PYTHON_PATH 环境变量`
        : err.message
      task.status = 'error'
      task.error = hint
      task.processedAt = Date.now()
    })

    proc.on('close', (code) => {
      task.processedAt = Date.now()
      try {
        const lines = stdout.trim().split('\n').filter((l) => l.trim())
        const lastLine = lines[lines.length - 1]

        if (!lastLine) {
          const errDetail = stderr.trim() || `进程退出码: ${code}`
          console.error(`[Detect] task=${taskId} 无输出. code=${code}, stderr: ${errDetail}`)
          task.status = 'error'
          task.error = errDetail.slice(0, 500)
          return
        }

        const result = JSON.parse(lastLine)

        if (code !== 0 || !result.success) {
          const errMsg = result?.error || `进程退出码: ${code}. stderr: ${stderr.trim()}`
          console.error(`[Detect] task=${taskId} failed: ${errMsg}`)
          task.status = 'error'
          task.error = errMsg
          return
        }

        const detections = (result.detections || []).map((d: any) => ({
          class_id: d.class_id,
          class_name: d.class_name,
          confidence: d.confidence,
          bbox: d.bbox,
        }))

        console.log(`[Detect] task=${taskId} done. Found ${detections.length} objects`)
        task.status = 'done'
        task.detections = detections
        task.inferenceTime = result.inference_time || 0
        task.resultImage = result.result_image || null
      } catch (err) {
        console.error(`[Detect] task=${taskId} 解析输出失败 (code=${code}):`, err)
        console.error('[Detect] stdout:', stdout.slice(0, 500))
        console.error('[Detect] stderr:', stderr.slice(0, 500))
        task.status = 'error'
        task.error = `解析结果失败: ${err instanceof Error ? err.message : String(err)}`
      }
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[Detect] Outer catch error:', errMsg)
    res.status(500).json({ success: false, error: `Detection failed: ${errMsg}` })
  }
})

// ---- GET /api/detect/status/:taskId — poll task status ----
router.get('/status/:taskId', (req: Request, res: Response): void => {
  const task = tasks.get(req.params.taskId)
  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found or expired' })
    return
  }
  res.json({
    success: true,
    data: {
      taskId: task.id,
      status: task.status,
      detections: task.detections,
      error: task.error,
      inferenceTime: task.inferenceTime,
      resultImage: task.resultImage,
    },
  })
})

// ---- POST /api/detect/batch (keep sync for now, unchanged) ----
router.post('/batch', upload.array('images', 20), (req: Request, res: Response): void => {
  try {
    const files = req.files as Express.Multer.File[]
    if (!files || files.length === 0) {
      res.status(400).json({ success: false, error: 'No images uploaded' })
      return
    }
    const modelPath = req.body.model_path || req.body.model || 'yolov8n.pt'
    const confThreshold = parseFloat(req.body.conf_threshold || req.body.confidence || '0.25')
    const iouThreshold = parseFloat(req.body.iou_threshold || '0.45')
    const autoSlice = req.body.auto_slice !== 'false' && req.body.auto_slice !== false
    const device = req.body.device || 'auto'

    const results: any[] = []
    let processed = 0

    files.forEach((file) => {
      const config = JSON.stringify({
        image_path: file.path,
        model_path: modelPath,
        conf_threshold: confThreshold,
        iou_threshold: iouThreshold,
        image_size: 640,
        auto_slice: autoSlice,
        device,
      })

      const proc = spawn(pythonCmd, [pythonService, 'detect', config])

      let stdout = ''
      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.on('close', () => {
        try {
          const lines = stdout.trim().split('\n')
          const lastLine = lines[lines.length - 1]
          const result = JSON.parse(lastLine)
          results.push({
            filename: file.filename,
            image_path: file.path,
            detections: result.success ? result.detections : [],
          })
        } catch {
          results.push({
            filename: file.filename,
            image_path: file.path,
            detections: [],
          })
        }

        processed++
        if (processed === files.length) {
          res.json({
            success: true,
            data: {
              total: results.length,
              results,
            },
          })
        }
      })
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[Detect] Batch outer catch error:', errMsg)
    res.status(500).json({ success: false, error: `Batch detection failed: ${errMsg}` })
  }
})

export default router

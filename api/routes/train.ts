import { Router, type Request, type Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import db from '../db/init.js'

const router = Router()

interface ActiveTask {
  id: string
  model_id: string
  dataset_id: string
  status: string
  epochs: number
  current_epoch: number
  progress: number
  process: ChildProcess | null
}

const activeTasks = new Map<string, ActiveTask>()

const pythonCmd = process.env.PYTHON_PATH || 'python'
const pythonDir = path.join(process.cwd(), 'python')
const datasetDir = path.join(process.cwd(), 'data', 'datasets')
const modelsDir = path.join(process.cwd(), 'data', 'models')

function prepareTrainingData(datasetId: string): { success: boolean; error?: string; annotatedCount?: number; trainCount?: number; valCount?: number; trainDir?: string } {
  const dsDir = path.join(datasetDir, datasetId)
  const imagesDir = path.join(dsDir, 'images')
  const labelsDir = path.join(dsDir, 'labels')

  if (!fs.existsSync(imagesDir)) {
    return { success: false, error: '数据集图片目录不存在，请先上传图片' }
  }

  const classes = db.prepare('SELECT id, name FROM classes WHERE dataset_id = ? ORDER BY id ASC').all(datasetId) as { id: string; name: string }[]
  if (classes.length === 0) {
    return { success: false, error: '数据集没有定义类别，请先在标注页面添加类别' }
  }

  if (!fs.existsSync(labelsDir)) {
    fs.mkdirSync(labelsDir, { recursive: true })
  }

  const annotatedImages = db.prepare(`
    SELECT DISTINCT i.id, i.filename, i.path
    FROM images i
    INNER JOIN annotations a ON a.image_id = i.id
    WHERE i.dataset_id = ?
  `).all(datasetId) as { id: string; filename: string; path: string }[]

  if (annotatedImages.length === 0) {
    return { success: false, error: '数据集没有已标注的图片，请先标注图片后再训练' }
  }

  const classIndexMap = new Map<string, number>()
  classes.forEach((cls, idx) => {
    classIndexMap.set(cls.id, idx)
  })

  for (const img of annotatedImages) {
    const annotations = db.prepare(`
      SELECT a.* FROM annotations a WHERE a.image_id = ?
    `).all(img.id) as { class_id: string; x: number; y: number; width: number; height: number }[]

    const imageName = path.parse(img.filename).name
    const labelPath = path.join(labelsDir, `${imageName}.txt`)

    const lines = annotations.map(a => {
      const clsIdx = classIndexMap.get(a.class_id)
      if (clsIdx === undefined) return null
      const centerX = a.x + a.width / 2
      const centerY = a.y + a.height / 2
      return `${clsIdx} ${centerX.toFixed(6)} ${centerY.toFixed(6)} ${a.width.toFixed(6)} ${a.height.toFixed(6)}`
    }).filter((l): l is string => l !== null)

    fs.writeFileSync(labelPath, lines.join('\n'))
  }

  const trainImagesDir = path.join(dsDir, 'train', 'images')
  const trainLabelsDir = path.join(dsDir, 'train', 'labels')
  const valImagesDir = path.join(dsDir, 'val', 'images')
  const valLabelsDir = path.join(dsDir, 'val', 'labels')

  ;[trainImagesDir, trainLabelsDir, valImagesDir, valLabelsDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  })

  const imageFiles = fs.readdirSync(imagesDir).filter(f =>
    /\.(jpg|jpeg|png|bmp|webp)$/i.test(f)
  )

  const annotatedFilenames = new Set(annotatedImages.map(img => img.filename))
  const annotatedFiles = imageFiles.filter(f => annotatedFilenames.has(f))

  if (annotatedFiles.length === 0) {
    return { success: false, error: '没有找到已标注的图片文件' }
  }

  const shuffled = [...annotatedFiles].sort(() => Math.random() - 0.5)
  const valRatio = 0.2
  const valCount = Math.max(1, Math.floor(shuffled.length * valRatio))
  const valFiles = shuffled.slice(0, valCount)
  const trainFiles = shuffled.slice(valCount)

  if (trainFiles.length === 0) {
    return { success: false, error: '标注图片数量太少，无法划分训练集（至少需要2张）' }
  }

  const linkOrCopy = (src: string, dst: string) => {
    if (fs.existsSync(dst)) fs.unlinkSync(dst)
    try {
      fs.linkSync(src, dst)
    } catch {
      fs.copyFileSync(src, dst)
    }
  }

  for (const file of trainFiles) {
    const imgSrc = path.join(imagesDir, file)
    const imgDst = path.join(trainImagesDir, file)
    linkOrCopy(imgSrc, imgDst)
    const name = path.parse(file).name
    const labelSrc = path.join(labelsDir, `${name}.txt`)
    if (fs.existsSync(labelSrc)) {
      linkOrCopy(labelSrc, path.join(trainLabelsDir, `${name}.txt`))
    }
  }

  for (const file of valFiles) {
    const imgSrc = path.join(imagesDir, file)
    const imgDst = path.join(valImagesDir, file)
    linkOrCopy(imgSrc, imgDst)
    const name = path.parse(file).name
    const labelSrc = path.join(labelsDir, `${name}.txt`)
    if (fs.existsSync(labelSrc)) {
      linkOrCopy(labelSrc, path.join(valLabelsDir, `${name}.txt`))
    }
  }

  return {
    success: true,
    annotatedCount: annotatedFiles.length,
    trainCount: trainFiles.length,
    valCount: valFiles.length,
  }
}

router.get('/models', (_req: Request, res: Response): void => {
  try {
    const models = db.prepare(`
      SELECT m.*, t.status, t.current_epoch, t.completed_at
      FROM models m
      LEFT JOIN training_tasks t ON m.id = t.model_id
      ORDER BY m.created_at DESC
    `).all()
    res.json({ success: true, data: models })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch models' })
  }
})

router.get('/models/:id', (req: Request, res: Response): void => {
  try {
    const model = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id)
    if (!model) {
      res.status(404).json({ success: false, error: 'Model not found' })
      return
    }
    res.json({ success: true, data: model })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch model' })
  }
})

router.delete('/models/:id', (req: Request, res: Response): void => {
  try {
    const model = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id)
    if (!model) {
      res.status(404).json({ success: false, error: 'Model not found' })
      return
    }
    db.prepare('DELETE FROM metric_logs WHERE task_id IN (SELECT id FROM training_tasks WHERE model_id = ?)').run(req.params.id)
    db.prepare('DELETE FROM training_tasks WHERE model_id = ?').run(req.params.id)
    db.prepare('DELETE FROM models WHERE id = ?').run(req.params.id)
    res.json({ success: true, message: 'Model deleted successfully' })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete model' })
  }
})

router.post('/', (req: Request, res: Response): void => {
  try {
    const { name, model_path, dataset_id, epochs, batch_size, learning_rate, auto_slice, overlap_ratio, image_size, device } = req.body
    if (!name || !model_path || !dataset_id || !epochs) {
      res.status(400).json({ success: false, error: 'Missing required fields: name, model_path, dataset_id, epochs' })
      return
    }
    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(dataset_id) as any
    if (!dataset) {
      res.status(404).json({ success: false, error: 'Dataset not found' })
      return
    }

    const classes = db.prepare('SELECT name FROM classes WHERE dataset_id = ? ORDER BY id ASC').all(dataset_id) as { name: string }[]
    const classNames = classes.map((c) => c.name)

    const dataPrep = prepareTrainingData(dataset_id)
    if (!dataPrep.success) {
      res.status(400).json({ success: false, error: dataPrep.error })
      return
    }

    const modelId = uuidv4()
    const taskId = uuidv4()

    db.prepare('INSERT INTO models (id, name, type, path) VALUES (?, ?, ?, ?)').run(
      modelId, name, 'yolov8', model_path
    )
    const config = JSON.stringify({ batch_size: batch_size || 16, learning_rate: learning_rate || 0.001 })
    db.prepare('INSERT INTO training_tasks (id, model_id, dataset_id, status, epochs, config, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      taskId, modelId, dataset_id, 'running', epochs, config, new Date().toISOString()
    )

    const taskInfo: ActiveTask = {
      id: taskId,
      model_id: modelId,
      dataset_id,
      status: 'running',
      epochs,
      current_epoch: 0,
      progress: 0,
      process: null,
    }
    activeTasks.set(taskId, taskInfo)

    spawnTraining(taskId, modelId, {
      dataset_dir: path.join(datasetDir, dataset_id),
      train_dir: path.join(datasetDir, dataset_id, 'train'),
      val_dir: path.join(datasetDir, dataset_id, 'val'),
      model_path,
      epochs,
      batch_size: batch_size || 16,
      learning_rate: learning_rate || 0.01,
      image_size: image_size || 640,
      project_dir: path.join(modelsDir),
      task_id: taskId,
      classes: classNames,
      auto_slice: auto_slice !== false,
      overlap_ratio: overlap_ratio || 0.2,
      device: device || 'auto',
    })

    const task = db.prepare('SELECT * FROM training_tasks WHERE id = ?').get(taskId)
    res.status(201).json({ success: true, data: task })
  } catch (error) {
    console.error('Start training error:', error)
    res.status(500).json({ success: false, error: 'Failed to start training' })
  }
})

function spawnTraining(taskId: string, modelId: string, config: Record<string, any>) {
  const scriptPath = path.join(pythonDir, 'train.py')
  const configJson = JSON.stringify(config)

  console.log(`[Train] Spawning: ${pythonCmd} ${scriptPath}`)
  console.log(`[Train] Config: ${configJson}`)

  const proc = spawn(pythonCmd, [scriptPath, configJson], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const task = activeTasks.get(taskId)
  if (task) task.process = proc

  let stderrBuf = ''

  proc.stdout.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter((l) => l.trim())
    for (const line of lines) {
      try {
        const msg = JSON.parse(line)
        handlePythonMessage(taskId, modelId, msg)
      } catch {
        console.log(`[Train:${taskId}] ${line}`)
      }
    }
  })

  proc.stderr.on('data', (data: Buffer) => {
    stderrBuf += data.toString()
    const lines = stderrBuf.split('\n')
    stderrBuf = lines.pop() || ''
    for (const line of lines) {
      if (line.trim()) console.error(`[Train:${taskId}:stderr] ${line}`)
    }
  })

  proc.on('close', (code) => {
    console.log(`[Train:${taskId}] Process exited with code ${code}`)
    const t = activeTasks.get(taskId)
    if (t && t.status === 'running') {
      db.prepare('UPDATE training_tasks SET status = ?, completed_at = ? WHERE id = ?').run(
        code === 0 ? 'completed' : 'failed', new Date().toISOString(), taskId
      )
      t.status = code === 0 ? 'completed' : 'failed'
    }
    activeTasks.delete(taskId)
  })

  proc.on('error', (err) => {
    console.error(`[Train:${taskId}] Process error:`, err)
    db.prepare('UPDATE training_tasks SET status = ?, completed_at = ? WHERE id = ?').run(
      'failed', new Date().toISOString(), taskId
    )
    db.prepare('UPDATE models SET path = ? WHERE id = ?').run(
      `error: ${err.message}`, modelId
    )
    activeTasks.delete(taskId)
  })
}

function handlePythonMessage(taskId: string, modelId: string, msg: any) {
  const task = activeTasks.get(taskId)
  if (!task) return

  if (msg.type === 'epoch') {
    const epoch = msg.epoch as number
    const progress = Math.round((epoch / task.epochs) * 100)
    task.current_epoch = epoch
    task.progress = progress

    const metricId = uuidv4()
    db.prepare('INSERT INTO metric_logs (id, task_id, epoch, train_loss, val_loss, mAP50, mAP50_95) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      metricId, taskId, epoch, msg.train_loss ?? 0, msg.val_loss ?? 0, msg.mAP50 ?? 0, msg.mAP50_95 ?? 0
    )
    db.prepare('UPDATE training_tasks SET current_epoch = ? WHERE id = ?').run(epoch, taskId)

    console.log(`[Train:${taskId}] Epoch ${epoch}/${task.epochs} loss=${(msg.train_loss ?? 0).toFixed(4)} mAP50=${(msg.mAP50 ?? 0).toFixed(4)}`)
  } else if (msg.type === 'complete') {
    const mAP50 = msg.mAP50 ?? 0
    const bestModel = msg.best_model || ''

    db.prepare('UPDATE training_tasks SET status = ?, completed_at = ? WHERE id = ?').run(
      'completed', new Date().toISOString(), taskId
    )
    db.prepare('UPDATE models SET mAP50 = ?, path = ? WHERE id = ?').run(mAP50, bestModel, modelId)

    task.status = 'completed'
    task.progress = 100
    console.log(`[Train:${taskId}] Complete! mAP50=${mAP50} best=${bestModel}`)
  } else if (msg.type === 'error') {
    console.error(`[Train:${taskId}] Error: ${msg.message}`)
    db.prepare('UPDATE training_tasks SET status = ?, completed_at = ? WHERE id = ?').run(
      'failed', new Date().toISOString(), taskId
    )
    task.status = 'failed'
  } else if (msg.type === 'info') {
    console.log(`[Train:${taskId}] ${msg.message}`)
  }
}

router.get('/', (_req: Request, res: Response): void => {
  try {
    const tasks = db.prepare('SELECT * FROM training_tasks ORDER BY started_at DESC').all()
    const enrichedTasks = tasks.map((task: any) => {
      const activeTask = activeTasks.get(task.id)
      if (activeTask) {
        return { ...task, current_epoch: activeTask.current_epoch, progress: activeTask.progress }
      }
      return task
    })
    res.json({ success: true, data: enrichedTasks })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch training tasks' })
  }
})

router.get('/:id', (req: Request, res: Response): void => {
  try {
    const task = db.prepare('SELECT * FROM training_tasks WHERE id = ?').get(req.params.id) as any
    if (!task) {
      res.status(404).json({ success: false, error: 'Training task not found' })
      return
    }
    const activeTask = activeTasks.get(req.params.id)
    if (activeTask) {
      task.current_epoch = activeTask.current_epoch
      task.progress = activeTask.progress
    }
    const metrics = db.prepare('SELECT * FROM metric_logs WHERE task_id = ? ORDER BY epoch').all(req.params.id)
    res.json({ success: true, data: { task, metrics } })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch training task' })
  }
})

router.post('/:id/stop', (req: Request, res: Response): void => {
  try {
    const task = db.prepare('SELECT * FROM training_tasks WHERE id = ?').get(req.params.id) as any
    if (!task) {
      res.status(404).json({ success: false, error: 'Training task not found' })
      return
    }
    if (task.status !== 'running') {
      res.status(400).json({ success: false, error: 'Task is not running' })
      return
    }
    const activeTask = activeTasks.get(req.params.id)
    if (activeTask?.process) {
      activeTask.process.kill('SIGTERM')
    }
    activeTasks.delete(req.params.id)
    db.prepare('UPDATE training_tasks SET status = ?, completed_at = ? WHERE id = ?').run(
      'stopped', new Date().toISOString(), req.params.id
    )
    res.json({ success: true, message: 'Training stopped' })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to stop training' })
  }
})

export default router

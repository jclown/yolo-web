import { Router, type Request, type Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import db from '../db/init.js'

const router = Router()

interface ActiveAugmentTask {
  id: string
  dataset_id: string
  status: string
  progress: number
  process: ChildProcess | null
}

const activeTasks = new Map<string, ActiveAugmentTask>()

const pythonCmd = process.env.PYTHON_PATH || 'python'
const pythonDir = path.join(process.cwd(), 'python')
const datasetDir = path.join(process.cwd(), 'data', 'datasets')

router.post('/', (req: Request, res: Response): void => {
  try {
    const { dataset_id, strategies, multiplier, name } = req.body
    if (!dataset_id || !strategies || !multiplier) {
      res.status(400).json({ success: false, error: 'Missing required fields: dataset_id, strategies, multiplier' })
      return
    }
    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(dataset_id) as any
    if (!dataset) {
      res.status(404).json({ success: false, error: 'Dataset not found' })
      return
    }
    const imageCount = db.prepare('SELECT COUNT(*) as count FROM images WHERE dataset_id = ?').get(dataset_id) as { count: number }
    if (imageCount.count === 0) {
      res.status(400).json({ success: false, error: 'Dataset has no images' })
      return
    }

    const taskId = uuidv4()
    const strategiesStr = typeof strategies === 'string' ? strategies : JSON.stringify(strategies)
    const taskName = name || `augment-${Date.now()}`

    db.prepare('INSERT INTO augment_tasks (id, dataset_id, strategies, multiplier, status) VALUES (?, ?, ?, ?, ?)').run(
      taskId, dataset_id, strategiesStr, multiplier, 'running'
    )

    const taskInfo: ActiveAugmentTask = {
      id: taskId,
      dataset_id,
      status: 'running',
      progress: 0,
      process: null,
    }
    activeTasks.set(taskId, taskInfo)

    const inputDir = path.join(datasetDir, dataset_id, 'images')
    const inputLabelsDir = path.join(datasetDir, dataset_id, 'labels')
    const outputDir = path.join(datasetDir, dataset_id, 'augmented_images')
    const outputLabelsDir = path.join(datasetDir, dataset_id, 'augmented_labels')

    const strategyList = typeof strategies === 'string' ? JSON.parse(strategies) : strategies

    spawnAugmentation(taskId, {
      input_dir: inputDir,
      input_labels_dir: fs.existsSync(inputLabelsDir) ? inputLabelsDir : '',
      output_dir: outputDir,
      output_labels_dir: outputLabelsDir,
      strategies: strategyList,
      multiplier,
      task_id: taskId,
    })

    const task = db.prepare('SELECT * FROM augment_tasks WHERE id = ?').get(taskId)
    res.status(201).json({ success: true, data: task })
  } catch (error) {
    console.error('Start augmentation error:', error)
    res.status(500).json({ success: false, error: 'Failed to start augmentation' })
  }
})

function spawnAugmentation(taskId: string, config: Record<string, any>) {
  const scriptPath = path.join(pythonDir, 'augment.py')
  const configJson = JSON.stringify(config)

  console.log(`[Augment] Spawning: ${pythonCmd} ${scriptPath}`)
  console.log(`[Augment] Config: ${configJson}`)

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
        handleAugmentMessage(taskId, msg)
      } catch {
        console.log(`[Augment:${taskId}] ${line}`)
      }
    }
  })

  proc.stderr.on('data', (data: Buffer) => {
    stderrBuf += data.toString()
    const lines = stderrBuf.split('\n')
    stderrBuf = lines.pop() || ''
    for (const line of lines) {
      if (line.trim()) console.error(`[Augment:${taskId}:stderr] ${line}`)
    }
  })

  proc.on('close', (code) => {
    console.log(`[Augment:${taskId}] Process exited with code ${code}`)
    const t = activeTasks.get(taskId)
    if (t && t.status === 'running') {
      db.prepare('UPDATE augment_tasks SET status = ?, progress = ? WHERE id = ?').run(
        code === 0 ? 'completed' : 'failed', code === 0 ? 100 : t.progress, taskId
      )
      t.status = code === 0 ? 'completed' : 'failed'
      if (code === 0) {
        registerGeneratedImages(taskId, t.dataset_id)
      }
    }
    activeTasks.delete(taskId)
  })

  proc.on('error', (err) => {
    console.error(`[Augment:${taskId}] Process error:`, err)
    db.prepare('UPDATE augment_tasks SET status = ? WHERE id = ?').run('failed', taskId)
    activeTasks.delete(taskId)
  })
}

function registerGeneratedImages(taskId: string, datasetId: string) {
  const outputDir = path.join(datasetDir, datasetId, 'augmented_images')

  if (!fs.existsSync(outputDir)) {
    console.log(`[Augment:${taskId}] No augmented images directory found at ${outputDir}`)
    return
  }

  const imageFiles = fs.readdirSync(outputDir).filter((f) =>
    /\.(jpg|jpeg|png|bmp|webp)$/i.test(f)
  )

  if (imageFiles.length === 0) {
    console.log(`[Augment:${taskId}] No augmented images found`)
    return
  }

  const insertImage = db.prepare(
    'INSERT INTO images (id, dataset_id, filename, path, width, height) VALUES (?, ?, ?, ?, ?, ?)'
  )

  const insertMany = db.transaction((records: any[]) => {
    for (const rec of records) {
      insertImage.run(rec.id, rec.dataset_id, rec.filename, rec.path, rec.width, rec.height)
    }
  })

  const records = imageFiles.map((file) => ({
    id: uuidv4(),
    dataset_id: datasetId,
    filename: file,
    path: path.relative(process.cwd(), path.join(outputDir, file)).replace(/\\/g, '/'),
    width: 0,
    height: 0,
  }))

  insertMany(records)
  console.log(`[Augment:${taskId}] Registered ${records.length} augmented images in DB`)
}

function handleAugmentMessage(taskId: string, msg: any) {
  const task = activeTasks.get(taskId)
  if (!task) return

  if (msg.type === 'progress') {
    const percent = msg.percent ?? 0
    task.progress = percent
    db.prepare('UPDATE augment_tasks SET progress = ? WHERE id = ?').run(percent, taskId)
  } else if (msg.type === 'complete') {
    db.prepare('UPDATE augment_tasks SET status = ?, progress = ? WHERE id = ?').run(
      'completed', 100, taskId
    )
    task.status = 'completed'
    task.progress = 100
    console.log(`[Augment:${taskId}] Complete! generated=${msg.generated_count}`)
    registerGeneratedImages(taskId, task.dataset_id)
  } else if (msg.type === 'error') {
    console.error(`[Augment:${taskId}] Error: ${msg.message}`)
    db.prepare('UPDATE augment_tasks SET status = ? WHERE id = ?').run('failed', taskId)
    task.status = 'failed'
  } else if (msg.type === 'info') {
    console.log(`[Augment:${taskId}] ${msg.message}`)
  }
}

router.get('/', (_req: Request, res: Response): void => {
  try {
    const tasks = db.prepare('SELECT * FROM augment_tasks ORDER BY created_at DESC').all()
    const enrichedTasks = tasks.map((task: any) => {
      const activeTask = activeTasks.get(task.id)
      if (activeTask) {
        return { ...task, progress: activeTask.progress, status: activeTask.status }
      }
      return task
    })
    res.json({ success: true, data: enrichedTasks })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch augmentation tasks' })
  }
})

router.get('/:id', (req: Request, res: Response): void => {
  try {
    const task = db.prepare('SELECT * FROM augment_tasks WHERE id = ?').get(req.params.id) as any
    if (!task) {
      res.status(404).json({ success: false, error: 'Augmentation task not found' })
      return
    }
    const activeTask = activeTasks.get(req.params.id)
    if (activeTask) {
      task.progress = activeTask.progress
      task.status = activeTask.status
    }
    res.json({ success: true, data: task })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch augmentation task' })
  }
})

router.post('/:id/stop', (req: Request, res: Response): void => {
  try {
    const task = db.prepare('SELECT * FROM augment_tasks WHERE id = ?').get(req.params.id) as any
    if (!task) {
      res.status(404).json({ success: false, error: 'Augmentation task not found' })
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
    db.prepare('UPDATE augment_tasks SET status = ? WHERE id = ?').run('stopped', req.params.id)
    res.json({ success: true, message: 'Augmentation stopped' })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to stop augmentation' })
  }
})

router.delete('/:id', (req: Request, res: Response): void => {
  try {
    const task = db.prepare('SELECT * FROM augment_tasks WHERE id = ?').get(req.params.id) as any
    if (!task) {
      res.status(404).json({ success: false, error: 'Augmentation task not found' })
      return
    }
    const activeTask = activeTasks.get(req.params.id)
    if (activeTask?.process) {
      activeTask.process.kill('SIGTERM')
    }
    activeTasks.delete(req.params.id)
    db.prepare('DELETE FROM augment_tasks WHERE id = ?').run(req.params.id)
    res.json({ success: true, message: 'Augmentation task deleted' })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete augmentation task' })
  }
})

export default router

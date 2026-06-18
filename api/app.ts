/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import authRoutes from './routes/auth.js'
import datasetsRoutes from './routes/datasets.js'
import detectRoutes from './routes/detect.js'
import trainRoutes from './routes/train.js'
import augmentRoutes from './routes/augment.js'

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 静态文件服务 - 提供data目录中的图片访问
const dataDir = path.join(__dirname, '..', 'data')
app.use('/data', express.static(dataDir))

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/datasets', datasetsRoutes)
app.use('/api/detect', detectRoutes)
app.use('/api/train', trainRoutes)
app.use('/api/augment', augmentRoutes)

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[App] Unhandled error:', error.message)
  console.error(error.stack)
  res.status(500).json({
    success: false,
    error: `Server internal error: ${error.message}`,
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app

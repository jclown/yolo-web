import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import db from '../db/init.js'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const router = Router()

const uploadDir = path.join(process.cwd(), 'data', 'uploads')
const datasetDir = path.join(process.cwd(), 'data', 'datasets')

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}
if (!fs.existsSync(datasetDir)) {
  fs.mkdirSync(datasetDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir)
  },
  filename: (_req, file, cb) => {
    let ext = path.extname(file.originalname).toLowerCase()
    if (ext === '.jfif') ext = '.jpg'
    const uniqueName = `${uuidv4()}${ext}`
    cb(null, uniqueName)
  },
})

const fileFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedExts = /jpeg|jpg|png|webp|bmp|jfif/
  const ext = path.extname(file.originalname).toLowerCase()
  const extname = allowedExts.test(ext)
  const allowedMimes = /jpeg|jpg|png|webp|bmp/
  const mimetype = allowedMimes.test(file.mimetype)
  if ((mimetype || ext === '.jfif') && extname) {
    cb(null, true)
  } else {
    cb(new Error('Only image files are allowed'))
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
})

// ============================================================
// Fixed-path routes MUST be registered BEFORE /:id routes
// to avoid Express matching "images" / "stats" / "annotations"
// / "classes" as a dynamic :id parameter.
// ============================================================

router.get('/', (_req: Request, res: Response): void => {
  try {
    const datasets = db.prepare(`
      SELECT d.*,
        (SELECT COUNT(*) FROM images WHERE dataset_id = d.id) as image_count,
        (SELECT COUNT(DISTINCT image_id) FROM annotations WHERE image_id IN (SELECT id FROM images WHERE dataset_id = d.id)) as annotated_count
      FROM datasets d
      ORDER BY d.created_at DESC
    `).all()
    res.json({ success: true, data: datasets })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch datasets' })
  }
})

router.post('/', (req: Request, res: Response): void => {
  try {
    const { name, description } = req.body
    if (!name) {
      res.status(400).json({ success: false, error: 'Dataset name is required' })
      return
    }
    const id = uuidv4()
    db.prepare('INSERT INTO datasets (id, name, description) VALUES (?, ?, ?)').run(id, name, description || '')
    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id)
    res.status(201).json({ success: true, data: dataset })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create dataset' })
  }
})

// --- Dashboard Stats ---
router.get('/stats/dashboard', (_req: Request, res: Response): void => {
  try {
    const datasetCount = (db.prepare('SELECT COUNT(*) as count FROM datasets').get() as any).count
    const imageCount = (db.prepare('SELECT COUNT(*) as count FROM images').get() as any).count
    const annotatedImageCount = (db.prepare('SELECT COUNT(DISTINCT image_id) as count FROM annotations').get() as any).count
    const modelCount = (db.prepare('SELECT COUNT(*) as count FROM models').get() as any).count

    const datasets = db.prepare(`
      SELECT d.id, d.name,
        (SELECT COUNT(*) FROM images WHERE dataset_id = d.id) as image_count,
        (SELECT COUNT(DISTINCT image_id) FROM annotations WHERE image_id IN (SELECT id FROM images WHERE dataset_id = d.id)) as annotated_count
      FROM datasets d
      ORDER BY d.created_at DESC
    `).all() as any[]

    res.json({
      success: true,
      data: {
        datasetCount,
        imageCount,
        annotatedImageCount,
        modelCount,
        datasets: datasets.map(ds => ({
          id: ds.id,
          name: ds.name,
          imageCount: ds.image_count,
          annotatedCount: ds.annotated_count,
        })),
      },
    })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard stats' })
  }
})

// --- Image routes (fixed path: /images/:imageId) ---
router.delete('/images/:imageId', (req: Request, res: Response): void => {
  try {
    const image = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.imageId) as any
    if (!image) {
      res.status(404).json({ success: false, error: 'Image not found' })
      return
    }
    const imagePath = path.resolve(image.path)
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath)
    }
    const datasetId = image.dataset_id
    if (datasetId) {
      const imageName = path.parse(image.filename).name
      const labelPath = path.join(datasetDir, datasetId, 'labels', `${imageName}.txt`)
      if (fs.existsSync(labelPath)) {
        fs.unlinkSync(labelPath)
      }
    }
    db.prepare('DELETE FROM annotations WHERE image_id = ?').run(req.params.imageId)
    db.prepare('DELETE FROM images WHERE id = ?').run(req.params.imageId)
    res.json({ success: true, message: 'Image deleted successfully' })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete image' })
  }
})

router.post('/images/:imageId/annotations', (req: Request, res: Response): void => {
  try {
    console.log('Creating annotation for image:', req.params.imageId);
    console.log('Annotation data:', req.body);

    const image = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.imageId)
    if (!image) {
      console.log('Image not found:', req.params.imageId);
      res.status(404).json({ success: false, error: 'Image not found' })
      return
    }
    const { class_id, x, y, width, height } = req.body
    if (class_id === undefined || x === undefined || y === undefined || width === undefined || height === undefined) {
      console.log('Missing fields:', { class_id, x, y, width, height });
      res.status(400).json({ success: false, error: 'Missing required annotation fields' })
      return
    }
    const id = uuidv4()
    console.log('Inserting annotation:', { id, imageId: req.params.imageId, class_id, x, y, width, height });
    db.prepare('INSERT INTO annotations (id, image_id, class_id, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, req.params.imageId, class_id, x, y, width, height
    )
    const annotation = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id)
    console.log('Annotation created:', annotation);
    res.status(201).json({ success: true, data: annotation })
  } catch (error) {
    console.error('Error creating annotation:', error);
    res.status(500).json({ success: false, error: 'Failed to create annotation' })
  }
})

router.get('/images/:imageId/annotations', (req: Request, res: Response): void => {
  try {
    const annotations = db.prepare('SELECT * FROM annotations WHERE image_id = ?').all(req.params.imageId)
    res.json({ success: true, data: annotations })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch annotations' })
  }
})

// --- Annotation routes (fixed path: /annotations/:annotationId) ---
router.put('/annotations/:annotationId', (req: Request, res: Response): void => {
  try {
    const existing = db.prepare('SELECT * FROM annotations WHERE id = ?').get(req.params.annotationId) as any
    if (!existing) {
      res.status(404).json({ success: false, error: 'Annotation not found' })
      return
    }
    const { class_id, x, y, width, height } = req.body
    db.prepare('UPDATE annotations SET class_id = ?, x = ?, y = ?, width = ?, height = ? WHERE id = ?').run(
      class_id !== undefined ? class_id : existing.class_id,
      x !== undefined ? x : existing.x,
      y !== undefined ? y : existing.y,
      width !== undefined ? width : existing.width,
      height !== undefined ? height : existing.height,
      req.params.annotationId
    )
    const annotation = db.prepare('SELECT * FROM annotations WHERE id = ?').get(req.params.annotationId)
    res.json({ success: true, data: annotation })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update annotation' })
  }
})

router.delete('/annotations/:annotationId', (req: Request, res: Response): void => {
  try {
    const existing = db.prepare('SELECT * FROM annotations WHERE id = ?').get(req.params.annotationId)
    if (!existing) {
      res.status(404).json({ success: false, error: 'Annotation not found' })
      return
    }
    db.prepare('DELETE FROM annotations WHERE id = ?').run(req.params.annotationId)
    res.json({ success: true, message: 'Annotation deleted successfully' })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete annotation' })
  }
})

// --- Class routes (fixed path: /classes/:classId) ---
router.delete('/classes/:classId', (req: Request, res: Response): void => {
  try {
    const { classId } = req.params
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId)
    res.json({ success: true, message: 'Class deleted' })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete class' })
  }
})

// ============================================================
// Dynamic /:id routes (registered AFTER fixed-path routes)
// ============================================================

router.get('/:id', (req: Request, res: Response): void => {
  try {
    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id)
    if (!dataset) {
      res.status(404).json({ success: false, error: 'Dataset not found' })
      return
    }
    res.json({ success: true, data: dataset })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch dataset' })
  }
})

router.put('/:id', (req: Request, res: Response): void => {
  try {
    const { name, description } = req.body
    const existing = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id) as any
    if (!existing) {
      res.status(404).json({ success: false, error: 'Dataset not found' })
      return
    }
    db.prepare('UPDATE datasets SET name = ?, description = ? WHERE id = ?').run(
      name || existing.name,
      description !== undefined ? description : existing.description,
      req.params.id
    )
    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: dataset })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update dataset' })
  }
})

router.delete('/:id', (req: Request, res: Response): void => {
  try {
    const existing = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id)
    if (!existing) {
      res.status(404).json({ success: false, error: 'Dataset not found' })
      return
    }
    const dsDir = path.join(datasetDir, req.params.id)
    if (fs.existsSync(dsDir)) {
      fs.rmSync(dsDir, { recursive: true, force: true })
    }
    db.prepare('DELETE FROM annotations WHERE image_id IN (SELECT id FROM images WHERE dataset_id = ?)').run(req.params.id)
    db.prepare('DELETE FROM images WHERE dataset_id = ?').run(req.params.id)
    db.prepare('DELETE FROM classes WHERE dataset_id = ?').run(req.params.id)
    db.prepare('DELETE FROM datasets WHERE id = ?').run(req.params.id)
    res.json({ success: true, message: 'Dataset deleted successfully' })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete dataset' })
  }
})

router.post('/:id/images', upload.array('images', 50), (req: Request, res: Response): void => {
  try {
    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id)
    if (!dataset) {
      res.status(404).json({ success: false, error: 'Dataset not found' })
      return
    }
    const files = req.files as Express.Multer.File[]
    if (!files || files.length === 0) {
      res.status(400).json({ success: false, error: 'No images uploaded' })
      return
    }

    const dsImagesDir = path.join(datasetDir, req.params.id, 'images')
    if (!fs.existsSync(dsImagesDir)) {
      fs.mkdirSync(dsImagesDir, { recursive: true })
    }

    const insertImage = db.prepare('INSERT INTO images (id, dataset_id, filename, path, width, height) VALUES (?, ?, ?, ?, ?, ?)')
    const insertedImages: any[] = []
    const insertMany = db.transaction((images: any[]) => {
      for (const img of images) {
        insertImage.run(img.id, img.dataset_id, img.filename, img.path, img.width, img.height)
      }
    })
    const imageRecords = files.map(file => {
      const dsImagePath = path.join(dsImagesDir, file.filename)
      fs.copyFileSync(file.path, dsImagePath)
      fs.unlinkSync(file.path)
      return {
        id: uuidv4(),
        dataset_id: req.params.id,
        filename: file.filename,
        path: path.relative(process.cwd(), dsImagePath).replace(/\\/g, '/'),
        width: 0,
        height: 0,
      }
    })
    insertMany(imageRecords)
    imageRecords.forEach(record => {
      const img = db.prepare('SELECT * FROM images WHERE id = ?').get(record.id)
      insertedImages.push(img)
    })
    res.status(201).json({ success: true, data: insertedImages })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to upload images' })
  }
})

router.get('/:id/images', (req: Request, res: Response): void => {
  try {
    const images = db.prepare('SELECT * FROM images WHERE dataset_id = ? ORDER BY uploaded_at DESC').all(req.params.id)
    res.json({ success: true, data: images })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch images' })
  }
})

router.post('/:id/classes', (req: Request, res: Response): void => {
  try {
    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id)
    if (!dataset) {
      res.status(404).json({ success: false, error: 'Dataset not found' })
      return
    }
    const { name, color } = req.body
    if (!name) {
      res.status(400).json({ success: false, error: 'Class name is required' })
      return
    }
    const result = db.prepare('INSERT INTO classes (dataset_id, name, color) VALUES (?, ?, ?)').run(
      req.params.id, name, color || '#000000'
    )
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ success: true, data: cls })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create class' })
  }
})

router.get('/:id/classes', (req: Request, res: Response): void => {
  try {
    const classes = db.prepare('SELECT * FROM classes WHERE dataset_id = ? ORDER BY id ASC').all(req.params.id)
    res.json({ success: true, data: classes })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch classes' })
  }
})

router.post('/:datasetId/export-yolo', (req: Request, res: Response): void => {
  try {
    const { datasetId } = req.params
    const { imageId, yoloContent } = req.body

    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId)
    if (!dataset) {
      res.status(404).json({ success: false, error: 'Dataset not found' })
      return
    }

    const image = db.prepare('SELECT * FROM images WHERE id = ?').get(imageId) as any
    if (!image) {
      res.status(404).json({ success: false, error: 'Image not found' })
      return
    }

    const dsImagesDir = path.join(datasetDir, datasetId, 'images')
    if (!fs.existsSync(dsImagesDir)) {
      fs.mkdirSync(dsImagesDir, { recursive: true })
    }
    const dsImageCopy = path.join(dsImagesDir, image.filename)
    const imagePath = path.resolve(image.path)
    if (fs.existsSync(imagePath) && imagePath !== dsImageCopy && !fs.existsSync(dsImageCopy)) {
      fs.copyFileSync(imagePath, dsImageCopy)
    }

    const yoloDir = path.join(datasetDir, datasetId, 'labels')
    if (!fs.existsSync(yoloDir)) {
      fs.mkdirSync(yoloDir, { recursive: true })
    }

    const imageName = path.parse(image.filename).name
    const yoloFilePath = path.join(yoloDir, `${imageName}.txt`)
    fs.writeFileSync(yoloFilePath, yoloContent)

    res.json({
      success: true,
      message: 'YOLO format exported',
      path: yoloFilePath,
    })
  } catch (error) {
    console.error('Export YOLO error:', error)
    res.status(500).json({ success: false, error: 'Failed to export YOLO format' })
  }
})

router.post('/:datasetId/slice', async (req: Request, res: Response): Promise<void> => {
  try {
    const { datasetId } = req.params
    const { sliceHeight = 640, sliceWidth = 640, overlapRatio = 0.2 } = req.body

    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId) as any
    if (!dataset) {
      res.status(404).json({ success: false, error: 'Dataset not found' })
      return
    }

    const sourceDir = path.join(datasetDir, datasetId)
    const slicedDatasetId = uuidv4()
    const outputDir = path.join(datasetDir, slicedDatasetId)

    console.log(`Slicing dataset: ${datasetId} -> ${slicedDatasetId}`)
    console.log(`Parameters: ${sliceWidth}x${sliceHeight}, overlap: ${overlapRatio}`)

    const pythonScript = path.join(process.cwd(), 'python', 'sahi_slice.py')
    const pythonCmd = process.env.PYTHON_PATH || 'python'

    console.log('PYTHON_PATH env:', process.env.PYTHON_PATH || 'not set')
    console.log('Using Python:', pythonCmd)

    const command = `"${pythonCmd}" "${pythonScript}" "${sourceDir}" "${outputDir}" ${sliceHeight} ${sliceWidth} ${overlapRatio}`

    console.log('Executing:', command)

    const { stdout, stderr } = await execAsync(command)

    if (stderr) {
      console.error('Python script stderr:', stderr)
    }

    console.log('Python script output:', stdout)

    const result = JSON.parse(stdout)

    if (result.success) {
      const newDatasetName = `${dataset.name} (Sliced ${sliceWidth}x${sliceHeight})`
      db.prepare('INSERT INTO datasets (id, name, image_count, annotated_count) VALUES (?, ?, 0, 0)').run(
        slicedDatasetId, newDatasetName
      )

      db.prepare('INSERT INTO classes (dataset_id, name, color) SELECT ?, name, color FROM classes WHERE dataset_id = ?').run(
        slicedDatasetId, datasetId
      )

      res.json({
        success: true,
        message: 'Dataset sliced successfully',
        datasetId: slicedDatasetId,
        datasetName: newDatasetName,
        totalSlices: result.total_slices,
        originalImages: result.total_images,
      })
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Slicing failed',
      })
    }
  } catch (error: any) {
    console.error('Slice dataset error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to slice dataset',
      details: error.message,
    })
  }
})

router.post('/import-yolo-json', upload.array('images', 500), (req: Request, res: Response): void => {
  try {
    const { name, annotationsJson } = req.body
    if (!name) {
      res.status(400).json({ success: false, error: 'Dataset name is required' })
      return
    }
    if (!annotationsJson) {
      res.status(400).json({ success: false, error: 'Annotations JSON is required' })
      return
    }

    let parsed: any
    try {
      parsed = typeof annotationsJson === 'string' ? JSON.parse(annotationsJson) : annotationsJson
    } catch {
      res.status(400).json({ success: false, error: 'Invalid JSON format' })
      return
    }

    const files = req.files as Express.Multer.File[]
    if (!files || files.length === 0) {
      res.status(400).json({ success: false, error: 'No images uploaded' })
      return
    }

    const datasetId = uuidv4()
    db.prepare('INSERT INTO datasets (id, name) VALUES (?, ?)').run(datasetId, name)

    const dsImagesDir = path.join(datasetDir, datasetId, 'images')
    const dsLabelsDir = path.join(datasetDir, datasetId, 'labels')
    fs.mkdirSync(dsImagesDir, { recursive: true })
    fs.mkdirSync(dsLabelsDir, { recursive: true })

    if (parsed.classes && Array.isArray(parsed.classes)) {
      const insertClass = db.prepare('INSERT INTO classes (dataset_id, name, color) VALUES (?, ?, ?)')
      const classColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F']
      for (const cls of parsed.classes) {
        const colorIndex = typeof cls.id === 'number' ? cls.id % classColors.length : 0
        insertClass.run(datasetId, cls.name, classColors[colorIndex])
      }
    }

    const classMap = new Map<string, number>()
    if (parsed.classes && Array.isArray(parsed.classes)) {
      const dbClasses = db.prepare('SELECT * FROM classes WHERE dataset_id = ?').all(datasetId) as any[]
      parsed.classes.forEach((cls: any, idx: number) => {
        const dbClass = dbClasses[idx]
        if (dbClass) {
          classMap.set(String(cls.id), dbClass.id)
        }
      })
    }

    const fileMap = new Map<string, Express.Multer.File>()
    // stemMap: basename without extension -> file, for matching across different extensions (e.g. .jfif vs .png)
    const stemMap = new Map<string, Express.Multer.File>()

    console.log(`[Import] Received ${files.length} image files`)
    for (const file of files) {
      const baseName = file.originalname.replace(/\\/g, '/')
      fileMap.set(baseName, file)
      const parts = baseName.split('/')
      if (parts.length > 1) {
        fileMap.set(parts[parts.length - 1], file)
      }
      const stem = path.parse(parts[parts.length - 1]).name
      stemMap.set(stem, file)
    }
    // Log first 3 file names for debugging
    console.log('[Import] Sample file.originalname values:', files.slice(0, 3).map(f => f.originalname))
    console.log('[Import] JSON image entries count:', (parsed.images || []).length)

    const insertImage = db.prepare('INSERT INTO images (id, dataset_id, filename, path, width, height) VALUES (?, ?, ?, ?, ?, ?)')
    const insertAnnotation = db.prepare('INSERT INTO annotations (id, image_id, class_id, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)')

    const runImport = db.transaction(() => {
      let importedImages = 0
      let importedAnnotations = 0
      let matchedCount = 0
      const unmatchedSamples: string[] = []

      for (const imgEntry of parsed.images || []) {
        // Try matching by file_name (JFIF original) and source_png (PNG used for annotation)
        const fileName = (imgEntry.file_name || '').replace(/\\/g, '/')
        const pngName = (imgEntry.source_png || '').replace(/\\/g, '/')
        const fileNameOnly = fileName.split('/').pop() || ''
        const pngNameOnly = pngName.split('/').pop() || ''

        const matchedFile =
          fileMap.get(fileName) ||
          fileMap.get(fileNameOnly) ||
          stemMap.get(path.parse(fileNameOnly).name) ||
          fileMap.get(pngName) ||
          fileMap.get(pngNameOnly) ||
          stemMap.get(path.parse(pngNameOnly).name)

        if (!matchedFile) {
          if (unmatchedSamples.length < 3) {
            unmatchedSamples.push(`file_name="${fileNameOnly}" source_png="${pngNameOnly}"`)
          }
          continue
        }
        matchedCount++

        const imageId = uuidv4()
        let ext = path.extname(matchedFile.originalname).toLowerCase()
        if (ext === '.jfif') ext = '.jpg'
        const savedFilename = `${uuidv4()}${ext}`
        const dsImagePath = path.join(dsImagesDir, savedFilename)

        fs.copyFileSync(matchedFile.path, dsImagePath)
        if (fs.existsSync(matchedFile.path)) {
          fs.unlinkSync(matchedFile.path)
        }

        insertImage.run(
          imageId,
          datasetId,
          savedFilename,
          path.relative(process.cwd(), dsImagePath).replace(/\\/g, '/'),
          imgEntry.image_width || 0,
          imgEntry.image_height || 0,
        )
        importedImages++

        if (imgEntry.annotations && Array.isArray(imgEntry.annotations)) {
          for (const ann of imgEntry.annotations) {
            const annotationId = uuidv4()
            const dbClassId = classMap.get(String(ann.class_id))
            if (dbClassId === undefined) continue

            const bbox = ann.bbox_yolo || []
            insertAnnotation.run(
              annotationId,
              imageId,
              String(dbClassId),
              bbox[0] ?? ann.x ?? 0,
              bbox[1] ?? ann.y ?? 0,
              bbox[2] ?? ann.width ?? 0,
              bbox[3] ?? ann.height ?? 0,
            )
            importedAnnotations++
          }

          const yoloLines: string[] = []
          for (const ann of imgEntry.annotations) {
            const classId = ann.class_id
            const bbox = ann.bbox_yolo || []
            if (bbox.length === 4) {
              yoloLines.push(`${classId} ${bbox[0]} ${bbox[1]} ${bbox[2]} ${bbox[3]}`)
            }
          }
          if (yoloLines.length > 0) {
            const labelName = path.parse(savedFilename).name + '.txt'
            fs.writeFileSync(path.join(dsLabelsDir, labelName), yoloLines.join('\n'))
          }
        }
      }

      const totalEntries = (parsed.images || []).length
      console.log(`[Import] Matched ${matchedCount}/${totalEntries} JSON entries. importedImages=${importedImages} importedAnnotations=${importedAnnotations}`)
      if (unmatchedSamples.length > 0) {
        console.log('[Import] First unmatched entries:', unmatchedSamples)
      }

      return { importedImages, importedAnnotations }
    })

    const result = runImport()

    for (const file of files) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path)
      }
    }

    res.status(201).json({
      success: true,
      data: {
        datasetId,
        name,
        importedImages: result.importedImages,
        importedAnnotations: result.importedAnnotations,
        totalFiles: files.length,
        totalImageEntries: (parsed.images || []).length,
      },
    })
  } catch (error) {
    console.error('Import YOLO-JSON error:', error)
    res.status(500).json({ success: false, error: 'Failed to import dataset' })
  }
})

export default router

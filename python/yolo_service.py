#!/usr/bin/env python3
"""
YOLO Service - Python integration for YOLOv8 detection and training
Provides CLI interface for Node.js backend to call
"""

import sys
import json
import os
from pathlib import Path

try:
    from ultralytics import YOLO
    import cv2
    import numpy as np
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "Required packages not installed. Run: pip install ultralytics opencv-python numpy"
    }))
    sys.exit(1)


def get_device(mode="auto"):
    """
    Auto-detect and return device(s) for YOLO inference/training.

    Args:
        mode: Device selection mode.
            - "auto" (default): Pick the single GPU with most free memory, fallback to CPU.
            - "all": Return list of all GPU indices for multi-GPU training, e.g. [0, 1].
            - "cuda:0" / "0" / "cuda:1": Use a specific GPU.
            - "cpu": Force CPU.

    Returns:
        str or list: "cuda:0", "cpu", or [0, 1, 2] for multi-GPU training.
    """
    try:
        import torch
    except ImportError:
        return "cpu" if mode != "all" else []

    if not torch.cuda.is_available():
        return "cpu" if mode != "all" else []

    gpu_count = torch.cuda.device_count()

    if mode == "all":
        return list(range(gpu_count))

    if mode == "auto":
        # Pick GPU with most free memory
        if gpu_count == 1:
            return "cuda:0"
        best_idx = 0
        best_mem = 0
        for i in range(gpu_count):
            free_mem = torch.cuda.mem_get_info(i)[0]
            if free_mem > best_mem:
                best_mem = free_mem
                best_idx = i
        return f"cuda:{best_idx}"

    # Specific: "cuda:1" → "cuda:1", "0" → "cuda:0"
    if mode.startswith("cuda:"):
        return mode
    try:
        idx = int(mode)
        if 0 <= idx < gpu_count:
            return f"cuda:{idx}"
    except (ValueError, TypeError):
        pass

    return "cpu"


def detect(image_path, model_path, conf_threshold=0.25, iou_threshold=0.45, image_size=640, auto_slice=True, device="auto"):
    """
    Detect objects in an image using YOLO model.
    If auto_slice is True and the image is larger than image_size*1.5,
    automatically use SAHI sliced inference for better small object detection.
    """
    try:
        from PIL import Image as PILImage
        pil_img = PILImage.open(image_path)
        img_w, img_h = pil_img.size
        need_slicing = auto_slice and (img_w > image_size * 1.5 or img_h > image_size * 1.5)
    except Exception:
        need_slicing = False

    try:
        resolved_device = get_device(device)
        model = YOLO(model_path, device=resolved_device)

        if need_slicing:
            try:
                from sahi import AutoDetectionModel
                from sahi.predict import get_sliced_prediction

                detection_model = AutoDetectionModel.from_pretrained(
                    model_type="ultralytics",
                    model_path=model_path,
                    confidence_threshold=conf_threshold,
                    device=resolved_device,
                )

                slice_h = min(image_size, img_h)
                slice_w = min(image_size, img_w)

                sahi_result = get_sliced_prediction(
                    image_path,
                    detection_model,
                    slice_height=slice_h,
                    slice_width=slice_w,
                    overlap_height_ratio=0.2,
                    overlap_width_ratio=0.2,
                    postprocess_type="NMS",
                    postprocess_match_metric="IOU",
                    postprocess_match_threshold=iou_threshold,
                )

                detections = []
                for pred in sahi_result.object_prediction_list:
                    bbox = pred.bbox
                    detections.append({
                        "class_id": pred.category.id,
                        "class_name": pred.category.name,
                        "confidence": round(float(pred.score.value), 4),
                        "bbox": [round(bbox.minx, 2), round(bbox.miny, 2), round(bbox.maxx, 2), round(bbox.maxy, 2)]
                    })

                annotated_img = cv2.imread(image_path)
                for det in detections:
                    x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
                    cv2.rectangle(annotated_img, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    label = f"{det['class_name']} {det['confidence']:.2f}"
                    cv2.putText(annotated_img, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

                result_path = image_path.replace('.jpg', '_result.jpg').replace('.png', '_result.jpg')
                cv2.imwrite(result_path, annotated_img)

                print(json.dumps({
                    "success": True,
                    "detections": detections,
                    "result_image": result_path,
                    "sliced_inference": True,
                    "device": resolved_device,
                    "inference_time": 0
                }), flush=True)
                return

            except ImportError:
                pass
            except Exception:
                pass

        results = model(
            image_path,
            conf=conf_threshold,
            iou=iou_threshold,
            imgsz=image_size,
            verbose=False
        )
        
        result = results[0]
        detections = []
        
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            class_id = int(box.cls[0])
            class_name = result.names[class_id]
            
            detections.append({
                "class_id": class_id,
                "class_name": class_name,
                "confidence": round(conf, 4),
                "bbox": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)]
            })
        
        annotated_img = result.plot()
        result_path = image_path.replace('.jpg', '_result.jpg').replace('.png', '_result.jpg')
        cv2.imwrite(result_path, annotated_img)
        
        print(json.dumps({
            "success": True,
            "detections": detections,
            "result_image": result_path,
            "sliced_inference": False,
            "device": resolved_device,
            "inference_time": round(result.speed['inference'], 2)
        }), flush=True)
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }), flush=True)
        sys.exit(1)


def train(dataset_path, model_type='yolov8n.pt', epochs=100, batch_size=16, 
          learning_rate=0.01, image_size=640, project='runs/train', name='exp', device="all"):
    """
    Train YOLO model on dataset. Uses all available GPUs by default.
    """
    try:
        resolved_device = get_device(device)
        model = YOLO(model_type, device=resolved_device)
        
        results = model.train(
            data=dataset_path,
            epochs=epochs,
            batch=batch_size,
            lr0=learning_rate,
            imgsz=image_size,
            project=project,
            name=name,
            verbose=True,
            save=True,
            save_period=1,
            plots=True,
            device=resolved_device,
        )
        
        best_model_path = os.path.join(project, name, 'weights', 'best.pt')
        
        print(json.dumps({
            "success": True,
            "model_path": best_model_path,
            "metrics": {
                "mAP50": round(results.metrics.get('metrics/mAP50(B)', 0), 4),
                "mAP50_95": round(results.metrics.get('metrics/mAP50-95(B)', 0), 4)
            }
        }))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)


def augment(input_dir, output_dir, strategies, multiplier=5):
    """
    Augment dataset using various strategies
    """
    try:
        import albumentations as A
        from albumentations.pytorch import ToTensorV2
        
        os.makedirs(output_dir, exist_ok=True)
        
        transforms = []
        
        for strategy in strategies:
            stype = strategy['type']
            params = strategy.get('params', {})
            
            if stype == 'rotation':
                angle = params.get('angle', 30)
                transforms.append(A.Rotate(limit=angle, p=0.5))
            elif stype == 'flip':
                transforms.append(A.HorizontalFlip(p=0.5))
                transforms.append(A.VerticalFlip(p=0.3))
            elif stype == 'crop':
                scale = params.get('scale', (0.8, 1.0))
                transforms.append(A.RandomResizedCrop(size=(640, 640), scale=scale, p=0.3))
            elif stype == 'color':
                transforms.append(A.ColorJitter(
                    brightness=params.get('brightness', 0.2),
                    contrast=params.get('contrast', 0.2),
                    saturation=params.get('saturation', 0.2),
                    hue=params.get('hue', 0.1),
                    p=0.5
                ))
            elif stype == 'blur':
                transforms.append(A.GaussianBlur(blur_limit=(3, 7), p=0.3))
            elif stype == 'noise':
                transforms.append(A.GaussNoise(var_limit=(10.0, 50.0), p=0.3))
        
        transform = A.Compose(transforms)
        
        image_files = [f for f in os.listdir(input_dir) 
                      if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
        
        generated_count = 0
        
        for img_file in image_files:
            img_path = os.path.join(input_dir, img_file)
            image = cv2.imread(img_path)
            image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            for i in range(multiplier):
                augmented = transform(image=image)
                augmented_img = augmented['image']
                
                output_path = os.path.join(output_dir, 
                    f"{Path(img_file).stem}_aug{i+1}{Path(img_file).suffix}")
                
                cv2.imwrite(output_path, cv2.cvtColor(augmented_img, cv2.COLOR_RGB2BGR))
                generated_count += 1
        
        print(json.dumps({
            "success": True,
            "generated_count": generated_count,
            "output_dir": output_dir
        }))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Usage: yolo_service.py <command> [args]"}))
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == 'detect':
        args = json.loads(sys.argv[2])
        detect(
            args['image_path'],
            args['model_path'],
            args.get('conf_threshold', 0.25),
            args.get('iou_threshold', 0.45),
            args.get('image_size', 640),
            args.get('auto_slice', True),
            args.get('device', 'auto'),
        )
    elif command == 'train':
        args = json.loads(sys.argv[2])
        train(
            args['dataset_path'],
            args.get('model_type', 'yolov8n.pt'),
            args.get('epochs', 100),
            args.get('batch_size', 16),
            args.get('learning_rate', 0.01),
            args.get('image_size', 640),
            args.get('project', 'runs/train'),
            args.get('name', 'exp'),
            args.get('device', 'all'),
        )
    elif command == 'augment':
        args = json.loads(sys.argv[2])
        augment(
            args['input_dir'],
            args['output_dir'],
            args['strategies'],
            args.get('multiplier', 5)
        )
    else:
        print(json.dumps({"success": False, "error": f"Unknown command: {command}"}))
        sys.exit(1)

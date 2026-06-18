#!/usr/bin/env python3
"""
Data Augmentation Script - Real-time progress output via stdout
Designed to be spawned by Node.js backend.

Usage: python augment.py <config_json>

Config JSON fields:
  - input_dir: str          Input images directory
  - input_labels_dir: str   Input labels directory (YOLO format .txt files)
  - output_dir: str         Output directory for augmented images
  - output_labels_dir: str  Output directory for augmented labels
  - strategies: list        List of strategy objects with type and params
  - multiplier: int         Number of augmented copies per image
  - task_id: str            Task ID for reference

Output format (one JSON per line, flushed immediately):
  {"type":"progress","current":10,"total":100,"percent":10}
  {"type":"complete","generated_count":500}
  {"type":"error","message":"error description"}
"""

import sys
import json
import os
import signal
import shutil
from pathlib import Path

import cv2
import numpy as np

try:
    import albumentations as A
except ImportError:
    print(json.dumps({"type": "error", "message": "albumentations not installed. Run: pip install albumentations"}), flush=True)
    sys.exit(1)


def output_json(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def build_transform(strategies):
    transforms = []
    for s in strategies:
        stype = s.get("type", "")
        params = s.get("params", {})

        if stype == "rotation":
            angle = params.get("角度", params.get("angle", 15))
            transforms.append(A.Rotate(limit=int(angle), p=0.5, border_mode=cv2.BORDER_REFLECT_101))
        elif stype == "flip":
            h = params.get("水平", params.get("horizontal", 1))
            v = params.get("垂直", params.get("vertical", 0))
            if h:
                transforms.append(A.HorizontalFlip(p=0.5))
            if v:
                transforms.append(A.VerticalFlip(p=0.5))
        elif stype == "crop":
            min_scale = params.get("最小比例", params.get("min_scale", 0.7))
            transforms.append(A.RandomResizedCrop(size=(640, 640), scale=(min_scale, 1.0), p=0.5))
        elif stype == "color":
            brightness = params.get("亮度", params.get("brightness", 0.2))
            contrast = params.get("对比度", params.get("contrast", 0.2))
            transforms.append(A.ColorJitter(brightness=brightness, contrast=contrast, saturation=0.2, hue=0.1, p=0.5))
        elif stype == "blur":
            sigma = params.get("西格玛", params.get("sigma", 1.5))
            transforms.append(A.GaussianBlur(blur_limit=(3, int(sigma * 4 + 1)), p=0.4))
        elif stype == "noise":
            intensity = params.get("强度", params.get("intensity", 0.02))
            var_limit = (intensity * 500, intensity * 2500)
            transforms.append(A.GaussNoise(var_limit=var_limit, p=0.4))

    if not transforms:
        transforms.append(A.HorizontalFlip(p=0.5))
        transforms.append(A.Rotate(limit=15, p=0.3))

    bbox_params = A.BboxParams(format="yolo", label_fields=["class_labels"])
    return A.Compose(transforms, bbox_params=bbox_params)


def read_yolo_labels(label_path):
    bboxes = []
    class_labels = []
    if not os.path.exists(label_path):
        return bboxes, class_labels
    with open(label_path, "r") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 5:
                try:
                    class_labels.append(int(float(parts[0])))
                    bboxes.append([float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])])
                except (ValueError, TypeError):
                    continue
    return bboxes, class_labels


def write_yolo_labels(label_path, bboxes, class_labels):
    with open(label_path, "w") as f:
        for cls, bbox in zip(class_labels, bboxes):
            f.write(f"{cls} {bbox[0]:.6f} {bbox[1]:.6f} {bbox[2]:.6f} {bbox[3]:.6f}\n")


def augment(config):
    input_dir = config["input_dir"]
    input_labels_dir = config.get("input_labels_dir", "")
    output_dir = config["output_dir"]
    output_labels_dir = config.get("output_labels_dir", "")
    strategies = config.get("strategies", [])
    multiplier = config.get("multiplier", 5)
    task_id = config.get("task_id", "unknown")

    if not os.path.isdir(input_dir):
        output_json({"type": "error", "message": f"Input directory not found: {input_dir}"})
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    if output_labels_dir:
        os.makedirs(output_labels_dir, exist_ok=True)

    transform = build_transform(strategies)

    image_files = [f for f in os.listdir(input_dir)
                   if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".webp"))]

    if not image_files:
        output_json({"type": "error", "message": "No images found in input directory"})
        sys.exit(1)

    total = len(image_files) * multiplier
    current = 0
    generated_count = 0

    output_json({"type": "info", "message": f"Starting augmentation: {len(image_files)} images x {multiplier} = {total} output"})

    for img_file in image_files:
        img_path = os.path.join(input_dir, img_file)
        image = cv2.imread(img_path)
        if image is None:
            current += multiplier
            continue

        h, w = image.shape[:2]
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        stem = Path(img_file).stem
        ext = Path(img_file).suffix

        label_path = os.path.join(input_labels_dir, f"{stem}.txt") if input_labels_dir else ""
        bboxes, class_labels = read_yolo_labels(label_path)

        for i in range(multiplier):
            try:
                if bboxes:
                    transformed = transform(image=image_rgb, bboxes=bboxes, class_labels=class_labels)
                    aug_img = transformed["image"]
                    aug_bboxes = transformed["bboxes"]
                    aug_labels = transformed["class_labels"]
                else:
                    transformed = transform(image=image_rgb)
                    aug_img = transformed["image"]
                    aug_bboxes = []
                    aug_labels = []

                out_name = f"{stem}_aug{i + 1}{ext}"
                out_path = os.path.join(output_dir, out_name)
                cv2.imwrite(out_path, cv2.cvtColor(aug_img, cv2.COLOR_RGB2BGR))

                if output_labels_dir:
                    out_label_path = os.path.join(output_labels_dir, f"{stem}_aug{i + 1}.txt")
                    write_yolo_labels(out_label_path, aug_bboxes, aug_labels)

                generated_count += 1
            except Exception as e:
                pass

            current += 1
            percent = int((current / total) * 100)
            if current % max(1, total // 20) == 0 or current == total:
                output_json({"type": "progress", "current": current, "total": total, "percent": percent})

    output_json({"type": "complete", "generated_count": generated_count})


def handle_signal(signum, frame):
    output_json({"type": "info", "message": f"Received signal {signum}, exiting..."})
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    if len(sys.argv) < 2:
        output_json({"type": "error", "message": "Usage: augment.py <config_json>"})
        sys.exit(1)

    try:
        config = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        output_json({"type": "error", "message": f"Invalid JSON config: {e}"})
        sys.exit(1)

    augment(config)

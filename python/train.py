#!/usr/bin/env python3
"""
YOLO Training Script - Real-time epoch metrics output via stdout
Designed to be spawned by Node.js backend, outputs one JSON line per epoch.

Usage: python train.py <config_json>

Config JSON fields:
  - dataset_dir: str        Path to dataset directory (contains images/ and labels/)
  - model_path: str         Model path or pretrained name (e.g. yolov8n.pt)
  - epochs: int             Number of training epochs
  - batch_size: int         Batch size
  - learning_rate: float    Initial learning rate
  - image_size: int         Image size (default 640)
  - project_dir: str        Output project directory
  - task_id: str            Training task ID (for reference)
  - classes: list[str]      Class names for data.yaml

Output format (one JSON per line, flushed immediately):
  {"type":"epoch","epoch":1,"train_box_loss":0.5,"val_box_loss":0.6,"mAP50":0.3,"mAP50_95":0.15,"lr":0.01}
  {"type":"complete","best_model":"path/to/best.pt","mAP50":0.85,"mAP50_95":0.6}
  {"type":"error","message":"error description"}
"""

import sys
import json
import os
import signal
import yaml
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_current_process = None


def output_json(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def write_data_yaml(dataset_dir, classes, yaml_path, train_dir=None, val_dir=None):
    if train_dir and val_dir:
        data = {
            "path": os.path.abspath(dataset_dir),
            "train": os.path.abspath(train_dir),
            "val": os.path.abspath(val_dir),
            "names": {i: name for i, name in enumerate(classes)},
        }
    else:
        images_dir = os.path.join(dataset_dir, "images")
        if not os.path.isdir(images_dir):
            images_dir = dataset_dir
        data = {
            "path": os.path.abspath(dataset_dir),
            "train": "images",
            "val": "images",
            "names": {i: name for i, name in enumerate(classes)},
        }

    with open(yaml_path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False)

    return yaml_path


def on_train_epoch_end(trainer):
    metrics = trainer.metrics
    epoch = trainer.epoch + 1

    train_box_loss = float(metrics.get("train/box_loss", 0))
    train_cls_loss = float(metrics.get("train/cls_loss", 0))
    train_dfl_loss = float(metrics.get("train/dfl_loss", 0))
    train_loss = train_box_loss + train_cls_loss + train_dfl_loss

    val_box_loss = float(metrics.get("val/box_loss", 0))
    val_cls_loss = float(metrics.get("val/cls_loss", 0))
    val_dfl_loss = float(metrics.get("val/dfl_loss", 0))
    val_loss = val_box_loss + val_cls_loss + val_dfl_loss

    mAP50 = float(metrics.get("metrics/mAP50(B)", 0))
    mAP50_95 = float(metrics.get("metrics/mAP50-95(B)", 0))
    lr = float(metrics.get("lr/pg0", 0))

    output_json({
        "type": "epoch",
        "epoch": epoch,
        "train_loss": round(train_loss, 6),
        "val_loss": round(val_loss, 6),
        "mAP50": round(mAP50, 6),
        "mAP50_95": round(mAP50_95, 6),
        "lr": round(lr, 8),
    })


def on_train_end(trainer):
    metrics = trainer.metrics
    mAP50 = float(metrics.get("metrics/mAP50(B)", 0))
    mAP50_95 = float(metrics.get("metrics/mAP50-95(B)", 0))

    best_path = str(trainer.best) if hasattr(trainer, "best") and trainer.best else ""
    if not best_path or not os.path.exists(best_path):
        save_dir = str(trainer.save_dir) if hasattr(trainer, "save_dir") else ""
        candidate = os.path.join(save_dir, "weights", "best.pt")
        if os.path.exists(candidate):
            best_path = candidate
        else:
            candidate = os.path.join(save_dir, "weights", "last.pt")
            if os.path.exists(candidate):
                best_path = candidate

    output_json({
        "type": "complete",
        "best_model": best_path,
        "mAP50": round(mAP50, 6),
        "mAP50_95": round(mAP50_95, 6),
    })


def handle_signal(signum, frame):
    output_json({"type": "info", "message": f"Received signal {signum}, exiting..."})
    sys.exit(0)


def train(config):
    dataset_dir = config["dataset_dir"]
    model_path = config["model_path"]
    epochs = config.get("epochs", 100)
    batch_size = config.get("batch_size", 16)
    learning_rate = config.get("learning_rate", 0.01)
    image_size = config.get("image_size", 640)
    project_dir = config.get("project_dir", "runs/train")
    task_id = config.get("task_id", "unknown")
    classes = config.get("classes", [])
    train_dir = config.get("train_dir", None)
    val_dir = config.get("val_dir", None)
    auto_slice = config.get("auto_slice", True)
    overlap_ratio = config.get("overlap_ratio", 0.2)
    device = config.get("device", "all")  # "auto", "all", "cuda:0", "0", "cpu"

    if auto_slice and not train_dir:
        output_json({"type": "info", "message": f"Auto-slice enabled, checking image sizes against {image_size}px..."})
        try:
            from sahi_slice import auto_slice_dataset
            slice_output_dir = os.path.join(os.path.dirname(dataset_dir), f"{os.path.basename(dataset_dir)}_sliced")
            slice_result = auto_slice_dataset(dataset_dir, slice_output_dir, image_size=image_size, overlap_ratio=overlap_ratio)
            if slice_result.get("success"):
                if slice_result.get("sliced"):
                    output_json({"type": "info", "message": f"Auto-slice: {slice_result.get('large_images', 0)} large images -> {slice_result.get('total_slices', 0)} slices"})
                    dataset_dir = slice_output_dir
                else:
                    output_json({"type": "info", "message": slice_result.get("message", "No slicing needed")})
            else:
                output_json({"type": "info", "message": f"Auto-slice skipped: {slice_result.get('error', 'unknown error')}"})
        except Exception as e:
            output_json({"type": "info", "message": f"Auto-slice skipped (error): {e}"})

    if train_dir and val_dir:
        train_images = os.path.join(train_dir, "images")
        val_images = os.path.join(val_dir, "images")
        if not os.path.isdir(train_images):
            output_json({"type": "error", "message": f"train images directory not found: {train_images}"})
            sys.exit(1)
        if not os.path.isdir(val_images):
            output_json({"type": "error", "message": f"val images directory not found: {val_images}"})
            sys.exit(1)
    else:
        images_dir = os.path.join(dataset_dir, "images")
        if not os.path.isdir(images_dir):
            output_json({"type": "error", "message": f"images directory not found: {images_dir}"})
            sys.exit(1)

        labels_dir = os.path.join(dataset_dir, "labels")
        if not os.path.isdir(labels_dir):
            output_json({"type": "error", "message": f"labels directory not found: {labels_dir}"})
            sys.exit(1)

        label_files = [f for f in os.listdir(labels_dir) if f.endswith(".txt")]
        if not label_files:
            output_json({"type": "error", "message": "No label files found in labels directory"})
            sys.exit(1)

    if not classes:
        all_ids = set()
        for lf in label_files:
            with open(os.path.join(labels_dir, lf), "r") as f:
                for line in f:
                    parts = line.strip().split()
                    if parts:
                        all_ids.add(int(parts[0]))
        if all_ids:
            classes = [f"class_{i}" for i in range(max(all_ids) + 1)]
        else:
            classes = ["object"]

    yaml_path = os.path.join(dataset_dir, "data.yaml")
    write_data_yaml(dataset_dir, classes, yaml_path, train_dir=train_dir, val_dir=val_dir)

    output_json({"type": "info", "message": f"Starting training: {epochs} epochs, batch={batch_size}, lr={learning_rate}"})
    output_json({"type": "info", "message": f"Dataset: {dataset_dir}, Classes: {classes}"})
    output_json({"type": "info", "message": f"Model: {model_path}"})
    output_json({"type": "info", "message": f"Device: {device}"})

    try:
        from ultralytics import YOLO
    except ImportError:
        output_json({"type": "error", "message": "ultralytics not installed. Run: pip install ultralytics"})
        sys.exit(1)

    if not os.path.isfile(model_path) and not os.path.isabs(model_path):
        output_json({"type": "info", "message": f"Model path '{model_path}' is not a local file, treating as pretrained model name"})

    # Resolve device using the same logic as yolo_service
    from yolo_service import get_device
    resolved_device = get_device(device)
    output_json({"type": "info", "message": f"Resolved device: {resolved_device}"})

    model = YOLO(model_path, device=resolved_device)

    exp_name = f"task_{task_id[:8]}" if task_id else "exp"
    os.makedirs(project_dir, exist_ok=True)

    model.add_callback("on_train_epoch_end", on_train_epoch_end)
    model.add_callback("on_train_end", on_train_end)

    try:
        model.train(
            data=yaml_path,
            epochs=epochs,
            batch=batch_size,
            lr0=learning_rate,
            imgsz=image_size,
            project=project_dir,
            name=exp_name,
            verbose=False,
            save=True,
            save_period=1,
            plots=True,
            exist_ok=True,
            device=resolved_device,
        )
    except Exception as e:
        output_json({"type": "error", "message": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    if len(sys.argv) < 2:
        output_json({"type": "error", "message": "Usage: train.py <config_json>"})
        sys.exit(1)

    try:
        config = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        output_json({"type": "error", "message": f"Invalid JSON config: {e}"})
        sys.exit(1)

    train(config)

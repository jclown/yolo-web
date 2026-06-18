import sys
import json
import os
from pathlib import Path
import shutil


def slice_yolo_annotation(label_path, img_w, img_h, start_x, start_y, slice_w, slice_h):
    new_lines = []
    if not os.path.exists(label_path):
        return new_lines

    with open(label_path, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 5:
                continue
            class_id = parts[0]
            cx = float(parts[1]) * img_w
            cy = float(parts[2]) * img_h
            bw = float(parts[3]) * img_w
            bh = float(parts[4]) * img_h

            x_min = cx - bw / 2
            y_min = cy - bh / 2
            x_max = cx + bw / 2
            y_max = cy + bh / 2

            inter_x_min = max(x_min, start_x)
            inter_y_min = max(y_min, start_y)
            inter_x_max = min(x_max, start_x + slice_w)
            inter_y_max = min(y_max, start_y + slice_h)

            if inter_x_max <= inter_x_min or inter_y_max <= inter_y_min:
                continue

            inter_w = inter_x_max - inter_x_min
            inter_h = inter_y_max - inter_y_min
            inter_area = inter_w * inter_h
            orig_area = bw * bh

            if orig_area > 0 and inter_area / orig_area < 0.1:
                continue

            new_cx = (inter_x_min + inter_x_max) / 2 - start_x
            new_cy = (inter_y_min + inter_y_max) / 2 - start_y
            new_bw = inter_w
            new_bh = inter_h

            new_cx /= slice_w
            new_cy /= slice_h
            new_bw /= slice_w
            new_bh /= slice_h

            new_cx = max(0, min(1, new_cx))
            new_cy = max(0, min(1, new_cy))
            new_bw = max(0, min(1, new_bw))
            new_bh = max(0, min(1, new_bh))

            new_lines.append(f"{class_id} {new_cx:.6f} {new_cy:.6f} {new_bw:.6f} {new_bh:.6f}\n")

    return new_lines


def auto_slice_dataset(source_dir, output_dir, image_size=640, overlap_ratio=0.2):
    source_dir = Path(source_dir)
    output_dir = Path(output_dir)

    output_images_dir = output_dir / "images"
    output_labels_dir = output_dir / "labels"
    output_images_dir.mkdir(parents=True, exist_ok=True)
    output_labels_dir.mkdir(parents=True, exist_ok=True)

    images_dir = source_dir / "images"
    labels_dir = source_dir / "labels"

    if images_dir.exists() and images_dir.is_dir():
        image_files = list(images_dir.glob("*.jpg")) + list(images_dir.glob("*.png")) + \
                      list(images_dir.glob("*.jpeg")) + list(images_dir.glob("*.jfif"))
    else:
        image_files = list(source_dir.glob("*.jpg")) + list(source_dir.glob("*.png")) + \
                      list(source_dir.glob("*.jpeg")) + list(source_dir.glob("*.jfif"))
        labels_dir = source_dir

    if not image_files:
        return {
            "success": False,
            "error": f"No images found in: {source_dir}"
        }

    slice_height = image_size
    slice_width = image_size

    need_slicing = False
    large_count = 0
    small_count = 0

    for img_path in image_files:
        try:
            from PIL import Image as PILImage
            pil_img = PILImage.open(str(img_path))
            img_w, img_h = pil_img.size
        except Exception:
            img_w, img_h = 1920, 1080

        if img_w > image_size * 1.5 or img_h > image_size * 1.5:
            need_slicing = True
            large_count += 1
        else:
            small_count += 1

    if not need_slicing:
        return {
            "success": True,
            "sliced": False,
            "message": f"All {len(image_files)} images are within {image_size}px, no slicing needed",
            "total_images": len(image_files),
            "total_slices": 0,
            "output_dir": str(source_dir),
        }

    total_slices = 0
    total_images = len(image_files)

    print(f"Auto-slice: {large_count} large images need slicing, {small_count} small images will be copied directly")

    for img_path in image_files:
        label_path = labels_dir / f"{img_path.stem}.txt"

        try:
            from PIL import Image as PILImage
            pil_img = PILImage.open(str(img_path))
            img_w, img_h = pil_img.size
        except Exception:
            img_w, img_h = 1920, 1080

        if img_w <= image_size * 1.5 and img_h <= image_size * 1.5:
            import shutil as sh
            dest_img = output_images_dir / img_path.name
            sh.copy2(str(img_path), str(dest_img))
            if label_path.exists():
                dest_label = output_labels_dir / label_path.name
                sh.copy2(str(label_path), str(dest_label))
            total_slices += 1
            continue

        stride_x = int(slice_width * (1 - overlap_ratio))
        stride_y = int(slice_height * (1 - overlap_ratio))
        if stride_x <= 0:
            stride_x = slice_width
        if stride_y <= 0:
            stride_y = slice_height

        slice_idx = 0
        y = 0
        while y < img_h:
            x = 0
            while x < img_w:
                actual_slice_w = min(slice_width, img_w - x)
                actual_slice_h = min(slice_height, img_h - y)

                if actual_slice_w < slice_width * 0.3 and x > 0:
                    x += stride_x
                    continue
                if actual_slice_h < slice_height * 0.3 and y > 0:
                    break

                try:
                    from PIL import Image as PILImg
                    full_img = PILImg.open(str(img_path))
                    crop_box = (x, y, min(x + slice_width, img_w), min(y + slice_height, img_h))
                    crop = full_img.crop(crop_box)

                    final_name = f"{img_path.stem}_{slice_idx}.jpg"
                    final_path = output_images_dir / final_name
                    crop.save(str(final_path), quality=95)
                except Exception as e:
                    print(f"Warning: crop failed for {img_path.name} at ({x},{y}): {e}")
                    x += stride_x
                    slice_idx += 1
                    continue

                new_lines = slice_yolo_annotation(
                    str(label_path), img_w, img_h,
                    x, y, slice_width, slice_height
                )

                label_name = f"{img_path.stem}_{slice_idx}.txt"
                label_out = output_labels_dir / label_name
                with open(str(label_out), "w", encoding="utf-8") as lf:
                    lf.writelines(new_lines)

                total_slices += 1
                x += stride_x
                slice_idx += 1
            y += stride_y

    result = {
        "success": True,
        "sliced": True,
        "total_images": total_images,
        "large_images": large_count,
        "total_slices": total_slices,
        "output_dir": str(output_dir),
        "slice_size": f"{slice_width}x{slice_height}",
        "overlap_ratio": overlap_ratio
    }

    print(f"Auto-slice complete! {large_count} large images -> {total_slices} slices")
    return result


def slice_dataset(source_dir, output_dir, slice_height=640, slice_width=640, overlap_ratio=0.2):
    return auto_slice_dataset(source_dir, output_dir, image_size=slice_height, overlap_ratio=overlap_ratio)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python sahi_slice.py <source_dir> <output_dir> [slice_height] [slice_width] [overlap_ratio]")
        sys.exit(1)

    source_dir = sys.argv[1]
    output_dir = sys.argv[2]
    slice_height = int(sys.argv[3]) if len(sys.argv) > 3 else 640
    slice_width = int(sys.argv[4]) if len(sys.argv) > 4 else 640
    overlap_ratio = float(sys.argv[5]) if len(sys.argv) > 5 else 0.2

    result = auto_slice_dataset(source_dir, output_dir, image_size=slice_height, overlap_ratio=overlap_ratio)
    print(json.dumps(result, indent=2))

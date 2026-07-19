import os
import json
import time
import numpy as np
from PIL import Image
import torch
import umap
from tqdm import tqdm
from transformers import AutoModel, AutoProcessor
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
COLLECTION_NAME = "emoji_siglip2"
MODEL_NAME = "google/siglip2-base-patch16-224"

# Path resolve helper
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMOJI_JSON_PATH = os.getenv("EMOJI_JSON_PATH", os.path.join(BASE_DIR, "emoji.json"))
EMOJI_IMG_DIR = os.getenv("EMOJI_IMG_DIR", os.path.join(BASE_DIR, "img-apple-160"))

def get_qdrant_client():
    max_retries = 10
    for i in range(max_retries):
        try:
            client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
            client.get_collections()
            print(f"[Indexer] Successfully connected to Qdrant at {QDRANT_HOST}:{QDRANT_PORT}")
            return client
        except Exception as e:
            print(f"[Indexer] Qdrant not ready yet ({e}), retrying {i+1}/{max_retries}...")
            time.sleep(3)
    raise RuntimeError("Could not connect to Qdrant server.")

def run_indexing(force_reindex=False):
    client = get_qdrant_client()

    # Check existing collection
    try:
        if client.collection_exists(COLLECTION_NAME) and not force_reindex:
            info = client.get_collection(COLLECTION_NAME)
            if info.points_count and info.points_count > 0:
                print(f"[Indexer] Collection '{COLLECTION_NAME}' already exists with {info.points_count} points. Skipping indexing.")
                return
    except Exception as e:
        print(f"[Indexer] Collection check info: {e}")

    print(f"[Indexer] Starting indexing process using model '{MODEL_NAME}'...")

    # Load emoji data
    if not os.path.exists(EMOJI_JSON_PATH):
        raise FileNotFoundError(f"emoji.json not found at {EMOJI_JSON_PATH}")

    with open(EMOJI_JSON_PATH, "r", encoding="utf-8") as f:
        raw_emojis = json.load(f)

    # Build lookup map of mapped image name -> metadata
    metadata_map = {}
    base_lookup = {}  # base hex string -> parent item
    
    # Skin tone suffix descriptor dictionary
    skin_tone_names = {
        "1F3FB": "Light Skin Tone",
        "1F3FC": "Medium-Light Skin Tone",
        "1F3FD": "Medium Skin Tone",
        "1F3FE": "Medium-Dark Skin Tone",
        "1F3FF": "Dark Skin Tone"
    }

    for item in raw_emojis:
        unified = item.get("unified", "")
        img_name = item.get("image")
        if img_name:
            metadata_map[img_name] = {
                "name": item.get("name", "Unknown"),
                "short_name": item.get("short_name", ""),
                "category": item.get("category", "Uncategorized"),
                "subcategory": item.get("subcategory", ""),
                "unified": unified
            }
            if unified:
                base_lookup[unified.lower()] = item

        # Map skin variations
        skins = item.get("skin_variations", {})
        for skin_key, skin_item in skins.items():
            skin_img = skin_item.get("image")
            if skin_img:
                skin_desc = skin_tone_names.get(skin_key.upper(), "Skin Tone Variation")
                parent_name = item.get("name", "Unknown")
                metadata_map[skin_img] = {
                    "name": f"{parent_name} ({skin_desc})",
                    "short_name": f"{item.get('short_name', '')}_{skin_key.lower()}",
                    "category": item.get("category", "Uncategorized"),
                    "subcategory": item.get("subcategory", ""),
                    "unified": skin_item.get("unified", "")
                }

    # Find all PNG files in directory
    all_files = [f for f in os.listdir(EMOJI_IMG_DIR) if f.endswith(".png")]
    all_files.sort()

    valid_emojis = []
    import unicodedata
    for filename in all_files:
        img_path = os.path.join(EMOJI_IMG_DIR, filename)
        if filename in metadata_map:
            meta = metadata_map[filename]
            valid_emojis.append({
                "name": meta["name"],
                "short_name": meta["short_name"],
                "category": meta["category"],
                "subcategory": meta["subcategory"],
                "unified": meta["unified"],
                "image_file": filename,
                "image_path": img_path
            })
        else:
            # Fallback name and category generation via unicodedata
            base_name_raw = os.path.splitext(filename)[0]
            parts = base_name_raw.split("-")
            
            # Generate Name
            names = []
            for p in parts:
                val_hex = p.strip()
                if not val_hex:
                    continue
                try:
                    val = int(val_hex, 16)
                    if val in (0x200d, 0xfe0f):
                        continue
                    names.append(unicodedata.name(chr(val)))
                except Exception:
                    names.append(val_hex.upper())
            generated_name = " & ".join(names) if names else "UNKNOWN VARIATION"

            # Check if we can inherit category from base prefix
            base_hex = parts[0].lower()
            inherited_cat = "Uncategorized"
            inherited_sub = "variation"
            if base_hex in base_lookup:
                parent = base_lookup[base_hex]
                inherited_cat = parent.get("category", "Uncategorized")
                inherited_sub = parent.get("subcategory", "variation")

            valid_emojis.append({
                "name": generated_name,
                "short_name": base_name_raw,
                "category": inherited_cat,
                "subcategory": inherited_sub,
                "unified": base_name_raw.upper(),
                "image_file": filename,
                "image_path": img_path
            })

    print(f"[Indexer] Found {len(valid_emojis)} valid emojis in {EMOJI_IMG_DIR}.")

    if not valid_emojis:
        print("[Indexer] No valid emojis found. Aborting.")
        return

    # Load SigLIP 2 Model and Processor
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[Indexer] Loading SigLIP 2 model '{MODEL_NAME}' on device: {device}...")
    processor = AutoProcessor.from_pretrained(MODEL_NAME)
    model = AutoModel.from_pretrained(MODEL_NAME).to(device)
    model.eval()

    # Extract vision embeddings
    batch_size = 64
    all_embeddings = []

    print("[Indexer] Extracting vision embeddings...")
    for i in tqdm(range(0, len(valid_emojis), batch_size)):
        batch_items = valid_emojis[i:i+batch_size]
        images = []
        for item in batch_items:
            img = Image.open(item["image_path"])
            if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                img = img.convert('RGBA')
                bg = Image.new('RGB', img.size, (255, 255, 255))
                bg.paste(img, mask=img.split()[3])
                img = bg
            else:
                img = img.convert("RGB")
            images.append(img)

        inputs = processor(images=images, return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items()}
        with torch.no_grad():
            features = model.get_image_features(**inputs)
            if hasattr(features, "pooler_output"):
                features = features.pooler_output
            # L2 normalize
            features = features / features.norm(dim=-1, keepdim=True)
            all_embeddings.append(features.cpu().numpy())

    embeddings_matrix = np.vstack(all_embeddings).astype(np.float32)
    vector_dim = embeddings_matrix.shape[1]
    print(f"[Indexer] Embedding extraction complete. Shape: {embeddings_matrix.shape}")

    # Compute 2D UMAP
    print("[Indexer] Computing UMAP 2D projection...")
    reducer_2d = umap.UMAP(n_components=2, random_state=42, n_neighbors=15, min_dist=0.1, metric="cosine")
    coords_2d = reducer_2d.fit_transform(embeddings_matrix)

    # Compute 3D UMAP
    print("[Indexer] Computing UMAP 3D projection...")
    reducer_3d = umap.UMAP(n_components=3, random_state=42, n_neighbors=15, min_dist=0.1, metric="cosine")
    coords_3d = reducer_3d.fit_transform(embeddings_matrix)

    # Re-create Qdrant Collection
    print(f"[Indexer] Re-creating Qdrant collection '{COLLECTION_NAME}' (dim={vector_dim})...")
    client.recreate_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=qdrant_models.VectorParams(
            size=vector_dim,
            distance=qdrant_models.Distance.COSINE
        )
    )

    # Upsert points
    print("[Indexer] Upserting points to Qdrant...")
    points = []
    for idx, item in enumerate(valid_emojis):
        point = qdrant_models.PointStruct(
            id=idx,
            vector=embeddings_matrix[idx].tolist(),
            payload={
                "name": item["name"],
                "short_name": item["short_name"],
                "category": item["category"],
                "subcategory": item["subcategory"],
                "unified": item["unified"],
                "image_file": item["image_file"],
                "x_2d": float(coords_2d[idx][0]),
                "y_2d": float(coords_2d[idx][1]),
                "x_3d": float(coords_3d[idx][0]),
                "y_3d": float(coords_3d[idx][1]),
                "z_3d": float(coords_3d[idx][2])
            }
        )
        points.append(point)

    # Batch upsert
    upsert_batch_size = 200
    for i in range(0, len(points), upsert_batch_size):
        client.upsert(
            collection_name=COLLECTION_NAME,
            points=points[i:i+upsert_batch_size]
        )

    print(f"[Indexer] Successfully indexed {len(points)} emojis into Qdrant collection '{COLLECTION_NAME}'.")

if __name__ == "__main__":
    run_indexing(force_reindex=True)

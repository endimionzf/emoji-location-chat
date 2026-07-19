import os
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import torch
from transformers import AutoModel, AutoProcessor
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
COLLECTION_NAME = "emoji_siglip2"
MODEL_NAME = "google/siglip2-base-patch16-224"

# Path resolve helper
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMOJI_IMG_DIR = os.getenv("EMOJI_IMG_DIR", os.path.join(BASE_DIR, "img-apple-160"))

app = FastAPI(title="Emoji SigLIP 2 Explorer")

# Mount emoji images static folder
app.mount("/images", StaticFiles(directory=EMOJI_IMG_DIR), name="images")
# Mount UI static folder (CSS/JS)
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "app", "static")), name="static")

templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "app", "templates"))

# Global references for model and client
model = None
processor = None
qdrant_client = None

class SearchQuery(BaseModel):
    query: str
    limit: int = 15

@app.on_event("startup")
def startup_event():
    global model, processor, qdrant_client
    print("[API] Loading SigLIP 2 model and processor...")
    processor = AutoProcessor.from_pretrained(MODEL_NAME)
    model = AutoModel.from_pretrained(MODEL_NAME)
    model.eval()

    print("[API] Connecting to Qdrant...")
    qdrant_client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

@app.get("/")
def read_root(request: Request):
    return templates.TemplateResponse(request, "index.html")

@app.get("/api/emojis")
def get_all_emojis():
    """Retrieve all emojis and UMAP coordinates from Qdrant scroll api"""
    try:
        # Scroll up to 10000 points (our emojis size is ~2000-3000)
        scroll_result, next_page = qdrant_client.scroll(
            collection_name=COLLECTION_NAME,
            limit=5000,
            with_payload=True,
            with_vectors=False
        )
        
        emojis_data = []
        for point in scroll_result:
            payload = point.payload
            emojis_data.append({
                "id": point.id,
                "name": payload.get("name"),
                "short_name": payload.get("short_name"),
                "category": payload.get("category"),
                "subcategory": payload.get("subcategory"),
                "unified": payload.get("unified"),
                "image_file": payload.get("image_file"),
                "x_2d": payload.get("x_2d"),
                "y_2d": payload.get("y_2d"),
                "x_3d": payload.get("x_3d"),
                "y_3d": payload.get("y_3d"),
                "z_3d": payload.get("z_3d")
            })
        
        return JSONResponse(content={"status": "success", "data": emojis_data})
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": f"Failed to retrieve data from Qdrant: {str(e)}"}
        )

@app.post("/api/search")
def search_emojis(search_req: SearchQuery):
    """Text-to-Image vector semantic search using SigLIP 2"""
    try:
        # Generate text embedding
        inputs = processor(text=[search_req.query], return_tensors="pt", padding=True)
        with torch.no_grad():
            text_features = model.get_text_features(**inputs)
            if hasattr(text_features, "pooler_output"):
                text_features = text_features.pooler_output
            # L2 normalize
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            query_vector = text_features[0].cpu().numpy().tolist()

        # Query Qdrant with a larger limit to perform hybrid ranking
        query_response = qdrant_client.query_points(
            collection_name=COLLECTION_NAME,
            query=query_vector,
            limit=2000,
            with_payload=True
        )

        query_words = [w.lower() for w in search_req.query.strip().split() if len(w) > 1]

        results = []
        for point in query_response.points:
            payload = point.payload
            name = payload.get("name", "").lower()
            short_name = payload.get("short_name", "").lower()
            category = payload.get("category", "").lower()
            subcategory = payload.get("subcategory", "").lower()

            # Keyword match boost
            keyword_score = 0.0
            for word in query_words:
                if word in name or word in short_name or word in category or word in subcategory:
                    # Give higher boost if it matches name or short_name
                    if word in name or word in short_name:
                        keyword_score += 0.3
                    else:
                        keyword_score += 0.1

            # Combined score (vector cosine similarity + keyword boost)
            final_score = float(point.score) + keyword_score

            results.append({
                "id": point.id,
                "score": final_score,
                "vector_score": float(point.score),
                "name": payload.get("name"),
                "short_name": payload.get("short_name"),
                "category": payload.get("category"),
                "image_file": payload.get("image_file"),
                "x_2d": payload.get("x_2d"),
                "y_2d": payload.get("y_2d"),
                "x_3d": payload.get("x_3d"),
                "y_3d": payload.get("y_3d"),
                "z_3d": payload.get("z_3d")
            })

        # Re-sort based on combined hybrid score
        results.sort(key=lambda x: x["score"], reverse=True)
        results = results[:search_req.limit]

        return JSONResponse(content={"status": "success", "results": results})
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": f"Search failed: {str(e)}"}
        )

@app.get("/api/status")
def get_status():
    """Retrieve database index status"""
    try:
        if qdrant_client.collection_exists(COLLECTION_NAME):
            info = qdrant_client.get_collection(COLLECTION_NAME)
            return {
                "indexed": True,
                "points_count": info.points_count,
                "vector_dimension": info.config.params.vectors.size,
                "status": "ready"
            }
        else:
            return {"indexed": False, "status": "no_collection"}
    except Exception as e:
        return {"indexed": False, "status": "error", "error": str(e)}

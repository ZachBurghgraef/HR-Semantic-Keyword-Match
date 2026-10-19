from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import util, SentenceTransformer
from typing import Optional
import datetime
import os
import uuid
from mangum import Mangum

from src.matching import generate_embeddings, rescore_candidates

app = FastAPI(
    title="Candidate Ranker API",
    description="Rank candidates by semantic similarity to job titles",
    version="1.0.0"
)

# fine tuned for job listings. In Lambda, MODEL_DIR points at the copy baked into
# the container image; locally it falls back to downloading from Hugging Face.
model = SentenceTransformer(os.environ.get('MODEL_DIR', 'TechWolf/JobBERT-v2'))


# ========== Request/Response Models =============

class RankRequest(BaseModel):
    """Input for creating a new ranking"""
    job_title: str
    candidate_titles: list[str]
    good_candidate_indexes: Optional[list[int]] = None

class RankedCandidate(BaseModel):
    title: str
    similarity_score: float
    idx: int

class RankingResult(BaseModel):
    """A ranking resource"""
    ranking_id: str
    job_title: str
    ranked_candidates: list[RankedCandidate]
    created_at: str

# ========= Health Check ============

@app.get('/health', tags=['Health'])
async def health_check():
    """Health check endpoint for monitoring"""
    return {"status": "healthy", "timestamp":datetime.datetime.now(datetime.timezone.utc)}

# ========= RESTful Endpoints ===========

@app.post('/rankings', response_model=RankingResult, tags=['Rankings'], status_code=201)
async def create_ranking(request: RankRequest):
    """
    Create a new ranking by posting a job title and candidate list.

    **HTTP Method:** POST (creates a resource)
    **Resource:** /rankings (nouns, plural)
    **Returns:** The created ranking with a unique ID

    """
    try:
        if not request.candidate_titles:
            raise HTTPException(
                status_code=400,
                detail="candidate_titles cannot be empty"
            )

        if len(request.candidate_titles) > 1000:
            raise HTTPException(
                status_code=400,
                detail="Cannot rank more than 1000 candidates at once"
            )

        # encode job title and candidates
        job_embeddings = generate_embeddings(text_list=[request.job_title], model=model)
        candidate_embeddings = generate_embeddings(text_list=request.candidate_titles, model=model)

        # rank candidates
        if request.good_candidate_indexes and len(request.good_candidate_indexes) > 0:
            valid_indexes = [i for i in request.good_candidate_indexes if 0<= i < len(request.candidate_titles)]
            scores = rescore_candidates(good_idxs=valid_indexes, candidate_embeddings=candidate_embeddings, keyword_embeddings=job_embeddings)
        else:
            scores = rescore_candidates(good_idxs=[], candidate_embeddings=candidate_embeddings, keyword_embeddings=job_embeddings)

        ranked_candidates = sorted(
            enumerate(zip(request.candidate_titles, scores)),
            key=lambda x: x[1][1],
            reverse=True
        )

        ranking_id = str(uuid.uuid4())
        return RankingResult(
            ranking_id=ranking_id,
            job_title=request.job_title,
            ranked_candidates=[
                RankedCandidate(title=title, similarity_score=score, idx = idx) for idx, (title, score) in ranked_candidates
            ],
            created_at=datetime.datetime.now(datetime.timezone.utc).isoformat()
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

handler = Mangum(app)

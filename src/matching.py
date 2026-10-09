import torch
from sentence_transformers import SentenceTransformer, util

def generate_embeddings(text_list: list[str], model: SentenceTransformer) -> torch.Tensor:
    """
    Generates and returns tensors for a list of strings.
    Abstracts the implmentation of the model, in case the model output is not exactly as expected
    """
    return model.encode(text_list, convert_to_tensor=True)

def score_off_keywords(keyword_embeddings: torch.Tensor, candidate_embeddings: torch.Tensor,) -> list[float]:
    """
    Ranks candidates using pre-calculated tensors against an array of search keywords.
    Returns a unified list of match scores (0.0 to 1.0) for every candidate.
    """
    # Average the search keywords if there are multiple inputs
    if keyword_embeddings.ndim > 1:
        base_search_vector = torch.mean(keyword_embeddings, dim=0)
    else:
        base_search_vector = keyword_embeddings

    # Compute cosine similarity against all candidates in a single matrix operation
    # util.cos_sim returns a matrix shape [1, num_candidates]; we flatten it using [0]
    scores = util.cos_sim(base_search_vector, candidate_embeddings)[0]
    
    return scores.tolist()
def rescore_candidates(good_idxs: list[int], candidate_embeddings: torch.Tensor, keyword_embeddings: torch.Tensor, alpha: float = 0.4) -> list[float]:
    """
    params:
        good_ids: list of promising candidate's indexes in candidate_embeddings tensor
        candidate_embeddings: tensor of candidates
        keyword_embeddings: tensor of keywords
        alpha: weighting (float in range 0-1) of how much to change promising candidate search vector based on promising candidates' ids

    Blends keyword intent with an average vector of successful candidate profiles.
    Returns a newly adjusted list of match scores for the dataset pool.
    """
    # generate the base search vector baseline
    if keyword_embeddings.ndim > 1:
        base_search_vector = torch.mean(keyword_embeddings, dim=0)
    else:
        base_search_vector = keyword_embeddings

    # If no promising candidates have been flagged yet, return baseline scores
    if not good_idxs:
        scores = util.cos_sim(base_search_vector, candidate_embeddings)[0]
        return scores.tolist()

    # Pull the exact precalculated tensors for selected candidates and average them
    selected_vectors = candidate_embeddings[good_idxs]
    avg_promising_vector = torch.mean(selected_vectors, dim=0)

    # Synthesize the updated search vector profile
    updated_search_vector = ((1 - alpha) * base_search_vector) + (alpha * avg_promising_vector)

    # Calculate the adjusted search metrics across the pool
    reranked_scores = util.cos_sim(updated_search_vector, candidate_embeddings)[0]
    
    return reranked_scores.tolist()

Phase 1: Semantic Text Matching (The "L1" Layer)

- Goal 1: Parse and Clean with spaCy. Use spaCy to preprocess your dataset. Extract and isolate candidate job titles and position keywords.

- Goal 2: Embed and Calculate Similarity with Hugging Face / Sentence-Transformers. Load a pre-trained model (like all-mpnet-base-v2 or JobBERT). Encode your position keywords and candidate job titles into vectors. Use cosine_similarity to generate an initial baseline text-match score from 0 to 1.

Phase 2: Tabular Scaling & Multi-Feature Integration (The "L2" Layer)

- Goal 3: Normalize and Feature Engineer Tabular Data. Candidates' locations (e.g., categorical or geographic distance matching a required job site) and connection amounts need to be normalized using scikit-learn.

- Goal 4: Create a Hybrid Scoring Function. Instead of letting text metrics dictate the final output alone, build a weighted business formula. For example: 0.6 x Semantic Score + 0.2 x Location score + 0.2 * Network Score

Phase 3: Adaptive Feedback & Reranking (The Secondary Goal)

- Goal 5: Implement Dynamic Vector Averaging (Reranking). When a recruiter flags a candidate as "promising," capture that candidate's job title vector. Create a "target profile vector" by averaging the original position vector with the promising candidate's vector. Instantly recalculate cosine similarities against the remaining pool to float similar profiles to the top.Goal 

- 6: Transition to Learning-to-Rank (Advanced). If you scale this project, convert your dataset into a format readable by LightGBM's LGBMRanker. This allows the system to automatically learn optimal weights for job titles, connections, and feedback interactions over time.
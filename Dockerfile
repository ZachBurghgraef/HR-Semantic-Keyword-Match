# Lambda container image for the Candidate Ranker API.
# CDK builds this image and pushes it to ECR during `cdk deploy`.
FROM public.ecr.aws/lambda/python:3.12

# Install the CPU-only torch wheel first. The default PyPI wheel bundles CUDA
# (several GB) which Lambda can't use anyway. requirements.txt pins the same
# version, so pip sees it as already satisfied and won't swap it out.
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the model into the image at build time so a cold start loads it from
# local disk instead of downloading it from Hugging Face.
ENV MODEL_DIR=/opt/model
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('TechWolf/JobBERT-v2').save('${MODEL_DIR}')"

# Lambda's filesystem is read-only except /tmp, and there's no network
# download to do at runtime, so point any HF cache writes at /tmp and stay offline.
ENV HF_HOME=/tmp/hf \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

COPY app.py ${LAMBDA_TASK_ROOT}/
COPY src/ ${LAMBDA_TASK_ROOT}/src/

# module.attribute of the Mangum handler in app.py
CMD ["app.handler"]

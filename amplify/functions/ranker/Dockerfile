FROM public.ecr.aws/lambda/python:3.12

# Copy the requirements file into the container
COPY requirements.txt ${LAMBDA_TASK_ROOT}

# Install dependencies, ensuring we explicitly target CPU-only PyTorch to save space
RUN pip install --no-cache-dir -r requirements.txt --extra-index-url https://pytorch.org

# Copy the actual handler function code into the task root directory
COPY handler.py ${LAMBDA_TASK_ROOT}

# Set the execution entry point contract hook
CMD [ "handler.handler" ]

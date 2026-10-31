import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { DockerImageFunction, DockerImageCode } from 'aws-cdk-lib/aws-lambda';
import { Duration, Stack } from 'aws-cdk-lib';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backend = defineBackend({
  auth,
});

const backendStack = backend.createStack('PythonBackendStack');

// Deploys the Python logic as an isolated Docker Container image to bypass the 250MB limit
const rankerFunction = new DockerImageFunction(backendStack, 'RankerPythonFunction', {
  code: DockerImageCode.fromImageAsset(path.join(__dirname, 'functions/ranker')), // Looks for your Dockerfile
  memorySize: 2048, // 2GB to comfortably handle JobBERT text embeddings
  timeout: Duration.seconds(60*5), // First (cold) call downloads/loads the model; raise if you see timeouts
  environment: {
    HF_HOME: '/tmp/huggingface',
  },
});

// Allow signed-in users (Cognito authenticated role) to invoke the ranker from the browser
rankerFunction.grantInvoke(backend.auth.resources.authenticatedUserIamRole);

// Publish the function name + region into amplify_outputs.json (read by App.tsx)
backend.addOutput({
  custom: {
    rankerFunctionName: rankerFunction.functionName,
    awsRegion: Stack.of(rankerFunction).region,
  },
});
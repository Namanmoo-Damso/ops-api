import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';

export type BedrockClientOptions = {
  region?: string;
  requestTimeoutMs?: number;
};

export function createBedrockRuntimeClient(
  options: BedrockClientOptions = {},
): BedrockRuntimeClient {
  const region = options.region ?? process.env.AWS_REGION ?? 'ap-northeast-2';
  const requestTimeoutMs = options.requestTimeoutMs;

  const requestHandler = requestTimeoutMs
    ? new NodeHttpHandler({ requestTimeout: requestTimeoutMs })
    : undefined;

  return new BedrockRuntimeClient({
    region,
    ...(requestHandler ? { requestHandler } : {}),
  });
}

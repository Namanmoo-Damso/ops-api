import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'ap-northeast-2'
});

const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';

async function testBedrock() {
  try {
    console.log('Testing AWS Bedrock embedding generation...');
    console.log(`Region: ${process.env.AWS_REGION}`);
    console.log(`Model: ${EMBEDDING_MODEL}`);

    const input = {
      modelId: EMBEDDING_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: '안녕하세요, 테스트입니다.',
        dimensions: 1024,
        normalize: true,
      }),
    };

    console.log('\nCalling Bedrock API...');
    const command = new InvokeModelCommand(input);
    const response = await bedrockClient.send(command);

    console.log('Response received!');
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const embedding = responseBody.embedding;

    console.log(`✅ Success! Embedding length: ${embedding.length}`);
    console.log(`First 5 values: ${embedding.slice(0, 5)}`);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testBedrock();

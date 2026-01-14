import { PrismaClient } from '@prisma/client';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://damso:pw@db:5432/damso';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL,
    },
  },
});

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'ap-northeast-2',
  requestHandler: {
    requestTimeout: 30000,
  },
});

const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';

/**
 * Generate embedding using AWS Bedrock Titan V2
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const input = {
      modelId: EMBEDDING_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text,
        dimensions: 1024,
        normalize: true,
      }),
    };

    const command = new InvokeModelCommand(input);
    const response = await bedrockClient.send(command);

    const bodyBytes = response.body;
    if (!bodyBytes) {
      throw new Error('Empty response body from Bedrock');
    }

    const responseBody = JSON.parse(Buffer.from(bodyBytes).toString('utf-8'));
    const embedding = responseBody.embedding;

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid embedding response from Bedrock');
    }

    return embedding;
  } catch (error) {
    console.error(`Failed to generate embedding: ${error}`);
    throw error;
  }
}

/**
 * Re-embed test data vectors
 */
async function reEmbedTestData() {
  try {
    console.log('🔄 Re-embedding test data vectors...\n');

    // Find test data vectors
    const vectors = await prisma.$queryRaw<
      Array<{
        id: string;
        child_text: string;
        chunk_header: string | null;
        ward_id: string;
      }>
    >`
      SELECT id, child_text, chunk_header, ward_id
      FROM conversation_vectors_child
      WHERE metadata->>'testData' = 'true'
      ORDER BY created_at ASC
    `;

    if (vectors.length === 0) {
      console.log('❌ No test data vectors found');
      return;
    }

    console.log(`✅ Found ${vectors.length} test data vectors\n`);

    let successCount = 0;
    let failCount = 0;

    for (const [index, vector] of vectors.entries()) {
      try {
        console.log(
          `[${index + 1}/${vectors.length}] Re-embedding: ${vector.child_text.substring(0, 60)}...`,
        );

        // Generate new embedding
        const embedding = await generateEmbedding(vector.child_text);
        const embeddingStr = JSON.stringify(embedding);

        // Update in database
        await prisma.$executeRaw`
          UPDATE conversation_vectors_child
          SET embedding = ${embeddingStr}::vector
          WHERE id = ${vector.id}::uuid
        `;

        successCount++;
        console.log(
          `  ✅ Updated embedding (${embedding.length} dimensions)\n`,
        );

        // Rate limiting: wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        failCount++;
        console.error(`  ❌ Failed: ${error.message}\n`);
      }
    }

    console.log('\n🎉 Re-embedding completed!');
    console.log(`\n📊 Summary:`);
    console.log(`  - Total vectors: ${vectors.length}`);
    console.log(`  - Success: ${successCount}`);
    console.log(`  - Failed: ${failCount}`);

    if (successCount > 0) {
      console.log(`\n💡 Next step: Run preload to update Redis cache:`);
      console.log(
        `   curl -X POST "http://localhost:8080/v1/rag/preload" -H "Content-Type: application/json" -d '{"wardId":"<WARD_ID>","callDirection":"inbound"}'`,
      );
    }
  } catch (error) {
    console.error('❌ Error re-embedding test data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
reEmbedTestData();

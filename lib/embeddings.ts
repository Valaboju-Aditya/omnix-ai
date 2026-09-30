const OLLAMA_URL = "http://localhost:11434";

const EMBEDDING_MODEL = "nomic-embed-text";

const EMBEDDING_DIMENSIONS = 768;

export async function generateEmbedding(
  text: string
): Promise<number[]> {
  const embeddings =
    await generateEmbeddings([text]);

  return embeddings[0];
}

export async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  if (!texts.length) {
    return [];
  }

  const response = await fetch(
    `${OLLAMA_URL}/api/embed`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
      }),
    }
  );

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Embedding generation failed: ${errorText}`
    );
  }

  const data = await response.json();

  if (
    !data.embeddings ||
    !Array.isArray(data.embeddings)
  ) {
    throw new Error(
      "Invalid embedding response from Ollama"
    );
  }

  if (
    data.embeddings.length !== texts.length
  ) {
    throw new Error(
      `Expected ${texts.length} embeddings, got ${data.embeddings.length}`
    );
  }

  for (const embedding of data.embeddings) {
    if (
      !Array.isArray(embedding) ||
      embedding.length !==
        EMBEDDING_DIMENSIONS
    ) {
      throw new Error(
        `Expected ${EMBEDDING_DIMENSIONS} dimensions`
      );
    }
  }

  return data.embeddings;
}
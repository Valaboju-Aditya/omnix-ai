import { Pool } from "pg";
import { toSql } from "pgvector/pg";
import { generateEmbedding } from "@/lib/embeddings";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export type RetrievedChunk = {
  content: string;
  documentId: string;
  documentName: string;
  similarity: number;
};

export async function retrieveRelevantChunks(
  question: string,
  conversationId: string,
  limit = 5
): Promise<RetrievedChunk[]> {
  const questionEmbedding =
    await generateEmbedding(question);

  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT
        dc."content",
        dc."documentId",
        d."name" AS "documentName",
        1 - (dc."embedding" <=> $1::vector) AS "similarity"
      FROM "DocumentChunk" dc
      INNER JOIN "Document" d
        ON d."id" = dc."documentId"
      WHERE d."conversationId" = $2
      ORDER BY dc."embedding" <=> $1::vector
      LIMIT $3
      `,
      [
        toSql(questionEmbedding),
        conversationId,
        limit,
      ]
    );

    return result.rows.map((row) => ({
      content: row.content,
      documentId: row.documentId,
      documentName: row.documentName,
      similarity: Number(row.similarity),
    }));
  } finally {
    client.release();
  }
}
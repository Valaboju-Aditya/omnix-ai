
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
  pageNumber: number | null;
  slideNumber: number | null;
  similarity: number;
};

type RequestedLocation = {
  type: "page" | "slide";
  number: number;
};

type RetrievedChunkRow = {
  content: string;
  documentId: string;
  documentName: string;
  pageNumber: number | string | null;
  slideNumber: number | string | null;
  similarity?: number | string | null;
};

// ============================================================
// LOCATION DETECTION
// ============================================================

function extractRequestedLocation(
  question: string
): RequestedLocation | null {
  const text = question
    .toLowerCase()
    .replace(/[?.,!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const numberWords: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    eleventh: 11,
    twelfth: 12,
    thirteenth: 13,
    fourteenth: 14,
    fifteenth: 15,
    sixteenth: 16,
    seventeenth: 17,
    eighteenth: 18,
    nineteenth: 19,
    twentieth: 20,
  };

  const numericMatch = text.match(
    /\b(page|slide)\s+(?:number\s+)?(\d+)\b/
  );

  if (numericMatch) {
    const number = Number(numericMatch[2]);

    if (number > 0) {
      return {
        type: numericMatch[1] === "slide" ? "slide" : "page",
        number,
      };
    }
  }

  const numberFirstMatch = text.match(
    /\b(\d+)(?:st|nd|rd|th)?\s+(page|slide)\b/
  );

  if (numberFirstMatch) {
    const number = Number(numberFirstMatch[1]);

    if (number > 0) {
      return {
        type: numberFirstMatch[2] === "slide" ? "slide" : "page",
        number,
      };
    }
  }

  for (const [word, number] of Object.entries(numberWords)) {
    const match = text.match(
      new RegExp(`\\b${word}\\s+(page|slide)\\b`)
    );

    if (match) {
      return {
        type: match[1] === "slide" ? "slide" : "page",
        number,
      };
    }
  }

  for (const [word, number] of Object.entries(numberWords)) {
    if (new RegExp(`\\bpage\\s+${word}\\b`).test(text)) {
      return { type: "page", number };
    }

    if (new RegExp(`\\bslide\\s+${word}\\b`).test(text)) {
      return { type: "slide", number };
    }
  }

  return null;
}

// ============================================================
// DATABASE ROW MAPPING
// ============================================================

function mapRetrievedRows(
  rows: RetrievedChunkRow[]
): RetrievedChunk[] {
  return rows.map((row) => ({
    content: row.content,
    documentId: row.documentId,
    documentName: row.documentName,
    pageNumber:
      row.pageNumber !== null && row.pageNumber !== undefined
        ? Number(row.pageNumber)
        : null,
    slideNumber:
      row.slideNumber !== null && row.slideNumber !== undefined
        ? Number(row.slideNumber)
        : null,
    similarity:
      row.similarity !== null && row.similarity !== undefined
        ? Number(row.similarity)
        : 0,
  }));
}

// ============================================================
// HYBRID RETRIEVAL
// Semantic search + keyword search + RRF ranking
// ============================================================


async function retrieveHybridChunks(
  question: string,
  conversationId: string,
  limit: number,
  location: RequestedLocation | null = null
): Promise<RetrievedChunk[]> {
  const questionEmbedding = await generateEmbedding(question);
  const embeddingSql = toSql(questionEmbedding);

  const pageNumber =
    location?.type === "page" ? location.number : null;

  const slideNumber =
    location?.type === "slide" ? location.number : null;

  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 20));

  const client = await pool.connect();

  try {
    const result = await client.query(
      `
        WITH eligible AS (
          SELECT
            dc."id",
            dc."content",
            dc."documentId",
            d."name" AS "documentName",
            dc."pageNumber",
            dc."slideNumber",
            dc."embedding"
          FROM "DocumentChunk" dc
          INNER JOIN "Document" d
            ON d."id" = dc."documentId"
          WHERE
            d."conversationId" = $1
            AND (
              $4::integer IS NULL
              OR dc."pageNumber" = $4
            )
            AND (
              $5::integer IS NULL
              OR dc."slideNumber" = $5
            )
        ),

        semantic_ranked AS (
          SELECT
            e."id",
            ROW_NUMBER() OVER (
              ORDER BY
                e."embedding" <=> $3::vector ASC,
                e."id" ASC
            ) AS rank_position
          FROM eligible e
          WHERE e."embedding" IS NOT NULL
        ),

        keyword_ranked AS (
          SELECT
            e."id",
            ROW_NUMBER() OVER (
              ORDER BY
                ts_rank_cd(
                  to_tsvector('simple', e."content"),
                  plainto_tsquery('simple', $2)
                ) DESC,
                e."id" ASC
            ) AS rank_position
          FROM eligible e
          WHERE
            numnode(
              plainto_tsquery('simple', $2)
            ) > 0
            AND plainto_tsquery('simple', $2)
              @@ to_tsvector('simple', e."content")
        ),

        combined_ranks AS (
          SELECT
            sr."id",
            1.0 / (60 + sr.rank_position) AS rrf_score
          FROM semantic_ranked sr

          UNION ALL

          SELECT
            kr."id",
            1.0 / (60 + kr.rank_position) AS rrf_score
          FROM keyword_ranked kr
        ),

        fused AS (
          SELECT
            "id",
            SUM(rrf_score) AS combined_score
          FROM combined_ranks
          GROUP BY "id"
        )

        SELECT
          e."content",
          e."documentId",
          e."documentName",
          e."pageNumber",
          e."slideNumber",
          CASE
            WHEN e."embedding" IS NOT NULL
              THEN 1 - (
                e."embedding" <=> $3::vector
              )
            ELSE 0
          END AS "similarity"
        FROM eligible e
        INNER JOIN fused f
          ON f."id" = e."id"
        ORDER BY
          f.combined_score DESC,
          e."id" ASC
        LIMIT $6
      `,
      [
        conversationId,
        question,
        embeddingSql,
        pageNumber,
        slideNumber,
        safeLimit,
      ]
    );

    const chunks = mapRetrievedRows(result.rows);

    console.log(
      `RAG: Hybrid search returned ${chunks.length} chunks`,
      { location }
    );

    return chunks;
  } finally {
    client.release();
  }
}


// ============================================================
// MAIN RAG FUNCTION
// ============================================================

export async function retrieveRelevantChunks(
  question: string,
  conversationId: string,
  limit = 5
): Promise<RetrievedChunk[]> {
  const requestedLocation = extractRequestedLocation(question);

     // Preserve the actual requested location type.
  const adjustedLocation = requestedLocation;

  if (adjustedLocation) {
    console.log(
      "RAG: Hybrid exact-location request:",
      adjustedLocation
    );

    const locationChunks = await retrieveHybridChunks(
      question,
      conversationId,
      limit,
      adjustedLocation
    );

    if (locationChunks.length > 0) {
      return locationChunks;
    }

    console.log(
      "RAG: No chunks found at requested location; falling back to hybrid search."
    );
  }

  return retrieveHybridChunks(
    question,
    conversationId,
    limit
  );
}

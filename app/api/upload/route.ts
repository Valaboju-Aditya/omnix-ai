import { prisma } from "@/lib/prisma";
import { extractText } from "unpdf";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import {
  generateEmbeddings,
} from "@/lib/embeddings";
import { Pool } from "pg";
import { toSql } from "pgvector/pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,
});

// ============================================================
// LIMITS
// ============================================================

const MAX_FILE_SIZE =
  10 * 1024 * 1024; // 10 MB

const MAX_SPREADSHEET_ROWS = 10000;

const CHUNK_SIZE = 2000;

const CHUNK_OVERLAP = 300;

const EMBEDDING_BATCH_SIZE = 32;

// ============================================================
// NORMAL TEXT CHUNKING
// ============================================================

function splitTextIntoChunks(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP
): string[] {
  const chunks: string[] = [];

  let start = 0;

  while (start < text.length) {
    const end = Math.min(
      start + chunkSize,
      text.length
    );

    const chunk =
      text.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= text.length) {
      break;
    }

    start = Math.max(
      0,
      end - overlap
    );
  }

  return chunks;
}

// ============================================================
// SPREADSHEET CHUNKING
// ============================================================

function createSpreadsheetChunks(
  text: string
): string[] {
  const lines =
    text.split("\n");

  const chunks: string[] = [];

  let currentChunk = "";

  for (const line of lines) {
    const trimmedLine =
      line.trim();

    if (!trimmedLine) {
      continue;
    }

    const nextChunk =
      currentChunk
        ? `${currentChunk}\n${trimmedLine}`
        : trimmedLine;

    if (
      nextChunk.length >
      CHUNK_SIZE
    ) {
      if (currentChunk.trim()) {
        chunks.push(
          currentChunk.trim()
        );
      }

      currentChunk =
        trimmedLine;
    } else {
      currentChunk =
        nextChunk;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(
      currentChunk.trim()
    );
  }

  return chunks;
}

// ============================================================
// PDF / TXT / DOCX / CSV / XLSX
// ============================================================

async function extractFileText(
  file: File
) {

  // ==========================================================
  // PDF
  // ==========================================================

  if (
    file.type ===
      "application/pdf" ||
    file.name
      .toLowerCase()
      .endsWith(".pdf")
  ) {
    const buffer =
      new Uint8Array(
        await file.arrayBuffer()
      );

    const {
      text,
      totalPages,
    } =
      await extractText(
        buffer
      );

    return {
      content:
        text
          .join("\n\n")
          .trim(),

      pages: totalPages,

      spreadsheet: false,
    };
  }

  // ==========================================================
  // TXT
  // ==========================================================

  if (
    file.type ===
      "text/plain" ||
    file.name
      .toLowerCase()
      .endsWith(".txt")
  ) {
    const content =
      await file.text();

    return {
      content:
        content.trim(),

      pages: undefined,

      spreadsheet: false,
    };
  }

  // ==========================================================
  // DOCX
  // ==========================================================

  if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name
      .toLowerCase()
      .endsWith(".docx")
  ) {
    const buffer =
      Buffer.from(
        await file.arrayBuffer()
      );

    const result =
      await mammoth.extractRawText(
        {
          buffer,
        }
      );

    return {
      content:
        result.value.trim(),

      pages: undefined,

      spreadsheet: false,
    };
  }

  // ==========================================================
  // CSV
  // ==========================================================

  if (
    file.type ===
      "text/csv" ||
    file.name
      .toLowerCase()
      .endsWith(".csv")
  ) {
    const csvText =
      await file.text();

    const workbook =
      XLSX.read(
        csvText,
        {
          type: "string",
          raw: false,
        }
      );

    const sections: string[] =
      [];

    for (const sheetName of
      workbook.SheetNames) {

      const worksheet =
        workbook.Sheets[
          sheetName
        ];

      const rows =
        XLSX.utils.sheet_to_json(
          worksheet,
          {
            header: 1,
            defval: "",
            raw: false,
          }
        ) as unknown[][];

      if (
        rows.length >
        MAX_SPREADSHEET_ROWS
      ) {
        throw new Error(
          `CSV contains ${rows.length.toLocaleString()} rows. Maximum supported is ${MAX_SPREADSHEET_ROWS.toLocaleString()} rows.`
        );
      }

      const formattedRows =
        rows.map((row) =>
          row
            .map((cell) =>
              String(cell)
            )
            .join(" | ")
        );

      sections.push(
        `Sheet: ${sheetName}\n\n${formattedRows.join(
          "\n"
        )}`
      );
    }

    return {
      content:
        sections
          .join(
            "\n\n====================\n\n"
          )
          .trim(),

      pages: undefined,

      spreadsheet: true,
    };
  }

  // ==========================================================
  // XLSX
  // ==========================================================

  if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.name
      .toLowerCase()
      .endsWith(".xlsx")
  ) {
    const buffer =
      await file.arrayBuffer();

    const workbook =
      XLSX.read(
        buffer,
        {
          type: "array",
          cellDates: true,
        }
      );

    const sections: string[] =
      [];

    for (const sheetName of
      workbook.SheetNames) {

      const worksheet =
        workbook.Sheets[
          sheetName
        ];

      const rows =
        XLSX.utils.sheet_to_json(
          worksheet,
          {
            header: 1,
            defval: "",
            raw: false,
          }
        ) as unknown[][];

      if (
        rows.length >
        MAX_SPREADSHEET_ROWS
      ) {
        throw new Error(
          `Excel sheet "${sheetName}" contains ${rows.length.toLocaleString()} rows. Maximum supported is ${MAX_SPREADSHEET_ROWS.toLocaleString()} rows per sheet.`
        );
      }

      const formattedRows =
        rows.map((row) =>
          row
            .map((cell) =>
              String(cell)
            )
            .join(" | ")
        );

      sections.push(
        `Sheet: ${sheetName}\n\n${formattedRows.join(
          "\n"
        )}`
      );
    }

    return {
      content:
        sections
          .join(
            "\n\n====================\n\n"
          )
          .trim(),

      pages: undefined,

      spreadsheet: true,
    };
  }

  throw new Error(
    "Unsupported file type. Please upload PDF, TXT, DOCX, CSV, or XLSX files."
  );
}

// ============================================================
// POST /api/upload
// ============================================================

export async function POST(
  request: Request
) {
  try {

    const formData =
      await request.formData();

    const file =
      formData.get("file");

    const conversationIdValue =
      formData.get(
        "conversationId"
      );

    let conversationId =
      typeof conversationIdValue ===
        "string" &&
      conversationIdValue.trim()
        ? conversationIdValue
        : null;

    // ========================================================
    // CHECK FILE
    // ========================================================

    if (!(file instanceof File)) {
      return Response.json(
        {
          error:
            "No file uploaded",
        },
        {
          status: 400,
        }
      );
    }

    // ========================================================
    // FILE SIZE
    // ========================================================

    if (
      file.size >
      MAX_FILE_SIZE
    ) {
      return Response.json(
        {
          error:
            "File is too large. Maximum file size is 10 MB.",
        },
        {
          status: 400,
        }
      );
    }

    const fileName =
      file.name.toLowerCase();

    // ========================================================
    // FILE TYPES
    // ========================================================

    const isPDF =
      file.type ===
        "application/pdf" ||
      fileName.endsWith(".pdf");

    const isTXT =
      file.type ===
        "text/plain" ||
      fileName.endsWith(".txt");

    const isDOCX =
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      fileName.endsWith(".docx");

    const isCSV =
      file.type ===
        "text/csv" ||
      fileName.endsWith(".csv");

    const isXLSX =
      file.type ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      fileName.endsWith(".xlsx");

    if (
      !isPDF &&
      !isTXT &&
      !isDOCX &&
      !isCSV &&
      !isXLSX
    ) {
      return Response.json(
        {
          error:
            "Only PDF, TXT, DOCX, CSV, and XLSX files are currently supported.",
        },
        {
          status: 400,
        }
      );
    }

    // ========================================================
    // CREATE CONVERSATION
    // ========================================================

    if (!conversationId) {

      const conversation =
        await prisma.conversation.create(
          {
            data: {
              title:
                file.name.replace(
                  /\.(pdf|txt|docx|csv|xlsx)$/i,
                  ""
                ) ||
                "File Chat",
            },
          }
        );

      conversationId =
        conversation.id;

    } else {

      const conversation =
        await prisma.conversation.findUnique(
          {
            where: {
              id: conversationId,
            },

            select: {
              id: true,
            },
          }
        );

      if (!conversation) {

        const newConversation =
          await prisma.conversation.create(
            {
              data: {
                title:
                  file.name.replace(
                    /\.(pdf|txt|docx|csv|xlsx)$/i,
                    ""
                  ) ||
                  "File Chat",
              },
            }
          );

        conversationId =
          newConversation.id;
      }
    }

    // ========================================================
    // EXTRACT FILE
    // ========================================================

    const {
      content: extractedText,
      pages,
      spreadsheet,
    } =
      await extractFileText(
        file
      );

    if (!extractedText) {
      return Response.json(
        {
          error:
            "Could not extract any text from this file.",
        },
        {
          status: 400,
        }
      );
    }

    // ========================================================
    // CREATE DOCUMENT
    // ========================================================

    const document =
      await prisma.document.create(
        {
          data: {
            name: file.name,

            content:
              extractedText,

            conversationId,
          },
        }
      );

    // ========================================================
    // CREATE CHUNKS
    // ========================================================

    const chunks =
      spreadsheet
        ? createSpreadsheetChunks(
            extractedText
          )
        : splitTextIntoChunks(
            extractedText
          );

    if (!chunks.length) {
      await prisma.document.delete(
        {
          where: {
            id: document.id,
          },
        }
      );

      return Response.json(
        {
          error:
            "Could not create searchable chunks from this file.",
        },
        {
          status: 400,
        }
      );
    }

    // ========================================================
    // CONNECT TO POSTGRES
    // ========================================================

    const client =
      await pool.connect();

    try {

      // ======================================================
      // BATCH EMBEDDINGS
      // ======================================================

      for (
        let start = 0;
        start < chunks.length;
        start += EMBEDDING_BATCH_SIZE
      ) {

        const batch =
          chunks.slice(
            start,
            start +
              EMBEDDING_BATCH_SIZE
          );

        console.log(
          `Generating embeddings ${start + 1}-${Math.min(
            start + batch.length,
            chunks.length
          )} of ${chunks.length}`
        );

        const embeddings =
          await generateEmbeddings(
            batch
          );

        // ====================================================
        // STORE EMBEDDINGS
        // ====================================================

        for (
          let i = 0;
          i < batch.length;
          i++
        ) {

          await client.query(
            `
            INSERT INTO "DocumentChunk"
            ("id","documentId","content","embedding")
            VALUES ($1,$2,$3,$4::vector)
            `,
            [
              crypto.randomUUID(),

              document.id,

              batch[i],

              toSql(
                embeddings[i]
              ),
            ]
          );
        }
      }

    } catch (embeddingError) {

      console.error(
        "Embedding error:",
        embeddingError
      );

      await prisma.document.delete(
        {
          where: {
            id: document.id,
          },
        }
      );

      throw new Error(
        "Failed to generate embeddings for the file."
      );

    } finally {

      client.release();
    }

    // ========================================================
    // FILE TYPE
    // ========================================================

    let fileType =
      "unknown";

    if (isPDF) {
      fileType = "pdf";
    } else if (isTXT) {
      fileType = "txt";
    } else if (isDOCX) {
      fileType = "docx";
    } else if (isCSV) {
      fileType = "csv";
    } else if (isXLSX) {
      fileType = "xlsx";
    }

    // ========================================================
    // SUCCESS
    // ========================================================

    return Response.json({
      success: true,

      documentId:
        document.id,

      fileName:
        file.name,

      characters:
        extractedText.length,

      pages,

      chunks:
        chunks.length,

      embeddings:
        chunks.length,

      conversationId,

      fileType,
    });

  } catch (error) {

    console.error(
      "File upload error:",
      error
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process file",
      },
      {
        status: 500,
      }
    );
  }
}
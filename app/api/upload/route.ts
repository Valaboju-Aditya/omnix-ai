import { prisma } from "@/lib/prisma";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { generateEmbeddings } from "@/lib/embeddings";
import { Pool } from "pg";
import { toSql } from "pgvector/pg";
import { createRequire } from "module";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const require = createRequire(import.meta.url);

// ============================================================
// LIMITS
// ============================================================

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_SPREADSHEET_ROWS = 10000;

const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 300;
const EMBEDDING_BATCH_SIZE = 32;

// ============================================================
// TYPES
// ============================================================

type ExtractedFile = {
  content: string;
  pages?: number;
  spreadsheet: boolean;
  pageTexts?: string[];
};

// ============================================================
// NORMAL TEXT CHUNKING
// ============================================================

function splitTextIntoChunks(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP
): string[] {
  const chunks: string[] = [];

  if (!text.trim()) {
    return chunks;
  }

  let start = 0;

  while (start < text.length) {
    const end = Math.min(
      start + chunkSize,
      text.length
    );

    const chunk = text
      .slice(start, end)
      .trim();

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
  const lines = text.split("\n");

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
// IMAGE OCR
// ============================================================





async function extractImageText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());

  // 1. Extract text using Tesseract OCR
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng");

  let ocrText = "";

  try {
    const modes = [
      PSM.SPARSE_TEXT,
      PSM.AUTO,
      PSM.SINGLE_BLOCK,
    ];

    const results: string[] = [];

    for (const mode of modes) {
      await worker.setParameters({
        tessedit_pageseg_mode: mode,
      });

      const result = await worker.recognize(buffer);
      const text = result.data.text.trim();

      if (text) {
        results.push(text);
      }
    }

    ocrText = [
      ...new Set(
        results
          .flatMap((text) => text.split(/\r?\n/))
          .map((line) => line.trim())
          .filter(Boolean)
      ),
    ].join("\n");
  } finally {
    await worker.terminate();
  }

  // 2. Understand the image using Qwen2.5-VL
  const imageBase64 = buffer.toString("base64");

  try {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen2.5vl:3b",
        stream: false,
        messages: [
          {
            role: "user",
            content:
              "Analyze this image for a document question-answering system. " +
              "Read all visible text and explain any flowcharts, diagrams, " +
              "tables, screenshots, shapes, arrows, and relationships. " +
              "Preserve labels and symbols accurately. " +
              "Do not invent unreadable text or missing information. " +
              "Return a clear, detailed description.",
            images: [imageBase64],
          },
        ],
        options: {
          temperature: 0.1,
        },
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      throw new Error(`Vision API returned ${response.status}`);
    }

    const data = await response.json();
    const visionText = data.message?.content?.trim() ?? "";

    // 3. Combine OCR and visual understanding
    const sections: string[] = [];

    if (ocrText) {
      sections.push("TEXT EXTRACTED FROM IMAGE:\n" + ocrText);
    }

    if (visionText) {
      sections.push("VISUAL ANALYSIS:\n" + visionText);
    }

    return sections.join("\n\n");
  } catch (error) {
    console.error("[Image Vision Error]", error);

    // Keep image uploads working even if the vision model fails.
    if (ocrText) {
      return (
        "TEXT EXTRACTED FROM IMAGE:\n" +
        ocrText +
        "\n\nVisual analysis is currently unavailable."
      );
    }

    throw new Error(
      "Could not analyze this image. Check that Ollama is running and qwen2.5vl:3b is installed."
    );
  }
}
  




// ============================================================
// FILE TEXT EXTRACTION
// ============================================================

async function extractFileText(
  file: File
): Promise<ExtractedFile> {
  const lowerName =
    file.name.toLowerCase();

  // ==========================================================
  // PDF
  // ==========================================================

  if (
    file.type === "application/pdf" ||
    lowerName.endsWith(".pdf")
  ) {
    const buffer = Buffer.from(
      await file.arrayBuffer()
    );

    /*
     * IMPORTANT:
     *
     * pdf-parse is loaded using Node's native require.
     *
     * It is marked as an external package in next.config.ts
     * so Next.js/Webpack does not bundle it.
     */

    const pdfModule =
      require("pdf-parse");

    const PDFParse =
      pdfModule.PDFParse ??
      pdfModule.default?.PDFParse;

    if (!PDFParse) {
      throw new Error(
        "Could not load PDFParse from pdf-parse."
      );
    }

    const parser =
      new PDFParse({
        data: buffer,
      });

    try {
      const result =
        await parser.getText();

      /*
       * Keep the text of every page separately.
       *
       * This allows each RAG chunk to remember
       * which PDF page it came from.
       */

      const pageTexts =
        Array.isArray(
          result.pages
        )
          ? result.pages.map(
              (page: {
                text?: string;
              }) =>
                page.text?.trim() ||
                ""
            )
          : [];

      return {
        content:
          result.text.trim(),

        pages:
          result.total,

        spreadsheet: false,

        pageTexts,
      };
    } finally {
      await parser.destroy();
    }
  }

  // ==========================================================
  // TXT
  // ==========================================================

  if (
    file.type === "text/plain" ||
    lowerName.endsWith(".txt")
  ) {
    const content =
      await file.text();

    return {
      content: content.trim(),
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
    lowerName.endsWith(".docx")
  ) {
    const buffer = Buffer.from(
      await file.arrayBuffer()
    );

    const result =
      await mammoth.extractRawText({
        buffer,
      });

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
    file.type === "text/csv" ||
    lowerName.endsWith(".csv")
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

    for (
      const sheetName of
      workbook.SheetNames
    ) {
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
      content: sections
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
    lowerName.endsWith(".xlsx")
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

    for (
      const sheetName of
      workbook.SheetNames
    ) {
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
      content: sections
        .join(
          "\n\n====================\n\n"
        )
        .trim(),

      pages: undefined,

      spreadsheet: true,
    };
  }

  // ==========================================================
  // IMAGE / OCR
  // ==========================================================

  if (
    file.type === "image/jpeg" ||
    file.type === "image/png" ||
    file.type === "image/webp" ||
    lowerName.endsWith(".jpg") ||
    lowerName.endsWith(".jpeg") ||
    lowerName.endsWith(".png") ||
    lowerName.endsWith(".webp")
  ) {
    const content =
      await extractImageText(file);

    return {
      content,

      pages: undefined,

      spreadsheet: false,
    };
  }

  // ==========================================================
  // PPTX
  // ==========================================================

  /*
   * PPTX IS TEMPORARILY DISABLED.
   *
   * officeparser caused a Next.js/Webpack error.
   *
   * We will add PPTX support later using another approach.
   */

  if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    lowerName.endsWith(".pptx")
  ) {
    throw new Error(
      "PPTX support is temporarily disabled. Please upload PDF, TXT, DOCX, CSV, XLSX, JPG, JPEG, PNG, or WEBP."
    );
  }

  // ==========================================================
  // UNSUPPORTED
  // ==========================================================

  throw new Error(
    "Unsupported file type. Please upload PDF, TXT, DOCX, CSV, XLSX, JPG, JPEG, PNG, or WEBP."
  );
}

// ============================================================
// POST /api/upload
// ============================================================

export async function POST(
  request: Request
) {
  let createdDocumentId:
    | string
    | null = null;

  let savedFilePath:
    | string
    | null = null;

  try {
    // ========================================================
    // READ FORM DATA
    // ========================================================

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

    const isPPTX =
      file.type ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      fileName.endsWith(".pptx");

    const isImage =
      file.type ===
        "image/jpeg" ||
      file.type ===
        "image/png" ||
      file.type ===
        "image/webp" ||
      fileName.endsWith(".jpg") ||
      fileName.endsWith(".jpeg") ||
      fileName.endsWith(".png") ||
      fileName.endsWith(".webp");

    // ========================================================
    // VALIDATE FILE TYPE
    // ========================================================

    if (
      !isPDF &&
      !isTXT &&
      !isDOCX &&
      !isCSV &&
      !isXLSX &&
      !isPPTX &&
      !isImage
    ) {
      return Response.json(
        {
          error:
            "Only PDF, TXT, DOCX, CSV, XLSX, JPG, JPEG, PNG, and WEBP files are currently supported.",
        },
        {
          status: 400,
        }
      );
    }

    // ========================================================
    // CREATE OR FIND CONVERSATION
    // ========================================================

    const cleanTitle =
      file.name
        .replace(
          /\.(pdf|txt|docx|csv|xlsx|pptx|jpg|jpeg|png|webp)$/i,
          ""
        )
        .trim();

    if (!conversationId) {
      const conversation =
        await prisma.conversation.create(
          {
            data: {
              title:
                cleanTitle ||
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
                  cleanTitle ||
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
      pageTexts,
    } =
      await extractFileText(
        file
      );

    if (
      !extractedText.trim()
    ) {
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
    // SAVE ORIGINAL PDF
    // ========================================================

    if (isPDF) {
      const uploadsDirectory =
        path.join(
          process.cwd(),
          "public",
          "uploads"
        );

      await fs.mkdir(
        uploadsDirectory,
        {
          recursive: true,
        }
      );

      const extension =
        path
          .extname(file.name)
          .toLowerCase();

      const safeBaseName =
        path
          .basename(
            file.name,
            extension
          )
          .replace(
            /[^a-zA-Z0-9-_]/g,
            "_"
          );

      const uniqueFileName =
        `${safeBaseName}-${crypto.randomUUID()}${extension}`;

      const absoluteFilePath =
        path.join(
          uploadsDirectory,
          uniqueFileName
        );

      const fileBuffer =
        Buffer.from(
          await file.arrayBuffer()
        );

      await fs.writeFile(
        absoluteFilePath,
        fileBuffer
      );

      savedFilePath =
        `/uploads/${uniqueFileName}`;

      console.log(
        `PDF saved successfully: ${savedFilePath}`
      );
    }

    // ========================================================
    // CREATE DOCUMENT
    // ========================================================

    const document =
      await prisma.document.create({
        data: {
          name: file.name,
          content: extractedText,
          filePath: savedFilePath,
          conversationId,
        },
      });

    createdDocumentId =
      document.id;

    // ========================================================
    // CREATE CHUNKS
    // ========================================================

    type ChunkWithLocation = {
      content: string;
      pageNumber: number | null;
      slideNumber: number | null;
    };

    let chunksWithLocation:
      ChunkWithLocation[] = [];

    /*
     * PDF:
     *
     * Split each page separately.
     *
     * Every chunk created from that page
     * receives the corresponding page number.
     */

    if (
      isPDF &&
      pageTexts?.length
    ) {
      for (
        let pageIndex = 0;
        pageIndex <
        pageTexts.length;
        pageIndex++
      ) {
        const pageText =
          pageTexts[
            pageIndex
          ];

        if (
          !pageText.trim()
        ) {
          continue;
        }

        const pageChunks =
          splitTextIntoChunks(
            pageText
          );

        for (
          const chunk of pageChunks
        ) {
          chunksWithLocation.push(
            {
              content: chunk,
              pageNumber:
                pageIndex + 1,
              slideNumber: null,
            }
          );
        }
      }
    } else {
      /*
       * Non-PDF files do not have
       * page/slide numbers in the
       * current extraction pipeline.
       */

      const normalChunks =
        spreadsheet
          ? createSpreadsheetChunks(
              extractedText
            )
          : splitTextIntoChunks(
              extractedText
            );

      chunksWithLocation =
        normalChunks.map(
          (chunk) => ({
            content: chunk,
            pageNumber: null,
            slideNumber: null,
          })
        );
    }

    const chunks =
      chunksWithLocation.map(
        (chunk) =>
          chunk.content
      );

    if (!chunks.length) {
      await prisma.document.delete(
        {
          where: {
            id: document.id,
          },
        }
      );

      createdDocumentId = null;

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
        start +=
          EMBEDDING_BATCH_SIZE
      ) {
        const batch =
          chunksWithLocation.slice(
            start,
            start +
              EMBEDDING_BATCH_SIZE
          );

        /*
         * Ollama only receives the text.
         *
         * Page/slide metadata stays with
         * the chunk and is stored in PostgreSQL.
         */

        const batchTexts =
          batch.map(
            (item) =>
              item.content
          );

        console.log(
          `Generating embeddings ${
            start + 1
          }-${Math.min(
            start +
              batch.length,
            chunksWithLocation.length
          )} of ${
            chunksWithLocation.length
          }`
        );

        const embeddings =
          await generateEmbeddings(
            batchTexts
          );

        if (
          embeddings.length !==
          batch.length
        ) {
          throw new Error(
            `Embedding count mismatch. Expected ${batch.length}, received ${embeddings.length}.`
          );
        }

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
              (
                "id",
                "documentId",
                "content",
                "pageNumber",
                "slideNumber",
                "embedding"
              )
              VALUES
              (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6::vector
              )
            `,
            [
              crypto.randomUUID(),
              document.id,
              batch[i].content,
              batch[i].pageNumber ??
                null,
              batch[i].slideNumber ??
                null,
              toSql(
                embeddings[i]
              ),
            ]
          );
        }
      }
    } catch (
      embeddingError
    ) {
      console.error(
        "Embedding error:",
        embeddingError
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
    } else if (isPPTX) {
      fileType = "pptx";
    } else if (isImage) {
      fileType = "image";
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

    // ========================================================
    // CLEANUP SAVED FILE IF SOMETHING FAILED
    // ========================================================

    if (savedFilePath) {
      try {
        const absoluteFilePath =
          path.join(
            process.cwd(),
            "public",
            savedFilePath.replace(
              /^\/+/,
              ""
            )
          );

        await fs.unlink(
          absoluteFilePath
        );
      } catch (
        fileCleanupError
      ) {
        console.error(
          "File cleanup error:",
          fileCleanupError
        );
      }
    }

    // ========================================================
    // CLEANUP DOCUMENT IF SOMETHING FAILED
    // ========================================================

    if (createdDocumentId) {
      try {
        await prisma.document.delete(
          {
            where: {
              id: createdDocumentId,
            },
          }
        );
      } catch (
        cleanupError
      ) {
        console.error(
          "Document cleanup error:",
          cleanupError
        );
      }
    }

    // ========================================================
    // RETURN JSON ERROR
    // ========================================================

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
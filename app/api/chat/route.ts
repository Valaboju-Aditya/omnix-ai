import { prisma } from "@/lib/prisma";
import { retrieveRelevantChunks } from "@/lib/rag";

export async function POST(request: Request) {
  try {
    const { messages, conversationId } =
      await request.json();

    // --------------------------------------------------
    // VALIDATE REQUEST
    // --------------------------------------------------

    if (
      !Array.isArray(messages) ||
      messages.length === 0
    ) {
      return Response.json(
        {
          error: "Messages are required",
        },
        {
          status: 400,
        }
      );
    }

    const latestUserMessage =
      messages[messages.length - 1];

    if (
      !latestUserMessage ||
      latestUserMessage.role !== "user" ||
      typeof latestUserMessage.content !==
        "string"
    ) {
      return Response.json(
        {
          error: "Invalid user message",
        },
        {
          status: 400,
        }
      );
    }

    // --------------------------------------------------
    // CREATE OR FIND CONVERSATION
    // --------------------------------------------------

    let conversation;

    if (conversationId) {
      conversation =
        await prisma.conversation.findUnique({
          where: {
            id: conversationId,
          },
        });
    }

    if (!conversation) {
      conversation =
        await prisma.conversation.create({
          data: {
            title:
              latestUserMessage.content
                .substring(0, 50) ||
              "New Chat",
          },
        });

      console.log(
        "CHAT: Created conversation:",
        conversation.id
      );
    } else {
      console.log(
        "CHAT: Using conversation:",
        conversation.id
      );
    }

    // --------------------------------------------------
    // SAVE USER MESSAGE
    // --------------------------------------------------

    await prisma.message.create({
      data: {
        conversationId:
          conversation.id,
        role: "user",
        content:
          latestUserMessage.content,
      },
    });

    console.log(
      "CHAT: User message saved"
    );

    // --------------------------------------------------
    // GET MEMORIES
    // --------------------------------------------------

    const memories =
      await prisma.memory.findMany();

    const memoryText =
      memories.length > 0
        ? memories
            .map(
              (memory) =>
                `${memory.key}: ${memory.value}`
            )
            .join("\n")
        : "No saved memories.";

    console.log(
      `CHAT: Loaded ${memories.length} memories`
    );

    // --------------------------------------------------
    // CHECK WHETHER CONVERSATION HAS DOCUMENTS
    // --------------------------------------------------

    const documentCount =
      await prisma.document.count({
        where: {
          conversationId:
            conversation.id,
        },
      });

    console.log(
      "CHAT: Documents:",
      documentCount
    );

    // --------------------------------------------------
    // RAG RETRIEVAL
    // --------------------------------------------------

    let relevantChunks: Awaited<
      ReturnType<
        typeof retrieveRelevantChunks
      >
    > = [];

    if (documentCount > 0) {
      try {
        console.log(
          "RAG: Generating question embedding..."
        );

        relevantChunks =
          await retrieveRelevantChunks(
            latestUserMessage.content,
            conversation.id,
            5
          );

        console.log(
          `RAG: Retrieved ${relevantChunks.length} chunks`
        );
      } catch (error) {
        console.error(
          "RAG retrieval error:",
          error
        );

        relevantChunks = [];
      }
    } else {
      console.log(
        "RAG: No documents, skipping retrieval"
      );
    }

    // --------------------------------------------------
    // BUILD DOCUMENT CONTEXT
    // --------------------------------------------------

    const relevantDocumentText =
      relevantChunks.length > 0
        ? relevantChunks
            .map(
              (chunk, index) =>
                `[Source ${index + 1}: ${chunk.documentName}]\n${chunk.content}`
            )
            .join(
              "\n\n---\n\n"
            )
        : "";

    // --------------------------------------------------
    // BUILD SYSTEM PROMPT
    // --------------------------------------------------

    let systemPrompt = `You are Omnix.AI.

You are a helpful, accurate and natural AI assistant.

Here are the user's saved memories:

${memoryText}

Use these memories when they are relevant to the user's question.
Do not mention the memory system unless the user asks about it.

Answer clearly and naturally.

If the user asks a normal question that is unrelated
to uploaded documents, answer using your available knowledge.
`;

    // --------------------------------------------------
    // ADD RAG CONTEXT
    // --------------------------------------------------

    if (relevantDocumentText) {
      systemPrompt += `

The user has uploaded documents.

The following information was retrieved from those documents:

${relevantDocumentText}

IMPORTANT INSTRUCTIONS:

- Use the document information when it is relevant.
- Prefer the document information for questions about the uploaded files.
- Do not invent information that is not supported by the retrieved document content.
- If the retrieved document content does not contain the answer, clearly say that the uploaded document does not provide enough information.
- Do not mention embeddings, vector databases, chunks, retrieval, or the RAG system to the user.

`;
    }

    // --------------------------------------------------
    // CALL OLLAMA
    // --------------------------------------------------

    console.log(
      "CHAT: About to call Ollama"
    );

    const response = await fetch(
      "http://localhost:11434/api/chat",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          model: "qwen3:1.7b",
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            ...messages,
          ],
          stream: true,
        }),
      }
    );

    console.log(
      "CHAT: Ollama response received:",
      response.status
    );

    if (!response.ok || !response.body) {
      return Response.json(
        {
          error:
            "Ollama request failed",
        },
        {
          status: 500,
        }
      );
    }

    // --------------------------------------------------
    // STREAM RESPONSE
    // --------------------------------------------------

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder("utf-8");

    const encoder =
      new TextEncoder();

    let fullResponse = "";

    let streamClosed = false;

    const stream =
      new ReadableStream({
        async start(controller) {
          const safeEnqueue = (
            content: string
          ) => {
            if (
              streamClosed ||
              !content
            ) {
              return;
            }

            try {
              controller.enqueue(
                encoder.encode(content)
              );
            } catch (error) {
              console.error(
                "Stream enqueue error:",
                error
              );

              streamClosed = true;
            }
          };

          const safeClose = () => {
            if (streamClosed) {
              return;
            }

            try {
              streamClosed = true;
              controller.close();
            } catch (error) {
              console.error(
                "Stream close error:",
                error
              );
            }
          };

          const safeError = (
            error: unknown
          ) => {
            if (streamClosed) {
              return;
            }

            try {
              streamClosed = true;
              controller.error(error);
            } catch (controllerError) {
              console.error(
                "Stream controller error:",
                controllerError
              );
            }
          };

          try {
            let buffer = "";

            while (true) {
              const {
                done,
                value,
              } = await reader.read();

              if (done) {
                break;
              }

              buffer +=
                decoder.decode(
                  value,
                  {
                    stream: true,
                  }
                );

              const lines =
                buffer.split("\n");

              buffer =
                lines.pop() || "";

              for (const line of lines) {
                if (!line.trim()) {
                  continue;
                }

                try {
                  const data =
                    JSON.parse(line);

                  const content =
                    data.message
                      ?.content || "";

                  if (content) {
                    fullResponse +=
                      content;

                    safeEnqueue(
                      content
                    );
                  }
                } catch {
                  // Ignore malformed JSON
                }
              }
            }

            // ------------------------------------------------
            // PROCESS REMAINING BUFFER
            // ------------------------------------------------

            if (buffer.trim()) {
              try {
                const data =
                  JSON.parse(buffer);

                const content =
                  data.message
                    ?.content || "";

                if (content) {
                  fullResponse +=
                    content;

                  safeEnqueue(
                    content
                  );
                }
              } catch {
                // Ignore incomplete JSON
              }
            }

            // ------------------------------------------------
            // ADD DOCUMENT SOURCES
            // ------------------------------------------------

            const uniqueSources = [
              ...new Set(
                relevantChunks.map(
                  (chunk) =>
                    chunk.documentName
                )
              ),
            ];

            if (
              uniqueSources.length > 0 &&
              fullResponse
            ) {
              const sourceText = `\n\n---\n\n**Sources:**\n${uniqueSources
                .map(
                  (name) =>
                    `- 📄 ${name}`
                )
                .join("\n")}`;

              fullResponse +=
                sourceText;

              safeEnqueue(
                sourceText
              );
            }

            // ------------------------------------------------
            // SAVE ASSISTANT MESSAGE
            // ------------------------------------------------

            if (fullResponse) {
              await prisma.message.create({
                data: {
                  conversationId:
                    conversation.id,
                  role: "assistant",
                  content:
                    fullResponse,
                },
              });

              console.log(
                "CHAT: Assistant response saved"
              );
            }

            // ------------------------------------------------
            // UPDATE CONVERSATION TIME
            // ------------------------------------------------

            await prisma.conversation.update({
              where: {
                id: conversation.id,
              },
              data: {
                updatedAt:
                  new Date(),
              },
            });

            // ------------------------------------------------
            // SAVE USER NAME TO MEMORY
            // ------------------------------------------------

            const userText =
              latestUserMessage.content.trim();

            const nameMatch =
              userText.match(
                /(?:my name is|i am|i'm)\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)/i
              );

            if (nameMatch) {
              const name =
                nameMatch[1].trim();

              await prisma.memory.upsert({
                where: {
                  key: "name",
                },
                update: {
                  value: name,
                },
                create: {
                  key: "name",
                  value: name,
                },
              });

              console.log(
                "MEMORY: Saved name:",
                name
              );
            }

            // ------------------------------------------------
            // CLOSE STREAM
            // ------------------------------------------------

            safeClose();
          } catch (error) {
            console.error(
              "Streaming error:",
              error
            );

            safeError(error);
          }
        },

        cancel() {
          streamClosed = true;

          try {
            reader.cancel();
          } catch {
            // Ignore cancellation error
          }
        },
      });

    // --------------------------------------------------
    // RETURN STREAM
    // --------------------------------------------------

    return new Response(stream, {
      headers: {
        "Content-Type":
          "text/plain; charset=utf-8",
        "Cache-Control":
          "no-cache",
        "X-Accel-Buffering":
          "no",
      },
    });
  } catch (error) {
    console.error(
      "Chat API error:",
      error
    );

    return Response.json(
      {
        error:
          "Something went wrong. Make sure PostgreSQL and Ollama are running.",
      },
      {
        status: 500,
      }
    );
  }
}
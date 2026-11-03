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
        .map((chunk, index) => {
          const locationLabel =
            chunk.pageNumber != null
              ? `Page ${chunk.pageNumber}`
              : chunk.slideNumber != null
                ? `Slide ${chunk.slideNumber}`
                : "Location unknown";

          return [
            `[Source ${index + 1}]`,
            `Document: ${chunk.documentName}`,
            `Location: ${locationLabel}`,
            "Content:",
            chunk.content,
          ].join("\n");
        })
        .join("\n\n---\n\n")
    : "";

 
    // --------------------------------------------------
    // BUILD SYSTEM PROMPT
    // --------------------------------------------------

    const conversationHistory = messages
      .slice(0, -1)
      .slice(-8)
      .map((item: { role: string; content: string }) => {
        return `${item.role}: ${item.content}`;
      })
      .join("\n\n");

    let systemPrompt = `You are Omnix.AI, a helpful AI assistant.

USER MEMORIES:
${memoryText}

Use memories only when relevant. Do not mention the memory system unless asked.

CORE RULES:
1. Answer the user's actual question directly.
2. Explain concepts using your general knowledge when the user asks for an explanation.
3. Never refuse to explain a topic just because an uploaded document contains only a heading.
4. Clearly distinguish document facts from additional explanations.
5. Keep answers understandable, organized, and useful.
6. For follow-up questions such as "explain it", "why?", or "give examples", use the previous conversation to identify the topic.
7. Do not repeat the same disclaimer instead of answering.
8. If the user asks for advantages, disadvantages, examples, or applications, provide them directly.

PREVIOUS CONVERSATION:
${conversationHistory || "No previous conversation provided."}

If the question is unrelated to uploaded documents, answer using your general knowledge.
`;

    // --------------------------------------------------
    // ADD DOCUMENT CONTEXT
    // --------------------------------------------------

    if (relevantDocumentText) {
      systemPrompt += `

UPLOADED DOCUMENT CONTEXT:
The following text was retrieved from the user's documents.
Treat it as evidence of what the document actually contains.

${relevantDocumentText}

DOCUMENT ANSWERING RULES:
- For questions about a specific page, describe the content retrieved from that page.
- Do not claim that information appears in the document unless the retrieved text supports that claim.
- If a page contains only a heading, state that briefly, then explain the heading if the user asks for an explanation.
- If the user asks to explain a concept, answer the concept question using general knowledge even if the document provides no details.
- Label additional knowledge as "General explanation" when it is not present in the document.
- If the user asks "explain machine learning advantages", explain the advantages of machine learning. Do not merely repeat the heading.
- If the user asks "explain it", resolve "it" using the previous conversation and answer that topic.
- Never invent document quotations, page contents, or citations.
- Do not mention internal retrieval processes, embeddings, chunks, or databases.
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

    const stream = new ReadableStream({
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

            buffer += decoder.decode(
              value,
              {
                stream: true,
              }
            );

            const lines =
              buffer.split("\n");

            buffer =
              lines.pop() || "";

            for (
              const line of lines
            ) {
              if (!line.trim()) {
                continue;
              }

              try {
                const data =
                  JSON.parse(line);

                const content =
                  data.message?.content ||
                  "";

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
                data.message?.content ||
                "";

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
            ...new Map(
              relevantChunks.map((chunk) => [
                `${chunk.documentId}-${chunk.pageNumber ?? "none"}-${chunk.slideNumber ?? "none"}`,
                {
                  documentId: chunk.documentId,
                  documentName: chunk.documentName,
                  pageNumber: chunk.pageNumber ?? null,
                  slideNumber: chunk.slideNumber ?? null,
                },
              ])
            ).values(),
          ];

          if (uniqueSources.length > 0 && fullResponse) {
            const sourceText =
              `\n\n---\n\n**Sources:**\n${uniqueSources
                .map((source) => {
                  const locationText =
                    source.pageNumber != null
                      ? ` — Page ${source.pageNumber}`
                      : source.slideNumber != null
                        ? ` — Slide ${source.slideNumber}`
                        : "";

                  return `- 📄 ${source.documentName}${locationText}`;
                })
                .join("\n")}`;

            fullResponse += sourceText;
            safeEnqueue(sourceText);

            // Send structured source metadata to the frontend.
            const sourceMetadata = JSON.stringify({
              type: "sources",
              sources: uniqueSources,
            });

            const sourceMetadataText =
              `\n\n__OMNIX_SOURCES__${sourceMetadata}__END_OMNIX_SOURCES__`;

            fullResponse += sourceMetadataText;
            safeEnqueue(sourceMetadataText);
          }


          // ------------------------------------------------
          // SAVE ASSISTANT MESSAGE
          // ------------------------------------------------

          
if (fullResponse) {
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: fullResponse,
    },
  });

  console.log("CHAT: Assistant response saved");
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
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "X-Conversation-Id": conversation.id,
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
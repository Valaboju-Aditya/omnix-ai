import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const {
      conversationId,
      messages,
      mode,
      editIndex,
    } = await request.json();

    if (!conversationId) {
      return Response.json(
        { error: "Conversation ID is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "Messages are required" },
        { status: 400 }
      );
    }

    const conversation =
      await prisma.conversation.findUnique({
        where: {
          id: conversationId,
        },
      });

    if (!conversation) {
      return Response.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    /*
     * EDIT MODE
     *
     * Remove the old messages starting from
     * the edited user message.
     */
    if (
      mode === "edit" &&
      typeof editIndex === "number"
    ) {
      const existingMessages =
        await prisma.message.findMany({
          where: {
            conversationId,
          },
          orderBy: {
            createdAt: "asc",
          },
        });

      const messageToEdit =
        existingMessages[editIndex];

      if (messageToEdit) {
        await prisma.message.deleteMany({
          where: {
            conversationId,
            createdAt: {
              gte: messageToEdit.createdAt,
            },
          },
        });
      }
    }

    /*
     * REGENERATE MODE
     *
     * Remove the latest assistant response.
     */
    if (mode === "regenerate") {
      const latestAssistant =
        await prisma.message.findFirst({
          where: {
            conversationId,
            role: "assistant",
          },
          orderBy: {
            createdAt: "desc",
          },
        });

      if (latestAssistant) {
        await prisma.message.delete({
          where: {
            id: latestAssistant.id,
          },
        });
      }
    }

    /*
     * Save the user message for EDIT mode.
     */
    if (
      mode === "edit" &&
      messages[messages.length - 1]?.role ===
        "user"
    ) {
      const latestUserMessage =
        messages[messages.length - 1];

      await prisma.message.create({
        data: {
          conversationId,
          role: "user",
          content: latestUserMessage.content,
        },
      });
    }

    const response = await fetch(
      "http://localhost:11434/api/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen3:1.7b",
          messages: [
            {
              role: "system",
              content:
                "You are Omnix.AI, a helpful personal AI assistant.",
            },
            ...messages,
          ],
          stream: true,
        }),
      }
    );

    if (!response.ok || !response.body) {
      return Response.json(
        {
          error: "Ollama request failed",
        },
        { status: 500 }
      );
    }

    const reader =
      response.body.getReader();

    const decoder = new TextDecoder();

    let fullResponse = "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } =
              await reader.read();

            if (done) {
              break;
            }

            const chunk =
              decoder.decode(value, {
                stream: true,
              });

            const lines =
              chunk
                .split("\n")
                .filter(Boolean);

            for (const line of lines) {
              try {
                const data =
                  JSON.parse(line);

                const content =
                  data.message?.content || "";

                if (content) {
                  fullResponse += content;

                  controller.enqueue(
                    new TextEncoder().encode(
                      content
                    )
                  );
                }
              } catch {
                // Ignore incomplete JSON
              }
            }
          }

          if (fullResponse) {
            await prisma.message.create({
              data: {
                conversationId,
                role: "assistant",
                content: fullResponse,
              },
            });
          }

          controller.close();
        } catch (error) {
          console.error(
            "Chat action streaming error:",
            error
          );

          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type":
          "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error(
      "Chat action API error:",
      error
    );

    return Response.json(
      {
        error:
          "Failed to process chat action",
      },
      { status: 500 }
    );
  }
}
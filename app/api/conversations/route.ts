import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return Response.json(conversations);
  } catch (error) {
    console.error("Failed to load conversations:", error);

    return Response.json(
      { error: "Failed to load conversations" },
      { status: 500 }
    );
  }
}
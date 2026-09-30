import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// GET - Load a conversation
export async function GET(
  request: Request,
  { params }: RouteContext
) {
  try {
    const { id } = await params;

    const conversation =
      await prisma.conversation.findUnique({
        where: {
          id,
        },
        include: {
          messages: {
            orderBy: {
              createdAt: "asc",
            },
          },
          documents: {
            select: {
              id: true,
              name: true,
              createdAt: true,
            },
            orderBy: {
              createdAt: "asc",
            },
          },
        },
      });

    if (!conversation) {
      return Response.json(
        {
          error: "Conversation not found",
        },
        { status: 404 }
      );
    }

    return Response.json(conversation);
  } catch (error) {
    console.error(
      "Conversation GET error:",
      error
    );

    return Response.json(
      {
        error:
          "Failed to load conversation",
      },
      { status: 500 }
    );
  }
}

// PATCH - Rename a conversation
export async function PATCH(
  request: Request,
  { params }: RouteContext
) {
  try {
    const { id } = await params;

    const body = await request.json();

    const title =
      typeof body.title === "string"
        ? body.title.trim()
        : "";

    if (!title) {
      return Response.json(
        {
          error: "Title is required",
        },
        { status: 400 }
      );
    }

    if (title.length > 100) {
      return Response.json(
        {
          error:
            "Title must be 100 characters or less",
        },
        { status: 400 }
      );
    }

    const conversation =
      await prisma.conversation.update({
        where: {
          id,
        },
        data: {
          title,
        },
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
        },
      });

    return Response.json(conversation);
  } catch (error) {
    console.error(
      "Conversation PATCH error:",
      error
    );

    return Response.json(
      {
        error:
          "Failed to rename conversation",
      },
      { status: 500 }
    );
  }
}

// DELETE - Delete a conversation
export async function DELETE(
  request: Request,
  { params }: RouteContext
) {
  try {
    const { id } = await params;

    const conversation =
      await prisma.conversation.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
        },
      });

    if (!conversation) {
      return Response.json(
        {
          error: "Conversation not found",
        },
        { status: 404 }
      );
    }

    await prisma.conversation.delete({
      where: {
        id,
      },
    });

    return Response.json({
      success: true,
      message: "Conversation deleted",
    });
  } catch (error) {
    console.error(
      "Conversation DELETE error:",
      error
    );

    return Response.json(
      {
        error:
          "Failed to delete conversation",
      },
      { status: 500 }
    );
  }
}
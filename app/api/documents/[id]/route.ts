import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(
  request: Request,
  { params }: RouteContext
) {
  try {
    const { id } = await params;

    const document =
      await prisma.document.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          name: true,
        },
      });

    if (!document) {
      return Response.json(
        {
          error: "Document not found",
        },
        { status: 404 }
      );
    }

    await prisma.document.delete({
      where: {
        id,
      },
    });

    return Response.json({
      success: true,
      message: "Document deleted successfully",
      documentId: document.id,
      fileName: document.name,
    });
  } catch (error) {
    console.error(
      "Document DELETE error:",
      error
    );

    return Response.json(
      {
        error: "Failed to delete document",
      },
      { status: 500 }
    );
  }
}
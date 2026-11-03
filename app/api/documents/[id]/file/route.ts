import { prisma } from "@/lib/prisma";
import fs from "fs/promises";
import path from "path";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
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
          name: true,
          filePath: true,
        },
      });

    if (!document) {
      return Response.json(
        {
          error: "Document not found",
        },
        {
          status: 404,
        }
      );
    }

    if (!document.filePath) {
      return Response.json(
        {
          error:
            "This document does not have a stored file.",
        },
        {
          status: 404,
        }
      );
    }

    const relativePath =
      document.filePath.replace(
        /^\/+/,
        ""
      );

    const filePath = path.join(
      process.cwd(),
      "public",
      relativePath
    );

    const fileBuffer =
      await fs.readFile(filePath);

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/pdf",
        "Content-Disposition": `inline; filename="${document.name}"`,
        "Cache-Control":
          "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error(
      "Document file error:",
      error
    );

    return Response.json(
      {
        error:
          "Failed to open document",
      },
      {
        status: 500,
      }
    );
  }
}